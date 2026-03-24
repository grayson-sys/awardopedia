#!/usr/bin/env python3
"""
bulk_fetch_contracts.py — Bulk download 5 years of USASpending contract data

FEATURES:
  - Resumable: tracks progress in JSON checkpoint file
  - Modification handling: groups mods under base PIID
  - Idempotent: safe to restart at any point
  - Rate-limited: respects API limits
  - Robust: retries on failure, logs errors

USAGE:
  python3 scripts/bulk_fetch_contracts.py                    # Resume or start fresh
  python3 scripts/bulk_fetch_contracts.py --reset            # Start over from scratch
  python3 scripts/bulk_fetch_contracts.py --dry-run          # Show plan without fetching
  python3 scripts/bulk_fetch_contracts.py --year 2023        # Fetch single year only

ESTIMATED TIME:
  - ~500K contracts over 5 years
  - ~100 records/request, 1 request/second
  - ~5000 requests = ~1.5 hours per year
  - Total: ~8-10 hours for full fetch
"""

import os, sys, json, time, urllib.request, urllib.error, argparse, re
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, Dict, List

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
import psycopg2.extras

DATABASE_URL = os.environ.get('DATABASE_URL', '')
LOG_DIR = BASE_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)

CHECKPOINT_FILE = LOG_DIR / 'bulk_fetch_checkpoint.json'
ERROR_LOG = LOG_DIR / 'bulk_fetch_errors.log'

USASPENDING_SEARCH_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/"

# Fields to fetch from USASpending
FETCH_FIELDS = [
    'Award ID', 'Recipient Name', 'recipient_id', 'Description',
    'Start Date', 'End Date', 'Award Amount', 'Total Outlays',
    'Awarding Agency', 'Awarding Sub Agency', 'Award Type',
    'Contract Award Type', 'NAICS Code', 'PSC Code',
    'Place of Performance City', 'Place of Performance State Code',
    'Place of Performance Zip5', 'Place of Performance Country',
    'Recipient Address Line 1', 'Recipient City', 'Recipient State Code',
    'Recipient Zip Code', 'Recipient Country',
    'generated_internal_id', 'Mod'
]


def db_connect():
    return psycopg2.connect(DATABASE_URL)


def log(msg: str, level: str = 'INFO'):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{ts}] [{level}] {msg}")
    if level == 'ERROR':
        with open(ERROR_LOG, 'a') as f:
            f.write(f"[{ts}] {msg}\n")


def load_checkpoint() -> Dict:
    """Load checkpoint from disk, or return fresh state."""
    if CHECKPOINT_FILE.exists():
        return json.loads(CHECKPOINT_FILE.read_text())
    return {
        'started_at': datetime.now().isoformat(),
        'years': {},  # year -> {page, total_pages, fetched, status}
        'total_fetched': 0,
        'total_inserted': 0,
        'last_updated': None,
    }


def save_checkpoint(state: Dict):
    """Save checkpoint to disk."""
    state['last_updated'] = datetime.now().isoformat()
    CHECKPOINT_FILE.write_text(json.dumps(state, indent=2))


def extract_base_piid(piid: str) -> str:
    """
    Extract base PIID from a modification PIID.
    Modifications often append suffixes like -0001, -MOD-01, etc.
    """
    if not piid:
        return piid
    # Common modification patterns
    # W56HZV22F0353-0001 -> W56HZV22F0353
    # FA8620-20-C-2027-P00001 -> FA8620-20-C-2027
    match = re.match(r'^(.+?)(?:-(?:P?\d{4,}|MOD.*))?$', piid, re.IGNORECASE)
    return match.group(1) if match else piid


# Amount ranges to chunk queries (USASpending caps at 10K results per query)
AMOUNT_RANGES = [
    (1_000_000_000, None),      # $1B+
    (500_000_000, 1_000_000_000),  # $500M-$1B
    (100_000_000, 500_000_000),    # $100M-$500M
    (50_000_000, 100_000_000),     # $50M-$100M
    (10_000_000, 50_000_000),      # $10M-$50M
    (5_000_000, 10_000_000),       # $5M-$10M
    (1_000_000, 5_000_000),        # $1M-$5M
    (500_000, 1_000_000),          # $500K-$1M
    (100_000, 500_000),            # $100K-$500K
    (0, 100_000),                  # Under $100K
]


def fetch_page(year: int, page: int, limit: int = 100, amount_range: tuple = None) -> Dict:
    """Fetch one page of contract data from USASpending."""
    # Federal fiscal year: Oct 1 (year-1) to Sep 30 (year)
    start_date = f"{year - 1}-10-01"
    end_date = f"{year}-09-30"

    filters = {
        'award_type_codes': ['A', 'B', 'C', 'D'],  # Contracts only
        'time_period': [{'start_date': start_date, 'end_date': end_date}],
    }

    # Add amount range filter if specified
    if amount_range:
        min_amt, max_amt = amount_range
        if max_amt is None:
            filters['award_amounts'] = [{'lower_bound': min_amt}]
        else:
            filters['award_amounts'] = [{'lower_bound': min_amt, 'upper_bound': max_amt}]

    body = json.dumps({
        'filters': filters,
        'fields': FETCH_FIELDS,
        'page': page,
        'limit': limit,
        'sort': 'Award Amount',
        'order': 'desc',
    }).encode()

    req = urllib.request.Request(
        USASPENDING_SEARCH_URL,
        data=body,
        headers={
            'Content-Type': 'application/json',
            'User-Agent': 'Awardopedia/1.0 (bulk-fetch)'
        }
    )

    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def parse_contract(row: Dict, year: int) -> Dict:
    """Parse a USASpending row into our contract schema."""
    piid = row.get('Award ID') or ''

    return {
        'piid': piid,
        'base_piid': extract_base_piid(piid),
        'recipient_name': row.get('Recipient Name'),
        'recipient_uei': row.get('recipient_id'),  # This is actually UEI in newer data
        'description': row.get('Description'),
        'start_date': row.get('Start Date'),
        'end_date': row.get('End Date'),
        'award_amount': row.get('Award Amount'),
        'total_outlayed': row.get('Total Outlays'),
        'agency_name': row.get('Awarding Agency'),
        'sub_agency_name': row.get('Awarding Sub Agency'),
        'contract_type': row.get('Contract Award Type') or row.get('Award Type'),
        'naics_code': row.get('NAICS Code'),
        'psc_code': row.get('PSC Code'),
        'pop_city': row.get('Place of Performance City'),
        'pop_state': row.get('Place of Performance State Code'),
        'pop_zip': row.get('Place of Performance Zip5'),
        'pop_country': row.get('Place of Performance Country'),
        'recipient_address': row.get('Recipient Address Line 1'),
        'recipient_city': row.get('Recipient City'),
        'recipient_state': row.get('Recipient State Code'),
        'recipient_zip': row.get('Recipient Zip Code'),
        'recipient_country': row.get('Recipient Country'),
        'usaspending_id': row.get('generated_internal_id'),
        'fiscal_year': year,
        'modification_number': row.get('Mod'),
    }


def insert_contracts(contracts: List[Dict], conn) -> int:
    """
    Insert/update contracts in database.
    Uses base_piid to group modifications.
    """
    if not contracts:
        return 0

    cur = conn.cursor()
    inserted = 0

    for c in contracts:
        try:
            cur.execute("""
                INSERT INTO contracts (
                    piid, base_piid, recipient_name, recipient_uei, description,
                    start_date, end_date, award_amount, total_outlayed,
                    agency_name, sub_agency_name, contract_type,
                    naics_code, psc_code,
                    pop_city, pop_state, pop_zip, pop_country,
                    recipient_address, recipient_city, recipient_state,
                    recipient_zip, recipient_country,
                    usaspending_id, fiscal_year, modification_number,
                    data_source, jurisdiction_code,
                    fetched_at
                ) VALUES (
                    %(piid)s, %(base_piid)s, %(recipient_name)s, %(recipient_uei)s, %(description)s,
                    %(start_date)s, %(end_date)s, %(award_amount)s, %(total_outlayed)s,
                    %(agency_name)s, %(sub_agency_name)s, %(contract_type)s,
                    %(naics_code)s, %(psc_code)s,
                    %(pop_city)s, %(pop_state)s, %(pop_zip)s, %(pop_country)s,
                    %(recipient_address)s, %(recipient_city)s, %(recipient_state)s,
                    %(recipient_zip)s, %(recipient_country)s,
                    %(usaspending_id)s, %(fiscal_year)s, %(modification_number)s,
                    'usaspending', 'federal',
                    NOW()
                )
                ON CONFLICT (piid) DO UPDATE SET
                    recipient_name = COALESCE(EXCLUDED.recipient_name, contracts.recipient_name),
                    description = COALESCE(EXCLUDED.description, contracts.description),
                    award_amount = COALESCE(EXCLUDED.award_amount, contracts.award_amount),
                    total_outlayed = COALESCE(EXCLUDED.total_outlayed, contracts.total_outlayed),
                    end_date = COALESCE(EXCLUDED.end_date, contracts.end_date),
                    data_source = COALESCE(contracts.data_source, 'usaspending'),
                    jurisdiction_code = COALESCE(contracts.jurisdiction_code, 'federal'),
                    fetched_at = NOW()
            """, c)
            inserted += 1
        except Exception as e:
            log(f"Insert error for {c.get('piid')}: {e}", 'ERROR')

    conn.commit()
    return inserted


def range_key(amount_range: tuple) -> str:
    """Generate a string key for an amount range."""
    min_amt, max_amt = amount_range
    if max_amt is None:
        return f"{min_amt}+"
    return f"{min_amt}-{max_amt}"


def fetch_year(year: int, state: Dict, dry_run: bool = False) -> int:
    """Fetch all contracts for a fiscal year using amount-range chunking."""
    year_key = str(year)

    if year_key not in state['years']:
        state['years'][year_key] = {
            'ranges': {},  # range_key -> {page, fetched, status}
            'fetched': 0,
            'inserted': 0,
            'status': 'in_progress'
        }

    year_state = state['years'][year_key]

    # Migrate old checkpoint format (no ranges) to new format
    if 'ranges' not in year_state:
        year_state['ranges'] = {}
        year_state['status'] = 'in_progress'  # Force re-fetch with ranges

    if year_state['status'] == 'complete':
        log(f"FY{year} already complete ({year_state['fetched']} records)")
        return 0

    conn = db_connect() if not dry_run else None
    total_fetched = 0
    total_inserted = 0

    log(f"Starting FY{year} with {len(AMOUNT_RANGES)} amount ranges")

    for amount_range in AMOUNT_RANGES:
        rkey = range_key(amount_range)

        if rkey not in year_state['ranges']:
            year_state['ranges'][rkey] = {
                'page': 1,
                'fetched': 0,
                'status': 'in_progress'
            }

        range_state = year_state['ranges'][rkey]

        if range_state['status'] == 'complete':
            continue

        page = range_state['page']
        min_amt, max_amt = amount_range
        range_label = f"${min_amt/1e6:.0f}M+" if max_amt is None else f"${min_amt/1e6:.1f}M-${max_amt/1e6:.0f}M"

        log(f"  FY{year} {range_label}: starting from page {page}")

        while True:
            try:
                # Fetch page with amount range filter
                data = fetch_page(year, page, amount_range=amount_range)
                results = data.get('results', [])

                if not results:
                    log(f"  FY{year} {range_label}: complete at page {page}")
                    range_state['status'] = 'complete'
                    break

                # Parse contracts
                contracts = [parse_contract(r, year) for r in results]

                if dry_run:
                    log(f"  [DRY] FY{year} {range_label} page {page}: {len(contracts)} contracts")
                else:
                    # Insert to database
                    inserted = insert_contracts(contracts, conn)
                    total_inserted += inserted
                    log(f"  FY{year} {range_label} page {page}: {len(contracts)} fetched, {inserted} inserted")

                total_fetched += len(contracts)

                # Update checkpoint
                range_state['page'] = page + 1
                range_state['fetched'] += len(contracts)
                year_state['fetched'] += len(contracts)
                state['total_fetched'] += len(contracts)

                # Save checkpoint every 10 pages
                if page % 10 == 0:
                    save_checkpoint(state)

                # Check if we've hit the end
                page_metadata = data.get('page_metadata', {})
                has_next = page_metadata.get('hasNext', False)

                if not has_next or len(results) < 100:
                    log(f"  FY{year} {range_label}: complete ({range_state['fetched']} records)")
                    range_state['status'] = 'complete'
                    break

                page += 1

                # Rate limit: 1 request per second
                time.sleep(1.0)

            except urllib.error.HTTPError as e:
                log(f"HTTP error on page {page}: {e.code} - retrying in 30s", 'ERROR')
                time.sleep(30)
            except Exception as e:
                log(f"Error on page {page}: {e} - retrying in 10s", 'ERROR')
                time.sleep(10)
                # Save checkpoint on error
                save_checkpoint(state)

    # Check if all ranges are complete
    all_complete = all(
        year_state['ranges'].get(range_key(r), {}).get('status') == 'complete'
        for r in AMOUNT_RANGES
    )
    if all_complete:
        log(f"FY{year} ALL RANGES COMPLETE: {year_state['fetched']} total records")
        year_state['status'] = 'complete'

    if conn:
        conn.close()

    save_checkpoint(state)
    return total_fetched


def main():
    parser = argparse.ArgumentParser(description='Bulk fetch USASpending contracts')
    parser.add_argument('--reset', action='store_true', help='Reset checkpoint and start fresh')
    parser.add_argument('--dry-run', action='store_true', help='Show plan without fetching')
    parser.add_argument('--year', type=int, help='Fetch single year only (e.g., 2023)')
    parser.add_argument('--years', type=int, default=5, help='Number of years to fetch (default: 5)')
    args = parser.parse_args()

    if args.reset and CHECKPOINT_FILE.exists():
        CHECKPOINT_FILE.unlink()
        log("Checkpoint reset")

    state = load_checkpoint()

    # Determine years to fetch
    current_fy = datetime.now().year if datetime.now().month >= 10 else datetime.now().year
    if args.year:
        years = [args.year]
    else:
        years = list(range(current_fy, current_fy - args.years, -1))

    log("=" * 60)
    log("BULK FETCH — USASpending Contracts")
    log(f"Years: {years}")
    log(f"Checkpoint: {CHECKPOINT_FILE}")
    log(f"Dry run: {args.dry_run}")
    log("=" * 60)

    total = 0
    for year in years:
        try:
            fetched = fetch_year(year, state, args.dry_run)
            total += fetched
        except KeyboardInterrupt:
            log("Interrupted by user - checkpoint saved")
            save_checkpoint(state)
            sys.exit(0)
        except Exception as e:
            log(f"Fatal error in FY{year}: {e}", 'ERROR')
            save_checkpoint(state)
            raise

    save_checkpoint(state)
    log("=" * 60)
    log(f"COMPLETE: {total} contracts fetched")
    log("=" * 60)


if __name__ == '__main__':
    main()
