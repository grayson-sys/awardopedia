#!/usr/bin/env python3
"""
clean_titles.py — Clean messy SAM.gov opportunity titles using Claude Sonnet

Takes raw SAM.gov titles like "48--VALVE,GATE" or "MAINT SVCS FOR HVAC EQUIPMENT"
and produces readable titles like "Gate Valve" or "HVAC Equipment Maintenance Services"

USAGE:
  python3 scripts/clean_titles.py --check           # Count titles needing cleaning
  python3 scripts/clean_titles.py --limit 100       # Clean 100 titles
  python3 scripts/clean_titles.py --all             # Clean all messy titles
  python3 scripts/clean_titles.py --dry-run         # Show what would happen
"""

import os, sys, json, re, time, argparse, urllib.request, urllib.error
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

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get('DATABASE_URL', '')
CLAUDE_PROXY_URL = os.environ.get('CLAUDE_PROXY_URL', 'http://localhost:3456')

LOG_DIR = BASE_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / 'clean_titles.log'


def log(msg: str, level: str = 'INFO'):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] [{level}] {msg}"
    print(line)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')


def db_connect():
    return psycopg2.connect(DATABASE_URL)


def is_messy_title(title: str) -> bool:
    """Detect if a title needs cleaning."""
    if not title:
        return False

    # Patterns that indicate messy titles
    patterns = [
        r'^[0-9A-Z]{1,3}--',              # Leading codes like "48--", "Z--", "H930--"
        r'^[A-Z]+,',                       # Starts with ALL CAPS word + comma: "PIPE,METALLIC"
        r'^[A-Z\s]{10,}$',                 # All caps, 10+ chars
        r'\b[A-Z]{2,},[A-Z]{2,}\b',        # WORD,WORD pattern
        r'^\d+\s*-\s*[A-Z]',               # "123 - SOMETHING"
        r'--',                              # Double dashes
        r'\bFY\d{2}\b',                     # FY26, FY25 etc
        r'\([Bb]ase\s*\+\s*\d\)',           # (Base + 4) contract jargon
        r'\b[A-Z]{2,}/[A-Z]{2,}\b',         # CATH/EP slash abbreviations
        r'\b(SVCS?|MAINT|EQUIP|CONSTR|MODS?|MGMT|OPER|ADMIN|GOVT|DEPT|NATL|INTL)\b',  # Common abbrevs
        r'\b(IDIQ|BPA|BOA|GSA|RFP|RFQ|RFI|SOW|PWS|CLINs?)\b',  # Contract terms
        r'\b[A-Z]{4,}\b',                   # Any 4+ letter acronym (NASA ok, NYHHS needs cleaning)
        r'^\d{3,}-',                        # Starts with 3+ digit code
        r'\bNSN\b|\bFSC\b|\bNIIN\b',        # Supply codes
    ]

    for pattern in patterns:
        if re.search(pattern, title):
            return True

    # Also flag if mostly uppercase and has weird punctuation
    upper_ratio = sum(1 for c in title if c.isupper()) / max(len(title), 1)
    if upper_ratio > 0.5 and len(title) > 20:  # Lowered threshold
        return True

    return False


def call_claude_sonnet(titles_batch: list) -> dict:
    """
    Call Claude Sonnet via OAuth proxy to clean a batch of titles.
    Returns dict mapping original title -> clean title.
    """
    # Build prompt with numbered titles
    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(titles_batch))

    prompt = f"""You are cleaning up federal government contracting opportunity titles.

These titles come from SAM.gov and are often messy: ALL CAPS, cryptic codes, strange punctuation, abbreviations.

Your job: Convert each title to a clear, readable format:
- Fix ALL CAPS → Title Case
- Expand abbreviations: SVCS→Services, MAINT→Maintenance, EQUIP→Equipment, CONSTR→Construction, MOD→Modification, ASS→Assembly, GOVT→Government
- Strip leading codes like "48--", "Z--", "H930--"
- Fix "WORD,WORD" patterns → "Word Word"
- Keep it concise but readable
- If the title is already good, return it unchanged

Input titles (numbered):
{numbered}

Return ONLY a JSON object mapping each number to the cleaned title:
{{
  "1": "cleaned title 1",
  "2": "cleaned title 2",
  ...
}}

No explanation, just the JSON."""

    # Use OAuth proxy at localhost:3456 (never direct Anthropic API)
    url = f"{CLAUDE_PROXY_URL}/v1/chat/completions"
    payload = json.dumps({
        "model": "claude-sonnet-4",
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": prompt}]
    }).encode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={'Content-Type': 'application/json'}
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            resp = json.loads(r.read())
    except urllib.error.URLError as e:
        raise RuntimeError(
            f"Claude proxy not reachable at {CLAUDE_PROXY_URL}. "
            f"Start with: claude-max-api\nError: {e}"
        )

    raw = resp['choices'][0]['message']['content'].strip()

    # Strip markdown code fences if present
    raw = re.sub(r'^```json\s*', '', raw)
    raw = re.sub(r'^```\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)

    # Parse JSON
    result = json.loads(raw)

    # Map back to original titles
    cleaned = {}
    for i, original in enumerate(titles_batch):
        key = str(i + 1)
        if key in result:
            cleaned[original] = result[key]

    # Proxy returns OpenAI-style usage
    usage = resp.get('usage', {})
    tokens_in = usage.get('prompt_tokens', 0)
    tokens_out = usage.get('completion_tokens', 0)

    return cleaned, tokens_in, tokens_out


def main():
    parser = argparse.ArgumentParser(description='Clean messy SAM.gov opportunity titles')
    parser.add_argument('--check', action='store_true', help='Count titles needing cleaning')
    parser.add_argument('--limit', type=int, help='Max titles to clean')
    parser.add_argument('--all', action='store_true', help='Clean all messy titles')
    parser.add_argument('--dry-run', action='store_true', help='Show plan without writing')
    parser.add_argument('--batch-size', type=int, default=25, help='Titles per API call (default 25)')
    args = parser.parse_args()

    conn = db_connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Get all titles
    cur.execute("SELECT notice_id, title FROM opportunities WHERE title IS NOT NULL")
    all_opps = cur.fetchall()

    # Filter to messy titles
    messy = [(r['notice_id'], r['title']) for r in all_opps if is_messy_title(r['title'])]

    log(f"Total opportunities: {len(all_opps):,}")
    log(f"Messy titles needing cleaning: {len(messy):,}")

    if args.check:
        # Show sample
        log("\nSample messy titles:")
        for nid, title in messy[:10]:
            log(f"  {title[:60]}...")
        return

    if not args.limit and not args.all:
        parser.print_help()
        return

    # Determine how many to process
    to_process = messy[:args.limit] if args.limit else messy

    log(f"\nWill clean {len(to_process):,} titles")
    log(f"Batch size: {args.batch_size}")
    log(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    log("=" * 50)

    total_cleaned = 0
    total_tokens_in = 0
    total_tokens_out = 0

    # Process in batches
    for i in range(0, len(to_process), args.batch_size):
        batch = to_process[i:i + args.batch_size]
        titles = [t[1] for t in batch]
        notice_ids = {t[1]: t[0] for t in batch}  # title -> notice_id

        log(f"\nBatch {i // args.batch_size + 1}: {len(titles)} titles")

        if args.dry_run:
            for title in titles[:3]:
                log(f"  [DRY] Would clean: {title[:50]}...")
            continue

        try:
            cleaned, tok_in, tok_out = call_claude_sonnet(titles)
            total_tokens_in += tok_in
            total_tokens_out += tok_out

            # Update database
            write_cur = conn.cursor()
            for original, clean in cleaned.items():
                if clean and clean != original:
                    notice_id = notice_ids.get(original)
                    if notice_id:
                        write_cur.execute(
                            "UPDATE opportunities SET title = %s WHERE notice_id = %s",
                            [clean, notice_id]
                        )
                        total_cleaned += 1
                        log(f"  {original[:30]}... → {clean[:30]}...")

            conn.commit()
            log(f"  Cleaned {len(cleaned)} titles ({tok_in + tok_out:,} tokens)")

            # Rate limit - be nice
            if i + args.batch_size < len(to_process):
                time.sleep(0.5)

        except Exception as e:
            log(f"  ERROR: {e}", 'ERROR')
            conn.rollback()
            continue

    conn.close()

    log("\n" + "=" * 50)
    log(f"COMPLETE: {total_cleaned:,} titles cleaned")
    log(f"Total tokens: {total_tokens_in + total_tokens_out:,} ({total_tokens_in:,} in, {total_tokens_out:,} out)")
    log("=" * 50)


if __name__ == '__main__':
    main()
