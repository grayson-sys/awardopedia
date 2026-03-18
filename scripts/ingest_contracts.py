#!/usr/bin/env python3
"""
ingest_contracts.py — Phase 4 Script 1: Always-on contract ingestion from USASpending

Fetches awarded contracts from USASpending.gov search API, enriches each with
full detail (58 fields), generates Ollama summaries for new records.

USAGE:
  python3 scripts/ingest_contracts.py                # full run
  python3 scripts/ingest_contracts.py --limit 10     # test: 10 records only
  python3 scripts/ingest_contracts.py --resume       # restart from last saved page
  python3 scripts/ingest_contracts.py --reset        # clear progress and start fresh

RATE LIMITS:
  USASpending: no meaningful limit — but be polite: 1s sleep between pages
  Max 60 pages/minute (enforced)
  Never loads more than 1 page (100 records) at a time

PROGRESS:
  Written to ~/awardopedia/logs/ingest_progress.json after every page.
  Script is resumable — if interrupted, run with --resume.

CRON (Mac Mini, runs daily 1am):
  0 1 * * * cd ~/awardopedia && python3 scripts/ingest_contracts.py >> logs/ingest.log 2>&1
"""

import os, sys, json, time, urllib.request, urllib.error
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

sys.path.insert(0, str(Path(__file__).parent))
from enrich_usaspending import fetch_award, parse_award, upsert, run_ollama_summary

USASPENDING_BASE = "https://api.usaspending.gov/api/v2/awards"

def fetch_award_smart(piid: str, internal_id: str = None) -> dict | None:
    """
    Try generated_internal_id URL first (most reliable), fall back to piid lookup.
    The search API gives us generated_internal_id like CONT_AWD_FA877324C0001_9700_...
    which is what the detail endpoint actually expects.
    """
    urls_to_try = []
    if internal_id:
        urls_to_try.append(f"{USASPENDING_BASE}/{internal_id}/")
    # Fall back to standard fetch_award logic
    raw = None
    for url in urls_to_try:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Awardopedia/1.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = json.loads(r.read().decode())
                print(f"✓ internal_id fetch OK", end=' ')
                return raw
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
    # Fallback: enrich_usaspending's own retry logic
    return fetch_award(piid)

# ── Config ────────────────────────────────────────────────────────────────────

PROGRESS_FILE = Path(__file__).parent.parent / 'logs' / 'ingest_progress.json'
LOG_DIR       = Path(__file__).parent.parent / 'logs'
LOG_DIR.mkdir(exist_ok=True)

SEARCH_URL    = "https://api.usaspending.gov/api/v2/search/spending_by_award/"
PAGE_SIZE     = 100
MIN_PAGE_SECS = 1.0   # at least 1 second between pages (max 60/min)

# Target: professional services + defense, contracts only, 2024-present
# Adjust these filters to change what gets ingested
SEARCH_FILTERS = {
    "award_type_codes": ["A", "B", "C", "D"],  # Definitive contracts only
    "time_period": [
        {
            "start_date": "2024-01-01",
            "end_date": datetime.today().strftime("%Y-%m-%d")
        }
    ],
    "award_amounts": [
        {"lower_bound": 500000, "upper_bound": 50000000}
    ]
}

SEARCH_FIELDS = [
    "Award ID",
    "Recipient Name",
    "Start Date",
    "End Date",
    "Award Amount",
    "Awarding Agency",
    "Awarding Sub Agency",
    "Contract Award Type",
    "recipient_id",
    "prime_award_recipient_id",
    "generated_internal_id"
]

# ── Progress tracking ─────────────────────────────────────────────────────────

def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        try:
            return json.loads(PROGRESS_FILE.read_text())
        except:
            pass
    return {"pages_done": 0, "records_inserted": 0, "records_updated": 0,
            "errors": 0, "last_piid": None, "last_page": 0, "timestamp": None}

def save_progress(p: dict):
    p["timestamp"] = datetime.utcnow().isoformat()
    PROGRESS_FILE.write_text(json.dumps(p, indent=2))

# ── USASpending search (get list of award IDs) ────────────────────────────────

def search_page(page: int, limit: int = PAGE_SIZE) -> dict:
    """Fetch one page of awards from USASpending search."""
    body = json.dumps({
        "filters": SEARCH_FILTERS,
        "fields": SEARCH_FIELDS,
        "limit": limit,
        "page": page,
        "sort": "Award Amount",
        "order": "desc",
        "subawards": False
    }).encode()

    req = urllib.request.Request(
        SEARCH_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Awardopedia/1.0 (awardopedia.com)"
        }
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def already_exists(piid: str) -> bool:
    """Check if a contract already exists in DB."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM contracts WHERE piid = %s", [piid])
    exists = cur.fetchone() is not None
    conn.close()
    return exists

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit',   type=int, help='Max records to process (for testing)')
    parser.add_argument('--resume',  action='store_true', help='Resume from saved progress')
    parser.add_argument('--reset',   action='store_true', help='Clear progress and start fresh')
    parser.add_argument('--no-summary', action='store_true', help='Skip Ollama summaries')
    args = parser.parse_args()

    print("=" * 60)
    print("AWARDOPEDIA — CONTRACT INGEST (USASpending)")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    if args.limit:
        print(f"TEST MODE: limit {args.limit} records")
    print("=" * 60)

    # Load or reset progress
    if args.reset:
        progress = {"pages_done": 0, "records_inserted": 0, "records_updated": 0,
                    "errors": 0, "last_piid": None, "last_page": 0, "timestamp": None}
        save_progress(progress)
        print("Progress reset.")
    else:
        progress = load_progress()

    start_page = (progress.get("last_page", 0) + 1) if args.resume else 1
    if args.resume and progress.get("last_page", 0) > 0:
        print(f"Resuming from page {start_page} "
              f"({progress['records_inserted']} inserted so far)")

    total_processed = 0
    page = start_page

    while True:
        # Check limit
        if args.limit and total_processed >= args.limit:
            print(f"\nLimit of {args.limit} records reached.")
            break

        page_limit = PAGE_SIZE
        if args.limit:
            page_limit = min(PAGE_SIZE, args.limit - total_processed)

        print(f"\n── Page {page} ──────────────────────────────────────────")
        t_page = time.time()

        try:
            data = search_page(page, limit=page_limit)
        except Exception as e:
            print(f"  ✗ Search failed: {e}")
            progress['errors'] += 1
            save_progress(progress)
            break

        results = data.get('results', [])
        has_next = data.get('page_metadata', {}).get('hasNext', False)

        print(f"  Got {len(results)} records  |  hasNext={has_next}")

        if not results:
            print("  No more records.")
            break

        for i, row in enumerate(results, 1):
            # "Award ID" from USASpending search IS the PIID directly
            piid = (row.get('Award ID') or '').strip()
            internal_id = (row.get('generated_internal_id') or '').strip() or None
            if not piid:
                print(f"  [{i}] ✗ No Award ID in row — skipping")
                progress['errors'] += 1
                continue

            recipient = (row.get('Recipient Name') or '')[:35]
            print(f"  [{i}/{len(results)}] {piid} — {recipient}", end=' ')

            # Check if new or update
            is_new = not already_exists(piid)

            try:
                # Fetch full detail from USASpending (uses generated_internal_id if available)
                raw = fetch_award_smart(piid, internal_id)
                if not raw:
                    print("✗ not found on USASpending")
                    progress['errors'] += 1
                    continue

                fields = parse_award(raw)
                upsert(fields)

                if is_new:
                    progress['records_inserted'] += 1
                    print(f"✓ new", end='')
                else:
                    progress['records_updated'] += 1
                    print(f"↻ updated", end='')

                total_processed += 1
                progress['last_piid'] = piid

                # Ollama summary for new records only
                if is_new and not args.no_summary:
                    run_ollama_summary(piid)
                    print(f" + summary", end='')
                    try:
                        from generate_static import generate_page_for_piid
                        generate_page_for_piid(piid)
                        print(f" + page", end='')
                    except Exception as e:
                        pass  # non-fatal

                print()

            except Exception as e:
                print(f"  ✗ Error: {e}")
                progress['errors'] += 1
                continue

        # Save progress after every page
        progress['pages_done'] += 1
        progress['last_page'] = page
        save_progress(progress)

        print(f"\n  Page {page} done — "
              f"{progress['records_inserted']} inserted, "
              f"{progress['records_updated']} updated, "
              f"{progress['errors']} errors")

        if not has_next:
            print("\nAll pages complete.")
            break

        # Rate limiting: at least 1 second per page
        elapsed = time.time() - t_page
        if elapsed < MIN_PAGE_SECS:
            time.sleep(MIN_PAGE_SECS - elapsed)

        page += 1

    # Final summary
    print("\n" + "=" * 60)
    print(f"DONE: {progress['records_inserted']} inserted, "
          f"{progress['records_updated']} updated, "
          f"{progress['errors']} errors")
    print(f"Progress saved → {PROGRESS_FILE}")
    print("=" * 60)
