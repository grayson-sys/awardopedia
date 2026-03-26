#!/usr/bin/env python3
"""
bulk_fetch_granular.py — Granular USASpending fetch to get 100% of contracts

STRATEGY:
  - Fine-grained amount ranges (especially under $100K where most contracts live)
  - Quarterly time periods within each fiscal year
  - State-level filtering as fallback if still hitting 10K cap
  - Resumable with checkpoint file

USAGE:
  python3 scripts/bulk_fetch_granular.py                    # Resume or start
  python3 scripts/bulk_fetch_granular.py --reset            # Start fresh
  python3 scripts/bulk_fetch_granular.py --dry-run          # Preview without fetching
  python3 scripts/bulk_fetch_granular.py --year 2024        # Single year only
  python3 scripts/bulk_fetch_granular.py --status           # Show progress summary

ESTIMATED:
  - ~27M contracts over 5 years
  - With granular chunking: ~3000+ queries per year
  - At 1 req/sec with sleeps: ~1 hour per 3000 queries
  - Total: ~5-10 hours for full fetch (can run overnight)
"""

import os, sys, json, time, urllib.request, urllib.error, argparse
from pathlib import Path
from datetime import datetime, date
from typing import Optional, Dict, List, Tuple

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

CHECKPOINT_FILE = LOG_DIR / 'bulk_granular_checkpoint.json'
LOG_FILE = LOG_DIR / 'bulk_granular.log'
ERROR_LOG = LOG_DIR / 'bulk_granular_errors.log'

USASPENDING_SEARCH_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/"

# ═══════════════════════════════════════════════════════════════════════════════
# GRANULAR CHUNKING STRATEGY
# ═══════════════════════════════════════════════════════════════════════════════

# Fine-grained amount ranges - especially granular under $100K
AMOUNT_RANGES = [
    # Large contracts (sparse, won't hit 10K)
    (1_000_000_000, None),           # $1B+
    (500_000_000, 1_000_000_000),    # $500M-$1B
    (250_000_000, 500_000_000),      # $250M-$500M
    (100_000_000, 250_000_000),      # $100M-$250M
    (50_000_000, 100_000_000),       # $50M-$100M
    (25_000_000, 50_000_000),        # $25M-$50M
    (10_000_000, 25_000_000),        # $10M-$25M
    (5_000_000, 10_000_000),         # $5M-$10M
    (2_500_000, 5_000_000),          # $2.5M-$5M
    (1_000_000, 2_500_000),          # $1M-$2.5M
    # Medium contracts
    (500_000, 1_000_000),            # $500K-$1M
    (250_000, 500_000),              # $250K-$500K
    (100_000, 250_000),              # $100K-$250K
    # Small contracts (most volume here)
    (75_000, 100_000),               # $75K-$100K
    (50_000, 75_000),                # $50K-$75K
    (25_000, 50_000),                # $25K-$50K
    (10_000, 25_000),                # $10K-$25K
    (5_000, 10_000),                 # $5K-$10K
    (2_500, 5_000),                  # $2.5K-$5K
    (1_000, 2_500),                  # $1K-$2.5K
    (0, 1_000),                      # Under $1K (micro-purchases)
]

# Fiscal year quarters
def get_quarters(fiscal_year: int) -> List[Tuple[str, str]]:
    """Return (start_date, end_date) for each quarter of a fiscal year."""
    # FY starts Oct 1 of prior calendar year
    return [
        (f"{fiscal_year - 1}-10-01", f"{fiscal_year - 1}-12-31"),  # Q1: Oct-Dec
        (f"{fiscal_year}-01-01", f"{fiscal_year}-03-31"),          # Q2: Jan-Mar
        (f"{fiscal_year}-04-01", f"{fiscal_year}-06-30"),          # Q3: Apr-Jun
        (f"{fiscal_year}-07-01", f"{fiscal_year}-09-30"),          # Q4: Jul-Sep
    ]

# US states for fallback chunking
US_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    'DC', 'PR', 'VI', 'GU', 'AS', 'MP',  # Territories
]

# Fields to fetch
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
    line = f"[{ts}] [{level}] {msg}"
    print(line)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')
    if level == 'ERROR':
        with open(ERROR_LOG, 'a') as f:
            f.write(line + '\n')


def load_checkpoint() -> Dict:
    if CHECKPOINT_FILE.exists():
        try:
            return json.loads(CHECKPOINT_FILE.read_text())
        except:
            pass
    return {
        'started_at': datetime.now().isoformat(),
        'years': {},
        'total_fetched': 0,
        'total_inserted': 0,
        'last_updated': None
    }


def save_checkpoint(state: Dict):
    state['last_updated'] = datetime.now().isoformat()
    CHECKPOINT_FILE.write_text(json.dumps(state, indent=2))


def chunk_key(quarter: int, amount_range: Tuple, state: str = None) -> str:
    """Generate unique key for a fetch chunk."""
    min_amt, max_amt = amount_range
    amt_str = f"{min_amt}+" if max_amt is None else f"{min_amt}-{max_amt}"
    if state:
        return f"Q{quarter}_{amt_str}_{state}"
    return f"Q{quarter}_{amt_str}"


def fetch_page(start_date: str, end_date: str, page: int,
               amount_range: Tuple, state: str = None, limit: int = 100) -> Dict:
    """Fetch one page of contracts with granular filters."""

    filters = {
        'award_type_codes': ['A', 'B', 'C', 'D'],
        'time_period': [{'start_date': start_date, 'end_date': end_date}],
    }

    # Amount range filter
    min_amt, max_amt = amount_range
    if max_amt is None:
        filters['award_amounts'] = [{'lower_bound': min_amt}]
    else:
        filters['award_amounts'] = [{'lower_bound': min_amt, 'upper_bound': max_amt}]

    # State filter (for fallback chunking)
    if state:
        filters['place_of_performance_locations'] = [{'country': 'USA', 'state': state}]

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
        headers={'Content-Type': 'application/json'}
    )

    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read())


def parse_contract(record: Dict, fiscal_year: int) -> Dict:
    """Parse USASpending record to our schema."""
    award_id = record.get('Award ID', '')

    # Extract PIID from Award ID (format: CONT_AWD_PIID_...)
    piid = award_id
    if award_id.startswith('CONT_AWD_'):
        parts = award_id.split('_')
        if len(parts) >= 3:
            piid = parts[2]

    return {
        'piid': piid[:50] if piid else None,
        'award_id': award_id[:100] if award_id else None,
        'usaspending_id': record.get('generated_internal_id'),
        'description': record.get('Description'),
        'naics_code': record.get('NAICS Code'),
        'psc_code': record.get('PSC Code'),
        'agency_name': record.get('Awarding Agency'),
        'sub_agency_name': record.get('Awarding Sub Agency'),
        'recipient_name': record.get('Recipient Name'),
        'recipient_city': record.get('Recipient City'),
        'recipient_state': record.get('Recipient State Code'),
        'recipient_zip': record.get('Recipient Zip Code'),
        'recipient_country': record.get('Recipient Country'),
        'pop_city': record.get('Place of Performance City'),
        'pop_state': record.get('Place of Performance State Code'),
        'pop_zip': record.get('Place of Performance Zip5'),
        'pop_country': record.get('Place of Performance Country'),
        'award_amount': record.get('Award Amount'),
        'total_outlayed': record.get('Total Outlays'),
        'start_date': record.get('Start Date'),
        'end_date': record.get('End Date'),
        'award_type': record.get('Award Type'),
        'contract_type': record.get('Contract Award Type'),
        'fiscal_year': fiscal_year,
        'data_source': 'usaspending',
        'modification_number': record.get('Mod'),
    }


def insert_contracts(contracts: List[Dict], conn) -> int:
    """Insert contracts using upsert."""
    if not contracts or not conn:
        return 0

    cur = conn.cursor()
    inserted = 0

    for c in contracts:
        if not c.get('piid'):
            continue
        try:
            cur.execute("""
                INSERT INTO contracts (
                    piid, award_id, usaspending_id, description,
                    naics_code, psc_code, agency_name, sub_agency_name,
                    recipient_name, recipient_city, recipient_state,
                    recipient_zip, recipient_country,
                    pop_city, pop_state, pop_zip, pop_country,
                    award_amount, total_outlayed, start_date, end_date,
                    award_type, contract_type, fiscal_year,
                    data_source, modification_number, last_synced
                ) VALUES (
                    %(piid)s, %(award_id)s, %(usaspending_id)s, %(description)s,
                    %(naics_code)s, %(psc_code)s, %(agency_name)s, %(sub_agency_name)s,
                    %(recipient_name)s, %(recipient_city)s, %(recipient_state)s,
                    %(recipient_zip)s, %(recipient_country)s,
                    %(pop_city)s, %(pop_state)s, %(pop_zip)s, %(pop_country)s,
                    %(award_amount)s, %(total_outlayed)s, %(start_date)s, %(end_date)s,
                    %(award_type)s, %(contract_type)s, %(fiscal_year)s,
                    %(data_source)s, %(modification_number)s, NOW()
                )
                ON CONFLICT (piid) DO UPDATE SET
                    award_amount = COALESCE(EXCLUDED.award_amount, contracts.award_amount),
                    total_outlayed = COALESCE(EXCLUDED.total_outlayed, contracts.total_outlayed),
                    end_date = COALESCE(EXCLUDED.end_date, contracts.end_date),
                    last_synced = NOW()
            """, c)
            inserted += 1
        except Exception as e:
            # Skip duplicates/errors silently
            pass

    conn.commit()
    return inserted


def fetch_chunk(year: int, quarter: int, quarter_dates: Tuple[str, str],
                amount_range: Tuple, state: Dict, year_state: Dict,
                dry_run: bool, conn) -> Tuple[int, int, bool]:
    """
    Fetch all pages for one chunk. Returns (fetched, inserted, hit_cap).
    If hit_cap is True, caller should retry with state-level chunking.
    """
    start_date, end_date = quarter_dates
    ckey = chunk_key(quarter, amount_range, state)

    if ckey not in year_state['chunks']:
        year_state['chunks'][ckey] = {'page': 1, 'fetched': 0, 'status': 'pending'}

    chunk_state = year_state['chunks'][ckey]

    if chunk_state['status'] == 'complete':
        return 0, 0, False

    min_amt, max_amt = amount_range
    range_label = f"${min_amt/1e6:.2f}M+" if max_amt is None else f"${min_amt/1000:.0f}K-${max_amt/1000:.0f}K"
    if min_amt >= 1_000_000:
        range_label = f"${min_amt/1e6:.1f}M+" if max_amt is None else f"${min_amt/1e6:.1f}M-${max_amt/1e6:.1f}M"

    state_label = f" [{state}]" if state else ""

    page = chunk_state['page']
    total_fetched = 0
    total_inserted = 0

    while True:
        try:
            data = fetch_page(start_date, end_date, page, amount_range, state)
            results = data.get('results', [])

            if not results:
                chunk_state['status'] = 'complete'
                break

            contracts = [parse_contract(r, year) for r in results]

            if dry_run:
                log(f"  [DRY] FY{year} Q{quarter} {range_label}{state_label} p{page}: {len(contracts)}")
            else:
                inserted = insert_contracts(contracts, conn)
                total_inserted += inserted
                log(f"  FY{year} Q{quarter} {range_label}{state_label} p{page}: {len(contracts)} fetched, {inserted} inserted")

            total_fetched += len(contracts)
            chunk_state['page'] = page + 1
            chunk_state['fetched'] += len(contracts)

            # Check if we've hit the 10K cap
            if chunk_state['fetched'] >= 9900 and not state:
                log(f"  ⚠️ FY{year} Q{quarter} {range_label} approaching 10K cap - will need state chunking")
                chunk_state['status'] = 'needs_state_chunking'
                return total_fetched, total_inserted, True

            # Check for more pages
            page_meta = data.get('page_metadata', {})
            if not page_meta.get('hasNext', False) or len(results) < 100:
                chunk_state['status'] = 'complete'
                break

            page += 1
            time.sleep(0.5)  # Rate limit

        except urllib.error.HTTPError as e:
            log(f"HTTP {e.code} on FY{year} Q{quarter} {range_label} p{page} - retry in 30s", 'ERROR')
            time.sleep(30)
        except Exception as e:
            log(f"Error: {e} - retry in 10s", 'ERROR')
            time.sleep(10)

    return total_fetched, total_inserted, False


def fetch_year(year: int, state: Dict, dry_run: bool = False) -> Tuple[int, int]:
    """Fetch all contracts for a fiscal year using granular chunking."""
    year_key = str(year)

    if year_key not in state['years']:
        state['years'][year_key] = {
            'chunks': {},
            'fetched': 0,
            'inserted': 0,
            'status': 'in_progress'
        }

    year_state = state['years'][year_key]

    if year_state['status'] == 'complete':
        log(f"FY{year} already complete ({year_state['fetched']} records)")
        return 0, 0

    conn = db_connect() if not dry_run else None
    quarters = get_quarters(year)
    total_fetched = 0
    total_inserted = 0

    log(f"═══ FY{year}: {len(quarters)} quarters × {len(AMOUNT_RANGES)} amount ranges ═══")

    for q_idx, quarter_dates in enumerate(quarters, 1):
        for amount_range in AMOUNT_RANGES:
            fetched, inserted, hit_cap = fetch_chunk(
                year, q_idx, quarter_dates, amount_range,
                None, year_state, dry_run, conn
            )
            total_fetched += fetched
            total_inserted += inserted

            # If we hit the 10K cap, need to chunk by state
            if hit_cap:
                log(f"  Falling back to state-level chunking...")
                for us_state in US_STATES:
                    f, i, _ = fetch_chunk(
                        year, q_idx, quarter_dates, amount_range,
                        us_state, year_state, dry_run, conn
                    )
                    total_fetched += f
                    total_inserted += i

            # Save checkpoint periodically
            state['total_fetched'] += fetched
            state['total_inserted'] += inserted
            year_state['fetched'] += fetched
            year_state['inserted'] += inserted

            if total_fetched % 1000 == 0 and total_fetched > 0:
                save_checkpoint(state)

    # Check completion
    all_complete = all(
        c.get('status') == 'complete'
        for c in year_state['chunks'].values()
    )
    if all_complete:
        year_state['status'] = 'complete'
        log(f"═══ FY{year} COMPLETE: {year_state['fetched']} records ═══")

    if conn:
        conn.close()

    save_checkpoint(state)
    return total_fetched, total_inserted


def show_status(state: Dict):
    """Display progress summary."""
    print("\n" + "═" * 60)
    print("GRANULAR FETCH STATUS")
    print("═" * 60)
    print(f"Started: {state.get('started_at', 'N/A')}")
    print(f"Last updated: {state.get('last_updated', 'N/A')}")
    print(f"Total fetched: {state.get('total_fetched', 0):,}")
    print(f"Total inserted: {state.get('total_inserted', 0):,}")
    print()

    for year in ['2026', '2025', '2024', '2023', '2022', '2021']:
        if year in state.get('years', {}):
            ys = state['years'][year]
            chunks = ys.get('chunks', {})
            complete = sum(1 for c in chunks.values() if c.get('status') == 'complete')
            total = len(chunks)
            print(f"  FY{year}: {ys.get('fetched', 0):,} records | {complete}/{total} chunks | {ys.get('status', 'pending')}")
        else:
            print(f"  FY{year}: not started")
    print("═" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(description='Granular USASpending contract fetch')
    parser.add_argument('--reset', action='store_true', help='Reset and start fresh')
    parser.add_argument('--dry-run', action='store_true', help='Preview without fetching')
    parser.add_argument('--year', type=int, help='Fetch single year only')
    parser.add_argument('--status', action='store_true', help='Show progress summary')
    args = parser.parse_args()

    if args.reset:
        if CHECKPOINT_FILE.exists():
            CHECKPOINT_FILE.unlink()
        log("Checkpoint reset")

    state = load_checkpoint()

    if args.status:
        show_status(state)
        return

    log("=" * 60)
    log("GRANULAR USASPENDING FETCH - 100% Coverage Strategy")
    log(f"Amount ranges: {len(AMOUNT_RANGES)}")
    log(f"Quarters per year: 4")
    log(f"States for fallback: {len(US_STATES)}")
    log(f"Dry run: {args.dry_run}")
    log("=" * 60)

    years = [args.year] if args.year else [2026, 2025, 2024, 2023, 2022, 2021]

    for year in years:
        fetch_year(year, state, args.dry_run)

    show_status(state)
    log("GRANULAR FETCH COMPLETE")


if __name__ == '__main__':
    main()
