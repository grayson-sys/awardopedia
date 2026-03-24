#!/usr/bin/env python3
"""
fetch_tx_opportunities.py — Fetch Texas open bid opportunities from data.texas.gov

Texas publishes TxDOT bid data via Socrata API. This fetches OPEN bids only
(deadline in the future) and maps them to our opportunities schema.

USAGE:
  python3 scripts/fetch_tx_opportunities.py --limit 1         # One Perfect Record
  python3 scripts/fetch_tx_opportunities.py --limit 100       # Small batch
  python3 scripts/fetch_tx_opportunities.py --all             # All open bids
  python3 scripts/fetch_tx_opportunities.py --dry-run         # Preview without inserting
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
# TX DATA SOURCE CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

# Texas Official and Unofficial Bid Items
# Dataset: https://data.texas.gov/dataset/Official-and-Unofficial-Bid-Items/qh8x-rm8r
TX_BIDS_API = "https://data.texas.gov/resource/qh8x-rm8r.json"

# ═══════════════════════════════════════════════════════════════════════════════
# FIELD MAPPING: TX → Awardopedia Schema
# ═══════════════════════════════════════════════════════════════════════════════

"""
TX Bid Items Field Mapping:

TX Field                          → Our Field              Notes
─────────────────────────────────────────────────────────────────────────────
project_id                        → notice_id              Prefix with TX-
TxDOT                             → agency_name            Always TxDOT
project_type + classification     → description
highway + county                  → place_of_performance
sealed_engineer_s_estimate        → estimated_value_max
bid_recieved_until_date_and       → response_deadline
proposal_status                   → status                 "Official" = active
district_division                 → office_name
"""


def db_connect():
    return psycopg2.connect(DATABASE_URL)


def log(msg: str, level: str = 'INFO'):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{ts}] [{level}] {msg}")


def fetch_tx_open_projects(limit: int = 100, offset: int = 0) -> List[Dict]:
    """Fetch OPEN bid projects from Texas (deduplicated by project_id)."""

    today = datetime.now().strftime('%Y-%m-%d')

    # Get unique projects with open deadlines
    params = {
        '$select': 'project_id, highway, county, district_division, '
                   'bid_recieved_until_date_and, sealed_engineer_s_estimate, '
                   'project_type, project_classification, proposal_status, '
                   'proposal_address_1, proposal_city, proposal_zip_code, '
                   'proposal_phone_number, proposal_published_date, '
                   'proposal_guarantee_amount, control_section_job_csj',
        '$where': f"bid_recieved_until_date_and > '{today}' AND proposal_status = 'Official'",
        '$group': 'project_id, highway, county, district_division, '
                  'bid_recieved_until_date_and, sealed_engineer_s_estimate, '
                  'project_type, project_classification, proposal_status, '
                  'proposal_address_1, proposal_city, proposal_zip_code, '
                  'proposal_phone_number, proposal_published_date, '
                  'proposal_guarantee_amount, control_section_job_csj',
        '$order': 'sealed_engineer_s_estimate DESC',
        '$limit': str(limit),
        '$offset': str(offset),
    }

    url = f"{TX_BIDS_API}?{urllib.parse.urlencode(params)}"

    headers = {'Accept': 'application/json'}

    log(f"Fetching TX open bids (offset={offset}, limit={limit})")

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())

    log(f"Fetched {len(data)} projects")
    return data


def parse_date(date_str: str) -> Optional[str]:
    """Parse Socrata datetime to ISO date."""
    if not date_str:
        return None
    try:
        if 'T' in date_str:
            return date_str.split('T')[0]
        return date_str
    except:
        return None


def parse_amount(amount_str) -> Optional[float]:
    """Parse numeric amount."""
    if not amount_str:
        return None
    try:
        return float(str(amount_str).replace(',', ''))
    except:
        return None


def map_tx_opportunity(row: Dict) -> Dict:
    """Map a TX bid project to our opportunities schema."""

    project_id = row.get('project_id', '')
    highway = row.get('highway', '')
    county = row.get('county', '')
    project_type = row.get('project_type', '')
    classification = row.get('project_classification', '')

    # Build description
    description_parts = []
    if project_type:
        description_parts.append(project_type)
    if classification:
        description_parts.append(f"- {classification}")
    if highway:
        description_parts.append(f"on {highway}")
    if county:
        description_parts.append(f"in {county} County")

    description = ' '.join(description_parts) or f"TxDOT Project {project_id}"

    # Title
    title = f"{highway} {classification}" if highway and classification else f"TxDOT {project_id}"

    return {
        # Core identifiers
        'notice_id': f"TX-{project_id}",
        'solicitation_number': row.get('control_section_job_csj') or project_id,
        'data_source': 'tx',
        'jurisdiction_code': 'tx',

        # Agency
        'agency_name': 'Texas Department of Transportation',
        'sub_agency_name': None,
        'office_name': row.get('district_division'),

        # Description
        'title': title[:200],
        'description': description,

        # Type
        'notice_type': 'Solicitation',
        'set_aside_type': None,

        # Value
        'estimated_value_max': parse_amount(row.get('sealed_engineer_s_estimate')),
        'estimated_value_min': None,

        # Dates
        'response_deadline': parse_date(row.get('bid_recieved_until_date_and')),
        'posted_date': parse_date(row.get('proposal_published_date')),
        'archive_date': None,

        # Location
        'place_of_performance_city': row.get('proposal_city'),
        'place_of_performance_state': 'TX',
        'place_of_performance_zip': row.get('proposal_zip_code'),
        'place_of_performance_country': 'USA',

        # Contact
        'primary_contact_email': None,
        'primary_contact_phone': row.get('proposal_phone_number'),

        # Status
        'active': True,

        # NAICS (construction)
        'naics_code': '237310',  # Highway construction
        'naics_description': 'Highway, Street, and Bridge Construction',
    }


def insert_tx_opportunity(opp: Dict, conn) -> bool:
    """Insert or update a TX opportunity in the database."""

    cur = conn.cursor()

    try:
        cur.execute("""
            INSERT INTO opportunities (
                notice_id, solicitation_number, data_source, jurisdiction_code,
                agency_name, sub_agency_name, office_name,
                title, description,
                notice_type, set_aside_type,
                estimated_value_max, estimated_value_min,
                response_deadline, posted_date, archive_date,
                place_of_performance_city, place_of_performance_state,
                naics_code, naics_description,
                last_synced
            ) VALUES (
                %(notice_id)s, %(solicitation_number)s, %(data_source)s, %(jurisdiction_code)s,
                %(agency_name)s, %(sub_agency_name)s, %(office_name)s,
                %(title)s, %(description)s,
                %(notice_type)s, %(set_aside_type)s,
                %(estimated_value_max)s, %(estimated_value_min)s,
                %(response_deadline)s, %(posted_date)s, %(archive_date)s,
                %(place_of_performance_city)s, %(place_of_performance_state)s,
                %(naics_code)s, %(naics_description)s,
                NOW()
            )
            ON CONFLICT (notice_id) DO UPDATE SET
                title = COALESCE(EXCLUDED.title, opportunities.title),
                description = COALESCE(EXCLUDED.description, opportunities.description),
                estimated_value_max = COALESCE(EXCLUDED.estimated_value_max, opportunities.estimated_value_max),
                response_deadline = COALESCE(EXCLUDED.response_deadline, opportunities.response_deadline),
                last_synced = NOW()
        """, opp)

        conn.commit()
        return True

    except Exception as e:
        log(f"Insert error for {opp.get('notice_id')}: {e}", 'ERROR')
        conn.rollback()
        return False


def main():
    parser = argparse.ArgumentParser(description='Fetch Texas open bid opportunities')
    parser.add_argument('--limit', type=int, default=1, help='Number of projects to fetch')
    parser.add_argument('--offset', type=int, default=0, help='Offset for pagination')
    parser.add_argument('--all', action='store_true', help='Fetch all open projects')
    parser.add_argument('--dry-run', action='store_true', help='Preview without inserting')
    args = parser.parse_args()

    log("=" * 60)
    log("TEXAS OPEN BID OPPORTUNITIES FETCH")
    log(f"Limit: {args.limit if not args.all else 'ALL'}")
    log(f"Dry run: {args.dry_run}")
    log("=" * 60)

    # Fetch data
    if args.all:
        all_records = []
        offset = 0
        batch_size = 500
        while True:
            batch = fetch_tx_open_projects(limit=batch_size, offset=offset)
            if not batch:
                break
            all_records.extend(batch)
            offset += batch_size
            if len(batch) < batch_size:
                break
        records = all_records
    else:
        records = fetch_tx_open_projects(limit=args.limit, offset=args.offset)

    if not records:
        log("No open bids found")
        return

    log(f"Processing {len(records)} projects")

    # Connect to DB (unless dry run)
    conn = None if args.dry_run else db_connect()

    inserted = 0
    total_value = 0
    for i, row in enumerate(records):
        opp = map_tx_opportunity(row)
        value = opp.get('estimated_value_max') or 0
        total_value += value

        if args.dry_run:
            log(f"[DRY] {i+1}. {opp['notice_id']}: {opp['title'][:50]} - ${value:,.0f}")
            if i < 3:  # Show details for first 3
                print(json.dumps(opp, indent=2, default=str))
        else:
            if insert_tx_opportunity(opp, conn):
                inserted += 1
                log(f"Inserted: {opp['notice_id']} - ${value:,.0f} - {opp['title'][:40]}")

    if conn:
        conn.close()

    log("=" * 60)
    log(f"COMPLETE: {inserted}/{len(records)} projects inserted")
    log(f"Total value: ${total_value:,.0f}")
    log("=" * 60)


if __name__ == '__main__':
    main()
