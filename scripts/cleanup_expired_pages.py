#!/usr/bin/env python3
"""
cleanup_expired_pages.py — Delete static pages for expired opportunities

Runs nightly before the pipeline. Finds opportunities where
response_deadline < today, deletes their static HTML from DO Spaces
and local disk, clears the static_page_generated flag in the DB.

USAGE:
  python3 scripts/cleanup_expired_pages.py            # delete expired pages
  python3 scripts/cleanup_expired_pages.py --dry-run  # list what would be deleted
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

import psycopg2, psycopg2.extras

DATABASE_URL = os.environ.get('DATABASE_URL', '')
STATIC_DIR = BASE_DIR / 'static' / 'opportunities'


def get_s3_client():
    try:
        import boto3
    except ImportError:
        print("WARNING: boto3 not installed — can only delete local files")
        return None
    session = boto3.session.Session()
    return session.client(
        's3',
        region_name=os.environ['DO_SPACES_REGION'],
        endpoint_url=os.environ['DO_SPACES_ENDPOINT'],
        aws_access_key_id=os.environ['DO_SPACES_KEY'],
        aws_secret_access_key=os.environ['DO_SPACES_SECRET'],
    )


def main():
    parser = argparse.ArgumentParser(description='Delete static pages for expired opportunities')
    parser.add_argument('--dry-run', action='store_true', help='List what would be deleted')
    args = parser.parse_args()

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True  # set before any queries
    cur = conn.cursor()

    # Find expired opportunities that have static pages
    cur.execute("""
        SELECT notice_id, slug, response_deadline
        FROM opportunities
        WHERE response_deadline < CURRENT_DATE
          AND report_generated = true
          AND slug IS NOT NULL
    """)
    expired = cur.fetchall()

    print(f"Found {len(expired)} expired static pages to clean up")

    if not expired:
        conn.close()
        return

    if args.dry_run:
        for nid, slug, deadline in expired[:20]:
            print(f"  Would delete: {slug} (expired {deadline})")
        if len(expired) > 20:
            print(f"  ... and {len(expired) - 20} more")
        conn.close()
        return

    s3 = get_s3_client()
    bucket = os.environ.get('DO_SPACES_BUCKET', 'awardopedia-static')
    deleted_cdn, deleted_local = 0, 0

    for nid, slug, deadline in expired:
        remote_key = f"opportunities/{slug}.html"
        local_path = STATIC_DIR / f"{slug}.html"

        # Delete from CDN
        if s3:
            try:
                s3.delete_object(Bucket=bucket, Key=remote_key)
                deleted_cdn += 1
            except Exception as e:
                print(f"  CDN delete failed for {slug}: {e}")

        # Delete local file
        if local_path.exists():
            local_path.unlink()
            deleted_local += 1

        # Clear the flag in DB (autocommit already on)
        cur.execute("""
            UPDATE opportunities
            SET report_generated = false, report_url = NULL
            WHERE notice_id = %s
        """, [nid])

    conn.close()
    print(f"Cleaned up: {deleted_cdn} from CDN, {deleted_local} local files")

    # ── Clean up local PDFs for expired opportunities ────────────────────
    # Text has already been extracted and stored in the DB. No need to keep
    # the PDFs on disk after the record expires.
    import shutil
    pdf_base = Path(__file__).parent.parent / 'data' / 'pdfs'
    if pdf_base.exists():
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SELECT notice_id FROM opportunities WHERE response_deadline < CURRENT_DATE")
        expired_ids = set(r[0] for r in cur.fetchall())
        conn.close()

        pdf_deleted = 0
        for d in pdf_base.iterdir():
            if d.is_dir() and d.name in expired_ids:
                shutil.rmtree(d)
                pdf_deleted += 1
        if pdf_deleted:
            print(f"Cleaned up {pdf_deleted} expired PDF directories")


if __name__ == '__main__':
    main()
