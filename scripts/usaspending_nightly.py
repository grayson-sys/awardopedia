#!/usr/bin/env python3
"""
usaspending_nightly.py — Delta ingest of USASpending contracts

Runs nightly in its own cron slot, independent of the opportunity pipeline.
Fetches contracts that are:
  1. Last-modified in the past 30 days
  2. Award date within the last 5 years (retention window)
  3. Not already in our contracts table

Then prunes contracts older than 5 years from start_date.

This script is intentionally decoupled from pipeline_opportunity.py so a
USASpending API hiccup never blocks the opportunity pipeline.

USAGE:
  python3 scripts/usaspending_nightly.py              # normal run
  python3 scripts/usaspending_nightly.py --dry-run    # count only
  python3 scripts/usaspending_nightly.py --days 60    # look back further
"""

import os, sys, json, argparse, time, urllib.request
from pathlib import Path
from datetime import datetime, timedelta

# ── Load .env ────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.parent
ENV_PATH = BASE_DIR / '.env'
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2

DATABASE_URL = os.environ['DATABASE_URL']
LOG_DIR = BASE_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)

USASPENDING_SEARCH_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/"
USASPENDING_DETAIL_URL = "https://api.usaspending.gov/api/v2/awards/"
PAGE_SIZE = 100
RETENTION_YEARS = 5
DEFAULT_LOOKBACK_DAYS = 30


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {msg}", flush=True)


def db_connect():
    """Connect with DNS retry (same pattern as pipeline scripts)."""
    for attempt in range(5):
        try:
            return psycopg2.connect(DATABASE_URL)
        except psycopg2.OperationalError as e:
            if attempt < 4 and 'could not translate host name' in str(e):
                log(f"DNS error, retry {attempt + 1}/5 in 30s...")
                time.sleep(30)
            else:
                raise


def fetch_modified_contracts(lookback_days: int, limit: int = 5000) -> list:
    """
    Search USASpending for contracts modified in the past N days,
    awarded within the retention window.
    Returns list of (piid, internal_id) tuples.
    """
    cutoff_end = datetime.now().strftime('%Y-%m-%d')
    cutoff_start = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
    retention_start = (datetime.now() - timedelta(days=365 * RETENTION_YEARS)).strftime('%Y-%m-%d')

    log(f"Searching USASpending for contracts modified {cutoff_start} → {cutoff_end}")
    log(f"Retention window: award_date >= {retention_start}")

    results = []
    page = 1
    while len(results) < limit:
        body = json.dumps({
            "filters": {
                "award_type_codes": ["A", "B", "C", "D"],
                "time_period": [{
                    "start_date": retention_start,
                    "end_date": cutoff_end,
                    "date_type": "action_date",  # last action is a proxy for last modified
                }],
            },
            "fields": ["Award ID", "Start Date", "End Date", "Last Modified Date",
                       "generated_internal_id", "Recipient Name", "Award Amount"],
            "limit": PAGE_SIZE,
            "page": page,
            "sort": "Last Modified Date",
            "order": "desc",
        }).encode()

        req = urllib.request.Request(
            USASPENDING_SEARCH_URL,
            data=body,
            headers={'Content-Type': 'application/json', 'User-Agent': 'Awardopedia/1.0'}
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read())
        except Exception as e:
            log(f"  API error page {page}: {e}")
            break

        page_results = data.get('results', [])
        if not page_results:
            break

        # Stop as soon as we hit contracts older than our lookback window
        hit_old = False
        for row in page_results:
            last_mod = row.get('Last Modified Date', '')
            if last_mod and last_mod[:10] < cutoff_start:
                hit_old = True
                break
            piid = (row.get('Award ID') or '').strip()
            internal_id = (row.get('generated_internal_id') or '').strip()
            if piid:
                results.append((piid, internal_id))

        log(f"  Page {page}: {len(page_results)} records (total kept: {len(results)})")

        if hit_old or not data.get('page_metadata', {}).get('hasNext', False):
            break

        page += 1
        time.sleep(0.5)  # Be polite

    return results


def filter_new(candidates: list) -> list:
    """Remove PIIDs already in our contracts table."""
    if not candidates:
        return []
    piids = [p for p, _ in candidates]
    conn = db_connect()
    cur = conn.cursor()
    cur.execute("SELECT piid FROM contracts WHERE piid = ANY(%s)", [piids])
    existing = {r[0] for r in cur.fetchall()}
    conn.close()
    new = [(p, i) for p, i in candidates if p not in existing]
    log(f"Filtered: {len(candidates)} found → {len(new)} new (skipping {len(existing)} already in DB)")
    return new


def ingest_one(piid: str, internal_id: str) -> bool:
    """Fetch one award detail + parse + upsert. Returns True on success."""
    # Reuse the existing parser from enrich_usaspending.py
    sys.path.insert(0, str(Path(__file__).parent))
    from enrich_usaspending import fetch_award, parse_award, upsert

    try:
        if internal_id:
            url = f"{USASPENDING_DETAIL_URL}{internal_id}/"
            req = urllib.request.Request(url, headers={'User-Agent': 'Awardopedia/1.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = json.loads(r.read())
        else:
            raw = fetch_award(piid)
        fields = parse_award(raw)
        upsert(fields)
        return True
    except Exception as e:
        log(f"  ingest error {piid[:20]}: {e}")
        return False


def prune_old_contracts(dry_run: bool = False) -> int:
    """Delete contracts with start_date older than 5 years."""
    cutoff = (datetime.now() - timedelta(days=365 * RETENTION_YEARS)).strftime('%Y-%m-%d')
    conn = db_connect()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM contracts WHERE start_date < %s", [cutoff])
    count = cur.fetchone()[0]
    log(f"Retention: {count} contracts older than {cutoff}")
    if count and not dry_run:
        # Lineage rows will CASCADE-delete via FK if we had one; without FK, do it manually
        cur.execute("""
            DELETE FROM contract_lineage
            WHERE piid IN (SELECT piid FROM contracts WHERE start_date < %s)
        """, [cutoff])
        log(f"  Deleted {cur.rowcount} lineage rows")
        cur.execute("DELETE FROM contracts WHERE start_date < %s", [cutoff])
        log(f"  Deleted {cur.rowcount} contracts")
    conn.close()
    return count


def main():
    parser = argparse.ArgumentParser(description='Nightly USASpending delta ingest')
    parser.add_argument('--dry-run', action='store_true', help='Count only, no inserts')
    parser.add_argument('--days', type=int, default=DEFAULT_LOOKBACK_DAYS,
                        help=f'Lookback window in days (default {DEFAULT_LOOKBACK_DAYS})')
    parser.add_argument('--limit', type=int, default=5000, help='Max contracts per run')
    args = parser.parse_args()

    log("=" * 60)
    log("USASPENDING NIGHTLY INGEST")
    log(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    log("=" * 60)

    # Step 1: Search for recently-modified contracts
    candidates = fetch_modified_contracts(args.days, args.limit)

    # Step 2: Filter to only new-to-us
    new_contracts = filter_new(candidates)

    # Step 3: Ingest each one
    if args.dry_run:
        log(f"[DRY] Would ingest {len(new_contracts)} contracts")
    else:
        inserted, failed = 0, 0
        for i, (piid, internal_id) in enumerate(new_contracts, 1):
            if ingest_one(piid, internal_id):
                inserted += 1
            else:
                failed += 1
            if i % 50 == 0:
                log(f"  Progress: {i}/{len(new_contracts)} ({inserted} ok, {failed} failed)")
            time.sleep(0.15)  # Be polite to USASpending
        log(f"Ingest complete: {inserted} inserted, {failed} failed")

    # Step 4: Prune contracts past retention window
    prune_old_contracts(dry_run=args.dry_run)

    log("=" * 60)
    log(f"DONE: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == '__main__':
    main()
