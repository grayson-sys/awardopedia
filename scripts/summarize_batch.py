#!/usr/bin/env python3
"""
summarize_batch.py — Phase 4 Script 4: Batch Ollama summary generation

Generates llama_summary for all contracts and opportunities where it's NULL.
Processes in batches of 50 with 1s pause between batches.
Designed to run after ingest — safe to run repeatedly.

USAGE:
  python3 scripts/summarize_batch.py              # all missing summaries
  python3 scripts/summarize_batch.py --limit 50   # test batch
  python3 scripts/summarize_batch.py --batch-size 25  # smaller batches

CRON (Mac Mini, daily 3am — runs after ingest at 1am and sync at 2am):
  0 3 * * * cd ~/awardopedia && python3 scripts/summarize_batch.py >> logs/summarize.log 2>&1
"""

import os, sys
from pathlib import Path
from datetime import datetime

# ── Load .env ─────────────────────────────────────────────────────────────────
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

sys.path.insert(0, str(Path(__file__).parent))
from summarize import (
    ollama, contract_prompt, opp_prompt,
    CONTRACT_SYSTEM, OPP_SYSTEM,
    fetch_contracts, fetch_opps,
    save_summary, OLLAMA_URL, OLLAMA_MODEL
)
import urllib.request, time, psycopg2

DATABASE_URL = os.environ['DATABASE_URL']

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit',      type=int, help='Max total records to process')
    parser.add_argument('--batch-size', type=int, default=50, help='Records per batch (default 50)')
    parser.add_argument('--contracts-only', action='store_true')
    parser.add_argument('--opps-only',      action='store_true')
    args = parser.parse_args()

    print("=" * 60)
    print("AWARDOPEDIA — BATCH SUMMARIZER (Ollama)")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # Check Ollama
    try:
        urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=5)
        print(f"✓ Ollama up ({OLLAMA_MODEL})")
    except Exception as e:
        print(f"✗ Ollama not reachable: {e}")
        print("  Start with: ollama serve")
        sys.exit(1)

    contracts = [] if args.opps_only  else fetch_contracts()
    opps      = [] if args.contracts_only else fetch_opps()

    total_needed = len(contracts) + len(opps)
    print(f"\nNeeds summaries: {len(contracts)} contracts, {len(opps)} opportunities ({total_needed} total)")

    if total_needed == 0:
        print("Nothing to do — all records have summaries.")
        sys.exit(0)

    # Apply overall limit
    if args.limit:
        # Allocate limit proportionally
        c_limit = min(len(contracts), args.limit)
        o_limit = min(len(opps), args.limit - c_limit)
        contracts = contracts[:c_limit]
        opps      = opps[:o_limit]
        print(f"Limit applied: {len(contracts)} contracts, {len(opps)} opportunities")

    total, errors = 0, 0
    batch_size = args.batch_size

    # ── Contracts ─────────────────────────────────────────────────────────────
    if contracts:
        print(f"\nProcessing {len(contracts)} contracts in batches of {batch_size}...")
        for batch_start in range(0, len(contracts), batch_size):
            batch = contracts[batch_start:batch_start + batch_size]
            batch_num = batch_start // batch_size + 1
            print(f"\n  Batch {batch_num} ({len(batch)} records):")

            for c in batch:
                piid = c['piid']
                print(f"    {piid} — {(c.get('recipient_name') or '')[:30]}", end=' ')
                try:
                    t0 = time.time()
                    summary = ollama(contract_prompt(c), CONTRACT_SYSTEM)
                    save_summary('contracts', 'piid', piid, summary)
                    print(f"✓ {time.time()-t0:.1f}s")
                    total += 1
                except Exception as e:
                    print(f"✗ {e}")
                    errors += 1

            # 1s pause between batches
            if batch_start + batch_size < len(contracts):
                print("  [pause 1s between batches]")
                time.sleep(1)

    # ── Opportunities ─────────────────────────────────────────────────────────
    if opps:
        print(f"\nProcessing {len(opps)} opportunities in batches of {batch_size}...")
        for batch_start in range(0, len(opps), batch_size):
            batch = opps[batch_start:batch_start + batch_size]
            batch_num = batch_start // batch_size + 1
            print(f"\n  Batch {batch_num} ({len(batch)} records):")

            for o in batch:
                nid = o['notice_id']
                print(f"    {nid} — {(o.get('title') or '')[:35]}", end=' ')
                try:
                    t0 = time.time()
                    summary = ollama(opp_prompt(o), OPP_SYSTEM)
                    save_summary('opportunities', 'notice_id', nid, summary)
                    print(f"✓ {time.time()-t0:.1f}s")
                    total += 1
                except Exception as e:
                    print(f"✗ {e}")
                    errors += 1

            if batch_start + batch_size < len(opps):
                time.sleep(1)

    print(f"\n{'=' * 60}")
    print(f"DONE: {total} summaries generated, {errors} errors")
    print(f"Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
