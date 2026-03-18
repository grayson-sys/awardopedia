#!/usr/bin/env python3
"""
sync_opportunities.py — Phase 4 Script 3: Daily SAM.gov opportunity sync

Fetches solicitations posted in the last 7 days, upserts into opportunities table.
For recompetes: attempts to link to existing contract by solicitation number.
Generates Ollama summaries for new records.

ENDPOINT: https://api.sam.gov/opportunities/v2/search
RATE LIMIT: same daily quota as Contract Awards API (10/day no role, 1000/day with role)
ONE API call per run (limit=100). Do not add more calls.

USAGE:
  python3 scripts/sync_opportunities.py              # last 7 days
  python3 scripts/sync_opportunities.py --days 30    # last 30 days
  python3 scripts/sync_opportunities.py --limit 10   # test: 10 records
  python3 scripts/sync_opportunities.py --dry-run    # show query, don't write DB

CRON (Mac Mini, daily 2am):
  0 2 * * * cd ~/awardopedia && python3 scripts/sync_opportunities.py >> logs/sync.log 2>&1
"""

import os, sys, json, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path
from datetime import datetime, timedelta

# ── Load .env ─────────────────────────────────────────────────────────────────
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2, psycopg2.extras

DATABASE_URL = os.environ['DATABASE_URL']
SAM_API_KEY  = os.environ.get('SAM_API_KEY', '')

SAM_OPPS_URL = "https://api.sam.gov/opportunities/v2/search"

sys.path.insert(0, str(Path(__file__).parent))
from fetch_opportunity import parse_opportunity, upsert_opportunity, run_ollama_summary_opp

# ── Recompete detection ───────────────────────────────────────────────────────

def find_related_piid(solicitation_number: str, naics: str) -> str | None:
    """Try to find an existing contract that matches this opportunity's solicitation."""
    if not solicitation_number:
        return None
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    # Match by solicitation number first (most reliable)
    cur.execute(
        "SELECT piid FROM contracts WHERE solicitation_number = %s LIMIT 1",
        [solicitation_number]
    )
    row = cur.fetchone()
    conn.close()
    return row[0] if row else None

def already_exists(notice_id: str) -> bool:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM opportunities WHERE notice_id = %s", [notice_id])
    exists = cur.fetchone() is not None
    conn.close()
    return exists

# ── SAM.gov fetch (ONE call) ──────────────────────────────────────────────────

def fetch_opportunities(days_back: int = 7, limit: int = 100) -> list:
    if not SAM_API_KEY:
        print("✗ SAM_API_KEY not set in .env")
        sys.exit(1)

    posted_from = (datetime.today() - timedelta(days=days_back)).strftime("%m/%d/%Y")
    posted_to   = datetime.today().strftime("%m/%d/%Y")

    params = urllib.parse.urlencode({
        "api_key": SAM_API_KEY,
        "limit":   str(limit),
        "offset":  "0",
        "postedFrom": posted_from,
        "postedTo":   posted_to,
        "ptype": "o",   # o=solicitation, k=combined, p=presolicitation
        "status": "active",
        "sortBy": "-modifiedDate",
    })

    url = f"{SAM_OPPS_URL}?{params}"
    print(f"\nSAM.gov Opportunities API (1 call):")
    print(f"  postedFrom={posted_from}  postedTo={posted_to}  limit={limit}")

    req = urllib.request.Request(url, headers={"User-Agent": "Awardopedia/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        if e.code == 429:
            print(f"  ✗ Rate limit hit. Resets midnight UTC (6pm MDT).")
        else:
            print(f"  ✗ HTTP {e.code}: {body}")
        sys.exit(1)

    # Save raw
    out = Path(__file__).parent.parent / 'data'
    out.mkdir(exist_ok=True)
    (out / 'sam_opps_sync_latest.json').write_text(json.dumps(data, indent=2, default=str))

    opps = data.get('opportunitiesData', data.get('data', []))
    print(f"  ✓ {len(opps)} opportunities returned")
    return opps

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--days',    type=int, default=7, help='Days back to sync (default 7)')
    parser.add_argument('--limit',   type=int, default=100, help='Max records (default 100)')
    parser.add_argument('--dry-run', action='store_true', help='Show plan, do not write DB')
    parser.add_argument('--no-summary', action='store_true', help='Skip Ollama summaries')
    args = parser.parse_args()

    print("=" * 60)
    print("AWARDOPEDIA — OPPORTUNITY SYNC (SAM.gov)")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"⚠️  SAM.gov rate limit: 10/day (no role) | 1,000/day (with role)")
    print("=" * 60)

    if args.dry_run:
        print(f"\n[DRY RUN] Would fetch last {args.days} days, limit {args.limit}")
        print(f"  URL: {SAM_OPPS_URL}?api_key=***&postedFrom=...&limit={args.limit}")
        sys.exit(0)

    raw_opps = fetch_opportunities(days_back=args.days, limit=args.limit)
    if not raw_opps:
        print("No opportunities returned.")
        sys.exit(0)

    inserted, updated, errors = 0, 0, 0

    for i, raw in enumerate(raw_opps, 1):
        fields = parse_opportunity(raw)
        notice_id = fields.get('notice_id')
        title = (fields.get('title') or '')[:45]

        print(f"\n[{i}/{len(raw_opps)}] {notice_id or 'NO-ID'} — {title}")

        if not notice_id:
            print("  ✗ No notice_id — skipping")
            errors += 1
            continue

        is_new = not already_exists(notice_id)

        # Recompete detection
        related_piid = find_related_piid(
            fields.get('solicitation_number'),
            fields.get('naics_code')
        )
        if related_piid:
            fields['related_piid'] = related_piid
            fields['is_recompete'] = True
            print(f"  🔁 Recompete detected → {related_piid}")

        try:
            upsert_opportunity(fields)
            if is_new:
                inserted += 1
                print(f"  ✓ New")
            else:
                updated += 1
                print(f"  ↻ Updated")

            if is_new and not args.no_summary:
                run_ollama_summary_opp(notice_id)

        except Exception as e:
            print(f"  ✗ DB error: {e}")
            errors += 1

        time.sleep(0.2)

    print(f"\n{'=' * 60}")
    print(f"DONE: {inserted} new, {updated} updated, {errors} errors")
    print(f"Log: ~/awardopedia/logs/sync.log")
