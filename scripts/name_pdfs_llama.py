#!/usr/bin/env python3
"""
name_pdfs_llama.py — Use local LLaMA (via Ollama) to give PDFs logical names

Takes the first page of each PDF, asks LLaMA what it is, and generates a
descriptive filename like "Statement_of_Work.pdf" instead of "doc_1.pdf".

USAGE:
  python3 scripts/name_pdfs_llama.py           # Process all unnamed PDFs
  python3 scripts/name_pdfs_llama.py --check   # Show what would be renamed
  python3 scripts/name_pdfs_llama.py --limit 10  # Process only 10 PDFs
"""

import os, sys, json, argparse, subprocess, urllib.request
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

DATABASE_URL = os.environ.get('DATABASE_URL', '')
OLLAMA_URL = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', 'llama3.2:3b')  # Small, fast model

PDF_DIR = BASE_DIR / 'data' / 'pdfs'


def extract_first_page_text(pdf_path: str, max_chars: int = 2000) -> str:
    """Extract text from first page of PDF using pdftotext."""
    try:
        result = subprocess.run(
            ['pdftotext', '-f', '1', '-l', '1', pdf_path, '-'],
            capture_output=True, text=True, timeout=30
        )
        text = result.stdout.strip()[:max_chars]
        return text
    except Exception:
        return ''


def call_ollama(prompt: str) -> str:
    """Call local Ollama LLaMA model."""
    try:
        payload = json.dumps({
            "model": OLLAMA_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 100}
        }).encode()

        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
            return data.get('response', '').strip()
    except Exception as e:
        return f"ERROR: {e}"


def generate_filename(text: str) -> str:
    """Ask LLaMA to generate a logical filename for this document."""
    if not text or len(text) < 50:
        return None

    # Quick keyword detection for common document types
    text_upper = text[:2000].upper()

    # Check for obvious document types FIRST before asking LLaMA
    if 'STATEMENT OF WORK' in text_upper or 'SOW' in text_upper[:500]:
        return 'Statement_of_Work'
    if 'PERFORMANCE WORK STATEMENT' in text_upper or 'PWS' in text_upper[:500]:
        return 'Performance_Work_Statement'
    if 'SF 1449' in text_upper or 'SF-1449' in text_upper or 'STANDARD FORM 1449' in text_upper:
        return 'Solicitation'
    if 'SF 33' in text_upper or 'SF-33' in text_upper or 'STANDARD FORM 33' in text_upper:
        return 'Solicitation'
    if 'SF 30' in text_upper or 'SF-30' in text_upper or 'AMENDMENT OF SOLICITATION' in text_upper:
        # Try to extract amendment number
        import re
        match = re.search(r'AMENDMENT\s*(?:NO\.?|NUMBER)?\s*[:#]?\s*(\d+)', text_upper)
        if match:
            return f'Amendment_{int(match.group(1)):04d}'
        return 'Amendment'
    if 'WAGE DETERMINATION' in text_upper or 'WD NO' in text_upper or 'REGISTER OF WAGE' in text_upper:
        return 'Wage_Determination'
    if 'EVALUATION CRITERIA' in text_upper or 'EVALUATION FACTORS' in text_upper:
        return 'Evaluation_Criteria'
    if 'PAST PERFORMANCE' in text_upper and 'QUESTIONNAIRE' in text_upper:
        return 'Past_Performance_Questionnaire'
    if 'PRICE SCHEDULE' in text_upper or 'PRICING SCHEDULE' in text_upper or 'CONTRACT LINE ITEM' in text_upper:
        return 'Price_Schedule'
    if 'TECHNICAL SPECIFICATION' in text_upper or 'TECHNICAL REQUIREMENTS' in text_upper:
        return 'Technical_Specifications'

    # Fall back to LLaMA for less obvious documents
    prompt = f"""You are a federal contracting document classifier. Based on this document, provide a short descriptive filename (2-4 words, underscore-separated).

Common types: Solicitation, Statement_of_Work, Wage_Determination, Evaluation_Criteria, Price_Schedule, Contract_Clauses, Amendment_0001, Attachment_A

Document excerpt:
{text[:1200]}

Reply with ONLY the filename (no .pdf, no explanation):"""

    response = call_ollama(prompt)

    # Clean up the response
    filename = response.strip()
    # Remove any quotes, explanation, or extension
    filename = filename.replace('"', '').replace("'", "").split('\n')[0]
    filename = filename.replace('.pdf', '').replace('.PDF', '')
    # Only keep valid filename characters
    filename = ''.join(c for c in filename if c.isalnum() or c in '_- ')
    filename = filename.replace(' ', '_').replace('-', '_')
    filename = '_'.join(part for part in filename.split('_') if part)  # Remove empty parts

    # Limit length
    if len(filename) > 50:
        filename = filename[:50]

    return filename if filename and len(filename) > 2 else None


def process_unnamed_pdfs(check_only: bool = False, limit: int = None):
    """Find PDFs with generic names and rename them using LLaMA."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Find opportunities with attachments that have generic names
    cur.execute("""
        SELECT notice_id, attachments
        FROM opportunities
        WHERE attachments IS NOT NULL
        AND attachments::text LIKE '%doc_%'
    """)
    rows = cur.fetchall()

    processed = 0
    renamed = 0

    for notice_id, attachments in rows:
        if limit and processed >= limit:
            break

        if not attachments:
            continue

        updated = False
        atts = attachments if isinstance(attachments, list) else json.loads(attachments)

        # Track names used in this opportunity to avoid duplicates
        names_used = {}

        for idx, att in enumerate(atts):
            # Handle both dict and string formats
            if isinstance(att, str):
                continue  # Skip string URLs, we need dict with local_path

            if att.get('type') == 'link':
                continue

            name = att.get('name', '')
            local_path = att.get('local_path', '')

            # Skip if already has a descriptive name
            # Generic names we want to replace: "doc_1", "Document", "Document 1"
            is_generic = (
                not name or
                name.startswith('doc_') or
                name == 'Document' or
                name.startswith('Document ')
            )
            if not is_generic:
                continue

            if not local_path or not Path(local_path).exists():
                continue

            # Extract first page text
            text = extract_first_page_text(local_path)
            if not text:
                continue

            # Get new name from LLaMA
            new_name = generate_filename(text)
            if not new_name:
                continue

            # Handle naming collisions within same opportunity
            base_name = new_name
            if base_name in names_used:
                names_used[base_name] += 1
                new_name = f"{base_name}_{names_used[base_name]:02d}"
            else:
                names_used[base_name] = 1
                # Only add suffix if this might conflict later
                # Check if there are other docs that might get same name

            new_name_with_ext = f"{new_name}.pdf"

            if check_only:
                print(f"  {notice_id}: {name} → {new_name_with_ext}")
            else:
                att['name'] = new_name_with_ext
                updated = True
                print(f"  {notice_id}: {name} → {new_name_with_ext}")

            renamed += 1

        if updated and not check_only:
            # Save back to database
            cur.execute(
                "UPDATE opportunities SET attachments = %s WHERE notice_id = %s",
                [json.dumps(atts), notice_id]
            )
            conn.commit()

        processed += 1

    conn.close()

    mode = "Would rename" if check_only else "Renamed"
    print(f"\n{mode} {renamed} PDFs across {processed} opportunities")


def main():
    parser = argparse.ArgumentParser(description='Use LLaMA to name PDFs logically')
    parser.add_argument('--check', action='store_true', help='Show what would be renamed without changing')
    parser.add_argument('--limit', type=int, help='Process only N opportunities')
    args = parser.parse_args()

    print(f"PDF naming with LLaMA — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Model: {OLLAMA_MODEL} @ {OLLAMA_URL}")
    print("=" * 50)

    # Check Ollama is running
    try:
        req = urllib.request.Request(f"{OLLAMA_URL}/api/tags")
        with urllib.request.urlopen(req, timeout=5):
            pass
    except Exception:
        print("ERROR: Ollama not running. Start it with: ollama serve")
        print("Then pull the model: ollama pull llama3.2")
        sys.exit(1)

    process_unnamed_pdfs(check_only=args.check, limit=args.limit)


if __name__ == '__main__':
    main()
