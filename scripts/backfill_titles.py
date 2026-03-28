#!/usr/bin/env python3
"""
backfill_titles.py — Fast title cleanup using Ollama.

Focuses ONLY on titles that need cleanup (leading codes, ALL CAPS, abbreviations).
Much faster than the combined time-neutral backfill.
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
CLAUDE_PROXY_URL = "http://localhost:3456/v1/chat/completions"
MODEL = "claude-sonnet-4"


def call_claude(prompt: str, max_tokens: int = 100) -> str:
    """Call Claude via OAuth proxy."""
    data = json.dumps({
        "model": MODEL,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    }).encode('utf-8')
    req = urllib.request.Request(CLAUDE_PROXY_URL, data=data, headers={
        'Content-Type': 'application/json'
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode('utf-8'))
    # Extract text from OpenAI-style response
    choices = result.get('choices', [])
    if choices:
        return choices[0].get('message', {}).get('content', '').strip()
    return ''


def clean_title(original: str) -> str:
    """Clean up messy government contract title."""
    # First try regex-based cleanup for common patterns
    cleaned = original

    # Remove leading solicitation/contract numbers like "SPE4A126G0011", "15B51726Q00000005"
    cleaned = re.sub(r'^[A-Z0-9]{8,}\s+', '', cleaned)

    # Remove leading FSC codes like "43--", "6515--", "40--"
    cleaned = re.sub(r'^\d{2,4}--?\s*', '', cleaned)

    # Remove trailing truncation artifacts
    cleaned = re.sub(r'\s+Inte$', '', cleaned)

    # Expand common abbreviations
    abbrevs = {
        'SVCS': 'Services',
        'MAINT': 'Maintenance',
        'EQUIP': 'Equipment',
        'MGMT': 'Management',
        'ADMIN': 'Administrative',
        'GOVT': 'Government',
        'NATL': 'National',
        'INTL': 'International',
        'TECH': 'Technical',
        'SYS': 'System',
        'CONSTR': 'Construction',
        'OPER': 'Operations',
        'SUPP': 'Support',
        'DEV': 'Development',
        'ENGR': 'Engineering',
        'PRGM': 'Program',
        'PROJ': 'Project',
        'RPR': 'Repair',
        'INSTL': 'Installation',
        'BLDG': 'Building',
        'FY26': 'FY2026',
        'FY25': 'FY2025',
    }
    for abbr, full in abbrevs.items():
        cleaned = re.sub(rf'\b{abbr}\b', full, cleaned, flags=re.IGNORECASE)

    # Fix ALL CAPS - convert to title case
    if cleaned == cleaned.upper() and len(cleaned) > 5:
        cleaned = cleaned.title()

    # If regex cleanup made good progress, use it
    if cleaned != original and len(cleaned) > 5:
        return cleaned.strip()

    # Fall back to Ollama for complex cases
    prompt = f"""Clean this government contract title. Make it human-readable.

Rules:
- Remove leading codes (numbers, dashes)
- Expand abbreviations (SVCS=Services, MAINT=Maintenance)
- Fix ALL CAPS to Title Case
- Keep it under 80 characters
- Just output the cleaned title, nothing else

Original: {original}

Cleaned:"""

    result = call_claude(prompt)
    # Remove quotes
    result = result.strip('"\'')
    # Take first line only
    result = result.split('\n')[0].strip()

    if len(result) < 5 or len(result) > 150:
        return cleaned  # Use regex result as fallback
    return result


def main():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Find titles needing cleanup
    cur.execute("""
        SELECT notice_id, title FROM opportunities
        WHERE response_deadline >= CURRENT_DATE
        AND (
          title ~ '^[A-Z0-9-]{2,}--' OR
          title ~ '^[A-Z0-9]{8,}\\s' OR
          title = UPPER(title) OR
          title LIKE '%SVCS%' OR
          title LIKE '%MAINT%' OR
          title LIKE '%EQUIP%'
        )
        ORDER BY response_deadline DESC
    """)
    rows = cur.fetchall()
    print(f"Found {len(rows)} titles needing cleanup")

    fixed = 0
    errors = 0

    for i, row in enumerate(rows, 1):
        notice_id = row['notice_id']
        original = row['title']

        try:
            cleaned = clean_title(original)

            if cleaned and cleaned != original:
                cur.execute(
                    "UPDATE opportunities SET title = %s WHERE notice_id = %s",
                    [cleaned, notice_id]
                )
                fixed += 1
                print(f"[{i}/{len(rows)}] {original[:40]} → {cleaned[:40]}")
            else:
                print(f"[{i}/{len(rows)}] (unchanged) {original[:50]}")

        except Exception as e:
            errors += 1
            print(f"[{i}/{len(rows)}] ERROR: {e}")

        if i % 100 == 0:
            print(f"--- Progress: {fixed} fixed, {errors} errors ---")

    print(f"\n{'='*60}")
    print(f"DONE: {fixed} titles fixed, {errors} errors")
    print(f"{'='*60}")
    conn.close()


if __name__ == '__main__':
    main()
