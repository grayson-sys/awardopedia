#!/usr/bin/env python3
"""
fix_agency_names.py — Fix truncated agency names in the database

Fixes patterns like:
  "OF Defense > OF The Navy" → "DEPT OF Defense > DEPT OF The Navy"
  "Commerce, Department OF" → no change needed (frontend handles)
"""

import os, sys, re
import psycopg2

DATABASE_URL = os.environ.get('DATABASE_URL', '')

# Patterns to fix - order matters (more specific first)
FIXES = [
    # === INVERTED DEPARTMENT NAMES (highest priority) ===
    # "And Human Services, Department OF" → "Department of Health and Human Services"
    (r'^And Human Services, Department OF\b', 'Department of Health and Human Services'),
    # "Agriculture, Department OF" → "Department of Agriculture"
    (r'^Agriculture, Department OF\b', 'Department of Agriculture'),
    # "Interior, Department OF The" → "Department of the Interior"
    (r'^Interior, Department OF The\b', 'Department of the Interior'),
    # "Homeland Security, Department OF" → "Department of Homeland Security"
    (r'^Homeland Security, Department OF\b', 'Department of Homeland Security'),
    # "Veterans Affairs, Department OF" → "Department of Veterans Affairs"
    (r'^Veterans Affairs, Department OF\b', 'Department of Veterans Affairs'),
    # "State, Department OF" → "Department of State"
    (r'^State, Department OF\b', 'Department of State'),
    # "Commerce, Department OF" → "Department of Commerce"
    (r'^Commerce, Department OF\b', 'Department of Commerce'),
    # "Labor, Department OF" → "Department of Labor"
    (r'^Labor, Department OF\b', 'Department of Labor'),
    # "Energy, Department OF" → "Department of Energy"
    (r'^Energy, Department OF\b', 'Department of Energy'),
    # "Justice, Department OF" → "Department of Justice"
    (r'^Justice, Department OF\b', 'Department of Justice'),
    # "Treasury, Department OF The" → "Department of the Treasury"
    (r'^Treasury, Department OF The\b', 'Department of the Treasury'),
    # "Transportation, Department OF" → "Department of Transportation"
    (r'^Transportation, Department OF\b', 'Department of Transportation'),
    # "Education, Department OF" → "Department of Education"
    (r'^Education, Department OF\b', 'Department of Education'),
    # "Housing And Urban Development, Department OF" → "Department of Housing and Urban Development"
    (r'^Housing And Urban Development, Department OF\b', 'Department of Housing and Urban Development'),

    # === EXECUTIVE OFFICE ===
    (r'^Executive Office OF The President\b', 'Executive Office of the President'),

    # === COURTS ===
    (r'^Administrative Office OF The US Courts\b', 'Administrative Office of the US Courts'),

    # === TRUNCATED SEGMENTS (within sub-agencies) ===
    # "National Institutes OF Health" → "National Institutes of Health"
    (r'\bNational Institutes OF Health\b', 'National Institutes of Health'),
    # "OF Assistant Secretary" → "Office of the Assistant Secretary"
    (r'\bOF Assistant Secretary\b', 'Office of the Assistant Secretary'),
    # "OF The Assistant Secretary" → "Office of the Assistant Secretary"
    (r'\bOF The Assistant Secretary\b', 'Office of the Assistant Secretary'),
    # "And Drug Administration" → "Food and Drug Administration"
    (r'\bAnd Drug Administration\b', 'Food and Drug Administration'),
    # "National Institute OF" → "National Institute of"
    (r'\bNational Institute OF\b', 'National Institute of'),
    # "Div OF" → "Division of"
    (r'\bDiv OF\b', 'Division of'),
    # "Ofc OF" → "Office of"
    (r'\bOfc OF\b', 'Office of'),
    # "OF Acquisition" → "Office of Acquisition"
    (r'(^|> )OF Acquisition\b', r'\1Office of Acquisition'),

    # === ORIGINAL PATTERNS ===
    # "OF The Navy" → "DEPT OF THE NAVY"
    (r'\bOF The Navy\b', 'DEPT OF THE NAVY'),
    # "OF The Army" → "DEPT OF THE ARMY"
    (r'\bOF The Army\b', 'DEPT OF THE ARMY'),
    # "OF The Air Force" → "DEPT OF THE AIR FORCE"
    (r'\bOF The Air Force\b', 'DEPT OF THE AIR FORCE'),
    # "OF Defense" at start or after separator → "DEPT OF DEFENSE"
    (r'(^|> )OF Defense\b', r'\1DEPT OF DEFENSE'),
    # "OF Land Management" → "Bureau OF Land Management" (BLM)
    (r'\bOF Land Management\b', 'Bureau of Land Management'),
    # "OF Coast Guard" → "Coast Guard" (it's not "OF", it's just "Coast Guard")
    (r'\bOF Coast Guard\b', 'Coast Guard'),
    # "OF Oceanic" → "National Oceanic" (NOAA)
    (r'\bOF Oceanic\b', 'National Oceanic'),

    # === GENERAL CLEANUP ===
    # Fix remaining " OF " in middle of names (except " of ")
    (r' OF ', ' of '),
]

def fix_agency_name(name):
    if not name:
        return name

    original = name
    for pattern, replacement in FIXES:
        name = re.sub(pattern, replacement, name, flags=re.IGNORECASE)

    return name if name != original else None

def main():
    dry_run = '--dry-run' in sys.argv

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Find all malformed agency names
    cur.execute("""
        SELECT notice_id, agency_name
        FROM opportunities
        WHERE agency_name LIKE 'OF %'
           OR agency_name LIKE '% > OF %'
           OR agency_name LIKE '%OF Defense%'
           OR agency_name LIKE '%OF The Navy%'
           OR agency_name LIKE '%OF The Army%'
           OR agency_name LIKE '%OF Land Management%'
           OR agency_name LIKE 'And Human Services, Department OF%'
           OR agency_name LIKE 'Agriculture, Department OF%'
           OR agency_name LIKE 'Interior, Department OF%'
           OR agency_name LIKE 'Homeland Security, Department OF%'
           OR agency_name LIKE 'Veterans Affairs, Department OF%'
           OR agency_name LIKE 'State, Department OF%'
           OR agency_name LIKE 'Commerce, Department OF%'
           OR agency_name LIKE 'Labor, Department OF%'
           OR agency_name LIKE 'Energy, Department OF%'
           OR agency_name LIKE 'Justice, Department OF%'
           OR agency_name LIKE 'Treasury, Department OF%'
           OR agency_name LIKE 'Transportation, Department OF%'
           OR agency_name LIKE 'Education, Department OF%'
           OR agency_name LIKE 'Housing And Urban%'
           OR agency_name LIKE 'Executive Office OF%'
           OR agency_name LIKE 'Administrative Office OF%'
           OR agency_name LIKE '% OF %'
    """)

    rows = cur.fetchall()
    print(f"Found {len(rows)} records with malformed agency names")

    updates = []
    for notice_id, agency_name in rows:
        fixed = fix_agency_name(agency_name)
        if fixed:
            updates.append((notice_id, agency_name, fixed))

    print(f"Fixable: {len(updates)}")

    # Show samples
    print("\n=== Sample fixes ===")
    seen = set()
    for notice_id, old, new in updates[:30]:
        # Dedupe for display
        key = (old[:50], new[:50])
        if key not in seen:
            seen.add(key)
            print(f"  {old[:70]}")
            print(f"  → {new[:70]}")
            print()

    if dry_run:
        print(f"[DRY RUN] Would update {len(updates)} records")
        return

    # Apply updates
    if updates:
        print(f"Applying {len(updates)} fixes...")
        for notice_id, old, new in updates:
            cur.execute(
                "UPDATE opportunities SET agency_name = %s WHERE notice_id = %s",
                (new, notice_id)
            )
        conn.commit()
        print("Done!")

    cur.close()
    conn.close()

if __name__ == '__main__':
    main()
