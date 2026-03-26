#!/usr/bin/env python3
"""
cleanup_agency_names.py — Fast post-ingest cleanup of agency names

Run this AFTER data ingestion to normalize agency names without slowing down the pipeline.
Designed to be idempotent - safe to run multiple times.

USAGE:
  python3 scripts/cleanup_agency_names.py           # Run cleanup
  python3 scripts/cleanup_agency_names.py --check   # Show what needs cleaning
"""

import os, sys, argparse
from pathlib import Path
from datetime import datetime

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

DATABASE_URL = os.environ.get('DATABASE_URL', '')

# ── Cleanup rules ─────────────────────────────────────────────────────────────
# Format: (SQL pattern to match, clean name)
# These run as batch UPDATEs - very fast

AGENCY_CLEANUPS = [
    # Defense - catches "OF Defense > ..." verbose paths
    ("agency_name LIKE 'OF Defense%'", "Defense Department"),
    ("agency_name LIKE 'DEPT OF DEFENSE%'", "Defense Department"),

    # Departments with comma format: "X, Department of"
    ("agency_name LIKE 'Veterans Affairs%'", "Veterans Affairs Department"),
    ("agency_name LIKE 'Agriculture%Department%' OR agency_name LIKE 'Agriculture, Department%'", "Agriculture Department"),
    ("agency_name LIKE 'Commerce%Department%' OR agency_name LIKE 'Commerce, Department%'", "Commerce Department"),
    ("agency_name LIKE 'Energy%Department%' OR agency_name LIKE 'Energy, Department%'", "Energy Department"),
    ("agency_name LIKE '%Human Services%Department%' OR agency_name LIKE '%Human Services, Department%'", "Health and Human Services Department"),
    ("agency_name LIKE 'Homeland Security%Department%' OR agency_name LIKE 'Homeland Security, Department%'", "Homeland Security Department"),
    ("agency_name LIKE 'Interior%Department%' OR agency_name LIKE 'Interior, Department%'", "Interior Department"),
    ("agency_name LIKE 'Justice%Department%' OR agency_name LIKE 'Justice, Department%'", "Justice Department"),
    ("agency_name LIKE 'Labor%Department%' OR agency_name LIKE 'Labor, Department%'", "Labor Department"),
    ("agency_name LIKE 'State%Department%' OR agency_name LIKE 'State, Department%'", "State Department"),
    ("agency_name LIKE 'Transportation%Department%' OR agency_name LIKE 'Transportation, Department%'", "Transportation Department"),
    ("agency_name LIKE 'Treasury%Department%' OR agency_name LIKE 'Treasury, Department%'", "Treasury Department"),
    ("agency_name LIKE 'Education%Department%' OR agency_name LIKE 'Education, Department%'", "Education Department"),
    ("agency_name LIKE 'Housing%Development%Department%'", "Housing and Urban Development Department"),

    # Verbose sub-agency paths (simplify to top-level)
    ("agency_name LIKE 'General Services Administration >%'", "General Services Administration"),

    # Acronyms to spell out (except NASA)
    ("agency_name = 'EPA'", "Environmental Protection Agency"),
    ("agency_name = 'GSA'", "General Services Administration"),
    ("agency_name = 'NRC'", "Nuclear Regulatory Commission"),
    ("agency_name = 'SSA'", "Social Security Administration"),
    ("agency_name = 'SBA'", "Small Business Administration"),
    ("agency_name = 'OPM'", "Office of Personnel Management"),

    # NASA variations → NASA (keep as acronym, it's a household name)
    ("agency_name LIKE 'National Aeronautics%'", "NASA"),

    # Other cleanups
    ("agency_name LIKE 'Security Administration >%'", "Social Security Administration"),
    ("agency_name LIKE 'Library OF Congress%'", "Library of Congress"),
    ("agency_name LIKE 'Administrative Office OF%'", "Administrative Office of the US Courts"),
    ("agency_name LIKE '%Government Publishing Office%'", "US Government Publishing Office"),
]


def run_cleanup(check_only: bool = False):
    """Run all cleanup rules as batch UPDATEs."""
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()

    total_fixed = 0

    for condition, clean_name in AGENCY_CLEANUPS:
        # Check how many match
        cur.execute(f"SELECT COUNT(*) FROM opportunities WHERE {condition}")
        count = cur.fetchone()[0]

        if count > 0:
            if check_only:
                print(f"  {count:>5} → {clean_name}")
            else:
                cur.execute(f"UPDATE opportunities SET agency_name = %s WHERE {condition}", [clean_name])
                print(f"  Fixed {cur.rowcount}: → {clean_name}")
                total_fixed += cur.rowcount

    conn.close()

    if check_only:
        print(f"\nTotal needing cleanup: {total_fixed}")
    else:
        print(f"\nTotal fixed: {total_fixed}")

    return total_fixed


def main():
    parser = argparse.ArgumentParser(description='Post-ingest agency name cleanup')
    parser.add_argument('--check', action='store_true', help='Show what needs cleaning without fixing')
    args = parser.parse_args()

    print(f"Agency name cleanup — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)

    run_cleanup(check_only=args.check)


if __name__ == '__main__':
    main()
