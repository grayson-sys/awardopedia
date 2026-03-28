#!/usr/bin/env python3
"""
backfill_naics.py — Fill in missing NAICS descriptions from reference table.

Reads opportunities.naics_code and looks up description from naics_codes table.
"""

import os
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


def main():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Get all opportunities with NAICS code but no description
    cur.execute("""
        SELECT notice_id, naics_code
        FROM opportunities
        WHERE naics_code IS NOT NULL
          AND (naics_description IS NULL OR naics_description = '')
    """)
    rows = cur.fetchall()
    print(f"Found {len(rows)} opportunities needing NAICS descriptions")

    updated = 0
    for row in rows:
        notice_id = row['notice_id']
        naics = row['naics_code'].strip()

        # Try exact match, then parent codes
        candidates = [naics]
        if len(naics) >= 4:
            candidates.append(naics[:4])
        if len(naics) >= 3:
            candidates.append(naics[:3])
        if len(naics) >= 2:
            candidates.append(naics[:2])

        placeholders = ','.join(['%s'] * len(candidates))
        cur.execute(
            f"SELECT code, description FROM naics_codes WHERE code IN ({placeholders}) ORDER BY LENGTH(code) DESC LIMIT 1",
            candidates
        )
        match = cur.fetchone()

        if match:
            cur.execute(
                "UPDATE opportunities SET naics_description = %s WHERE notice_id = %s",
                [match['description'], notice_id]
            )
            updated += 1
            if updated % 500 == 0:
                print(f"  Updated {updated}...")

    print(f"\nDone. Updated {updated} records with NAICS descriptions.")
    conn.close()


if __name__ == '__main__':
    main()
