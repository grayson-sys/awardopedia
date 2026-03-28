#!/usr/bin/env python3
"""
backfill_time_neutral.py — Fix time-relative language in AI summaries using Ollama.

Also cleans up messy titles in the same pass.

Usage:
  python3 scripts/backfill_time_neutral.py [--limit N] [--dry-run]
"""

import os, sys, json, re, urllib.request
from pathlib import Path

# Load .env
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
OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "llama3.2:3b"

# Words that indicate time-relative language
TIME_WORDS = [
    'tomorrow', 'next week', 'immediately', 'soon', 'urgent', 'quickly',
    'running out', 'move fast', 'act now', 'days left', 'time is',
    'hurry', 'act quickly', 'don\'t wait', 'asap', 'right away'
]


def has_time_relative(text: str) -> bool:
    """Check if text contains time-relative language."""
    if not text:
        return False
    lower = text.lower()
    return any(word in lower for word in TIME_WORDS)


def needs_title_cleanup(title: str) -> bool:
    """Check if title needs cleanup."""
    if not title:
        return False
    # Leading codes like "43--" or "6515--"
    if re.match(r'^[A-Z0-9-]{2,}--', title):
        return True
    # ALL CAPS
    if title == title.upper() and len(title) > 10:
        return True
    # Common abbreviations
    if any(abbr in title for abbr in ['SVCS', 'MAINT', 'ASS ', 'EQUIP']):
        return True
    return False


def call_ollama(prompt: str, max_tokens: int = 400) -> str:
    """Call Ollama API."""
    data = json.dumps({
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"num_predict": max_tokens, "temperature": 0.3}
    }).encode('utf-8')
    req = urllib.request.Request(OLLAMA_URL, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read().decode('utf-8'))
    return result.get("response", "").strip()


def fix_summary(original: str, title: str, deadline: str) -> str:
    """Fix time-relative phrases in summary - minimal changes only."""
    prompt = f"""Edit this text to be time-neutral. These summaries will be read years from now.

Make MINIMAL changes. Keep the same prose style. Only fix these issues:
- Replace "tomorrow" with "{deadline}"
- Remove "immediately", "move quickly", "act now", "hurry" - just delete these words
- Remove urgency phrases like "time is running out", "don't wait"
- If a sentence no longer makes sense after removing a word, smooth it out minimally

Example:
Before: "The deadline is tomorrow so move quickly to submit"
After: "The deadline is {deadline}"

Before: "Bidders should act immediately to secure a spot"
After: "Bidders should apply to secure a spot"

Now fix this text:
{original}

Fixed:"""

    result = call_ollama(prompt)
    # Remove common preamble phrases
    for prefix in ["Here's the revised text:", "Here is the revised text:", "Fixed:", "Here's the fixed text:"]:
        if result.startswith(prefix):
            result = result[len(prefix):].strip()
    return result


def clean_title(original: str) -> str:
    """Clean up messy title."""
    prompt = f"""Clean up this government contract title to be human-readable.

RULES:
- Remove leading codes like "43--", "6515--", "SPE4A126G0011"
- Expand abbreviations: SVCS→Services, MAINT→Maintenance, EQUIP→Equipment
- Fix ALL CAPS to Title Case
- Keep it concise (under 80 chars)
- If it's already readable, return it unchanged

Original: {original}

Cleaned title:"""

    result = call_ollama(prompt, max_tokens=100)
    # Remove quotes if present
    result = result.strip('"\'')
    # Don't accept empty or very short results
    if len(result) < 5:
        return original
    return result


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=0, help='Limit number of records')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be done')
    args = parser.parse_args()

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Find records needing fixes
    cur.execute("""
        SELECT notice_id, title, llama_summary, response_deadline
        FROM opportunities
        WHERE llama_summary IS NOT NULL
        ORDER BY response_deadline DESC
    """)
    rows = cur.fetchall()

    to_fix = []
    for row in rows:
        needs_summary = has_time_relative(row['llama_summary'])
        needs_title = needs_title_cleanup(row['title'])
        if needs_summary or needs_title:
            to_fix.append({
                **row,
                'fix_summary': needs_summary,
                'fix_title': needs_title
            })

    if args.limit:
        to_fix = to_fix[:args.limit]

    print(f"Found {len(to_fix)} records needing fixes")
    if args.dry_run:
        print("[DRY RUN] Would fix:")
        for r in to_fix[:10]:
            print(f"  {r['notice_id'][:16]} - summary:{r['fix_summary']} title:{r['fix_title']}")
        return

    fixed_summaries = 0
    fixed_titles = 0
    errors = 0

    for i, row in enumerate(to_fix, 1):
        notice_id = row['notice_id']
        print(f"[{i}/{len(to_fix)}] {notice_id[:16]}", end=" ")

        try:
            # Fix summary if needed
            if row['fix_summary']:
                new_summary = fix_summary(
                    row['llama_summary'],
                    row['title'],
                    str(row['response_deadline'])
                )
                if new_summary and len(new_summary) > 50:
                    cur.execute(
                        "UPDATE opportunities SET llama_summary = %s WHERE notice_id = %s",
                        [new_summary, notice_id]
                    )
                    fixed_summaries += 1
                    print("S", end="")

            # Fix title if needed
            if row['fix_title']:
                new_title = clean_title(row['title'])
                if new_title and new_title != row['title']:
                    cur.execute(
                        "UPDATE opportunities SET title = %s WHERE notice_id = %s",
                        [new_title, notice_id]
                    )
                    fixed_titles += 1
                    print("T", end="")

            print(" OK")

        except Exception as e:
            errors += 1
            print(f" ERROR: {e}")

        if i % 100 == 0:
            print(f"--- Progress: {fixed_summaries} summaries, {fixed_titles} titles, {errors} errors ---")

    print(f"\n{'='*60}")
    print(f"DONE: {fixed_summaries} summaries, {fixed_titles} titles fixed, {errors} errors")
    print(f"{'='*60}")
    conn.close()


if __name__ == '__main__':
    main()
