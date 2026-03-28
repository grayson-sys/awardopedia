#!/usr/bin/env python3
"""
backfill_agency_names.py — Normalize agency names in the database.

Converts:
  "AGRICULTURE, DEPARTMENT OF" → "USDA"
  "Energy, Department OF" → "Dept. of Energy"
  "DEPT OF DEFENSE" → "Defense Department"
"""

import os, re
from pathlib import Path

# Load .env
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


# ── Agency normalization (port of agencyNorm.js) ─────────────────────────────

def to_title_case(s):
    """Convert to title case, keeping small words lowercase."""
    LOWER = {'of', 'the', 'and', 'for', 'in', 'at', 'by', 'to'}
    words = s.lower().split()
    return ' '.join(
        w if (i > 0 and w in LOWER) else w.capitalize()
        for i, w in enumerate(words)
    )


def uninvert(raw):
    """Convert SAM.gov inverted names to normal format."""
    if not raw:
        return ''
    raw = raw.strip()

    # Already in normal format (mixed case, starts with "Department")
    if re.match(r'^[A-Z][a-z]', raw):
        return raw

    # "DEPT OF THE X" → "Department of the X"
    m = re.match(r'^DEPT\s+OF\s+THE\s+(.+)$', raw, re.IGNORECASE)
    if m:
        return f"Department of the {to_title_case(m.group(1))}"

    # "DEPT OF X" → "Department of X"
    m = re.match(r'^DEPT\s+OF\s+(.+)$', raw, re.IGNORECASE)
    if m:
        return f"Department of {to_title_case(m.group(1))}"

    # "X, DEPARTMENT OF THE" → "Department of the X"
    m = re.match(r'^(.+?),?\s+DEPARTMENT\s+OF\s+THE\s*$', raw, re.IGNORECASE)
    if m:
        return f"Department of the {to_title_case(m.group(1).strip())}"

    # "X, DEPARTMENT OF" → "Department of X"
    m = re.match(r'^(.+?),?\s+DEPARTMENT\s+OF\s*$', raw, re.IGNORECASE)
    if m:
        return f"Department of {to_title_case(m.group(1).strip())}"

    # All-caps fallback → title case
    if raw == raw.upper():
        return to_title_case(raw)

    return raw


# Abbreviation map: uninverted name → display name
ABBREV = {
    'Department of Agriculture':                   'USDA',
    'Department of Commerce':                      'Dept. of Commerce',
    'Department of Defense':                       'Defense Department',
    'Department of Education':                     'Dept. of Education',
    'Department of Energy':                        'Dept. of Energy',
    'Department of Health and Human Services':     'HHS',
    'Department of Homeland Security':             'DHS',
    'Department of Housing and Urban Development': 'HUD',
    'Department of Justice':                       'Dept. of Justice',
    'Department of Labor':                         'Dept. of Labor',
    'Department of State':                         'Dept. of State',
    'Department of the Interior':                  'Dept. of the Interior',
    'Department of the Treasury':                  'Dept. of the Treasury',
    'Department of Transportation':                'Dept. of Transportation',
    'Department of Veterans Affairs':              'Veterans Affairs',
    'Agency for International Development':        'USAID',
    'Environmental Protection Agency':             'EPA',
    'Federal Communications Commission':           'FCC',
    'General Services Administration':             'GSA',
    'National Aeronautics and Space Administration': 'NASA',
    'National Science Foundation':                 'NSF',
    'Nuclear Regulatory Commission':               'NRC',
    'Office of Personnel Management':              'OPM',
    'Small Business Administration':               'SBA',
    'Social Security Administration':              'SSA',
}


def normalize_agency(raw):
    """Normalize any raw agency name to display format."""
    if not raw:
        return None
    # Handle hierarchical names (e.g., "AGRICULTURE, DEPARTMENT OF.FOREST SERVICE")
    top = raw.split('.')[0].strip()
    normal = uninvert(top)
    return ABBREV.get(normal, normal)


def main():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # ── 1. Normalize opportunities ───────────────────────────────────────────
    print("=== Normalizing opportunity agency names ===")
    cur.execute("SELECT DISTINCT agency_name FROM opportunities WHERE agency_name IS NOT NULL")
    agency_names = [r['agency_name'] for r in cur.fetchall()]
    print(f"Found {len(agency_names)} distinct agency names")

    updated_opps = 0
    for raw in agency_names:
        normalized = normalize_agency(raw)
        if normalized and normalized != raw:
            cur.execute(
                "UPDATE opportunities SET agency_name = %s WHERE agency_name = %s",
                [normalized, raw]
            )
            count = cur.rowcount
            updated_opps += count
            print(f"  {raw[:40]} → {normalized} ({count} rows)")

    print(f"Updated {updated_opps} opportunity rows")

    # ── 2. Normalize contracts ───────────────────────────────────────────────
    print("\n=== Normalizing contract agency names ===")
    cur.execute("SELECT DISTINCT agency_name FROM contracts WHERE agency_name IS NOT NULL")
    contract_agencies = [r['agency_name'] for r in cur.fetchall()]
    print(f"Found {len(contract_agencies)} distinct agency names")

    updated_contracts = 0
    for raw in contract_agencies:
        normalized = normalize_agency(raw)
        if normalized and normalized != raw:
            cur.execute(
                "UPDATE contracts SET agency_name = %s WHERE agency_name = %s",
                [normalized, raw]
            )
            count = cur.rowcount
            updated_contracts += count
            print(f"  {raw[:40]} → {normalized} ({count} rows)")

    print(f"Updated {updated_contracts} contract rows")

    print(f"\n=== DONE ===")
    print(f"Opportunities: {updated_opps} rows normalized")
    print(f"Contracts: {updated_contracts} rows normalized")
    conn.close()


if __name__ == '__main__':
    main()
