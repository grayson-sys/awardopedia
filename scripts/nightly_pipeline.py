#!/usr/bin/env python3
"""
nightly_pipeline.py — Nightly SAM.gov fetch + full pipeline run

Designed to run at midnight via cron:
  0 0 * * * cd ~/awardopedia && python3 scripts/nightly_pipeline.py >> logs/nightly.log 2>&1

Steps:
  1. Fetch fresh opportunities from SAM.gov (up to 10 API calls = 10K records)
  2. Run full pipeline (stages 1-9) on all open opportunities needing processing
  3. Uses Haiku for AI stages (fast, accurate, $0 via OAuth proxy)

Safety:
  - Idempotent: safe to run multiple times
  - Preserves raw_sam_json for reprocessing
  - Respects SAM.gov API limits (10 calls/day)
"""

import os, sys, subprocess, json
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

LOG_DIR = BASE_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)


def log(msg: str):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{ts}] {msg}")


def run_cmd(cmd: list, desc: str) -> bool:
    """Run a command and return True if successful."""
    log(f"Starting: {desc}")
    log(f"  Command: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600*12)  # 12 hour timeout
        if result.returncode == 0:
            log(f"  ✓ {desc} completed successfully")
            return True
        else:
            log(f"  ✗ {desc} failed (exit {result.returncode})")
            if result.stderr:
                log(f"  stderr: {result.stderr[:500]}")
            return False
    except subprocess.TimeoutExpired:
        log(f"  ✗ {desc} timed out after 12 hours")
        return False
    except Exception as e:
        log(f"  ✗ {desc} error: {e}")
        return False


def check_claude_proxy() -> bool:
    """Check if Claude OAuth proxy is running."""
    import urllib.request
    try:
        urllib.request.urlopen('http://localhost:3456/v1/models', timeout=5)
        log("✓ Claude OAuth proxy is running")
        return True
    except Exception:
        log("✗ Claude OAuth proxy not running! Start with: claude-max-api")
        return False


def main():
    log("=" * 60)
    log("NIGHTLY PIPELINE — SAM.gov Fetch + Full Processing")
    log(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log("=" * 60)

    # Pre-flight checks
    if not check_claude_proxy():
        log("ABORT: Claude proxy required for AI stages")
        sys.exit(1)

    scripts_dir = BASE_DIR / 'scripts'

    # ── Step 0: Delete expired static pages from DO Spaces ──────────────────
    log("\n" + "=" * 60)
    log("STEP 0: Clean up expired static pages")
    log("=" * 60)
    cleanup_ok = run_cmd(
        ['python3', str(scripts_dir / 'cleanup_expired_pages.py')],
        "Delete expired static pages from CDN"
    )

    # ── Step 1: Fetch fresh from SAM.gov ─────────────────────────────────────
    log("\n" + "=" * 60)
    log("STEP 1: Fetch fresh opportunities from SAM.gov")
    log("=" * 60)

    # Use up to 10 API calls to get fresh/updated opportunities
    # 30-day window avoids SAM.gov 400 errors at high offsets with 12-month ranges
    from datetime import timedelta
    from_date = (datetime.now() - timedelta(days=30)).strftime('%m/%d/%Y')
    to_date = datetime.now().strftime('%m/%d/%Y')
    fetch_cmd = [
        'python3', str(scripts_dir / 'fetch_all_sam_opps.py'),
        '--fetch', '10',
        '--from-date', from_date,
        '--to-date', to_date,
    ]
    fetch_ok = run_cmd(fetch_cmd, "SAM.gov fetch")

    if not fetch_ok:
        log("WARNING: SAM.gov fetch had issues, continuing with pipeline...")

    # ── Step 2: Run full pipeline on open opportunities ──────────────────────
    log("\n" + "=" * 60)
    log("STEP 2: Run full pipeline (stages 1-9) on open opportunities")
    log("=" * 60)

    # Run pipeline on all open opportunities + records missing enrichment
    # No limit — process every new record SAM.gov gave us
    pipeline_cmd = [
        'python3', str(scripts_dir / 'pipeline_opportunity.py'),
        '--stage', '1-9',  # Stages 1-9 per-record (Stage 10 disabled until SEO template is fixed)
    ]
    pipeline_ok = run_cmd(pipeline_cmd, "Full pipeline (stages 1-9, all needed records)")

    # ── Step 3: Match Award Notices to solicitations ────────────────────────
    log("\n" + "=" * 60)
    log("STEP 3: Match Award Notices to solicitations")
    log("=" * 60)

    match_cmd = [
        'python3', str(scripts_dir / 'pipeline_opportunity.py'),
        '--stage', '11'  # Award matching (batch)
    ]
    match_ok = run_cmd(match_cmd, "Award matching (stage 11)")

    # ── Step 4: Enrich award winners ───────────────────────────────────────
    log("\n" + "=" * 60)
    log("STEP 4: Enrich award winners (YFinance + AI briefs)")
    log("=" * 60)

    enrich_cmd = [
        'python3', str(scripts_dir / 'pipeline_opportunity.py'),
        '--stage', '12'  # Winner enrichment (batch)
    ]
    enrich_ok = run_cmd(enrich_cmd, "Winner enrichment (stage 12)")

    # ── Summary ──────────────────────────────────────────────────────────────
    log("\n" + "=" * 60)
    log("NIGHTLY PIPELINE COMPLETE")
    log(f"Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log(f"Fetch: {'✓' if fetch_ok else '✗'}")
    log(f"Pipeline: {'✓' if pipeline_ok else '✗'}")
    log(f"Awards: {'✓' if match_ok else '✗'}")
    log(f"Winners: {'✓' if enrich_ok else '✗'}")
    log("=" * 60)

    sys.exit(0 if (fetch_ok and pipeline_ok and match_ok) else 1)


if __name__ == '__main__':
    main()
