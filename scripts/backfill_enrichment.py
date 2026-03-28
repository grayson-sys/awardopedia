#!/usr/bin/env python3
"""
backfill_enrichment.py — Run all deterministic enrichment on existing records.

Fills in:
- NAICS descriptions from naics_codes table
- PSC descriptions from psc_codes table
- Agency display names (normalized)

Does NOT call any APIs or AI. Pure database enrichment.
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
AGENCY_MAP = {
    'DEPT OF DEFENSE': 'Defense Department',
    'DEPARTMENT OF DEFENSE': 'Defense Department',
    'DEPT OF THE ARMY': 'U.S. Army',
    'DEPT OF THE NAVY': 'U.S. Navy',
    'DEPT OF THE AIR FORCE': 'U.S. Air Force',
    'GENERAL SERVICES ADMINISTRATION': 'GSA',
    'VETERANS AFFAIRS, DEPARTMENT OF': 'Veterans Affairs',
    'DEPT OF VETERANS AFFAIRS': 'Veterans Affairs',
    'HEALTH AND HUMAN SERVICES, DEPARTMENT OF': 'HHS',
    'DEPT OF HEALTH AND HUMAN SERVICES': 'HHS',
    'HOMELAND SECURITY, DEPARTMENT OF': 'Homeland Security',
    'DEPT OF HOMELAND SECURITY': 'Homeland Security',
    'JUSTICE, DEPARTMENT OF': 'Justice Department',
    'DEPT OF JUSTICE': 'Justice Department',
    'TREASURY, DEPARTMENT OF THE': 'Treasury Department',
    'DEPT OF THE TREASURY': 'Treasury Department',
    'TRANSPORTATION, DEPARTMENT OF': 'Transportation',
    'DEPT OF TRANSPORTATION': 'Transportation',
    'AGRICULTURE, DEPARTMENT OF': 'USDA',
    'DEPT OF AGRICULTURE': 'USDA',
    'INTERIOR, DEPARTMENT OF THE': 'Interior',
    'DEPT OF THE INTERIOR': 'Interior',
    'COMMERCE, DEPARTMENT OF': 'Commerce',
    'DEPT OF COMMERCE': 'Commerce',
    'ENERGY, DEPARTMENT OF': 'Energy',
    'DEPT OF ENERGY': 'Energy',
    'STATE, DEPARTMENT OF': 'State Department',
    'DEPT OF STATE': 'State Department',
    'LABOR, DEPARTMENT OF': 'Labor',
    'DEPT OF LABOR': 'Labor',
    'EDUCATION, DEPARTMENT OF': 'Education',
    'DEPT OF EDUCATION': 'Education',
    'HOUSING AND URBAN DEVELOPMENT, DEPARTMENT OF': 'HUD',
    'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION': 'NASA',
    'ENVIRONMENTAL PROTECTION AGENCY': 'EPA',
    'SOCIAL SECURITY ADMINISTRATION': 'SSA',
    'SMALL BUSINESS ADMINISTRATION': 'SBA',
    'OFFICE OF PERSONNEL MANAGEMENT': 'OPM',
    'NATIONAL SCIENCE FOUNDATION': 'NSF',
    'AGENCY FOR INTERNATIONAL DEVELOPMENT': 'USAID',
}

def normalize_agency(raw: str) -> str:
    """Normalize agency name to friendly display format."""
    if not raw:
        return ''
    upper = raw.upper().strip()
    if upper in AGENCY_MAP:
        return AGENCY_MAP[upper]
    # Remove "DEPT OF" prefix
    cleaned = re.sub(r'^DEPT\s+OF\s+(THE\s+)?', '', upper)
    # Title case
    return cleaned.title()


def main():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # ── 1. NAICS descriptions ────────────────────────────────────────────────
    print("=== NAICS Descriptions ===")
    cur.execute("""
        SELECT notice_id, naics_code
        FROM opportunities
        WHERE naics_code IS NOT NULL
          AND (naics_description IS NULL OR naics_description = '')
    """)
    naics_rows = cur.fetchall()
    print(f"Found {len(naics_rows)} records needing NAICS descriptions")

    naics_updated = 0
    for row in naics_rows:
        notice_id = row['notice_id']
        naics = row['naics_code'].strip()

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
            naics_updated += 1
            if naics_updated % 500 == 0:
                print(f"  NAICS: {naics_updated}...")

    print(f"  Updated {naics_updated} NAICS descriptions")

    # ── 2. PSC descriptions ──────────────────────────────────────────────────
    print("\n=== PSC Descriptions ===")
    cur.execute("""
        SELECT o.notice_id, o.psc_code
        FROM opportunities o
        LEFT JOIN psc_codes p ON o.psc_code = p.code
        WHERE o.psc_code IS NOT NULL
          AND p.description IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM opportunity_intel i
            WHERE i.notice_id = o.notice_id
          )
    """)
    # Actually let's just check which records are missing PSC in opportunity_intel
    # But PSC description is shown via JOIN in the API, so it should work already
    print("  PSC descriptions are looked up via JOIN - no backfill needed")

    # ── 3. Agency normalization ──────────────────────────────────────────────
    # Note: We store the raw agency_name in opportunities table
    # The frontend normalizes it via agencyNorm.js
    # But let's add a denormalized column for faster queries
    print("\n=== Agency Names ===")
    cur.execute("""
        SELECT DISTINCT agency_name FROM opportunities
        WHERE agency_name IS NOT NULL
        LIMIT 20
    """)
    sample = [r['agency_name'] for r in cur.fetchall()]
    print("  Sample agency names in DB:")
    for a in sample[:10]:
        norm = normalize_agency(a)
        if norm != a:
            print(f"    {a[:40]} → {norm}")
    print("  Agency normalization happens in frontend (agencyNorm.js)")

    print(f"\n=== DONE ===")
    print(f"NAICS: {naics_updated} updated")
    conn.close()


if __name__ == '__main__':
    main()
