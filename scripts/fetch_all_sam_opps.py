#!/usr/bin/env python3
"""
fetch_all_sam_opps.py — Fetch ALL SAM.gov opportunities (all notice types)

Unlike fetch_opportunities_batch.py which only gets ptype=o (solicitations),
this fetches everything: presolicitations, sources sought, award notices, etc.

Stores raw JSON to data/ and inserts to opportunities table.

USAGE:
  python3 scripts/fetch_all_sam_opps.py --check        # Check total available (1 API call)
  python3 scripts/fetch_all_sam_opps.py --fetch 3      # Use 3 API calls (3000 records)
  python3 scripts/fetch_all_sam_opps.py --fetch-all    # Fetch all available records
"""

import os, sys, json, urllib.request, urllib.parse, argparse
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional

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
SAM_API_KEY = os.environ.get('SAM_API_KEY', '')

LOG_DIR = BASE_DIR / 'logs'
DATA_DIR = BASE_DIR / 'data'
LOG_DIR.mkdir(exist_ok=True)
DATA_DIR.mkdir(exist_ok=True)

CHECKPOINT_FILE = LOG_DIR / 'sam_all_opps_checkpoint.json'
LOG_FILE = LOG_DIR / 'sam_all_opps.log'

SAM_OPPS_URL = "https://api.sam.gov/opportunities/v2/search"


def log(msg: str, level: str = 'INFO'):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] [{level}] {msg}"
    print(line)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')


def db_connect():
    return psycopg2.connect(DATABASE_URL)


def load_checkpoint() -> Dict:
    if CHECKPOINT_FILE.exists():
        try:
            return json.loads(CHECKPOINT_FILE.read_text())
        except:
            pass
    return {
        'offset': 0,
        'total_fetched': 0,
        'total_available': None,
        'last_run': None,
    }


def save_checkpoint(state: Dict):
    state['last_run'] = datetime.now().isoformat()
    CHECKPOINT_FILE.write_text(json.dumps(state, indent=2))


def fetch_sam_page(offset: int, limit: int = 1000,
                   posted_from: str = None, posted_to: str = None) -> Dict:
    """Fetch one page from SAM.gov - ALL notice types."""

    if not SAM_API_KEY:
        raise RuntimeError("SAM_API_KEY not set")

    if not posted_from:
        # Default: last 12 months
        posted_from = (datetime.today() - timedelta(days=365)).strftime("%m/%d/%Y")
    if not posted_to:
        posted_to = datetime.today().strftime("%m/%d/%Y")

    params = {
        'api_key': SAM_API_KEY,
        'postedFrom': posted_from,
        'postedTo': posted_to,
        'limit': str(limit),
        'offset': str(offset),
        # NO ptype filter - get ALL types
    }

    url = f"{SAM_OPPS_URL}?{urllib.parse.urlencode(params)}"

    log(f"Fetching SAM.gov offset={offset} limit={limit}")
    log(f"  Date range: {posted_from} to {posted_to}")

    req = urllib.request.Request(url, headers={'User-Agent': 'Awardopedia/1.0'})

    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def map_opportunity(record: Dict) -> Dict:
    """Map SAM.gov record to our schema. Store ALL fields."""

    # Extract core fields
    notice_id = record.get('noticeId', '')

    # Parse dates
    def parse_date(d):
        if not d:
            return None
        try:
            # SAM uses various formats
            for fmt in ['%Y-%m-%d', '%m/%d/%Y', '%Y-%m-%dT%H:%M:%S']:
                try:
                    return datetime.strptime(d[:10], fmt[:len(d[:10])]).date().isoformat()
                except:
                    pass
            return d[:10] if len(d) >= 10 else None
        except:
            return None

    # Get office address for place of performance
    office = record.get('officeAddress', {}) or {}

    # Get point of contact
    poc = {}
    if record.get('pointOfContact'):
        pocs = record.get('pointOfContact', [])
        if pocs and len(pocs) > 0:
            poc = pocs[0]

    # Get resource links (attachments/PDFs!)
    links = record.get('resourceLinks', []) or []
    attachments = json.dumps(links) if links else None

    # Helper to truncate strings
    def trunc(val, length):
        if val and len(val) > length:
            return val[:length]
        return val

    return {
        'notice_id': trunc(notice_id, 255),
        'solicitation_number': trunc(record.get('solicitationNumber'), 255),
        'title': trunc(record.get('title'), 500),
        'description': record.get('description'),

        # Notice type - important for filtering later
        'notice_type': trunc(record.get('type'), 100),

        # Agency
        'agency_name': trunc(record.get('fullParentPathName', '').split('.')[0] if record.get('fullParentPathName') else record.get('department'), 500),
        'sub_agency_name': trunc(record.get('subtierAgency'), 500),
        'office_name': trunc(record.get('office'), 500),

        # Dates
        'posted_date': parse_date(record.get('postedDate')),
        'response_deadline': parse_date(record.get('responseDeadLine')),
        'archive_date': parse_date(record.get('archiveDate')),

        # Classification
        'naics_code': trunc(record.get('naicsCode'), 10),
        'psc_code': trunc(record.get('classificationCode'), 10),
        'set_aside_type': trunc(record.get('typeOfSetAside'), 255),

        # Location
        'place_of_performance_city': trunc(office.get('city'), 255),
        'place_of_performance_state': trunc(office.get('state'), 2),

        # Contact
        'contracting_officer': trunc(poc.get('fullName'), 255),
        'contracting_officer_email': trunc(poc.get('email'), 255),
        'contracting_officer_phone': trunc(poc.get('phone'), 50),

        # Links - THE GOOD STUFF
        'sam_url': f"https://sam.gov/opp/{notice_id}/view" if notice_id else None,
        'attachments': attachments,

        # Store full raw record for later parsing
        'additional_info': json.dumps(record),

        # Metadata
        'data_source': 'federal',
        'jurisdiction_code': 'federal',
    }


def insert_opportunity(opp: Dict, conn) -> bool:
    """Insert or update opportunity."""
    if not opp.get('notice_id'):
        return False

    cur = conn.cursor()

    try:
        cur.execute("""
            INSERT INTO opportunities (
                notice_id, solicitation_number, title, description,
                notice_type, agency_name, sub_agency_name, office_name,
                posted_date, response_deadline, archive_date,
                naics_code, psc_code, set_aside_type,
                place_of_performance_city, place_of_performance_state,
                contracting_officer, contracting_officer_email, contracting_officer_phone,
                sam_url, attachments,
                data_source, jurisdiction_code, last_synced
            ) VALUES (
                %(notice_id)s, %(solicitation_number)s, %(title)s, %(description)s,
                %(notice_type)s, %(agency_name)s, %(sub_agency_name)s, %(office_name)s,
                %(posted_date)s, %(response_deadline)s, %(archive_date)s,
                %(naics_code)s, %(psc_code)s, %(set_aside_type)s,
                %(place_of_performance_city)s, %(place_of_performance_state)s,
                %(contracting_officer)s, %(contracting_officer_email)s, %(contracting_officer_phone)s,
                %(sam_url)s, %(attachments)s,
                %(data_source)s, %(jurisdiction_code)s, NOW()
            )
            ON CONFLICT (notice_id) DO UPDATE SET
                title = COALESCE(EXCLUDED.title, opportunities.title),
                description = COALESCE(EXCLUDED.description, opportunities.description),
                notice_type = COALESCE(EXCLUDED.notice_type, opportunities.notice_type),
                response_deadline = COALESCE(EXCLUDED.response_deadline, opportunities.response_deadline),
                attachments = COALESCE(EXCLUDED.attachments, opportunities.attachments),
                sam_url = COALESCE(EXCLUDED.sam_url, opportunities.sam_url),
                last_synced = NOW()
        """, opp)
        conn.commit()
        return True
    except Exception as e:
        log(f"Insert error for {opp.get('notice_id')}: {e}", 'ERROR')
        conn.rollback()
        return False


def main():
    parser = argparse.ArgumentParser(description='Fetch ALL SAM.gov opportunities')
    parser.add_argument('--check', action='store_true', help='Check total available (uses 1 API call)')
    parser.add_argument('--fetch', type=int, help='Number of API calls to use (1000 records each)')
    parser.add_argument('--fetch-all', action='store_true', help='Fetch all available records')
    parser.add_argument('--reset', action='store_true', help='Reset checkpoint')
    parser.add_argument('--from-date', type=str, help='Start date MM/DD/YYYY (default: 12 months ago)')
    parser.add_argument('--to-date', type=str, help='End date MM/DD/YYYY (default: today)')
    args = parser.parse_args()

    if args.reset:
        if CHECKPOINT_FILE.exists():
            CHECKPOINT_FILE.unlink()
        log("Checkpoint reset")
        return

    state = load_checkpoint()

    # Date range
    posted_from = args.from_date or (datetime.today() - timedelta(days=365)).strftime("%m/%d/%Y")
    posted_to = args.to_date or datetime.today().strftime("%m/%d/%Y")

    if args.check:
        log("Checking total available records...")
        data = fetch_sam_page(0, limit=1, posted_from=posted_from, posted_to=posted_to)
        total = data.get('totalRecords', 0)
        log(f"Total available: {total:,}")
        state['total_available'] = total
        save_checkpoint(state)
        return

    if not args.fetch and not args.fetch_all:
        parser.print_help()
        return

    # Connect to DB
    conn = db_connect()

    # Determine how many calls to make
    if args.fetch_all:
        # First, check total
        log("Checking total available...")
        data = fetch_sam_page(state['offset'], limit=1, posted_from=posted_from, posted_to=posted_to)
        total = data.get('totalRecords', 0)
        remaining = total - state['offset']
        num_calls = (remaining // 1000) + (1 if remaining % 1000 else 0)
        log(f"Total: {total:,}, Already fetched: {state['offset']:,}, Need: {num_calls} calls")
    else:
        num_calls = args.fetch

    log(f"Will make {num_calls} API call(s)")
    log(f"Date range: {posted_from} to {posted_to}")

    total_inserted = 0

    for i in range(num_calls):
        offset = state['offset']

        try:
            data = fetch_sam_page(offset, limit=1000, posted_from=posted_from, posted_to=posted_to)
            records = data.get('opportunitiesData', [])
            total_available = data.get('totalRecords', 0)

            if not records:
                log(f"No more records at offset {offset}")
                break

            log(f"Fetched {len(records)} records (total available: {total_available:,})")

            # Save raw JSON
            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            raw_file = DATA_DIR / f'sam_all_opps_{ts}_offset{offset}.json'
            raw_file.write_text(json.dumps(data, indent=2))
            log(f"Saved raw JSON to {raw_file.name}")

            # Insert to DB
            inserted = 0
            for record in records:
                opp = map_opportunity(record)
                if insert_opportunity(opp, conn):
                    inserted += 1

            log(f"Inserted/updated {inserted} records")
            total_inserted += inserted

            # Update checkpoint
            state['offset'] = offset + len(records)
            state['total_fetched'] += len(records)
            state['total_available'] = total_available
            save_checkpoint(state)

            # Check if we've fetched everything
            if state['offset'] >= total_available:
                log("All records fetched!")
                break

            # Rate limit - be nice
            if i < num_calls - 1:
                import time
                time.sleep(1)

        except urllib.error.HTTPError as e:
            if e.code == 429:
                log(f"Rate limited (429). Used all available API calls.", 'ERROR')
                break
            else:
                log(f"HTTP Error {e.code}: {e.reason}", 'ERROR')
                raise

    conn.close()

    log("=" * 50)
    log(f"COMPLETE: {total_inserted} records inserted/updated")
    log(f"Total fetched so far: {state['total_fetched']:,}")
    log(f"Checkpoint offset: {state['offset']:,}")
    log("=" * 50)


if __name__ == '__main__':
    main()
