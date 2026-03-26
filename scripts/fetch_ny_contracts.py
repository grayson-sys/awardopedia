#!/usr/bin/env python3
"""
fetch_ny_contracts.py — Fetch New York State contracts from data.ny.gov

Uses Socrata Open Data API (SODA) to fetch state contract data.
Maps NY fields to our unified contracts schema.

USAGE:
  python3 scripts/fetch_ny_contracts.py --limit 1         # One Perfect Record
  python3 scripts/fetch_ny_contracts.py --limit 100       # Small batch
  python3 scripts/fetch_ny_contracts.py --all             # Full dataset
  python3 scripts/fetch_ny_contracts.py --dry-run         # Preview without inserting
"""

import os, sys, json, urllib.request, urllib.parse, argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional

# ── Load .env ────────────────────────────────────────────────────────────────
ENV_PATH = Path(__file__).parent.parent / '.env'
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get('DATABASE_URL', '')

# ═══════════════════════════════════════════════════════════════════════════════
# NY DATA SOURCE CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

# NY Open Data - Procurement Report for State Authorities
# Dataset: https://data.ny.gov/Transparency/Procurement-Report-for-State-Authorities/ehig-g5x3
# 275K+ records, actively maintained
NY_CONTRACTS_API = "https://data.ny.gov/resource/ehig-g5x3.json"

# App token (optional but recommended for higher rate limits)
NY_APP_TOKEN = os.environ.get('NY_APP_TOKEN', '')

# ═══════════════════════════════════════════════════════════════════════════════
# FIELD MAPPING: NY → Awardopedia Schema
# ═══════════════════════════════════════════════════════════════════════════════

"""
NY Procurement Report (ehig-g5x3) Field Mapping:

NY Field                          → Our Field              Notes
─────────────────────────────────────────────────────────────────────────────
(generated row ID)                → piid                   Prefix with NY-
authority_name                    → agency_name            State authority
vendor_name                       → recipient_name
vendor_city                       → recipient_city
vendor_state                      → recipient_state
procurement_description           → description
type_of_procurement               → contract_type          e.g., "Consulting Services"
award_process                     → competition_type       e.g., "Competitive Bid"
award_date                        → date_signed
begin_date                        → start_date
end_date                          → end_date
contract_amount                   → award_amount
status                            → status                 "COMPLETED", "Open"
vendor_is_a_mwbe                  → mwbe_status            Y/N
"""


def db_connect():
    return psycopg2.connect(DATABASE_URL)


def log(msg: str, level: str = 'INFO'):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{ts}] [{level}] {msg}")


def fetch_ny_contracts(limit: int = 100, offset: int = 0) -> List[Dict]:
    """Fetch contracts from NY Open Data via Socrata API."""

    params = {
        '$limit': str(limit),
        '$offset': str(offset),
        '$order': 'contract_amount DESC',  # Biggest contracts first
        '$where': "status='OPEN' AND contract_amount IS NOT NULL",  # Only active contracts with amounts
    }

    url = f"{NY_CONTRACTS_API}?{urllib.parse.urlencode(params)}"

    headers = {'Accept': 'application/json'}
    if NY_APP_TOKEN:
        headers['X-App-Token'] = NY_APP_TOKEN

    log(f"Fetching NY contracts (offset={offset}, limit={limit})")

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())

    log(f"Fetched {len(data)} records")
    return data


def parse_date(date_str: str) -> Optional[str]:
    """Parse various date formats to ISO format."""
    if not date_str:
        return None
    try:
        # Socrata typically returns ISO format or timestamps
        if 'T' in date_str:
            return date_str.split('T')[0]
        return date_str
    except:
        return None


def parse_amount(amount_str) -> Optional[float]:
    """Parse currency amount."""
    if not amount_str:
        return None
    try:
        # Remove $ and commas if present
        clean = str(amount_str).replace('$', '').replace(',', '').strip()
        return float(clean)
    except:
        return None


def map_award_method(ny_method: str) -> str:
    """Map NY award method to federal competition types."""
    if not ny_method:
        return None

    ny_method = ny_method.upper()

    # Common NY award methods → federal equivalents
    mapping = {
        'COMPETITIVE BID': 'Full and Open Competition',
        'COMPETITIVE': 'Full and Open Competition',
        'MINI-BID': 'Full and Open Competition',
        'RFP': 'Full and Open Competition',
        'RFQ': 'Full and Open Competition',
        'SOLE SOURCE': 'Not Competed',
        'SINGLE SOURCE': 'Not Competed',
        'EMERGENCY': 'Not Competed',
        'OGS CONTRACT': 'Full and Open Competition',
        'PREFERRED SOURCE': 'Set-Aside',
    }

    for key, value in mapping.items():
        if key in ny_method:
            return value

    return ny_method  # Return original if no mapping


def map_ny_contract(row: Dict) -> Dict:
    """Map a NY contract record to our unified schema."""

    # Generate a unique ID from available fields
    # Use combination of authority + vendor + award_date + amount for uniqueness
    authority = row.get('authority_name', '')[:20]
    vendor = row.get('vendor_name', '')[:20]
    award_date = row.get('award_date', '')[:10]
    amount = str(row.get('contract_amount', ''))[:10]
    unique_id = f"{authority}-{vendor}-{award_date}-{amount}".replace(' ', '_')[:50]

    return {
        # Core identifiers
        'piid': f"NY-{unique_id}",  # Prefix to distinguish from federal
        'state_contract_id': unique_id,
        'data_source': 'ny',
        'jurisdiction_code': 'ny',

        # Recipient info
        'recipient_name': row.get('vendor_name'),
        'recipient_address': None,  # Not in this dataset
        'recipient_city': row.get('vendor_city'),
        'recipient_state': row.get('vendor_state') or 'NY',
        'recipient_zip': None,  # Not in this dataset
        'recipient_country': 'USA',

        # Agency info
        'agency_name': row.get('authority_name'),
        'sub_agency_name': None,

        # Contract details
        'description': row.get('procurement_description'),
        'contract_type': row.get('type_of_procurement'),
        'award_amount': parse_amount(row.get('contract_amount')),

        # Dates
        'start_date': parse_date(row.get('begin_date')),
        'end_date': parse_date(row.get('end_date')),
        'date_signed': parse_date(row.get('award_date')),

        # Competition info
        'competition_type': map_award_method(row.get('award_process')),
        'number_of_offers': None,  # Not in this dataset

        # NY-specific
        'mwbe_status': 'Yes' if row.get('vendor_is_a_mwbe') == 'Y' else 'No' if row.get('vendor_is_a_mwbe') == 'N' else None,

        # Status
        'status': row.get('status'),
    }


def insert_ny_contract(contract: Dict, conn) -> bool:
    """Insert or update a NY contract in the database."""

    cur = conn.cursor()

    try:
        cur.execute("""
            INSERT INTO contracts (
                piid, state_contract_id, data_source, jurisdiction_code,
                recipient_name, recipient_address, recipient_city,
                recipient_state, recipient_zip, recipient_country,
                agency_name, sub_agency_name,
                description, contract_type, award_amount,
                start_date, end_date,
                competition_type, number_of_offers,
                mwbe_status,
                fetched_at
            ) VALUES (
                %(piid)s, %(state_contract_id)s, %(data_source)s, %(jurisdiction_code)s,
                %(recipient_name)s, %(recipient_address)s, %(recipient_city)s,
                %(recipient_state)s, %(recipient_zip)s, %(recipient_country)s,
                %(agency_name)s, %(sub_agency_name)s,
                %(description)s, %(contract_type)s, %(award_amount)s,
                %(start_date)s, %(end_date)s,
                %(competition_type)s, %(number_of_offers)s,
                %(mwbe_status)s,
                NOW()
            )
            ON CONFLICT (piid) DO UPDATE SET
                recipient_name = COALESCE(EXCLUDED.recipient_name, contracts.recipient_name),
                description = COALESCE(EXCLUDED.description, contracts.description),
                award_amount = COALESCE(EXCLUDED.award_amount, contracts.award_amount),
                end_date = COALESCE(EXCLUDED.end_date, contracts.end_date),
                fetched_at = NOW()
        """, contract)

        conn.commit()
        return True

    except Exception as e:
        log(f"Insert error for {contract.get('piid')}: {e}", 'ERROR')
        conn.rollback()
        return False


def main():
    parser = argparse.ArgumentParser(description='Fetch NY State contracts')
    parser.add_argument('--limit', type=int, default=1, help='Number of records to fetch')
    parser.add_argument('--offset', type=int, default=0, help='Offset for pagination')
    parser.add_argument('--all', action='store_true', help='Fetch all records')
    parser.add_argument('--dry-run', action='store_true', help='Preview without inserting')
    args = parser.parse_args()

    log("=" * 60)
    log("NEW YORK STATE CONTRACTS FETCH")
    log(f"Limit: {args.limit if not args.all else 'ALL'}")
    log(f"Dry run: {args.dry_run}")
    log("=" * 60)

    # Fetch data
    if args.all:
        # Paginate through all records
        all_records = []
        offset = 0
        batch_size = 1000
        while True:
            batch = fetch_ny_contracts(limit=batch_size, offset=offset)
            if not batch:
                break
            all_records.extend(batch)
            offset += batch_size
            if len(batch) < batch_size:
                break
        records = all_records
    else:
        records = fetch_ny_contracts(limit=args.limit, offset=args.offset)

    if not records:
        log("No records found")
        return

    log(f"Processing {len(records)} records")

    # Connect to DB (unless dry run)
    conn = None if args.dry_run else db_connect()

    inserted = 0
    for i, row in enumerate(records):
        contract = map_ny_contract(row)

        if args.dry_run:
            log(f"[DRY] {i+1}. {contract['piid']}: {contract['recipient_name']} - ${contract['award_amount']:,.0f}" if contract['award_amount'] else f"[DRY] {i+1}. {contract['piid']}")
            print(json.dumps(contract, indent=2, default=str))
        else:
            if insert_ny_contract(contract, conn):
                inserted += 1
                log(f"Inserted: {contract['piid']} - {contract['recipient_name']}")

    if conn:
        conn.close()

    log("=" * 60)
    log(f"COMPLETE: {inserted}/{len(records)} records inserted")
    log("=" * 60)


if __name__ == '__main__':
    main()
