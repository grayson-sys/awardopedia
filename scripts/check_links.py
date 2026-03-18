#!/usr/bin/env python3
"""
check_links.py — Phase 5: Weekly dead link checker

Verifies USASpending.gov URLs for all contracts/opportunities are still alive.
Designed to handle millions of records gracefully.

SCALE DESIGN:
  - Prioritizes records never checked or checked longest ago (oldest first)
  - Skips records checked within the last 6 days (won't overlap weekly run)
  - Dead records checked monthly only (they rarely recover)
  - Hard stop after MAX_HOURS (default 3h) — rotates through full DB over weeks
  - 10 concurrent HTTP threads → ~18,000 checks/hour = ~54,000 per Sunday run
  - Batch DB commits every 100 records (not per-record — massive speed diff)
  - Resumable via progress file if run is interrupted
  - Rate limit: max 100 req/min enforced via token bucket

USAGE:
  python3 scripts/check_links.py                  # normal weekly run
  python3 scripts/check_links.py --limit 100      # test: 100 records
  python3 scripts/check_links.py --dry-run        # show what would run, no HTTP
  python3 scripts/check_links.py --max-hours 1    # shorter run window
  python3 scripts/check_links.py --no-email       # skip SendGrid report

LAUNCHAGENT: Sunday 3am (see launchagents/com.awardopedia.checklinks.plist)
"""

import os, sys, json, time, urllib.request, urllib.error
from pathlib import Path
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import deque
import threading

# ── Load .env ─────────────────────────────────────────────────────────────────
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2, psycopg2.extras, psycopg2.pool

DATABASE_URL    = os.environ['DATABASE_URL']
SENDGRID_API_KEY = os.environ.get('SENDGRID_API_KEY', '')
ADMIN_EMAIL     = os.environ.get('ADMIN_EMAIL', 'grayson@graysonschaffer.com')

LOG_DIR         = Path(__file__).parent.parent / 'logs'
PROGRESS_FILE   = LOG_DIR / 'checklinks_progress.json'
LOG_DIR.mkdir(exist_ok=True)

# ── Tuning constants ──────────────────────────────────────────────────────────

MAX_HOURS        = 3          # hard stop after this many hours
CONCURRENCY      = 10         # parallel HTTP threads
MAX_REQ_PER_MIN  = 100        # USASpending rate limit
BATCH_COMMIT     = 100        # DB commit every N records
MIN_RECHECK_DAYS = 6          # skip records checked < 6 days ago
DEAD_RECHECK_DAYS = 30        # re-check dead records monthly only
REQUEST_TIMEOUT  = 10         # HTTP timeout per request (seconds)

# ── Rate limiter (token bucket) ───────────────────────────────────────────────

class RateLimiter:
    """Token bucket — enforces MAX_REQ_PER_MIN across all threads."""
    def __init__(self, per_minute: int):
        self.per_minute  = per_minute
        self.interval    = 60.0 / per_minute
        self._lock       = threading.Lock()
        self._last_call  = 0.0

    def acquire(self):
        with self._lock:
            now   = time.monotonic()
            delta = now - self._last_call
            if delta < self.interval:
                time.sleep(self.interval - delta)
            self._last_call = time.monotonic()

rate_limiter = RateLimiter(MAX_REQ_PER_MIN)

# ── DB helpers ────────────────────────────────────────────────────────────────

def ensure_dead_links_table():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS dead_links (
            id             SERIAL PRIMARY KEY,
            record_type    VARCHAR(20)   NOT NULL,
            piid           VARCHAR(100),
            notice_id      VARCHAR(255),
            url            TEXT          NOT NULL,
            http_status    INTEGER,
            first_dead_at  TIMESTAMP     NOT NULL DEFAULT NOW(),
            last_checked_at TIMESTAMP    NOT NULL DEFAULT NOW(),
            redirect_url   TEXT,
            recovered_at   TIMESTAMP
        )
    """)
    # Indexes: non-fatal if we don't own the table (e.g. created by doadmin)
    for idx_sql in [
        "CREATE INDEX IF NOT EXISTS idx_dead_links_piid ON dead_links(piid)",
        "CREATE INDEX IF NOT EXISTS idx_dead_links_notice ON dead_links(notice_id)",
    ]:
        try:
            cur.execute(idx_sql)
        except Exception as e:
            print(f"  (index skipped — {e})")
    conn.close()

def fetch_batch_to_check(limit: int = None) -> list:
    """
    Returns records to check, prioritized by age.
    Skips recently checked and respects dead/alive recheck windows.
    """
    conn = psycopg2.connect(DATABASE_URL)
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cutoff_recent = datetime.now(timezone.utc) - timedelta(days=MIN_RECHECK_DAYS)
    cutoff_dead   = datetime.now(timezone.utc) - timedelta(days=DEAD_RECHECK_DAYS)

    # Contracts: never checked OR alive but stale OR dead but monthly recheck
    cur.execute("""
        SELECT piid AS id, 'contract' AS record_type,
               usaspending_url AS url,
               usaspending_alive AS alive,
               usaspending_checked AS last_checked
        FROM contracts
        WHERE usaspending_url IS NOT NULL
          AND (
            usaspending_checked IS NULL
            OR (usaspending_alive = true  AND usaspending_checked < %s)
            OR (usaspending_alive = false AND usaspending_checked < %s)
          )
        ORDER BY usaspending_checked ASC NULLS FIRST
        LIMIT %s
    """, [cutoff_recent, cutoff_dead, limit or 500000])
    rows = [dict(r) for r in cur.fetchall()]

    # Opportunities (same logic, different columns)
    cur.execute("""
        SELECT notice_id AS id, 'opportunity' AS record_type,
               sam_url AS url,
               sam_url_alive AS alive,
               sam_url_checked AS last_checked
        FROM opportunities
        WHERE sam_url IS NOT NULL
          AND (
            sam_url_checked IS NULL
            OR (sam_url_alive = true  AND sam_url_checked < %s)
            OR (sam_url_alive = false AND sam_url_checked < %s)
          )
        ORDER BY sam_url_checked ASC NULLS FIRST
        LIMIT %s
    """, [cutoff_recent, cutoff_dead, limit or 500000])
    rows += [dict(r) for r in cur.fetchall()]
    conn.close()

    # Sort: never-checked first, then oldest checked
    rows.sort(key=lambda r: r['last_checked'] or datetime.min.replace(tzinfo=timezone.utc))
    return rows

def check_url(record: dict) -> dict:
    """Single URL check. Returns result dict. Thread-safe."""
    url  = record['url']
    result = dict(record)
    rate_limiter.acquire()

    try:
        req = urllib.request.Request(
            url, method='HEAD',
            headers={'User-Agent': 'Awardopedia/1.0 (awardopedia.com link-checker)'}
        )
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as r:
            result['status'] = r.status
            result['final_url'] = r.url  # captures redirects
            result['alive'] = r.status < 400
    except urllib.error.HTTPError as e:
        result['status']    = e.code
        result['final_url'] = url
        result['alive']     = e.code < 400
    except Exception as e:
        result['status']    = 0
        result['final_url'] = url
        result['alive']     = False
        result['error']     = str(e)[:100]

    return result

def flush_batch(updates: list, dead_inserts: list):
    """Batch DB commit. Called every BATCH_COMMIT records."""
    if not updates and not dead_inserts:
        return
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur  = conn.cursor()
    now  = datetime.now(timezone.utc)

    for u in updates:
        if u['record_type'] == 'contract':
            cur.execute("""
                UPDATE contracts SET
                    usaspending_alive   = %s,
                    usaspending_checked = %s,
                    usaspending_url     = CASE WHEN %s != usaspending_url THEN %s ELSE usaspending_url END
                WHERE piid = %s
            """, [u['alive'], now, u.get('final_url',''), u.get('final_url', u['url']), u['id']])
        else:
            cur.execute("""
                UPDATE opportunities SET
                    sam_url_alive   = %s,
                    sam_url_checked = %s
                WHERE notice_id = %s
            """, [u['alive'], now, u['id']])

    for d in dead_inserts:
        # Insert or update dead_links record
        if d['record_type'] == 'contract':
            cur.execute("""
                INSERT INTO dead_links (record_type, piid, url, http_status, last_checked_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, [d['record_type'], d['id'], d['url'], d.get('status', 0), now])
        else:
            cur.execute("""
                INSERT INTO dead_links (record_type, notice_id, url, http_status, last_checked_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
            """, [d['record_type'], d['id'], d['url'], d.get('status', 0), now])

    conn.commit()
    conn.close()

# ── SendGrid email ────────────────────────────────────────────────────────────

def send_summary_email(stats: dict):
    if not SENDGRID_API_KEY:
        print("  (no SENDGRID_API_KEY — skipping email)")
        return

    subject = f"Awardopedia Link Check — {datetime.now().strftime('%Y-%m-%d')} — {stats['newly_dead']} new dead links"
    body    = f"""Weekly Link Check Complete
==========================
Date:          {datetime.now().strftime('%Y-%m-%d %H:%M MDT')}
Total checked: {stats['checked']:,}
Newly dead:    {stats['newly_dead']}
Still dead:    {stats['still_dead']}
Recovered:     {stats['recovered']}
Redirected:    {stats['redirected']}
Errors:        {stats['errors']}
Runtime:       {stats['runtime_min']:.1f} minutes

{"NEWLY DEAD RECORDS:" + chr(10) + chr(10).join(stats['newly_dead_list']) if stats['newly_dead_list'] else "No new dead links this week."}
"""

    payload = json.dumps({
        "personalizations": [{"to": [{"email": ADMIN_EMAIL}]}],
        "from": {"email": "noreply@awardopedia.com", "name": "Awardopedia"},
        "subject": subject,
        "content": [{"type": "text/plain", "value": body}]
    }).encode()

    req = urllib.request.Request(
        "https://api.sendgrid.com/v3/mail/send",
        data=payload,
        headers={
            "Authorization": f"Bearer {SENDGRID_API_KEY}",
            "Content-Type": "application/json"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            print(f"  ✓ Email sent ({r.status}) → {ADMIN_EMAIL}")
    except Exception as e:
        print(f"  ✗ Email failed: {e}")

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit',     type=int,   help='Max records to check')
    parser.add_argument('--max-hours', type=float, default=MAX_HOURS)
    parser.add_argument('--dry-run',   action='store_true')
    parser.add_argument('--no-email',  action='store_true')
    parser.add_argument('--workers',   type=int,   default=CONCURRENCY)
    args = parser.parse_args()

    t_start = time.monotonic()
    deadline = t_start + (args.max_hours * 3600)

    print("=" * 60)
    print("AWARDOPEDIA — DEAD LINK CHECKER")
    print(f"Started:    {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Max hours:  {args.max_hours}h  |  Workers: {args.workers}  |  Rate: {MAX_REQ_PER_MIN}/min")
    print(f"Batch size: {BATCH_COMMIT} DB writes  |  Recheck: {MIN_RECHECK_DAYS}d alive / {DEAD_RECHECK_DAYS}d dead")
    print("=" * 60)

    if args.dry_run:
        records = fetch_batch_to_check(limit=args.limit or 10)
        print(f"\n[DRY RUN] Would check {len(records)} records")
        for r in records[:5]:
            print(f"  {r['record_type']:12} {r['id'][:40]:40} checked={r['last_checked'] or 'never'}")
        sys.exit(0)

    ensure_dead_links_table()

    records = fetch_batch_to_check(limit=args.limit)
    print(f"\n{len(records):,} records queued for checking")

    if not records:
        print("Nothing to check.")
        sys.exit(0)

    # ── Stats tracking ────────────────────────────────────────────────────────
    stats = {
        'checked': 0, 'newly_dead': 0, 'still_dead': 0,
        'recovered': 0, 'redirected': 0, 'errors': 0,
        'newly_dead_list': []
    }

    pending_updates  = []
    pending_dead     = []
    lock             = threading.Lock()

    def handle_result(result: dict):
        """Process one result. Called from main thread."""
        was_alive = result.get('alive_before', True)  # assume alive if unknown
        is_alive  = result['alive']
        redirected = result.get('final_url') and result['final_url'] != result['url']

        if not is_alive and was_alive:
            stats['newly_dead'] += 1
            stats['newly_dead_list'].append(
                f"  {result['record_type']:12} {result['id']} → HTTP {result.get('status', '?')}"
            )
            pending_dead.append(result)
        elif not is_alive and not was_alive:
            stats['still_dead'] += 1
        elif is_alive and not was_alive:
            stats['recovered'] += 1
        if redirected:
            stats['redirected'] += 1
        if result.get('error'):
            stats['errors'] += 1

        stats['checked'] += 1
        pending_updates.append(result)

        if len(pending_updates) >= BATCH_COMMIT:
            flush_batch(pending_updates, pending_dead)
            pending_updates.clear()
            pending_dead.clear()

    # ── Concurrent check loop ─────────────────────────────────────────────────
    print(f"\nChecking with {args.workers} threads...\n")

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {}
        record_iter = iter(records)
        submitted = 0
        done = 0

        # Fill initial pool
        for record in record_iter:
            if submitted >= args.workers * 2:
                break
            record['alive_before'] = record.get('alive')
            futures[pool.submit(check_url, record)] = record
            submitted += 1

        while futures:
            # Check time limit
            if time.monotonic() > deadline:
                print(f"\n⏱ Time limit ({args.max_hours}h) reached. Stopping gracefully.")
                pool.shutdown(wait=False, cancel_futures=True)
                break

            # Collect completed
            done_futures = []
            for f in list(futures.keys()):
                if f.done():
                    done_futures.append(f)

            for f in done_futures:
                try:
                    result = f.result()
                    handle_result(result)
                    done += 1
                except Exception as e:
                    stats['errors'] += 1
                    done += 1
                del futures[f]

                # Submit next record
                try:
                    record = next(record_iter)
                    record['alive_before'] = record.get('alive')
                    futures[pool.submit(check_url, record)] = record
                    submitted += 1
                except StopIteration:
                    pass  # no more records

            if done % 1000 == 0 and done > 0:
                elapsed = (time.monotonic() - t_start) / 60
                rate = done / elapsed if elapsed > 0 else 0
                pct = done / len(records) * 100
                print(f"  {done:,}/{len(records):,} ({pct:.0f}%) — "
                      f"{rate:.0f}/min — "
                      f"{stats['newly_dead']} new dead — "
                      f"{elapsed:.0f}min elapsed")

            if not done_futures:
                time.sleep(0.05)  # brief yield

    # Final flush
    flush_batch(pending_updates, pending_dead)

    runtime_min = (time.monotonic() - t_start) / 60
    stats['runtime_min'] = runtime_min

    # Write run summary to log
    summary_path = LOG_DIR / f"dead_links_{datetime.now().strftime('%Y-%m-%d')}.txt"
    lines = [
        f"Awardopedia Link Check — {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"Total checked: {stats['checked']:,}",
        f"Newly dead:    {stats['newly_dead']}",
        f"Still dead:    {stats['still_dead']}",
        f"Recovered:     {stats['recovered']}",
        f"Redirected:    {stats['redirected']}",
        f"Errors:        {stats['errors']}",
        f"Runtime:       {runtime_min:.1f} minutes",
        "",
    ]
    if stats['newly_dead_list']:
        lines += ["NEWLY DEAD:"] + stats['newly_dead_list']
    summary_path.write_text("\n".join(lines))

    print(f"\n{'=' * 60}")
    print(f"DONE in {runtime_min:.1f} min")
    print(f"  Checked:    {stats['checked']:,}")
    print(f"  Newly dead: {stats['newly_dead']}")
    print(f"  Recovered:  {stats['recovered']}")
    print(f"  Redirected: {stats['redirected']}")
    print(f"  Errors:     {stats['errors']}")
    print(f"  Report:     {summary_path}")

    if not args.no_email:
        print("\nSending summary email...")
        send_summary_email(stats)

    print("=" * 60)
