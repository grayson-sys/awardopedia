#!/usr/bin/env python3
"""
summarize.py — Phase 3 LLAMA summary generation (per MASTER_PROMPT spec)

Generates llama_summary for contracts and opportunities using llama3.2:3b via Ollama.
Runs locally on Mac mini Metal GPU — ~2-5 seconds per record, zero API cost.

This script is the canonical entry point for Phase 3 and Phase 4 batch summarization.
It wraps the logic in generate_llama_summaries.py for contracts and runs opportunity
summarization inline.

USAGE:
  python3 scripts/summarize.py                    # all missing summaries (contracts + opportunities)
  python3 scripts/summarize.py --contracts-only   # contracts only
  python3 scripts/summarize.py --opps-only        # opportunities only
  python3 scripts/summarize.py --piid FA877324C0001        # one contract
  python3 scripts/summarize.py --notice-id abc123          # one opportunity
  python3 scripts/summarize.py --force            # regenerate all, even existing

PERFORMANCE:
  llama3.2:3b on Apple Silicon Metal GPU: ~2-5 seconds per summary.
  100 contracts = ~7 minutes total.
  Batches of 50 with 1s pause between batches for bulk runs.
"""

import os, sys, json, time, urllib.request
from pathlib import Path

# ── Load .env ─────────────────────────────────────────────────────────────────

env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2, psycopg2.extras

DATABASE_URL = os.environ['DATABASE_URL']
OLLAMA_URL   = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'llama3.2:3b')

# ── Ollama call ───────────────────────────────────────────────────────────────

def ollama(prompt: str, system: str) -> str:
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "system": system,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 200}
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode()).get('response', '').strip()


# ── Contract summary ──────────────────────────────────────────────────────────

CONTRACT_SYSTEM = """You are a federal contracting analyst writing for small business owners.
Write a 2-3 sentence plain-English summary of this contract.
- First sentence: what the contract is and who holds it (be specific — use the contractor name)
- Second sentence: key facts (dollar amount, agency, place of work, set-aside type)
- Third sentence: one actionable insight about recompete potential or opportunity
- No bullet points, no headers, no markdown
- Do not start with "This contract" — vary your opening"""

def contract_prompt(c: dict) -> str:
    bizcat = c.get('business_categories')
    if isinstance(bizcat, list):    cats = ', '.join(bizcat[:3])
    elif isinstance(bizcat, str):
        try: cats = ', '.join(json.loads(bizcat)[:3])
        except: cats = bizcat[:60]
    else: cats = 'N/A'

    days = c.get('days_to_expiry')
    expiry = (f"expires in {days} days" if days and days > 0
              else f"expired {abs(days)} days ago" if days and days < 0
              else f"end date: {c.get('end_date','unknown')}")

    return f"""Agency: {c.get('agency_name','N/A')} / {c.get('sub_agency_name','N/A')}
Recipient: {c.get('recipient_name','N/A')}
Amount: ${float(c.get('award_amount') or 0):,.0f}
Description: {c.get('description','N/A')}
NAICS: {c.get('naics_code','N/A')} — {c.get('naics_description','N/A')}
Set-aside: {c.get('set_aside_type','None')}
Contract type: {c.get('contract_type','N/A')}
Timeline: {c.get('start_date','?')} → {c.get('end_date','?')} ({expiry})
Place of performance: {c.get('pop_city','N/A')}, {c.get('pop_state','N/A')}
Business types: {cats}"""


# ── Opportunity summary ───────────────────────────────────────────────────────

OPP_SYSTEM = """You are a federal contracting analyst writing for small business owners.
Write a 2-3 sentence plain-English summary of this contract solicitation.
- First sentence: what the agency wants and who is asking
- Second sentence: estimated value, set-aside type, and deadline urgency
- Third sentence: one actionable insight (bid window, competition level, or incumbent status)
- No bullet points, no headers, no markdown
- Do not start with "This opportunity" — vary your opening"""

def opp_prompt(o: dict) -> str:
    days = o.get('days_to_deadline')
    deadline = (f"{days} days to respond" if days and days > 0
                else f"closed {abs(days)} days ago" if days and days < 0
                else f"deadline: {o.get('response_deadline','unknown')}")

    return f"""Agency: {o.get('agency_name','N/A')}
Title: {o.get('title','N/A')}
Description: {(o.get('description') or '')[:300]}
Estimated value: ${float(o.get('estimated_value_max') or 0):,.0f}
Deadline: {o.get('response_deadline','?')} ({deadline})
NAICS: {o.get('naics_code','N/A')} — {o.get('naics_description','N/A')}
Set-aside: {o.get('set_aside_type','None')}
{"Recompete — incumbent: " + str(o.get('incumbent_name','Unknown')) if o.get('is_recompete') else "New requirement"}"""


# ── DB helpers ────────────────────────────────────────────────────────────────

def fetch_contracts(piid=None, force=False) -> list:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    if piid:
        cur.execute("SELECT *, (end_date - CURRENT_DATE) AS days_to_expiry FROM contracts WHERE piid = %s", [piid])
    elif force:
        cur.execute("SELECT *, (end_date - CURRENT_DATE) AS days_to_expiry FROM contracts ORDER BY created_at DESC")
    else:
        cur.execute("SELECT *, (end_date - CURRENT_DATE) AS days_to_expiry FROM contracts WHERE llama_summary IS NULL ORDER BY created_at DESC")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def fetch_opps(notice_id=None, force=False) -> list:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    if notice_id:
        cur.execute("SELECT *, (response_deadline - CURRENT_DATE) AS days_to_deadline FROM opportunities WHERE notice_id = %s", [notice_id])
    elif force:
        cur.execute("SELECT *, (response_deadline - CURRENT_DATE) AS days_to_deadline FROM opportunities ORDER BY created_at DESC")
    else:
        cur.execute("SELECT *, (response_deadline - CURRENT_DATE) AS days_to_deadline FROM opportunities WHERE llama_summary IS NULL ORDER BY created_at DESC")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def save_summary(table: str, id_col: str, id_val: str, summary: str):
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    conn.cursor().execute(f"UPDATE {table} SET llama_summary = %s WHERE {id_col} = %s", [summary, id_val])
    conn.close()


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--contracts-only', action='store_true')
    parser.add_argument('--opps-only',      action='store_true')
    parser.add_argument('--piid',       help='Summarize one contract by PIID')
    parser.add_argument('--notice-id',  help='Summarize one opportunity by notice ID')
    parser.add_argument('--force',      action='store_true', help='Regenerate existing summaries')
    args = parser.parse_args()

    # Check Ollama
    try:
        urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=5)
        print(f"✓ Ollama up ({OLLAMA_MODEL})")
    except Exception as e:
        print(f"✗ Ollama not reachable: {e}\n  Start with: ollama serve")
        sys.exit(1)

    total, errors = 0, 0

    # ── Contracts ─────────────────────────────────────────────────────────────
    if not args.opps_only:
        contracts = fetch_contracts(piid=args.piid, force=args.force)
        if contracts:
            print(f"\nContracts: {len(contracts)} to summarize")
        for i, c in enumerate(contracts, 1):
            piid = c['piid']
            print(f"  [{i}/{len(contracts)}] {piid} — {(c.get('recipient_name') or '')[:35]}", end=' ')
            try:
                t0 = time.time()
                summary = ollama(contract_prompt(c), CONTRACT_SYSTEM)
                save_summary('contracts', 'piid', piid, summary)
                print(f"✓ {time.time()-t0:.1f}s")
                total += 1
            except Exception as e:
                print(f"✗ {e}")
                errors += 1
            # Pause every 50 records
            if i % 50 == 0 and i < len(contracts):
                print("  [pausing 1s between batches]")
                time.sleep(1)

    # ── Opportunities ─────────────────────────────────────────────────────────
    if not args.contracts_only:
        opps = fetch_opps(notice_id=args.notice_id, force=args.force)
        if opps:
            print(f"\nOpportunities: {len(opps)} to summarize")
        for i, o in enumerate(opps, 1):
            nid = o['notice_id']
            print(f"  [{i}/{len(opps)}] {nid} — {(o.get('title') or '')[:40]}", end=' ')
            try:
                t0 = time.time()
                summary = ollama(opp_prompt(o), OPP_SYSTEM)
                save_summary('opportunities', 'notice_id', nid, summary)
                print(f"✓ {time.time()-t0:.1f}s")
                total += 1
            except Exception as e:
                print(f"✗ {e}")
                errors += 1
            if i % 50 == 0 and i < len(opps):
                time.sleep(1)

    print(f"\nDone: {total} summaries generated, {errors} errors")
