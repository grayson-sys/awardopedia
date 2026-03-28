#!/usr/bin/env python3
"""
backfill_cui_flag.py — Set has_controlled_docs flag from existing attachment data.

Reads the attachments JSONB field from opportunities table and checks for:
- access_level = 'controlled'
- export_controlled = true

No SAM.gov API calls — purely database reads.
"""

import os, json
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

    # Get all opportunities with attachments that have access_level info
    cur.execute("""
        SELECT notice_id, attachments
        FROM opportunities
        WHERE attachments IS NOT NULL
          AND attachments::text LIKE '%access_level%'
    """)
    rows = cur.fetchall()
    print(f"Found {len(rows)} opportunities with access_level info in attachments")

    controlled_count = 0
    for row in rows:
        notice_id = row['notice_id']
        atts = row['attachments']
        if isinstance(atts, str):
            atts = json.loads(atts)

        # Check if any attachment is controlled
        has_controlled = any(
            att.get('access_level') == 'controlled' or att.get('export_controlled')
            for att in atts
        )

        if has_controlled:
            controlled_count += 1
            cur.execute("""
                INSERT INTO opportunity_intel (notice_id, has_controlled_docs)
                VALUES (%s, TRUE)
                ON CONFLICT (notice_id) DO UPDATE
                SET has_controlled_docs = TRUE
            """, [notice_id])
            print(f"  [CUI] {notice_id}")

    print(f"\nDone. {controlled_count} opportunities flagged as having controlled documents.")
    conn.close()


if __name__ == '__main__':
    main()
