#!/usr/bin/env python3
"""
normalize_agencies.py — Extract and normalize agency hierarchy from SAM.gov data

Creates canonical agencies table with parent-child relationships:
  - department (top level: DEPT OF DEFENSE, DEPT OF AGRICULTURE, etc.)
  - sub_tier (DEFENSE LOGISTICS AGENCY, FOREST SERVICE, etc.)
  - major_command (DLA AVIATION, regional forests, etc.)
  - sub_command (specific offices)
  - office_code (SPE4A6, etc.)

Then normalizes opportunity records to reference the canonical table.

USAGE:
  python3 scripts/normalize_agencies.py --check       # Show current state
  python3 scripts/normalize_agencies.py --build       # Build canonical table
  python3 scripts/normalize_agencies.py --normalize   # Update opportunities
  python3 scripts/normalize_agencies.py --dry-run     # Preview without writes
"""

import os, sys, json, re, argparse
from pathlib import Path
from datetime import datetime
from collections import defaultdict

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
DATA_DIR = BASE_DIR / 'data'
LOG_FILE = BASE_DIR / 'logs' / 'normalize_agencies.log'


def log(msg: str, level: str = 'INFO'):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] [{level}] {msg}"
    print(line)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')


def db_connect():
    return psycopg2.connect(DATABASE_URL)


# ── Title case helper ────────────────────────────────────────────────────────
LOWER_WORDS = {'of', 'the', 'and', 'for', 'in', 'at', 'by', 'to'}
ACRONYMS = {'USA', 'US', 'NASA', 'EPA', 'FDA', 'GSA', 'HHS', 'DHS', 'HUD', 'DOD',
            'DOE', 'DOJ', 'DOL', 'DOT', 'DLA', 'USDA', 'USMC', 'VA', 'FBI', 'CIA',
            'NSF', 'NIH', 'CDC', 'FAA', 'FCC', 'SEC', 'SBA', 'OPM', 'NRC', 'FEMA',
            'ARS', 'NIST', 'NOAA', 'USPTO', 'USAID', 'IRS', 'SSA', 'FPAC', 'APHIS'}


def to_title_case(s: str) -> str:
    """Convert to title case, preserving acronyms."""
    if not s:
        return s
    words = s.split()
    result = []
    for i, word in enumerate(words):
        upper = word.upper()
        if upper in ACRONYMS:
            result.append(upper)
        elif i == 0:
            result.append(word.capitalize())
        elif word.lower() in LOWER_WORDS:
            result.append(word.lower())
        else:
            result.append(word.capitalize())
    return ' '.join(result)


def clean_agency_name(name: str) -> str:
    """Clean and normalize an agency name segment."""
    if not name:
        return name

    # Fix ALL CAPS
    if name.isupper() and len(name) > 4:
        name = to_title_case(name)

    # Fix "DEPT OF" → "Department of"
    name = re.sub(r'\bDEPT\s+OF\b', 'Department of', name, flags=re.IGNORECASE)
    name = re.sub(r'\bDEPARTMENT\s+OF\b', 'Department of', name, flags=re.IGNORECASE)

    # Fix common abbreviations
    abbrevs = {
        r'\bADMIN\b': 'Administration',
        r'\bNATL\b': 'National',
        r'\bINTL\b': 'International',
        r'\bSVC\b': 'Service',
        r'\bSVCS\b': 'Services',
        r'\bMGMT\b': 'Management',
        r'\bDEV\b': 'Development',
        r'\bOFC\b': 'Office',
    }
    for pattern, replacement in abbrevs.items():
        name = re.sub(pattern, replacement, name, flags=re.IGNORECASE)

    return name.strip()


def parse_agency_path(full_path_name: str) -> dict:
    """
    Parse SAM.gov fullParentPathName into hierarchy levels.

    Input: "DEPT OF DEFENSE.DEFENSE LOGISTICS AGENCY.DLA AVIATION.DLA AV RICHMOND.DLA AVIATION"
    Output: {
        'department': 'Department of Defense',
        'sub_tier': 'Defense Logistics Agency',
        'major_command': 'DLA Aviation',
        'sub_command_1': 'DLA AV Richmond',
        'sub_command_2': 'DLA Aviation',
        'office_name': 'DLA Aviation'
    }
    """
    if not full_path_name:
        return {}

    # Split on dots (SAM.gov format) or " > " (some records)
    if '.' in full_path_name:
        parts = [p.strip() for p in full_path_name.split('.') if p.strip()]
    else:
        parts = [p.strip() for p in full_path_name.split(' > ') if p.strip()]

    result = {}

    if len(parts) >= 1:
        result['department'] = clean_agency_name(parts[0])
    if len(parts) >= 2:
        result['sub_tier'] = clean_agency_name(parts[1])
    if len(parts) >= 3:
        result['major_command'] = clean_agency_name(parts[2])
    if len(parts) >= 4:
        result['sub_command_1'] = clean_agency_name(parts[3])
    if len(parts) >= 5:
        result['sub_command_2'] = clean_agency_name(parts[4])
    if len(parts) >= 6:
        result['sub_command_3'] = clean_agency_name(parts[5])

    # The last part is typically the office name
    if parts:
        result['office_name'] = clean_agency_name(parts[-1])

    return result


def create_schema(conn, dry_run: bool = False):
    """Create the agencies canonical table."""

    schema_sql = """
    -- Canonical agencies table with hierarchy
    CREATE TABLE IF NOT EXISTS agencies (
        id SERIAL PRIMARY KEY,

        -- Hierarchy levels (each level is optional)
        department VARCHAR(255),           -- Top level: "Department of Defense"
        sub_tier VARCHAR(255),              -- "Defense Logistics Agency"
        major_command VARCHAR(255),         -- "DLA Aviation"
        sub_command_1 VARCHAR(255),         -- Further breakdown
        sub_command_2 VARCHAR(255),
        sub_command_3 VARCHAR(255),

        -- Normalized office name (last segment)
        office_name VARCHAR(255),

        -- Original SAM.gov path for reference
        full_path_name TEXT,
        full_path_code VARCHAR(255),

        -- Metadata
        record_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),

        -- Unique on the full path
        UNIQUE(full_path_name)
    );

    -- Index for fast lookups
    CREATE INDEX IF NOT EXISTS idx_agencies_department ON agencies(department);
    CREATE INDEX IF NOT EXISTS idx_agencies_sub_tier ON agencies(sub_tier);
    CREATE INDEX IF NOT EXISTS idx_agencies_office ON agencies(office_name);
    """

    if dry_run:
        log("[DRY] Would create agencies table and update opportunities schema")
        return

    cur = conn.cursor()
    cur.execute(schema_sql)
    conn.commit()
    log("Created agencies table schema")


def build_canonical_table(conn, dry_run: bool = False):
    """Build canonical agencies table from raw SAM.gov data files."""

    # Collect all unique agency paths
    agency_paths = defaultdict(int)

    # Scan all raw SAM.gov JSON files
    for json_file in DATA_DIR.glob('sam_all_opps_*.json'):
        log(f"Scanning {json_file.name}...")
        try:
            data = json.loads(json_file.read_text())
            for record in data.get('opportunitiesData', []):
                path_name = record.get('fullParentPathName', '')
                path_code = record.get('fullParentPathCode', '')
                if path_name:
                    agency_paths[(path_name, path_code)] += 1
        except Exception as e:
            log(f"Error reading {json_file.name}: {e}", 'ERROR')

    log(f"Found {len(agency_paths):,} unique agency paths")

    if dry_run:
        log("[DRY] Would insert agency records")
        for (path_name, path_code), count in list(agency_paths.items())[:5]:
            parsed = parse_agency_path(path_name)
            log(f"  {parsed.get('department', '')} > {parsed.get('sub_tier', '')} ({count} records)")
        return

    # Insert all unique agencies
    cur = conn.cursor()
    inserted = 0

    for (path_name, path_code), count in agency_paths.items():
        parsed = parse_agency_path(path_name)

        try:
            cur.execute("""
                INSERT INTO agencies (
                    department, sub_tier, major_command,
                    sub_command_1, sub_command_2, sub_command_3,
                    office_name, full_path_name, full_path_code, record_count
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (full_path_name) DO UPDATE SET
                    record_count = EXCLUDED.record_count
            """, [
                parsed.get('department'),
                parsed.get('sub_tier'),
                parsed.get('major_command'),
                parsed.get('sub_command_1'),
                parsed.get('sub_command_2'),
                parsed.get('sub_command_3'),
                parsed.get('office_name'),
                path_name,
                path_code,
                count
            ])
            inserted += 1
        except Exception as e:
            log(f"Error inserting agency: {e}", 'ERROR')

    conn.commit()
    log(f"Inserted {inserted:,} agency records")


def normalize_opportunities(conn, dry_run: bool = False, limit: int = None):
    """Update opportunities with clean agency display names."""

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Get opportunities with verbose agency names (contain dots or long " > " paths)
    query = """
        SELECT notice_id, agency_name
        FROM opportunities
        WHERE agency_name IS NOT NULL
          AND (agency_name LIKE '%.%' OR agency_name LIKE '% > % > %')
    """
    if limit:
        query += f" LIMIT {limit}"

    cur.execute(query)
    opps = cur.fetchall()
    log(f"Found {len(opps):,} opportunities with verbose agency names")

    if dry_run:
        log("[DRY] Would update agency_name fields")
        for opp in opps[:5]:
            parsed = parse_agency_path(opp['agency_name'])
            dept = parsed.get('department', '')
            office = parsed.get('office_name', '')
            log(f"  {opp['agency_name'][:50]}... → {dept} > {office}")
        return

    write_cur = conn.cursor()
    updated = 0

    for opp in opps:
        notice_id = opp['notice_id']
        raw_name = opp['agency_name'] or ''

        # Parse the agency path
        parsed = parse_agency_path(raw_name)
        dept = parsed.get('department', '')
        sub_tier = parsed.get('sub_tier', '')
        office = parsed.get('office_name', '')

        # Build clean display name: "Department > Office" (skip middle layers)
        if dept and office and dept != office:
            display_name = f"{dept} > {office}"
        elif dept and sub_tier and dept != sub_tier:
            display_name = f"{dept} > {sub_tier}"
        elif dept:
            display_name = dept
        else:
            continue  # Can't parse, skip

        # Only update if different and shorter
        if display_name != raw_name and len(display_name) < len(raw_name):
            write_cur.execute("""
                UPDATE opportunities
                SET agency_name = %s
                WHERE notice_id = %s
            """, [display_name, notice_id])
            updated += 1

    conn.commit()
    log(f"Updated {updated:,} opportunities with normalized agency names")


def check_status(conn):
    """Show current state of agency normalization."""
    cur = conn.cursor()

    # Check if agencies table exists
    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = 'agencies'
        )
    """)
    has_table = cur.fetchone()[0]

    if has_table:
        cur.execute("SELECT COUNT(*) FROM agencies")
        agency_count = cur.fetchone()[0]
        log(f"Agencies table: {agency_count:,} records")

        # Sample departments
        cur.execute("""
            SELECT department, COUNT(*) as cnt
            FROM agencies
            WHERE department IS NOT NULL
            GROUP BY department
            ORDER BY cnt DESC
            LIMIT 10
        """)
        log("\nTop departments:")
        for row in cur.fetchall():
            log(f"  {row[0]}: {row[1]} sub-agencies")
    else:
        log("Agencies table does not exist yet")

    # Check opportunities with verbose names
    cur.execute("""
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE agency_name LIKE '%.%' OR LENGTH(agency_name) > 60) as verbose
        FROM opportunities
        WHERE agency_name IS NOT NULL
    """)
    total, verbose = cur.fetchone()
    log(f"\nOpportunities: {verbose:,}/{total:,} have verbose agency names")

    # Sample verbose agency names
    cur.execute("""
        SELECT agency_name FROM opportunities
        WHERE agency_name LIKE '%.%' OR LENGTH(agency_name) > 60
        LIMIT 5
    """)
    log("\nSample un-normalized agency names:")
    for row in cur.fetchall():
        log(f"  {row[0][:70]}...")


def main():
    parser = argparse.ArgumentParser(description='Normalize agency hierarchy from SAM.gov data')
    parser.add_argument('--check', action='store_true', help='Show current state')
    parser.add_argument('--build', action='store_true', help='Build canonical agencies table')
    parser.add_argument('--normalize', action='store_true', help='Link opportunities to agencies')
    parser.add_argument('--all', action='store_true', help='Run all steps: build + normalize')
    parser.add_argument('--dry-run', action='store_true', help='Preview without writes')
    parser.add_argument('--limit', type=int, help='Limit records to process')
    args = parser.parse_args()

    conn = db_connect()

    if args.check:
        check_status(conn)
        return

    if not any([args.build, args.normalize, args.all]):
        parser.print_help()
        return

    # Create schema first
    create_schema(conn, args.dry_run)

    if args.build or args.all:
        build_canonical_table(conn, args.dry_run)

    if args.normalize or args.all:
        normalize_opportunities(conn, args.dry_run, args.limit)

    conn.close()
    log("Done")


if __name__ == '__main__':
    main()
