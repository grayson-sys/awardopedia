#!/usr/bin/env python3
"""
enrich_fpds.py — Phase 4 Script 2: Enrich contracts with CO data from SAM.gov

For each contract where fpds_enriched = false, fetches contracting officer
name, email, and phone from the SAM.gov Contract Awards API (FPDS replacement).

ENDPOINT: https://api.sam.gov/contract-awards/v1/search
NOTE: fpds.gov/ezsearch is DEAD. This script uses the correct replacement.
Docs: https://open.gsa.gov/api/contract-awards/

RATE LIMITS (SAM.gov personal key):
  No role in SAM.gov:    10 calls/day  ← current state
  With any SAM.gov role: 1,000 calls/day
  Resets: midnight UTC = 6pm MDT

USAGE:
  python3 scripts/enrich_fpds.py              # enrich all un-enriched contracts
  python3 scripts/enrich_fpds.py --limit 10   # test: 10 records only
  python3 scripts/enrich_fpds.py --piid FA877324C0001  # one specific contract

CRON (Mac Mini, runs after ingest):
  # Not on cron — run manually after API resets (10/day limit)
  # Once SAM.gov role is approved (1,000/day), add to cron:
  # 30 1 * * * cd ~/awardopedia && python3 scripts/enrich_fpds.py >> logs/enrich.log 2>&1
"""

import os, sys, json, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path
from datetime import datetime

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

SAM_URL = "https://api.sam.gov/contract-awards/v1/search"

# ── DB helpers ────────────────────────────────────────────────────────────────

def fetch_unenriched(piid: str = None, limit: int = None) -> list:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    if piid:
        cur.execute("SELECT piid, recipient_name FROM contracts WHERE piid = %s", [piid])
    elif limit:
        cur.execute("""
            SELECT piid, recipient_name FROM contracts
            WHERE fpds_enriched = false OR fpds_enriched IS NULL
            ORDER BY award_amount DESC NULLS LAST
            LIMIT %s
        """, [limit])
    else:
        cur.execute("""
            SELECT piid, recipient_name FROM contracts
            WHERE fpds_enriched = false OR fpds_enriched IS NULL
            ORDER BY award_amount DESC NULLS LAST
        """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def save_co_data(piid: str, co: dict):
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("""
        UPDATE contracts SET
            contracting_officer       = COALESCE(%s, contracting_officer),
            contracting_officer_email = COALESCE(%s, contracting_officer_email),
            contracting_officer_phone = COALESCE(%s, contracting_officer_phone),
            fpds_enriched             = true
        WHERE piid = %s
    """, [
        co.get('name'),
        co.get('email'),
        co.get('phone'),
        piid
    ])
    conn.close()

# ── SAM.gov Contract Awards API ───────────────────────────────────────────────

def fetch_co_data(piid: str) -> dict:
    """
    Query SAM.gov Contract Awards API for contracting officer data.
    ONE API call per PIID — counts against daily quota.
    """
    if not SAM_API_KEY:
        raise ValueError("SAM_API_KEY not set in .env")

    params = urllib.parse.urlencode({
        "api_key": SAM_API_KEY,
        "q": f"piid:{piid}",
        "limit": "1"
    })
    url = f"{SAM_URL}?{params}"

    req = urllib.request.Request(
        url.replace(SAM_API_KEY, "***"),  # safe display
        headers={"User-Agent": "Awardopedia/1.0"}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Awardopedia/1.0"})

    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        if e.code == 429:
            raise RuntimeError(f"Rate limit hit. Resets midnight UTC (6pm MDT). {body}")
        raise RuntimeError(f"HTTP {e.code}: {body}")

    # Save raw response for debugging
    out = Path(__file__).parent.parent / 'data'
    out.mkdir(exist_ok=True)
    (out / f'sam_co_{piid}.json').write_text(json.dumps(data, indent=2, default=str))

    # Extract contracting officer from response
    records = []
    if isinstance(data, list):
        records = data
    elif isinstance(data, dict):
        for key in ['contractData', 'data', 'results']:
            if key in data:
                v = data[key]
                records = v if isinstance(v, list) else []
                break

    if not records:
        return {}

    rec = records[0]

    def g(*keys):
        for k in keys:
            parts = k.split('.')
            v = rec
            for p in parts:
                if not isinstance(v, dict): break
                v = v.get(p)
            if v: return v
        return None

    return {
        'name':  g('contractingOfficerName', 'co_name', 'contractingOfficer.name'),
        'email': g('contractingOfficerEmail', 'co_email', 'contractingOfficer.email'),
        'phone': g('contractingOfficerPhone', 'co_phone', 'contractingOfficer.phone'),
    }

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--piid',  help='Enrich one specific contract')
    parser.add_argument('--limit', type=int, help='Max contracts to enrich')
    args = parser.parse_args()

    if not SAM_API_KEY:
        print("✗ SAM_API_KEY not set in .env")
        sys.exit(1)

    print("=" * 60)
    print("AWARDOPEDIA — FPDS/CO ENRICHMENT (SAM.gov Contract Awards API)")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"⚠️  SAM.gov rate limit: 10/day (no role) | 1,000/day (with role)")
    print("=" * 60)

    contracts = fetch_unenriched(piid=args.piid, limit=args.limit)
    print(f"\n{len(contracts)} contract(s) to enrich")

    if not contracts:
        print("All contracts already enriched.")
        sys.exit(0)

    success, skipped, errors = 0, 0, 0

    for i, c in enumerate(contracts, 1):
        piid = c['piid']
        name = (c.get('recipient_name') or '')[:35]
        print(f"\n[{i}/{len(contracts)}] {piid} — {name}")

        try:
            co = fetch_co_data(piid)
            if co.get('name') or co.get('email'):
                save_co_data(piid, co)
                print(f"  ✓ CO: {co.get('name') or '—'} | {co.get('email') or '—'}")
                success += 1
            else:
                # Still mark as enriched (attempted) so we don't retry forever
                save_co_data(piid, {})
                print(f"  ○ No CO data found — marked as attempted")
                skipped += 1
        except RuntimeError as e:
            if "Rate limit" in str(e):
                print(f"  ✗ {e}")
                print(f"  Stopping — {success} enriched before limit hit.")
                break
            print(f"  ✗ Error: {e}")
            errors += 1
        except Exception as e:
            print(f"  ✗ Error: {e}")
            errors += 1

        # Be polite: 0.5s between requests
        if i < len(contracts):
            time.sleep(0.5)

    print(f"\nDone: {success} enriched, {skipped} no data found, {errors} errors")
