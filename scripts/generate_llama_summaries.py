#!/usr/bin/env python3
"""
generate_llama_summaries.py — Generate plain-English contract summaries via Ollama (llama3.2:3b)

Runs locally on Mac mini, Metal GPU, zero API cost.
Populates the llama_summary field used as the free teaser on every contract card.

Usage:
  python3 scripts/generate_llama_summaries.py              # all contracts missing summaries
  python3 scripts/generate_llama_summaries.py --piid FA877324C0001  # one specific record
  python3 scripts/generate_llama_summaries.py --limit 20   # batch of N

Requires: Ollama running locally (ollama serve), llama3.2:3b model downloaded
"""

import os, sys, json, urllib.request, urllib.error, time
from pathlib import Path

# Load .env
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ['DATABASE_URL']
OLLAMA_URL   = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'llama3.2:3b')

# ── Prompt ───────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a federal contracting analyst writing for small business owners.
Write a 2-3 sentence plain-English summary of this contract.
Rules:
- First sentence: what the contract is and who holds it
- Second sentence: key facts (amount, agency, location of work, set-aside type)
- Third sentence (optional): one actionable insight about recompete or opportunity
- No bullet points, no headers, no markdown
- Be specific — use the actual dollar amount, agency name, and contractor name
- Do not start with "This contract" — vary the opening"""

def build_prompt(c: dict) -> str:
    bizcat = c.get('business_categories')
    if bizcat and isinstance(bizcat, list):
        cats = ', '.join(bizcat[:4])
    elif bizcat and isinstance(bizcat, str):
        try: cats = ', '.join(json.loads(bizcat)[:4])
        except: cats = bizcat[:80]
    else:
        cats = 'N/A'

    days = c.get('days_to_expiry')
    if days is None:
        expiry_note = f"ended {c.get('end_date','unknown')}"
    elif days < 0:
        expiry_note = f"expired {abs(days)} days ago"
    elif days == 0:
        expiry_note = "expires today"
    else:
        expiry_note = f"expires in {days} days"

    return f"""CONTRACT RECORD:
Recipient: {c.get('recipient_name','N/A')}
Agency: {c.get('agency_name','N/A')} / {c.get('sub_agency_name','N/A')}
Amount: ${float(c.get('award_amount') or 0):,.0f}
Description: {c.get('description','N/A')}
NAICS: {c.get('naics_code','N/A')} — {c.get('naics_description','N/A')}
Set-aside: {c.get('set_aside_type','None')}
Contract type: {c.get('contract_type','N/A')}
Period: {c.get('start_date','?')} → {c.get('end_date','?')} ({expiry_note})
Place of performance: {c.get('pop_city','N/A')}, {c.get('pop_state','N/A')}
Recipient location: {c.get('recipient_city','N/A')}, {c.get('recipient_state','N/A')}
Business classifications: {cats}

Write the summary now:"""

# ── Ollama call ───────────────────────────────────────────────────────────────

def generate_summary(prompt: str) -> str:
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "system": SYSTEM_PROMPT,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.3,
            "num_predict": 200,
        }
    }).encode()

    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode())
    return data.get('response', '').strip()

# ── DB helpers ────────────────────────────────────────────────────────────────

def fetch_contracts(piid=None, limit=None) -> list:
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    if piid:
        cur.execute("""
            SELECT *, (end_date - CURRENT_DATE) AS days_to_expiry
            FROM contracts WHERE piid = %s
        """, [piid])
    elif limit:
        cur.execute("""
            SELECT *, (end_date - CURRENT_DATE) AS days_to_expiry
            FROM contracts WHERE llama_summary IS NULL
            ORDER BY created_at DESC LIMIT %s
        """, [limit])
    else:
        cur.execute("""
            SELECT *, (end_date - CURRENT_DATE) AS days_to_expiry
            FROM contracts WHERE llama_summary IS NULL
            ORDER BY created_at DESC
        """)

    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def save_summary(piid: str, summary: str):
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        "UPDATE contracts SET llama_summary = %s WHERE piid = %s",
        [summary, piid]
    )
    conn.close()

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--piid',  help='Generate for one specific contract')
    parser.add_argument('--limit', type=int, help='Process at most N contracts')
    parser.add_argument('--force', action='store_true', help='Overwrite existing summaries')
    args = parser.parse_args()

    # Check Ollama is up
    try:
        urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=5)
    except Exception as e:
        print(f"✗ Ollama not reachable at {OLLAMA_URL}: {e}")
        print("  Start it with: ollama serve")
        sys.exit(1)

    contracts = fetch_contracts(piid=args.piid, limit=args.limit)
    if args.force and args.piid:
        pass  # allow overwrite for single record
    elif args.force:
        # Re-fetch without the IS NULL filter
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = True
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        q = "SELECT *, (end_date - CURRENT_DATE) AS days_to_expiry FROM contracts"
        if args.limit:
            q += f" ORDER BY created_at DESC LIMIT {args.limit}"
        cur.execute(q)
        contracts = [dict(r) for r in cur.fetchall()]
        conn.close()

    if not contracts:
        print("No contracts need summaries. Use --force to regenerate existing ones.")
        sys.exit(0)

    print(f"Generating summaries for {len(contracts)} contract(s) using {OLLAMA_MODEL}...\n")

    for i, c in enumerate(contracts, 1):
        piid = c['piid']
        name = c.get('recipient_name', '?')[:35]
        print(f"[{i}/{len(contracts)}] {piid} — {name}")

        try:
            prompt = build_prompt(c)
            t0 = time.time()
            summary = generate_summary(prompt)
            elapsed = time.time() - t0

            print(f"  ✓ {elapsed:.1f}s — {summary[:100]}...")
            save_summary(piid, summary)

        except Exception as e:
            print(f"  ✗ Error: {e}")
            continue

        # Small pause between calls to be kind to the GPU
        if i < len(contracts):
            time.sleep(0.5)

    print(f"\nDone. {len(contracts)} summary/summaries written to DB.")
