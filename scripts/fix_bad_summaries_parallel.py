#!/usr/bin/env python3
"""
fix_bad_summaries_parallel.py — Parallel version with 3 workers

Same as fix_bad_summaries.py but processes 3 records concurrently.
Uses thread-safe progress tracking and separate DB connections per worker.
"""
import os, sys, json, time, subprocess, urllib.request, threading
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BASE_DIR / 'scripts'))

# Load .env
for line in (BASE_DIR / '.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip())

import psycopg2
import psycopg2.extras

from pipeline_opportunity import (
    stage_6_ai_summary, _rehydrate_pdf_text, flush_to_db,
    db_connect, log, PDF_DIR
)

PROGRESS_FILE = BASE_DIR / 'logs' / 'fix_progress.json'
MAX_RETRIES = 3
RETRY_DELAYS = [5, 30, 120]
NUM_WORKERS = 3
QA_CHECK_INTERVAL = 100  # Check quality every N records
QA_SAMPLE_RATE = 0.05    # Sample 5% of records
BATCH_SIZE = 4000
REVIEW_FILE = BASE_DIR / 'logs' / 'qa_review_samples.json'  # Samples for Claude to review

# Bad patterns to detect in summaries
BAD_SUMMARY_PATTERNS = [
    "here's your summary",
    "here is your summary",
    "here's a summary",
    "act fast",
    "deadline is approaching",
    "don't miss this opportunity",
    "time is running out",
    "apply now",
    "this is a great opportunity",
    "we are pleased to",
    "i've analyzed",
    "i have analyzed",
    "based on my review",
    "as requested",
    # Business-advice / consultant voice patterns (added 2026-04-04)
    "best move now",
    "subcontracting relationship",
    "set up sam.gov alerts",
    "pursue a sub",
    "the best approach",
    "your company should",
    "consider reaching out",
    "position your",
    "estimated value of $0",
    "no deadline",
]

# Thread-safe progress tracking
progress_lock = threading.Lock()
progress_data = {'completed': [], 'failed': [], 'last_index': 0}
qa_issues = []  # Track QA issues found


def load_progress() -> dict:
    """Load progress from disk."""
    global progress_data
    if PROGRESS_FILE.exists():
        progress_data = json.loads(PROGRESS_FILE.read_text())
    else:
        progress_data = {'completed': [], 'failed': [], 'last_index': 0}
    return progress_data


def save_progress():
    """Save progress to disk (thread-safe)."""
    with progress_lock:
        PROGRESS_FILE.write_text(json.dumps(progress_data, indent=2))


def mark_completed(nid: str):
    """Mark a record as completed (thread-safe)."""
    with progress_lock:
        if nid not in progress_data['completed']:
            progress_data['completed'].append(nid)
    save_progress()


def mark_failed(nid: str):
    """Mark a record as failed (thread-safe)."""
    with progress_lock:
        if nid not in progress_data['failed']:
            progress_data['failed'].append(nid)
    save_progress()


def run_qa_check(sample_nids: list[str]) -> list[dict]:
    """
    Run quality check on a sample of recently processed records.
    Returns list of issues found.
    """
    issues = []
    conn = db_connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    for nid in sample_nids:
        cur.execute("""
            SELECT notice_id, title, llama_summary, attachments
            FROM opportunities WHERE notice_id = %s
        """, [nid])
        row = cur.fetchone()
        if not row:
            continue

        title = row.get('title') or ''
        summary = row.get('llama_summary') or ''
        attachments = row.get('attachments') or []
        pdf_count = len([a for a in attachments if a.get('file_type') == 'pdf']) if attachments else 0
        summary_lower = summary.lower()

        # Check 1: Title issues
        if title.isupper() and len(title) > 10:
            issues.append({'nid': nid, 'type': 'title_allcaps', 'value': title[:50]})
        if len(title) < 10:
            issues.append({'nid': nid, 'type': 'title_short', 'value': title})
        if any(title.upper().startswith(x) for x in ['DEPT OF', 'DEPARTMENT OF', 'AGENCY', 'OFFICE OF']):
            issues.append({'nid': nid, 'type': 'title_agency_prefix', 'value': title[:50]})

        # Check 2: Bad summary patterns
        for pattern in BAD_SUMMARY_PATTERNS:
            if pattern in summary_lower:
                issues.append({'nid': nid, 'type': 'summary_meta_phrase', 'value': f"'{pattern}' in summary"})
                break  # One issue per record is enough

        # Check 3: PDF not read (has PDFs but summary is very short)
        if pdf_count > 0 and len(summary) < 150:
            issues.append({'nid': nid, 'type': 'pdf_not_read', 'value': f"{pdf_count} PDFs but only {len(summary)} char summary"})

    conn.close()
    return issues


def print_qa_report(batch_num: int, issues: list[dict], sample_size: int):
    """Print QA report for a batch."""
    print(f"\n{'='*50}")
    print(f"QA CHECK — Batch {batch_num} (sampled {sample_size} records)")
    print(f"{'='*50}")

    if not issues:
        print("No issues found!")
    else:
        print(f"Found {len(issues)} issues:")
        for issue in issues[:10]:  # Show first 10
            print(f"  [{issue['type']}] {issue['nid'][:12]}... — {issue['value']}")
        if len(issues) > 10:
            print(f"  ... and {len(issues) - 10} more")

        # Calculate issue rate
        issue_rate = len(issues) / sample_size * 100 if sample_size > 0 else 0
        print(f"\nIssue rate: {issue_rate:.1f}%")

        if issue_rate > 20:
            print("\n** WARNING: High issue rate! Review before continuing **")

    print(f"{'='*50}\n")
    return issues


def export_samples_for_review(sample_nids: list[str], batch_num: int):
    """
    Export sample records to JSON for Claude to review.
    Every 20th record = 5 samples per 100.
    """
    conn = db_connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    samples = []
    for nid in sample_nids:
        cur.execute("""
            SELECT notice_id, title, llama_summary, attachments,
                   response_deadline, naics_code, naics_description,
                   set_aside_type, agency_name, description
            FROM opportunities WHERE notice_id = %s
        """, [nid])
        row = cur.fetchone()
        if row:
            # Count PDFs from attachments JSON
            attachments = row['attachments'] or []
            pdf_count = len([a for a in attachments if a.get('file_type') == 'pdf']) if attachments else 0
            samples.append({
                'notice_id': row['notice_id'],
                'title': row['title'],
                'summary': row['llama_summary'],
                'pdf_count': pdf_count,
                'deadline': str(row['response_deadline']) if row['response_deadline'] else None,
                'naics': f"{row['naics_code']} - {row['naics_description']}" if row['naics_code'] else None,
                'set_aside': row['set_aside_type'],
                'agency': row['agency_name'],
                'description': (row['description'] or '')[:500],
            })

    conn.close()

    # Save to file
    review_data = {
        'batch_num': batch_num,
        'timestamp': datetime.now().isoformat(),
        'sample_count': len(samples),
        'samples': samples
    }
    REVIEW_FILE.write_text(json.dumps(review_data, indent=2))
    print(f"\n** Exported {len(samples)} samples to {REVIEW_FILE} for Claude review **")
    return samples


def check_claude_proxy() -> bool:
    """Check if Claude OAuth proxy is running."""
    try:
        urllib.request.urlopen('http://localhost:3456/v1/models', timeout=5)
        return True
    except Exception:
        return False


def restart_claude_proxy() -> bool:
    """Attempt to restart the Claude OAuth proxy."""
    print("  Attempting to restart Claude proxy...")
    try:
        subprocess.run(['pkill', '-f', 'claude-max-api'], capture_output=True)
        time.sleep(2)
        subprocess.Popen(
            ['claude-max-api'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )
        for _ in range(10):
            time.sleep(3)
            if check_claude_proxy():
                print("  Claude proxy restarted successfully")
                return True
        print("  Claude proxy failed to start")
        return False
    except Exception as e:
        print(f"  Error restarting proxy: {e}")
        return False


def process_single_record(nid: str) -> tuple[str, bool, str]:
    """
    Process a single record. Returns (nid, success, message).
    Each call creates its own DB connection for thread safety.
    """
    conn = None
    try:
        conn = db_connect()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM opportunities WHERE notice_id = %s", [nid])
        row = cur.fetchone()

        if not row:
            return (nid, True, "not found, skipped")

        title = (row.get('title') or '')[:40]

        for attempt in range(MAX_RETRIES):
            try:
                rec = {
                    'notice_id': nid,
                    'fields': dict(row),
                    'resource_links': [],
                    'pdfs': [],
                    'combined_text': '',
                    'det_extract': {},
                    'ai_extract': {},
                    'ai_summary': {},
                    'enrichment': {},
                }
                rec = _rehydrate_pdf_text(rec)
                rec = stage_6_ai_summary(rec, dry_run=False)
                flush_to_db(rec, dry_run=False)
                return (nid, True, f"{title}")

            except Exception as e:
                err_str = str(e).lower()
                if any(x in err_str for x in ['connection', 'timeout', 'refused', '502', '503', '504', 'token']):
                    if attempt < MAX_RETRIES - 1:
                        delay = RETRY_DELAYS[attempt]
                        time.sleep(delay)
                        if not check_claude_proxy():
                            restart_claude_proxy()
                        continue
                return (nid, False, f"{title} - {str(e)[:50]}")

        return (nid, False, f"{title} - max retries")

    except Exception as e:
        return (nid, False, f"DB error: {str(e)[:50]}")
    finally:
        if conn:
            conn.close()


def main():
    print(f"\n{'='*60}")
    print(f"FIX BAD SUMMARIES — Parallel Mode ({NUM_WORKERS} workers)")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    # Check proxy first
    if not check_claude_proxy():
        print("Claude proxy not running, attempting to start...")
        if not restart_claude_proxy():
            print("ABORT: Could not start Claude proxy")
            sys.exit(1)

    # Load bad record IDs
    bad_file = BASE_DIR / 'data' / 'bad_records_to_fix.txt'
    nids = [l.strip() for l in bad_file.read_text().splitlines() if l.strip()]
    print(f"Total records to fix: {len(nids)}")

    # Load progress
    load_progress()
    completed_set = set(progress_data['completed'])

    # Filter out already completed
    remaining = [n for n in nids if n not in completed_set]
    print(f"Already completed: {len(completed_set)}")
    print(f"Remaining: {len(remaining)}")

    if not remaining:
        print("\nAll records already processed!")
        return

    success_count = 0
    failed_count = 0
    start = datetime.now()
    batch_processed = []  # Track successfully processed records in this batch
    batch_num = (len(completed_set) // BATCH_SIZE) + 1  # Continue batch numbering

    # Only process BATCH_SIZE records, then stop for review
    batch_remaining = remaining[:BATCH_SIZE]
    print(f"Processing batch {batch_num}: {len(batch_remaining)} records")

    # Process in parallel with 3 workers
    with ThreadPoolExecutor(max_workers=NUM_WORKERS) as executor:
        futures = {}
        for i, nid in enumerate(batch_remaining):
            future = executor.submit(process_single_record, nid)
            futures[future] = (i, nid)
            if i < NUM_WORKERS:
                time.sleep(0.5)

        for future in as_completed(futures):
            idx, nid = futures[future]
            try:
                result_nid, success, message = future.result()

                if success:
                    mark_completed(result_nid)
                    success_count += 1
                    status = "ok"
                    batch_processed.append(result_nid)
                else:
                    mark_failed(result_nid)
                    failed_count += 1
                    status = "FAIL"

                total_done = len(progress_data['completed'])
                elapsed = (datetime.now() - start).total_seconds()
                rate = success_count / elapsed * 3600 if elapsed > 0 else 0

                print(f"[{total_done}/{len(nids)}] {status}: {message} ({rate:.0f}/hr)")

            except Exception as e:
                mark_failed(nid)
                failed_count += 1
                print(f"[?/{len(nids)}] ERROR: {nid} - {e}")

    # Export every 20th record (5 samples from 100) for Claude review
    if batch_processed:
        # Take every 20th record
        review_samples = [batch_processed[i] for i in range(0, len(batch_processed), 20)]
        export_samples_for_review(review_samples, batch_num)

    all_qa_issues = []  # placeholder

    print(f"\n{'='*60}")
    print(f"RUN COMPLETE")
    print(f"This run: {success_count} fixed, {failed_count} failed")
    print(f"Total completed: {len(progress_data['completed'])}/{len(nids)}")
    elapsed = (datetime.now() - start).total_seconds()
    print(f"Time: {elapsed/60:.1f} minutes")
    print(f"Rate: {(success_count + failed_count) / elapsed * 3600:.0f} records/hr")
    print(f"\nQA Summary: {len(all_qa_issues)} issues found across {batch_num} batches")
    if all_qa_issues:
        # Group by issue type
        from collections import Counter
        type_counts = Counter(i['type'] for i in all_qa_issues)
        for itype, count in type_counts.most_common():
            print(f"  - {itype}: {count}")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
