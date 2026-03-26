#!/usr/bin/env python3
"""
fetch_opportunities_batch.py — Scheduled batch fetcher for SAM.gov opportunities

Fetches 1000 opportunities per run, processes through pipeline, runs QA.
Designed to be called by launchd every 2 hours.

Tracks progress in logs/batch_progress.json:
  - current_offset: where to start next fetch
  - batches_done: count of completed batches
  - target_batches: stop after this many (default 10)
  - started_at: timestamp of first batch

USAGE:
  python3 scripts/fetch_opportunities_batch.py              # run one batch
  python3 scripts/fetch_opportunities_batch.py --reset      # reset progress, start over
  python3 scripts/fetch_opportunities_batch.py --dry-run    # show what would happen
  python3 scripts/fetch_opportunities_batch.py --status     # show current progress
"""

import os, sys, json, time, urllib.request, urllib.error
from pathlib import Path
from datetime import datetime

# ── Load .env ─────────────────────────────────────────────────────────────────
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

# ── Configuration ─────────────────────────────────────────────────────────────
SAM_API_KEY = os.environ.get('SAM_API_KEY', '')
BATCH_SIZE = 1000
TARGET_BATCHES = 10
PROGRESS_FILE = Path(__file__).parent.parent / 'logs' / 'batch_progress.json'

SAM_OPPS_URL = "https://api.sam.gov/opportunities/v2/search"

def load_progress():
    """Load progress from JSON file."""
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text())
    return {
        'current_offset': 2000,  # Start after existing batches 1 & 2
        'batches_done': 0,
        'target_batches': TARGET_BATCHES,
        'started_at': None,
        'last_run': None,
        'total_records': 0,
    }

def save_progress(progress):
    """Save progress to JSON file."""
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2))

def fetch_sam_opportunities(offset: int, limit: int = 1000) -> dict:
    """Fetch opportunities from SAM.gov API."""
    from datetime import timedelta
    import urllib.parse

    if not SAM_API_KEY:
        raise RuntimeError("SAM_API_KEY not set in .env")

    # SAM.gov requires MM/DD/YYYY format and date range within same year
    # Use Jan 1 of current year to today
    posted_from = datetime.today().replace(month=1, day=1).strftime("%m/%d/%Y")
    posted_to = datetime.today().strftime("%m/%d/%Y")

    params = urllib.parse.urlencode({
        'api_key': SAM_API_KEY,
        'postedFrom': posted_from,
        'postedTo': posted_to,
        'limit': str(limit),
        'offset': str(offset),
        'ptype': 'o',  # solicitations only
    })

    url = f"{SAM_OPPS_URL}?{params}"

    print(f"Fetching SAM.gov opportunities (offset={offset}, limit={limit})...")
    print(f"  Date range: {posted_from} to {posted_to}")
    req = urllib.request.Request(url, headers={'User-Agent': 'Awardopedia/1.0'})

    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read())

    return data

def run_pipeline(data_file: str, dry_run: bool = False):
    """Run the opportunity pipeline on fetched data."""
    import subprocess

    cmd = [
        sys.executable,
        'scripts/pipeline_opportunity.py',
        '--from-file', data_file,
        '--stage', '1-7',  # Ingest through enrichment
    ]
    if dry_run:
        cmd.append('--dry-run')

    print(f"Running pipeline: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=Path(__file__).parent.parent)
    return result.returncode == 0

def run_qa(sample_size: int = 20, dry_run: bool = False):
    """Run QA check on the data."""
    import subprocess

    cmd = [
        sys.executable,
        'scripts/qa_data_quality.py',
        '--sample', str(sample_size),
    ]
    if dry_run:
        cmd.append('--dry-run')

    print(f"Running QA: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=Path(__file__).parent.parent)
    return result.returncode == 0

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Fetch SAM.gov opportunities in batches')
    parser.add_argument('--reset', action='store_true', help='Reset progress and start over')
    parser.add_argument('--dry-run', action='store_true', help='Show what would happen')
    parser.add_argument('--status', action='store_true', help='Show current progress')
    parser.add_argument('--skip-qa', action='store_true', help='Skip QA check')
    parser.add_argument('--all', action='store_true', help='Run all remaining batches (use all 10 daily API calls)')
    parser.add_argument('--fetch-only', action='store_true', help='Just fetch and save records, skip pipeline processing')
    args = parser.parse_args()

    progress = load_progress()

    if args.status:
        print(f"Batch progress:")
        print(f"  Batches done:    {progress['batches_done']} / {progress['target_batches']}")
        print(f"  Current offset:  {progress['current_offset']}")
        print(f"  Total records:   {progress['total_records']}")
        print(f"  Started:         {progress['started_at'] or 'Not started'}")
        print(f"  Last run:        {progress['last_run'] or 'Never'}")
        return

    if args.reset:
        progress = {
            'current_offset': 2000,
            'batches_done': 0,
            'target_batches': TARGET_BATCHES,
            'started_at': None,
            'last_run': None,
            'total_records': 0,
        }
        save_progress(progress)
        print("Progress reset.")
        return

    # Determine how many batches to run
    batches_to_run = 1
    if args.all:
        batches_to_run = progress['target_batches'] - progress['batches_done']
        if batches_to_run <= 0:
            print(f"All {progress['target_batches']} batches complete! Total: {progress['total_records']} records.")
            print("Run with --reset to start a new batch run.")
            return
        print(f"\n{'='*60}")
        print(f"RUNNING ALL {batches_to_run} REMAINING BATCHES")
        print(f"{'='*60}\n")

    for batch_i in range(batches_to_run):
        # Reload progress each iteration
        progress = load_progress()

        # Check if we're done
        if progress['batches_done'] >= progress['target_batches']:
            print(f"\nAll {progress['target_batches']} batches complete! Total: {progress['total_records']} records.")
            return

        # Mark start time on first batch
        if not progress['started_at']:
            progress['started_at'] = datetime.now().isoformat()

        batch_num = progress['batches_done'] + 1
        offset = progress['current_offset']

        print(f"\n{'='*60}")
        print(f"BATCH {batch_num} of {progress['target_batches']}")
        print(f"{'='*60}")
        print(f"Offset: {offset}")
        print(f"Time:   {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*60}\n")

        if args.dry_run:
            print("[DRY RUN] Would fetch SAM.gov opportunities")
            print(f"[DRY RUN] Would save to data/sam_opps_batch{batch_num + 2}.json")
            print("[DRY RUN] Would run pipeline stages 1-7")
            print("[DRY RUN] Would run QA")
            continue

        # ── Step 1: Fetch from SAM.gov ────────────────────────────────────────
        try:
            data = fetch_sam_opportunities(offset, BATCH_SIZE)
        except Exception as e:
            print(f"ERROR fetching from SAM.gov: {e}")
            if 'throttled' in str(e).lower() or '429' in str(e):
                print("Rate limit hit. Stopping.")
                return
            sys.exit(1)

        records = data.get('opportunitiesData', [])
        total_available = data.get('totalRecords', 0)

        print(f"Fetched {len(records)} records (total available: {total_available})")

        if not records:
            print("No more records to fetch.")
            progress['batches_done'] = progress['target_batches']  # Mark as done
            save_progress(progress)
            return

        # ── Step 2: Save to file ──────────────────────────────────────────────
        data_dir = Path(__file__).parent.parent / 'data'
        data_dir.mkdir(exist_ok=True)
        batch_file = data_dir / f"sam_opps_batch{batch_num + 2}.json"  # +2 because batches 1&2 exist
        batch_file.write_text(json.dumps(data, indent=2))
        print(f"Saved to {batch_file}")

        # ── Step 3: Run pipeline ──────────────────────────────────────────────
        if args.fetch_only:
            print("Skipping pipeline (--fetch-only mode)")
        elif not run_pipeline(str(batch_file)):
            print("WARNING: Pipeline had errors")

        # ── Step 4: Run QA (only on last batch to save time) ─────────────────
        if not args.fetch_only and not args.skip_qa and (batch_i == batches_to_run - 1 or not args.all):
            run_qa(sample_size=20)

        # ── Step 5: Update progress ───────────────────────────────────────────
        progress['batches_done'] += 1
        progress['current_offset'] += BATCH_SIZE
        progress['total_records'] += len(records)
        progress['last_run'] = datetime.now().isoformat()
        save_progress(progress)

        print(f"\n{'='*60}")
        print(f"BATCH {batch_num} COMPLETE")
        print(f"{'='*60}")
        print(f"Records this batch: {len(records)}")
        print(f"Total so far:       {progress['total_records']}")
        print(f"Batches remaining:  {progress['target_batches'] - progress['batches_done']}")
        print(f"{'='*60}\n")

if __name__ == '__main__':
    main()
