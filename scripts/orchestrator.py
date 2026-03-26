#!/usr/bin/env python3
"""
orchestrator.py — Long-running pipeline orchestrator

Runs the full contract pipeline continuously until complete:
  1. Bulk fetch from USASpending (5 years, ~500K contracts)
  2. Canonicals (NAICS/PSC lookups)
  3. Recipients (dedupe, parent detection)
  4. Descriptions (Ollama cleans garbled text)
  5. Financials (Yahoo Finance + AI briefs)
  6. Summaries (Ollama writes plain English)
  7. Congress (representative lookups)
  8. Successors (chain expired contracts)
  9. Aggregates (compute stats)

FEATURES:
  - Resumable: saves state every batch, can restart anytime
  - Robust: retries failures, logs errors, continues on partial failure
  - Throttled: respects API rate limits
  - Progress: shows ETA and completion percentage

USAGE:
  python3 scripts/orchestrator.py                  # Run full pipeline
  python3 scripts/orchestrator.py --stage 1       # Run single stage
  python3 scripts/orchestrator.py --status        # Show current progress
  python3 scripts/orchestrator.py --skip-fetch    # Skip bulk fetch, process existing

ESTIMATED TIME:
  - Fetch: 8-10 hours (~500K contracts)
  - AI stages: 2-3 weeks (Ollama at ~2 sec/contract)
  - Other stages: hours

To run in background:
  nohup python3 scripts/orchestrator.py > logs/orchestrator.log 2>&1 &
"""

import os, sys, json, time, argparse, subprocess
from pathlib import Path
from datetime import datetime, timedelta

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

LOG_DIR = BASE_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)
STATE_FILE = LOG_DIR / 'orchestrator_state.json'


def db_connect():
    return psycopg2.connect(DATABASE_URL)


def log(msg: str, level: str = 'INFO'):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{ts}] [{level}] {msg}", flush=True)


def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {
        'started_at': datetime.now().isoformat(),
        'current_stage': 1,
        'stages': {},
        'paused': False,
    }


def save_state(state: dict):
    state['last_updated'] = datetime.now().isoformat()
    STATE_FILE.write_text(json.dumps(state, indent=2))


def get_counts() -> dict:
    """Get current record counts from database."""
    conn = db_connect()
    cur = conn.cursor()

    counts = {}
    cur.execute("SELECT COUNT(*) FROM contracts")
    counts['contracts'] = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM contracts WHERE llama_summary IS NOT NULL")
    counts['with_summary'] = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM contracts WHERE naics_description IS NOT NULL")
    counts['with_naics'] = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM contracts WHERE successor_checked_at IS NOT NULL")
    counts['successors_checked'] = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM contracts WHERE recipient_congress_url IS NOT NULL")
    counts['with_congress'] = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM recipients")
    counts['recipients'] = cur.fetchone()[0]

    conn.close()
    return counts


def run_command(cmd: list, timeout: int = None) -> tuple:
    """Run a command and return (success, output)."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(BASE_DIR)
        )
        return result.returncode == 0, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return False, "Command timed out"
    except Exception as e:
        return False, str(e)


def stage_1_fetch(state: dict, skip: bool = False) -> bool:
    """Stage 1: Bulk fetch from USASpending."""
    if skip:
        log("Stage 1: Skipping bulk fetch (--skip-fetch)")
        return True

    log("Stage 1: Bulk fetch from USASpending")
    success, output = run_command([
        sys.executable, 'scripts/bulk_fetch_contracts.py'
    ], timeout=None)  # No timeout - this can run for hours

    log(f"Stage 1 complete: {success}")
    return success


def stage_2_canonicals(state: dict, batch_size: int = 5000) -> bool:
    """Stage 2: NAICS/PSC canonical lookups."""
    log("Stage 2: Canonical lookups (NAICS/PSC)")
    success, output = run_command([
        sys.executable, 'scripts/pipeline_contract.py',
        '--stage', '3', '--limit', str(batch_size)
    ], timeout=600)

    log(f"Stage 2 output: {output[:500]}")
    return success


def stage_3_recipients(state: dict, batch_size: int = 5000) -> bool:
    """Stage 3: Recipients - dedupe and parent detection."""
    log("Stage 3: Recipients (dedupe, parent detection)")
    success, output = run_command([
        sys.executable, 'scripts/pipeline_contract.py',
        '--stage', '4', '--limit', str(batch_size)
    ], timeout=600)

    log(f"Stage 3 output: {output[:500]}")
    return success


def stage_4_descriptions(state: dict, batch_size: int = 100) -> bool:
    """Stage 4: Clean garbled descriptions with Ollama."""
    log("Stage 4: Clean descriptions (Ollama)")
    success, output = run_command([
        sys.executable, 'scripts/pipeline_contract.py',
        '--stage', '2', '--limit', str(batch_size)
    ], timeout=1800)  # 30 min timeout

    log(f"Stage 4 output: {output[:500]}")
    return success


def stage_5_financials(state: dict, batch_size: int = 100) -> bool:
    """Stage 5: Yahoo Finance + AI briefs."""
    log("Stage 5: Financials (Yahoo Finance + AI briefs)")
    success, output = run_command([
        sys.executable, 'scripts/pipeline_contract.py',
        '--stage', '5', '--limit', str(batch_size)
    ], timeout=1800)

    log(f"Stage 5 output: {output[:500]}")
    return success


def stage_6_summaries(state: dict, batch_size: int = 50) -> bool:
    """Stage 6: AI summaries with Ollama."""
    log("Stage 6: AI summaries (Ollama)")
    success, output = run_command([
        sys.executable, 'scripts/pipeline_contract.py',
        '--stage', '6', '--limit', str(batch_size)
    ], timeout=1800)

    log(f"Stage 6 output: {output[:500]}")
    return success


def stage_7_congress(state: dict, batch_size: int = 500) -> bool:
    """Stage 7: Congressional representative lookups."""
    log("Stage 7: Congressional lookups")
    success, output = run_command([
        sys.executable, 'scripts/pipeline_contract.py',
        '--stage', '9', '--limit', str(batch_size)
    ], timeout=600)

    log(f"Stage 7 output: {output[:500]}")
    return success


def stage_8_successors(state: dict, batch_size: int = 100) -> bool:
    """Stage 8: Successor contract detection."""
    log("Stage 8: Successor detection")
    success, output = run_command([
        sys.executable, 'scripts/pipeline_contract.py',
        '--stage', '8', '--limit', str(batch_size)
    ], timeout=600)

    log(f"Stage 8 output: {output[:500]}")
    return success


def stage_9_aggregates(state: dict) -> bool:
    """Stage 9: Compute aggregates."""
    log("Stage 9: Aggregates")
    success, output = run_command([
        sys.executable, 'scripts/pipeline_contract.py',
        '--stage', '7'
    ], timeout=300)

    log(f"Stage 9 output: {output[:500]}")
    return success


STAGES = [
    (1, 'fetch', stage_1_fetch, "Bulk fetch from USASpending"),
    (2, 'canonicals', stage_2_canonicals, "NAICS/PSC lookups"),
    (3, 'recipients', stage_3_recipients, "Recipients & parent detection"),
    (4, 'descriptions', stage_4_descriptions, "Clean descriptions (Ollama)"),
    (5, 'financials', stage_5_financials, "Yahoo Finance + AI briefs"),
    (6, 'summaries', stage_6_summaries, "AI summaries (Ollama)"),
    (7, 'congress', stage_7_congress, "Congressional lookups"),
    (8, 'successors', stage_8_successors, "Successor detection"),
    (9, 'aggregates', stage_9_aggregates, "Compute aggregates"),
]


def show_status():
    """Display current pipeline status."""
    state = load_state()
    counts = get_counts()

    print("\n" + "=" * 60)
    print("AWARDOPEDIA PIPELINE STATUS")
    print("=" * 60)
    print(f"Started: {state.get('started_at', 'Not started')}")
    print(f"Last updated: {state.get('last_updated', 'Never')}")
    print(f"Current stage: {state.get('current_stage', 1)}")
    print(f"Paused: {state.get('paused', False)}")
    print()
    print("DATABASE COUNTS:")
    print(f"  Contracts: {counts['contracts']:,}")
    print(f"  With summary: {counts['with_summary']:,} ({100*counts['with_summary']//max(1,counts['contracts'])}%)")
    print(f"  With NAICS lookup: {counts['with_naics']:,}")
    print(f"  Successors checked: {counts['successors_checked']:,}")
    print(f"  With congress URL: {counts['with_congress']:,}")
    print(f"  Recipients: {counts['recipients']:,}")
    print()
    print("STAGE STATUS:")
    for num, name, _, desc in STAGES:
        stage_state = state.get('stages', {}).get(str(num), {})
        status = stage_state.get('status', 'pending')
        print(f"  {num}. {desc}: {status}")
    print("=" * 60)


def run_pipeline(skip_fetch: bool = False, single_stage: int = None):
    """Run the full pipeline."""
    state = load_state()

    log("=" * 60)
    log("AWARDOPEDIA PIPELINE ORCHESTRATOR")
    log(f"Started: {datetime.now().isoformat()}")
    log("=" * 60)

    stages_to_run = STAGES
    if single_stage:
        stages_to_run = [s for s in STAGES if s[0] == single_stage]

    while True:
        # Check if all stages complete
        all_done = True

        for stage_num, stage_name, stage_func, stage_desc in stages_to_run:
            stage_key = str(stage_num)
            stage_state = state.get('stages', {}).setdefault(stage_key, {})

            # Skip completed stages (except AI stages which need multiple passes)
            if stage_state.get('status') == 'complete' and stage_num not in [4, 5, 6]:
                continue

            # Check if more work exists for AI stages
            counts = get_counts()
            if stage_num == 6 and counts['with_summary'] >= counts['contracts']:
                stage_state['status'] = 'complete'
                continue

            all_done = False

            log(f"\n>>> Stage {stage_num}: {stage_desc}")
            stage_state['last_run'] = datetime.now().isoformat()
            stage_state['status'] = 'running'
            save_state(state)

            try:
                if stage_num == 1:
                    success = stage_func(state, skip=skip_fetch)
                else:
                    success = stage_func(state)

                if success:
                    stage_state['runs'] = stage_state.get('runs', 0) + 1
                    # Mark non-AI stages as complete
                    if stage_num in [1, 2, 3, 9]:
                        stage_state['status'] = 'complete'
                    else:
                        stage_state['status'] = 'in_progress'
                else:
                    stage_state['status'] = 'failed'
                    stage_state['failures'] = stage_state.get('failures', 0) + 1

            except KeyboardInterrupt:
                log("Interrupted by user - saving state")
                stage_state['status'] = 'paused'
                save_state(state)
                sys.exit(0)
            except Exception as e:
                log(f"Error in stage {stage_num}: {e}", 'ERROR')
                stage_state['status'] = 'error'
                stage_state['error'] = str(e)

            save_state(state)

            # Brief pause between stages
            time.sleep(2)

        if all_done:
            log("\n>>> ALL STAGES COMPLETE!")
            break

        # Sleep between full cycles for AI stages
        log("\n--- Cycle complete, sleeping 60s before next pass ---")
        time.sleep(60)

    log("=" * 60)
    log("PIPELINE COMPLETE")
    log("=" * 60)


def main():
    parser = argparse.ArgumentParser(description='Pipeline orchestrator')
    parser.add_argument('--status', action='store_true', help='Show current status')
    parser.add_argument('--skip-fetch', action='store_true', help='Skip bulk fetch')
    parser.add_argument('--stage', type=int, help='Run single stage only')
    parser.add_argument('--reset', action='store_true', help='Reset state and start fresh')
    args = parser.parse_args()

    if args.reset and STATE_FILE.exists():
        STATE_FILE.unlink()
        log("State reset")

    if args.status:
        show_status()
        return

    run_pipeline(skip_fetch=args.skip_fetch, single_stage=args.stage)


if __name__ == '__main__':
    main()
