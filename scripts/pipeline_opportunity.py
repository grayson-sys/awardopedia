#!/usr/bin/env python3
"""
pipeline_opportunity.py — 10-stage opportunity processing pipeline

Takes SAM.gov notice IDs and produces complete, enriched opportunity records.
Single orchestrator. Every stage is general-purpose — no one-off fixes.

STAGES:
  1. Ingest         — SAM.gov API → opportunities table (raw JSON saved for audit)
  2. Download PDFs  — Fetch attachments, extract text via pdftotext, flag OCR-needed
  3. Classify Docs  — Tag each PDF by type (SF-1449, Wage Det, SOW, etc.)
  4. Det. Extract   — Regex extractors on the right document types
  5. AI Extract     — Claude fills NULLs from Stage 4 (targeted prompts)
  6. AI Summary     — Plain-English summary + key requirements
  7. Enrichment     — NAICS/PSC canonical lookups, agency normalization
  8. Congress       — ZIP → congressional district → rep website
  9. Link Check     — Verify SAM.gov URLs are alive
 10. Static Pages   — Generate SEO HTML + sitemap entry

USAGE:
  python3 scripts/pipeline_opportunity.py --dry-run          # show plan, no writes
  python3 scripts/pipeline_opportunity.py --limit 10         # process 10 records
  python3 scripts/pipeline_opportunity.py --stage 4-6        # run stages 4-6 only
  python3 scripts/pipeline_opportunity.py --notice-id XYZ    # single record
  python3 scripts/pipeline_opportunity.py --skip-ai          # stages 1-4,7-10 only
  python3 scripts/pipeline_opportunity.py --from-file data/sam_opps_sync_latest.json

FIREFLY: Required for Phase B (live API calls, DB writes). Phase A is code-only.
"""

import os, sys, json, re, time, subprocess, argparse, urllib.request, urllib.error
from pathlib import Path
from datetime import datetime, date, timedelta, timezone
from typing import Optional

# ── Load .env ────────────────────────────────────────────────────────────────
ENV_PATH = Path(__file__).parent.parent / '.env'
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2, psycopg2.extras

# ── Imports from existing scripts ────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).parent))
from extract_pdf_fields import (
    extract_all as deterministic_extract,
    identify_doc_type,
    extract_size_standard,
    extract_wage_floor,
    extract_performance_address,
    extract_clearance_required,
    extract_sole_source,
    extract_award_basis,
    extract_contract_structure,
    extract_estimated_value,
    extract_work_hours,
)
from fetch_opportunity import parse_opportunity, upsert_opportunity

# ── Config ───────────────────────────────────────────────────────────────────
DATABASE_URL     = os.environ.get('DATABASE_URL', '')
SAM_API_KEY      = os.environ.get('SAM_API_KEY', '')
CLAUDE_PROXY_URL = os.environ.get('CLAUDE_PROXY_URL', 'http://localhost:3456')
CLAUDE_MODEL     = 'claude-sonnet-4'

BASE_DIR    = Path(__file__).parent.parent
DATA_DIR    = BASE_DIR / 'data'
PDF_DIR     = DATA_DIR / 'pdfs'
LOG_DIR     = BASE_DIR / 'logs'
STATIC_DIR  = BASE_DIR / 'static' / 'opportunities'

SAM_OPPS_URL = "https://api.sam.gov/opportunities/v2/search"

# FAR/DFARS boilerplate regex
FAR_CLAUSE_RE = re.compile(r'\b5[12]\.\d{3}-\d+\b')


# ═════════════════════════════════════════════════════════════════════════════
# UTILITIES
# ═════════════════════════════════════════════════════════════════════════════

def db_connect():
    """Return a psycopg2 connection using DATABASE_URL."""
    return psycopg2.connect(DATABASE_URL)


def log(stage: int, notice_id: str, msg: str):
    """Consistent pipeline log format."""
    tag = f"[S{stage}]" if stage else "[  ]"
    nid = (notice_id or '???')[:16]
    print(f"  {tag} {nid} — {msg}")


def strip_boilerplate(text: str) -> tuple:
    """Remove FAR/DFARS clause blocks. Returns (cleaned_text, lines_stripped)."""
    lines = text.split('\n')
    cleaned, skip_count = [], 0
    for line in lines:
        if FAR_CLAUSE_RE.search(line):
            skip_count += 1
            continue
        cleaned.append(line)
    result = re.sub(r'\n{3,}', '\n\n', '\n'.join(cleaned))
    return result.strip(), skip_count


def call_claude(prompt: str, max_tokens: int = 2048) -> tuple:
    """
    Call Claude via OAuth proxy at localhost:3456.
    Returns (parsed_response_text, token_dict).
    Never falls back to personal API key.
    """
    url = f"{CLAUDE_PROXY_URL}/v1/chat/completions"
    payload = json.dumps({
        "model": CLAUDE_MODEL,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    }).encode()

    req = urllib.request.Request(
        url, data=payload,
        headers={'content-type': 'application/json'}
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
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

    usage = resp.get('usage', {})
    tokens = {
        'prompt':     len(payload) // 4,
        'completion': usage.get('completion_tokens', 0),
        'total':      (len(payload) // 4) + usage.get('completion_tokens', 0),
    }
    return raw, tokens


def call_claude_json(prompt: str, max_tokens: int = 2048) -> tuple:
    """Call Claude and parse response as JSON. Tolerant of trailing text after the JSON."""
    raw, tokens = call_claude(prompt, max_tokens)
    # Try direct parse first
    try:
        return json.loads(raw), tokens
    except json.JSONDecodeError:
        pass
    # Find the JSON object boundaries and extract just that
    start = raw.find('{')
    if start == -1:
        raise ValueError(f"No JSON object found in response: {raw[:200]}")
    depth = 0
    for i in range(start, len(raw)):
        if raw[i] == '{': depth += 1
        elif raw[i] == '}': depth -= 1
        if depth == 0:
            return json.loads(raw[start:i+1]), tokens
    raise ValueError(f"Unterminated JSON object in response: {raw[:200]}")


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 1 — INGEST (SAM.gov API → opportunities table)
# ═════════════════════════════════════════════════════════════════════════════

def stage_1_ingest(raw_records: list, dry_run: bool = False) -> list:
    """
    Parse raw SAM.gov API records, upsert into DB, save raw JSON for audit.
    Returns list of record dicts (pipeline format) for downstream stages.
    """
    pipeline_records = []

    for i, raw in enumerate(raw_records, 1):
        fields = parse_opportunity(raw)
        notice_id = fields.get('notice_id')

        if not notice_id:
            log(1, None, f"Record {i}: no notice_id — skipping")
            continue

        # Save raw JSON for audit trail
        if not dry_run:
            audit_dir = DATA_DIR / 'raw_opportunities'
            audit_dir.mkdir(parents=True, exist_ok=True)
            audit_path = audit_dir / f"{notice_id}.json"
            audit_path.write_text(json.dumps(raw, indent=2, default=str))

        # Extract resource links (PDF URLs) from raw record
        resource_links = raw.get('resourceLinks', [])

        # Recompete detection
        related_piid = _find_related_piid(
            fields.get('solicitation_number'),
            fields.get('naics_code')
        )
        if related_piid:
            fields['related_piid'] = related_piid
            fields['is_recompete'] = True
            log(1, notice_id, f"Recompete detected → {related_piid}")

        if not dry_run:
            upsert_opportunity(fields)

            # Store raw data for future re-processing
            raw_agency = raw.get('fullParentPathName', '')
            conn = db_connect()
            conn.autocommit = True
            cur = conn.cursor()
            cur.execute('''
                UPDATE opportunities
                SET raw_agency_hierarchy = %s, raw_sam_json = %s
                WHERE notice_id = %s
            ''', [raw_agency, json.dumps(raw), notice_id])
            conn.close()

        title = (fields.get('title') or '')[:55]
        log(1, notice_id, f"{'[DRY] ' if dry_run else ''}Ingested: {title}")

        # Build pipeline record — accumulates data through all stages
        rec = {
            'notice_id':      notice_id,
            'fields':         fields,
            'raw':            raw,
            'resource_links': resource_links,
            'pdfs':           [],          # Stage 2: downloaded PDF info
            'doc_types':      [],          # Stage 3: classified document types
            'det_extract':    {},          # Stage 4: deterministic extraction
            'ai_extract':     {},          # Stage 5: AI extraction fallback
            'ai_summary':     {},          # Stage 6: AI summary + key_requirements
            'enrichment':     {},          # Stage 7: NAICS/PSC/agency canonical
            'congress':       {},          # Stage 8: congressional district
            'link_check':     {},          # Stage 9: URL validation
            'static_page':    None,        # Stage 10: generated HTML path
            'combined_text':  '',          # accumulated PDF text
        }
        pipeline_records.append(rec)

    return pipeline_records


def _find_related_piid(solicitation_number: str, naics: str) -> Optional[str]:
    """Check if an existing contract matches this solicitation (recompete)."""
    if not solicitation_number:
        return None
    conn = db_connect()
    cur = conn.cursor()
    cur.execute(
        "SELECT piid FROM contracts WHERE solicitation_number = %s LIMIT 1",
        [solicitation_number]
    )
    row = cur.fetchone()
    conn.close()
    return row[0] if row else None


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 2 — DOWNLOAD & CATALOG PDFs
# ═════════════════════════════════════════════════════════════════════════════

SAM_RESOURCES_URL = 'https://sam.gov/api/prod/opps/v3/opportunities/{nid}/resources'


def _fetch_sam_resources(notice_id: str) -> tuple:
    """
    Fetch the full attachment + links list from SAM.gov's internal v3 API.
    No API key required. Returns (file_attachments, web_links).
    This is the same data source the SAM.gov web page uses.
    """
    url = SAM_RESOURCES_URL.format(nid=notice_id)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Awardopedia/1.0)'})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except Exception as e:
        return [], []

    embedded = data.get('_embedded', {})
    att_list = embedded.get('opportunityAttachmentList', [{}])
    attachments = att_list[0].get('attachments', []) if att_list else []

    files = []
    links = []
    for att in attachments:
        if att.get('deletedFlag') == '1':
            continue
        # Capture access level info for CUI detection
        access_level = att.get('accessLevel', 'public').lower()
        export_controlled = att.get('exportControlled', '0') == '1'
        explicit_access = att.get('explicitAccess', '0') == '1'

        if att.get('type') == 'link':
            links.append({
                'type':        'link',
                'url':         att.get('uri', ''),
                'name':        att.get('description', '').strip() or 'External Link',
                'posted_date': att.get('postedDate', ''),
                'access_level': access_level,
            })
        else:
            # File attachment — build the download URL from resourceId
            rid = att.get('resourceId', '')
            download_url = f"https://sam.gov/api/prod/opps/v3/opportunities/resources/files/{rid}/download"
            files.append({
                'type':            'file',
                'url':             download_url,
                'resource_id':     rid,
                'name':            att.get('description', '').strip() or att.get('name', 'Document'),
                'posted_date':     att.get('postedDate', ''),
                'size':            att.get('size', 0),
                'access_level':    access_level,
                'export_controlled': export_controlled,
                'explicit_access': explicit_access,
            })
    return files, links


def stage_2_download_pdfs(rec: dict, dry_run: bool = False) -> dict:
    """
    Fetch full attachment + links list from SAM.gov's v3 resources API.
    Download file attachments, extract text via pdftotext.
    Flag image-only PDFs as ocr_needed.
    Store PDFs at persistent path: data/pdfs/{notice_id}/
    Also captures web links that only appear on the SAM.gov page.
    """
    notice_id = rec['notice_id']

    # ── Step 1: Fetch resources from SAM.gov v3 internal API ──────────────
    # This gets BOTH file attachments AND web links (the v2 search API misses links)
    files, web_links = _fetch_sam_resources(notice_id)

    # Fallback: if v3 API fails, use resourceLinks from v2 search API
    if not files and rec.get('resource_links'):
        files = [{'type': 'file', 'url': url, 'name': f'Document {i+1}', 'resource_id': ''}
                 for i, url in enumerate(rec['resource_links'])]

    if not files and not web_links:
        log(2, notice_id, "No attachments or links")
        return rec

    if web_links:
        log(2, notice_id, f"{len(web_links)} web links found")
        for lnk in web_links:
            log(2, notice_id, f"  LINK: {lnk['name'][:50]} → {lnk['url'][:60]}")

    if dry_run:
        log(2, notice_id, f"[DRY] Would download {len(files)} files, {len(web_links)} links")
        return rec

    # ── Step 2: Download and extract file attachments ─────────────────────
    pdf_dir = PDF_DIR / notice_id
    pdf_dir.mkdir(parents=True, exist_ok=True)

    combined_text = ''
    pdfs = []

    for i, file_info in enumerate(files):
        url = file_info['url']
        pdf_path = pdf_dir / f"doc_{i+1}.pdf"
        pdf_info = {
            'index':      i + 1,
            'url':        url,
            'local_path': str(pdf_path),
            'filename':   file_info.get('name') or f"doc_{i+1}.pdf",
            'text':       '',
            'word_count': 0,
            'ocr_needed': False,
        }

        # Download
        if not pdf_path.exists() or pdf_path.stat().st_size < 100:
            if not _download_pdf(url, str(pdf_path)):
                log(2, notice_id, f"  doc_{i+1}: download failed")
                pdfs.append(pdf_info)
                continue

        # Try to get real filename from Content-Disposition
        real_name = _get_filename_from_url(url)
        if real_name:
            pdf_info['filename'] = real_name

        # Extract text
        raw_text = _extract_pdf_text(str(pdf_path))
        if not raw_text.strip():
            pdf_info['ocr_needed'] = True
            log(2, notice_id, f"  doc_{i+1}: no text (scanned image → ocr_needed)")
            pdfs.append(pdf_info)
            continue

        # Strip boilerplate
        clean_text, n_stripped = strip_boilerplate(raw_text)
        word_count = len(clean_text.split())

        pdf_info['text'] = clean_text
        pdf_info['word_count'] = word_count
        pdf_info['raw_word_count'] = len(raw_text.split())
        pdf_info['boilerplate_stripped'] = n_stripped

        combined_text += f"\n\n--- DOCUMENT {i+1}: {pdf_info['filename']} ---\n{clean_text}"

        log(2, notice_id, f"  doc_{i+1}: {word_count} words ({pdf_info['filename']})")
        pdfs.append(pdf_info)

    total_words = sum(p['word_count'] for p in pdfs)
    ocr_count = sum(1 for p in pdfs if p['ocr_needed'])
    log(2, notice_id,
        f"{len(pdfs)} files | {total_words} words"
        f"{f' | {ocr_count} need OCR' if ocr_count else ''}"
        f"{f' | {len(web_links)} links' if web_links else ''}")

    rec['pdfs'] = pdfs
    rec['combined_text'] = combined_text

    # ── Step 3: Save attachments + links to DB ────────────────────────────
    # Include access level info for CUI detection
    attachments_json = [
        {
            'type': 'file',
            'url': p['url'],
            'name': p['filename'],
            'local_path': p['local_path'],
            'access_level': p.get('access_level', 'public'),
            'export_controlled': p.get('export_controlled', False),
        }
        for p in pdfs
    ] + [
        {
            'type': 'link',
            'url': lnk['url'],
            'name': lnk['name'],
            'access_level': lnk.get('access_level', 'public'),
        }
        for lnk in web_links
    ]

    # Detect CUI/controlled documents
    has_controlled = any(
        att.get('access_level') == 'controlled' or att.get('export_controlled')
        for att in attachments_json
    )
    rec['has_controlled_docs'] = has_controlled

    conn = db_connect()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        "UPDATE opportunities SET attachments = %s::jsonb WHERE notice_id = %s",
        [json.dumps(attachments_json), notice_id]
    )
    conn.close()

    return rec


def _download_pdf(url: str, dest: str) -> bool:
    """Download a PDF from SAM.gov. Returns True on success."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Awardopedia/1.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            with open(dest, 'wb') as f:
                f.write(r.read())
        return os.path.getsize(dest) > 100
    except Exception as e:
        return False


def _get_filename_from_url(url: str) -> Optional[str]:
    """Try to extract real filename from Content-Disposition header."""
    try:
        req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'Awardopedia/1.0'})
        with urllib.request.urlopen(req, timeout=10) as r:
            cd = r.headers.get('Content-Disposition', '')
            m = re.search(r'filename="?([^";\n]+)"?', cd)
            if m:
                return m.group(1).strip()
    except Exception:
        pass
    return None


def _extract_pdf_text(pdf_path: str) -> str:
    """Extract text from PDF using pdftotext. Returns empty string on failure."""
    try:
        result = subprocess.run(
            ['pdftotext', pdf_path, '-'],
            capture_output=True, text=True, timeout=30
        )
        return result.stdout if result.returncode == 0 else ''
    except Exception:
        return ''


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 3 — CLASSIFY DOCUMENTS
# ═════════════════════════════════════════════════════════════════════════════

def stage_3_classify_docs(rec: dict, dry_run: bool = False) -> dict:
    """
    Classify each downloaded PDF by document type.
    Routes extraction in Stage 4 to the right documents.
    """
    notice_id = rec['notice_id']
    doc_types = []

    for pdf in rec['pdfs']:
        if pdf['ocr_needed'] or not pdf['text']:
            doc_types.append({
                'index': pdf['index'],
                'filename': pdf['filename'],
                'doc_type': 'Unknown (OCR needed)' if pdf['ocr_needed'] else 'Empty',
            })
            continue

        # Use first 500 chars for classification
        first_text = pdf['text'][:500]
        doc_type = identify_doc_type(first_text)

        doc_types.append({
            'index':    pdf['index'],
            'filename': pdf['filename'],
            'doc_type': doc_type,
        })

        if not dry_run:
            log(3, notice_id, f"  doc_{pdf['index']}: {doc_type}")

    rec['doc_types'] = doc_types

    if dry_run:
        log(3, notice_id, f"[DRY] Would classify {len(doc_types)} docs")
    else:
        type_summary = ', '.join(d['doc_type'] for d in doc_types if d['doc_type'] not in ('Empty',))
        log(3, notice_id, f"Classified: {type_summary or 'no documents'}")

    return rec


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 4 — DETERMINISTIC FIELD EXTRACTION
# ═════════════════════════════════════════════════════════════════════════════

# Map document types to the extractors that should run on them
DOC_EXTRACTOR_MAP = {
    'Solicitation Form (SF-1449)': [
        'size_standard', 'performance_address', 'award_basis',
        'estimated_value', 'contract_structure', 'sole_source',
    ],
    'Wage Determination': [
        'wage_floor',
    ],
    'Statement of Work': [
        'work_hours', 'clearance_required', 'contract_structure',
        'performance_address',
    ],
    'Price Schedule': [
        'estimated_value', 'contract_structure',
    ],
    'Amendment/Modification': [
        'sole_source', 'contract_structure',
    ],
}

# Individual extractor functions keyed by field name
EXTRACTORS = {
    'size_standard':       extract_size_standard,
    'wage_floor':          extract_wage_floor,
    'performance_address': extract_performance_address,
    'clearance_required':  extract_clearance_required,
    'sole_source':         extract_sole_source,
    'award_basis':         extract_award_basis,
    'contract_structure':  extract_contract_structure,
    'estimated_value':     extract_estimated_value,
    'work_hours':          extract_work_hours,
}


def stage_4_deterministic_extract(rec: dict, dry_run: bool = False) -> dict:
    """
    Run regex extractors on the RIGHT documents based on Stage 3 classification.
    Falls back to running all extractors on combined text for unclassified docs.
    """
    notice_id = rec['notice_id']
    results = {}
    confidence = {}  # field → 'HIGH' (right doc type) or 'MEDIUM' (fallback)

    if not rec['pdfs'] or not rec['combined_text']:
        log(4, notice_id, "No PDF text — skipping deterministic extraction")
        rec['det_extract'] = {}
        return rec

    # Phase 1: Run targeted extractors on classified documents
    for doc_info in rec['doc_types']:
        doc_type = doc_info['doc_type']
        idx = doc_info['index']

        # Find matching PDF text
        pdf = next((p for p in rec['pdfs'] if p['index'] == idx), None)
        if not pdf or not pdf['text']:
            continue

        # Get extractors for this document type
        field_names = DOC_EXTRACTOR_MAP.get(doc_type, [])
        for field_name in field_names:
            if field_name in results and results[field_name] is not None:
                continue  # already found from a higher-priority doc
            extractor = EXTRACTORS.get(field_name)
            if extractor:
                val = extractor(pdf['text'])
                if val is not None and val is not False:
                    results[field_name] = val
                    confidence[field_name] = 'HIGH'

    # Phase 2: Fallback — run remaining extractors on combined text
    for field_name, extractor in EXTRACTORS.items():
        if field_name not in results or results[field_name] is None:
            val = extractor(rec['combined_text'])
            if val is not None and val is not False:
                results[field_name] = val
                confidence[field_name] = 'MEDIUM'

    # Ensure all fields exist (None if not found)
    for field_name in EXTRACTORS:
        results.setdefault(field_name, None)

    # Validation layer: sanity-check extracted values
    set_aside = rec.get('fields', {}).get('set_aside_type', '')
    results = _validate_extraction(results, set_aside=set_aside)

    rec['det_extract'] = results
    rec['det_confidence'] = confidence

    found = [k for k, v in results.items() if v is not None and v is not False]
    log(4, notice_id,
        f"Extracted {len(found)}/{len(EXTRACTORS)}: "
        f"{', '.join(f'{k}={str(v)[:25]}' for k, v in results.items() if v is not None and v is not False)}"
        if found else "No fields extracted")

    return rec


def _validate_extraction(results: dict, set_aside: str = '') -> dict:
    """
    Sanity-check extracted values. Garbled values → None (AI fallback).
    Found in Phase B testing:
      - performance_address regex can grab sentence fragments ("121 and the size st")
      - contract_structure can produce impossible option counts ("8067 option years")
      - wage_floor must be within federal contractor range
      - estimated_value must be >$1,000
      - sole_source + set-aside = almost always a false positive (component-level J&A)
    """
    # Sole source: suppress if there's a set-aside — the government wouldn't
    # restrict to small businesses AND restrict to one vendor. The "brand name"
    # language is almost certainly about a specific component (fire alarm brand,
    # nurse call system), not the whole contract.
    if results.get('sole_source') and set_aside:
        results['sole_source'] = False
    # Performance address: must look like an actual address
    # Reject if it contains common false-positive fragments
    addr = results.get('performance_address')
    if addr:
        addr_lower = addr.lower()
        # Must contain a digit (street number) and be at least 15 chars
        if len(addr) < 15 or not re.search(r'\d', addr):
            results['performance_address'] = None
        # Reject if it contains non-address words (regex grabbed surrounding text)
        elif re.search(r'\b(size\s+st|the\s+size|standard|shall\s+be|pursuant|herein|'
                       r'notwithstanding|accordance|paragraph|subparagraph)\b', addr_lower):
            results['performance_address'] = None

    # Contract structure: option years must be 1-10 (real-world max)
    cs = results.get('contract_structure')
    if cs:
        m = re.search(r'(\d+)\s+option\s+year', cs)
        if m:
            try:
                n_options = int(m.group(1))
                if n_options > 10:
                    results['contract_structure'] = None
            except ValueError:
                results['contract_structure'] = None

    # Wage floor: must be between federal min wage and $80/hr
    wf = results.get('wage_floor')
    if wf:
        m = re.search(r'\$([\d.]+)', wf)
        if m:
            try:
                wage = float(m.group(1))
                if wage < 15.0 or wage > 80.0:
                    results['wage_floor'] = None
            except ValueError:
                results['wage_floor'] = None

    # Estimated value: must be > $1,000
    ev = results.get('estimated_value')
    if ev:
        m = re.search(r'[\d,]+', ev.replace('$', ''))
        if m:
            try:
                val = float(m.group(0).replace(',', ''))
                if val < 1000:
                    results['estimated_value'] = None
            except ValueError:
                results['estimated_value'] = None

    return results


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 5 — AI EXTRACTION (fallback for NULLs from Stage 4)
# ═════════════════════════════════════════════════════════════════════════════

AI_EXTRACT_PROMPT = """You are a federal contracting document analyst. Extract ONLY the requested fields from the document text below.

DOCUMENT TEXT (boilerplate stripped):
{pdf_text}

FIELDS NEEDED (only extract these — leave as null if not found):
{fields_needed}

SAM.GOV METADATA (use to cross-check, not as primary source):
  NAICS: {naics_code}
  Set-aside: {set_aside}
  State: {state}

Return ONLY a JSON object with the requested field names as keys.
For boolean fields, use true/false.
For text fields, use the exact value from the document.
If a field is genuinely not in the documents, use null.
No markdown, no explanation — just the JSON object."""

# Which fields AI can extract as fallback
AI_EXTRACTABLE_FIELDS = {
    'size_standard':       'The SBA size standard (e.g. "$22 million" or "1,250 employees")',
    'performance_address': 'The street address where work will be performed',
    'contract_structure':  'Base year + option years structure (e.g. "1 base + 4 option years")',
    'wage_floor':          'Prevailing wage rate for the primary occupation (e.g. "$18.27/hr for Janitor")',
    'award_basis':         'Evaluation method: "LPTA", "Best Value", or "Lowest Price"',
    'estimated_value':     'Total estimated contract value in dollars',
    'work_hours':          'Required work hours/schedule',
    'clearance_required':  'Whether security clearance is required (true/false)',
    'sole_source':         'Whether this is sole source or brand-name-only (true/false)',
}


def stage_5_ai_extract(rec: dict, dry_run: bool = False) -> dict:
    """
    For fields that Stage 4 returned NULL, ask Claude to extract from PDF text.
    Only runs if there's PDF text and at least one NULL field.
    """
    notice_id = rec['notice_id']
    det = rec.get('det_extract', {})
    combined_text = rec.get('combined_text', '')

    if not combined_text:
        log(5, notice_id, "No PDF text — skipping AI extraction")
        rec['ai_extract'] = {}
        return rec

    # Find which fields are still NULL
    null_fields = {
        k: desc for k, desc in AI_EXTRACTABLE_FIELDS.items()
        if det.get(k) is None or det.get(k) is False
    }

    if not null_fields:
        log(5, notice_id, "All fields found in Stage 4 — skipping AI extraction")
        rec['ai_extract'] = {}
        return rec

    if dry_run:
        log(5, notice_id, f"[DRY] Would ask Claude for {len(null_fields)} fields: {', '.join(null_fields)}")
        rec['ai_extract'] = {}
        return rec

    # Truncate text to keep token cost reasonable
    words = combined_text.split()
    if len(words) > 8000:
        combined_text = ' '.join(words[:8000]) + '\n[... truncated ...]'

    fields_desc = '\n'.join(f'  - {k}: {desc}' for k, desc in null_fields.items())
    fields_obj = rec.get('fields', {})

    prompt = AI_EXTRACT_PROMPT.format(
        pdf_text=combined_text,
        fields_needed=fields_desc,
        naics_code=fields_obj.get('naics_code', ''),
        set_aside=fields_obj.get('set_aside_type', ''),
        state=fields_obj.get('place_of_performance_state', ''),
    )

    try:
        ai_result, tokens = call_claude_json(prompt, max_tokens=1024)
        found = [k for k, v in ai_result.items() if v is not None]
        log(5, notice_id,
            f"AI extracted {len(found)}/{len(null_fields)}: {', '.join(found)}"
            f" | {tokens['total']:,} tokens")
        rec['ai_extract'] = ai_result
        rec.setdefault('_tokens', {'prompt': 0, 'completion': 0, 'total': 0})
        for k in rec['_tokens']:
            rec['_tokens'][k] += tokens[k]
    except Exception as e:
        log(5, notice_id, f"AI extraction failed: {e}")
        rec['ai_extract'] = {}

    return rec


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 6 — AI SUMMARY
# ═════════════════════════════════════════════════════════════════════════════

SUMMARY_PROMPT = """You are a federal contracting analyst. Read the document text and return a JSON object.

OPPORTUNITY:
Title: {title}
Agency: {agency}
NAICS: {naics_code} — {naics_description}
Set-aside: {set_aside}
Location: {city}, {state}
Posted: {posted} | Deadline: {deadline}
CO: {co_name} | {co_email} | {co_phone}

ALREADY EXTRACTED (do not contradict):
Size standard: {size_standard}
Performance address: {performance_address}
Contract structure: {contract_structure}
Wage floor: {wage_floor}
Award basis: {award_basis}
Work hours: {work_hours}
Clearance required: {clearance_required}
Sole source: {sole_source}
Estimated value: {estimated_value}

DOCUMENT TEXT ({pdf_count} PDFs):
{pdf_text}

INSTRUCTIONS:

1. clean_title: Fix the title if needed. Expand abbreviations (SVCS→Services, MAINT→Maintenance, EQUIP→Equipment). Strip leading codes (16--, H930--). Fix ALL CAPS to Title Case. If already readable, return unchanged. MUST be just the title text — no quotes, no preamble, no "Here is...".

2. summary: Write 2-3 plain sentences describing what the government is buying and what work the contractor will perform. Be conservative — only state facts from the document. TIME-NEUTRAL — never use "soon", "urgent", "upcoming". Do not repeat data from other fields (address, dollars, set-aside).

3. key_requirements: List up to 5 bid barriers or unusual requirements (certifications, clearances, equipment, tight timelines). Skip boilerplate FAR clauses.

Return ONLY this JSON object — no markdown, no explanation, no preamble:

{{"clean_title": "Cleaned Title Here", "summary": "Summary text here.", "key_requirements": ["requirement 1", "requirement 2"]}}"""

SUMMARY_PROMPT_NO_PDF = """You are a federal contracting analyst. Return a JSON object based on this metadata.

OPPORTUNITY:
Title: {title}
Agency: {agency}
Industry: {naics} — {naics_description}
Set-aside: {set_aside}
Notice type: {notice_type}
Location: {city}, {state}
Deadline: {deadline}

INSTRUCTIONS:

1. clean_title: Fix the title if needed. Expand abbreviations (SVCS→Services, MAINT→Maintenance). Strip leading codes. Fix ALL CAPS to Title Case. If already readable, return unchanged. MUST be just the title — no quotes, no preamble.

2. summary: Write 2-3 plain sentences. What is the government buying? Who is this for (mention set-aside if any)? TIME-NEUTRAL — never use "soon", "urgent", "upcoming". Do not repeat address, dollars, or set-aside type.

3. key_requirements: Based on the NAICS/industry, list 1-2 typical requirements for this type of work. If unsure, return empty array.

Return ONLY this JSON object — no markdown, no explanation:

{{"clean_title": "Cleaned Title", "summary": "Summary here.", "key_requirements": []}}"""


def stage_6_ai_summary(rec: dict, dry_run: bool = False) -> dict:
    """
    Generate plain-English summary + key requirements using Claude.
    Uses PDF text if available; falls back to metadata-only prompt.
    """
    notice_id = rec['notice_id']
    fields = rec.get('fields', {})
    combined_text = rec.get('combined_text', '')

    if dry_run:
        log(6, notice_id, "[DRY] Would generate AI summary")
        rec['ai_summary'] = {}
        return rec

    # Merge deterministic + AI extraction results for the prompt
    merged = {**rec.get('det_extract', {})}
    for k, v in rec.get('ai_extract', {}).items():
        if v is not None and merged.get(k) is None:
            merged[k] = v

    if combined_text:
        # Full prompt with PDF text
        words = combined_text.split()
        if len(words) > 8000:
            combined_text = ' '.join(words[:8000]) + '\n[... truncated ...]'

        prompt = SUMMARY_PROMPT.format(
            title=fields.get('title', ''),
            agency=fields.get('agency_name', ''),
            naics_code=fields.get('naics_code', ''),
            naics_description=fields.get('naics_description', ''),
            set_aside=fields.get('set_aside_type', 'None'),
            state=fields.get('place_of_performance_state', ''),
            city=fields.get('place_of_performance_city', ''),
            posted=str(fields.get('posted_date', '')),
            deadline=str(fields.get('response_deadline', '')),
            co_name=fields.get('contracting_officer', ''),
            co_email=fields.get('contracting_officer_email', ''),
            co_phone=fields.get('contracting_officer_phone', ''),
            pdf_count=len(rec.get('resource_links', [])),
            pdf_text=combined_text,
            size_standard=merged.get('size_standard') or 'Not found',
            performance_address=merged.get('performance_address') or 'Not found',
            contract_structure=merged.get('contract_structure') or 'Not found',
            wage_floor=merged.get('wage_floor') or 'Not applicable',
            award_basis=merged.get('award_basis') or 'Not stated',
            work_hours=merged.get('work_hours') or 'Not specified',
            clearance_required='YES' if merged.get('clearance_required') else 'No',
            sole_source='YES' if merged.get('sole_source') else 'No',
            estimated_value=merged.get('estimated_value') or 'Not published',
        )
        try:
            result, tokens = call_claude_json(prompt)
            rec['ai_summary'] = result
            rec.setdefault('_tokens', {'prompt': 0, 'completion': 0, 'total': 0})
            for k in rec['_tokens']:
                rec['_tokens'][k] += tokens[k]
            log(6, notice_id,
                f"Summary: {len(result.get('summary',''))} chars, "
                f"{len(result.get('key_requirements',[]))} requirements | "
                f"{tokens['total']:,} tokens")
        except Exception as e:
            log(6, notice_id, f"AI summary failed: {e}")
            rec['ai_summary'] = {}
    else:
        # No PDFs — richer metadata-only summary
        prompt = SUMMARY_PROMPT_NO_PDF.format(
            title=fields.get('title', ''),
            agency=fields.get('agency_name', ''),
            naics=fields.get('naics_code', ''),
            naics_description=fields.get('naics_description', ''),
            set_aside=fields.get('set_aside_type', 'Full & Open Competition'),
            notice_type=fields.get('notice_type', 'Solicitation'),
            city=fields.get('place_of_performance_city', ''),
            state=fields.get('place_of_performance_state', ''),
            deadline=str(fields.get('response_deadline', '')),
        )
        try:
            result, tokens = call_claude_json(prompt)
            rec['ai_summary'] = result
            rec.setdefault('_tokens', {'prompt': 0, 'completion': 0, 'total': 0})
            for k in rec['_tokens']:
                rec['_tokens'][k] += tokens[k]
            log(6, notice_id, f"Summary (no-PDF): {len(result.get('summary',''))} chars | {tokens['total']:,} tokens")
        except Exception as e:
            log(6, notice_id, f"AI summary (no-PDF) failed: {e}")
            rec['ai_summary'] = {}

    # Write AI-polished title back to DB if Claude improved it
    clean_title = rec.get('ai_summary', {}).get('clean_title')
    if clean_title and clean_title != fields.get('title') and not dry_run:
        # Validate: reject titles that contain Claude preamble
        bad_patterns = [
            'here is', 'i made', 'let me know', 'i can help', "i'd be happy",
            'cleaned-up', 'cleaned up', 'following changes', 'government contract title'
        ]
        title_lower = clean_title.lower()
        if any(pat in title_lower for pat in bad_patterns):
            log(6, notice_id, f"REJECTED bad clean_title: {clean_title[:50]}...")
        elif len(clean_title) < 5 or len(clean_title) > 300:
            log(6, notice_id, f"REJECTED clean_title (bad length): {len(clean_title)} chars")
        else:
            conn = db_connect()
            conn.autocommit = True
            cur = conn.cursor()
            cur.execute("UPDATE opportunities SET title = %s WHERE notice_id = %s", [clean_title, notice_id])
            conn.close()
            log(6, notice_id, f"Title: {fields.get('title','')[:30]} → {clean_title[:30]}")

    return rec


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 7 — CANONICAL ENRICHMENT (NAICS/PSC lookups, agency normalization)
# ═════════════════════════════════════════════════════════════════════════════

# Python port of agencyNorm.js

AGENCY_ABBREV = {
    'Department of Agriculture':                   'USDA',
    'Department of Commerce':                      'Dept. of Commerce',
    'Department of Defense':                       'Defense Department',
    'Department of Education':                     'Dept. of Education',
    'Department of Energy':                        'Dept. of Energy',
    'Department of Health and Human Services':     'HHS',
    'Department of Homeland Security':             'DHS',
    'Department of Housing and Urban Development': 'HUD',
    'Department of Justice':                       'Dept. of Justice',
    'Department of Labor':                         'Dept. of Labor',
    'Department of State':                         'Dept. of State',
    'Department of the Interior':                  'Dept. of the Interior',
    'Department of the Treasury':                  'Dept. of the Treasury',
    'Department of Transportation':                'Dept. of Transportation',
    'Department of Veterans Affairs':              'Veterans Affairs',
    'Agency for International Development':        'USAID',
    'Environmental Protection Agency':             'EPA',
    'Federal Communications Commission':           'FCC',
    'General Services Administration':             'GSA',
    'National Aeronautics and Space Administration': 'NASA',
    'National Science Foundation':                 'NSF',
    'Nuclear Regulatory Commission':               'NRC',
    'Office of Personnel Management':              'OPM',
    'Small Business Administration':               'SBA',
    'Social Security Administration':              'SSA',
    'US Army Corps of Engineers':                  'Army Corps of Engineers',
}

LOWER_WORDS = {'of', 'the', 'and', 'for', 'in', 'at', 'by', 'to'}


def _to_title_case(s: str) -> str:
    words = s.lower().split()
    return ' '.join(
        (w.capitalize() if i == 0 or w not in LOWER_WORDS else w)
        for i, w in enumerate(words)
    )


def _uninvert_agency(raw: str) -> str:
    """Uninvert SAM.gov inverted agency names to normal format."""
    if not raw:
        return ''
    raw = raw.strip()

    # Already normal format
    if raw and raw[0].isupper() and len(raw) > 1 and raw[1].islower():
        return raw

    # "DEPT OF THE X" → "Department of the X"
    m = re.match(r'^DEPT\s+OF\s+THE\s+(.*)', raw, re.IGNORECASE)
    if m:
        return f"Department of the {_to_title_case(m.group(1).strip())}"

    m = re.match(r'^DEPT\s+OF\s+(.*)', raw, re.IGNORECASE)
    if m:
        return f"Department of {_to_title_case(m.group(1).strip())}"

    # "X, DEPARTMENT OF THE" → "Department of the X"
    m = re.match(r'^(.+?),?\s+DEPARTMENT\s+OF\s+THE\s*$', raw, re.IGNORECASE)
    if m:
        return f"Department of the {_to_title_case(m.group(1).strip())}"

    m = re.match(r'^(.+?),?\s+DEPARTMENT\s+OF\s*$', raw, re.IGNORECASE)
    if m:
        return f"Department of {_to_title_case(m.group(1).strip())}"

    # All-caps fallback
    if raw == raw.upper():
        return _to_title_case(raw)

    return raw


def normalize_agency(raw: str) -> str:
    """Normalize any raw agency name to display name. Python port of agencyNorm.js."""
    if not raw:
        return ''
    normal = _uninvert_agency(raw.split('.')[0].strip())
    return AGENCY_ABBREV.get(normal, normal)


def stage_7_enrichment(rec: dict, dry_run: bool = False) -> dict:
    """
    NAICS/PSC canonical lookups from DB tables.
    Agency name normalization (Python port of agencyNorm.js).
    """
    notice_id = rec['notice_id']
    fields = rec.get('fields', {})
    enrichment = {}

    if dry_run:
        log(7, notice_id, "[DRY] Would enrich NAICS/PSC/agency")
        rec['enrichment'] = {}
        return rec

    conn = db_connect()
    cur = conn.cursor()

    # NAICS canonical lookup with parent code fallback
    naics = fields.get('naics_code')
    if naics:
        # Try: exact match → append '0' → 4-digit parent → 3-digit parent → 2-digit sector
        candidates = [naics]
        if len(naics) == 5:
            candidates.append(naics + '0')  # 5-digit → 6-digit
        if len(naics) >= 4:
            candidates.append(naics[:4])    # 4-digit parent
        if len(naics) >= 3:
            candidates.append(naics[:3])    # 3-digit subsector
        if len(naics) >= 2:
            candidates.append(naics[:2])    # 2-digit sector

        placeholders = ','.join(['%s'] * len(candidates))
        cur.execute(
            f"SELECT code, description FROM naics_codes WHERE code IN ({placeholders}) ORDER BY LENGTH(code) DESC LIMIT 1",
            candidates
        )
        row = cur.fetchone()
        if row:
            enrichment['naics_code'] = naics  # Keep original code
            enrichment['naics_description'] = row[1]
            if row[0] != naics:
                log(7, notice_id, f"NAICS: {naics} → matched parent {row[0]} — {row[1]}")
            elif row[1] != fields.get('naics_description'):
                log(7, notice_id, f"NAICS: {row[0]} — {row[1]}")

    # PSC canonical lookup
    psc = fields.get('psc_code')
    if psc:
        cur.execute(
            "SELECT code, description FROM psc_codes WHERE code = %s LIMIT 1",
            [psc]
        )
        row = cur.fetchone()
        if row:
            enrichment['psc_code'] = row[0]
            enrichment['psc_description'] = row[1]
            log(7, notice_id, f"PSC: {row[0]} — {row[1]}")

    # Office code canonical lookup (AI-powered, cached permanently)
    office_code = _extract_office_code(rec.get('raw', {}), fields)
    if office_code and not dry_run:
        office_info = _resolve_office_code(office_code, fields, cur, conn)
        if office_info:
            enrichment['office_name'] = office_info['full_name']
            enrichment['office_city'] = office_info.get('city')
            enrichment['office_state'] = office_info.get('state')
            log(7, notice_id, f"Office: {office_code} → {office_info['full_name']}")

    # ══════════════════════════════════════════════════════════════════════════
    # CANONICAL AGENCY LOOKUP — match raw SAM.gov hierarchy to agency_tree
    # ══════════════════════════════════════════════════════════════════════════

    # Get raw hierarchy from DB (stored in Stage 1) or from pipeline record
    raw_hierarchy = rec.get('raw', {}).get('fullParentPathName', '')
    if not raw_hierarchy:
        # Fallback: check if stored in DB
        cur.execute("SELECT raw_agency_hierarchy FROM opportunities WHERE notice_id = %s", [notice_id])
        row = cur.fetchone()
        raw_hierarchy = row[0] if row and row[0] else ''

    agency_tree_id = None
    if raw_hierarchy:
        # Walk the tree to find deepest matching node
        segments = [s.strip().lower() for s in raw_hierarchy.split('.')]

        # Start at level 1 (department)
        cur.execute(
            "SELECT id FROM agency_tree WHERE level = 1 AND name_normalized = %s",
            [segments[0]]
        )
        row = cur.fetchone()

        if row:
            agency_tree_id = row[0]

            # Walk down tree matching each segment
            for seg in segments[1:]:
                cur.execute(
                    "SELECT id FROM agency_tree WHERE parent_id = %s AND name_normalized = %s",
                    [agency_tree_id, seg]
                )
                child = cur.fetchone()
                if child:
                    agency_tree_id = child[0]
                else:
                    break  # Stop at deepest match

    if agency_tree_id:
        enrichment['agency_tree_id'] = agency_tree_id

        # Get department (level 1) and sub-agency (level 2) by walking up tree
        cur.execute('''
            WITH RECURSIVE ancestors AS (
                SELECT id, name, parent_id, level FROM agency_tree WHERE id = %s
                UNION ALL
                SELECT t.id, t.name, t.parent_id, t.level
                FROM agency_tree t JOIN ancestors a ON t.id = a.parent_id
            )
            SELECT name, level FROM ancestors ORDER BY level
        ''', [agency_tree_id])
        ancestors = cur.fetchall()

        for name, level in ancestors:
            if level == 1:
                enrichment['agency_name'] = name
            elif level == 2:
                enrichment['sub_agency_name'] = name

        log(7, notice_id, f"Agency tree: {raw_hierarchy[:40]}... → ID {agency_tree_id}")
    else:
        # No tree match — use deterministic cleanup as fallback
        raw_agency = fields.get('agency_name', '')
        enrichment['agency_display'] = normalize_agency(raw_agency)
        if raw_hierarchy:
            log(7, notice_id, f"Agency: NO TREE MATCH for {raw_hierarchy[:50]}...")

    conn.close()

    # Write canonical data back to opportunities table
    conn = db_connect()
    conn.autocommit = True
    cur = conn.cursor()

    # Update agency fields from tree lookup
    if enrichment.get('agency_tree_id'):
        cur.execute(
            "UPDATE opportunities SET agency_tree_id = %s WHERE notice_id = %s",
            [enrichment['agency_tree_id'], notice_id]
        )
    if enrichment.get('agency_name'):
        cur.execute(
            "UPDATE opportunities SET agency_name = %s WHERE notice_id = %s",
            [enrichment['agency_name'], notice_id]
        )
    if enrichment.get('sub_agency_name'):
        cur.execute(
            "UPDATE opportunities SET sub_agency_name = %s WHERE notice_id = %s",
            [enrichment['sub_agency_name'], notice_id]
        )

    if enrichment.get('naics_description'):
        cur.execute(
            "UPDATE opportunities SET naics_description = %s WHERE notice_id = %s",
            [enrichment['naics_description'], notice_id]
        )
    if enrichment.get('office_name'):
        cur.execute(
            "UPDATE opportunities SET office_name = %s WHERE notice_id = %s AND (office_name IS NULL OR office_name = '')",
            [enrichment['office_name'], notice_id]
        )
    conn.close()

    rec['enrichment'] = enrichment
    return rec


def _extract_office_code(raw: dict, fields: dict) -> Optional[str]:
    """Extract the office code from SAM.gov raw data or parsed fields."""
    # From fullParentPathCode: "036.3600.36C776" → last segment "36C776"
    path_code = raw.get('fullParentPathCode', '') or ''
    if path_code:
        parts = path_code.split('.')
        if len(parts) >= 3:
            return parts[-1].strip()

    # From agency_name hierarchy
    agency = fields.get('agency_name', '')
    if not agency:
        return None

    # Try parenthetical code: "PCAC (36C776)" → "36C776"
    m = re.search(r'\(([A-Z0-9]{4,10})\)', agency)
    if m:
        return m.group(1)

    # Extract from last segment of dot-delimited hierarchy
    # "DEPT OF DEFENSE.DEPT OF THE AIR FORCE.AIR FORCE GLOBAL STRIKE COMMAND.FA4661  7 CONS CD"
    # → last segment "FA4661  7 CONS CD" → extract "FA4661"
    parts = agency.split('.')
    if len(parts) >= 3:
        last = parts[-1].strip()
        # Look for alphanumeric code at start of last segment (must contain digit)
        m2 = re.match(r'^([A-Z0-9]{3,10})\b', last)
        if m2 and re.search(r'\d', m2.group(1)):
            return m2.group(1)

    return None


OFFICE_LOOKUP_PROMPT = """What is the US federal government contracting office with code "{code}"?

Context clues:
- Parent agency path: {agency_path}
- Abbreviation seen: {abbreviation}

Return ONLY a JSON object with these fields (no markdown, no explanation):
{{
  "full_name": "The full human-readable office name",
  "city": "City where the office is located (or null)",
  "state": "2-letter state code (or null for overseas)",
  "country": "Country name (default USA)",
  "parent_agency": "The cabinet department or top-level agency"
}}

If you're not confident, give your best guess based on the code pattern and agency context. Federal office codes follow patterns:
- W9xxxx = Army Corps of Engineers
- N00xxx = Navy
- FA/FBxxxx = Air Force
- 36Cxxx = VA
- SPRxxx = DLA
- GS-xxP = GSA"""


def _resolve_office_code(code: str, fields: dict, cur, conn) -> Optional[dict]:
    """
    Look up an office code. Check DB first; if not found, ask Claude once and cache forever.
    Returns dict with full_name, city, state, country, parent_agency — or None.
    """
    # Check if office_codes table exists (graceful degradation before migration)
    try:
        cur.execute("SELECT full_name, city, state, country, parent_agency FROM office_codes WHERE code = %s", [code])
    except Exception:
        conn.rollback()
        return None

    row = cur.fetchone()
    if row:
        return {
            'full_name': row[0],
            'city': row[1],
            'state': row[2],
            'country': row[3],
            'parent_agency': row[4],
        }

    # Not in table — ask Claude
    agency_path = fields.get('agency_name', '')
    # Extract abbreviation from agency path (last segment before the code)
    parts = agency_path.split('.')
    abbreviation = ''
    for p in reversed(parts):
        m = re.match(r'^([A-Z\s]+)', p.strip())
        if m and m.group(1).strip():
            abbreviation = m.group(1).strip()
            break

    prompt = OFFICE_LOOKUP_PROMPT.format(
        code=code,
        agency_path=agency_path,
        abbreviation=abbreviation,
    )

    try:
        result, tokens = call_claude_json(prompt, max_tokens=256)
        full_name = result.get('full_name', f'Office {code}')

        # Cache permanently
        cur.execute("""
            INSERT INTO office_codes (code, agency_code, abbreviation, full_name, city, state, country, parent_agency, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'ai')
            ON CONFLICT (code) DO NOTHING
        """, [
            code,
            code[:3] if len(code) >= 3 else code,
            abbreviation or None,
            full_name,
            result.get('city'),
            result.get('state'),
            result.get('country', 'USA'),
            result.get('parent_agency'),
        ])
        conn.commit()

        log(7, '', f"NEW office code cached: {code} → {full_name} ({tokens['total']} tokens)")
        return result
    except Exception as e:
        log(7, '', f"Office lookup failed for {code}: {e}")
        return None


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 8 — CONGRESSIONAL DISTRICT
# ═════════════════════════════════════════════════════════════════════════════

ZIP_RE = re.compile(r'\b(\d{5})(?:-\d{4})?\b')
STATE_ABBR = {
    'ALABAMA':'AL','ALASKA':'AK','ARIZONA':'AZ','ARKANSAS':'AR','CALIFORNIA':'CA',
    'COLORADO':'CO','CONNECTICUT':'CT','DELAWARE':'DE','FLORIDA':'FL','GEORGIA':'GA',
    'HAWAII':'HI','IDAHO':'ID','ILLINOIS':'IL','INDIANA':'IN','IOWA':'IA',
    'KANSAS':'KS','KENTUCKY':'KY','LOUISIANA':'LA','MAINE':'ME','MARYLAND':'MD',
    'MASSACHUSETTS':'MA','MICHIGAN':'MI','MINNESOTA':'MN','MISSISSIPPI':'MS',
    'MISSOURI':'MO','MONTANA':'MT','NEBRASKA':'NE','NEVADA':'NV','NEW HAMPSHIRE':'NH',
    'NEW JERSEY':'NJ','NEW MEXICO':'NM','NEW YORK':'NY','NORTH CAROLINA':'NC',
    'NORTH DAKOTA':'ND','OHIO':'OH','OKLAHOMA':'OK','OREGON':'OR','PENNSYLVANIA':'PA',
    'RHODE ISLAND':'RI','SOUTH CAROLINA':'SC','SOUTH DAKOTA':'SD','TENNESSEE':'TN',
    'TEXAS':'TX','UTAH':'UT','VERMONT':'VT','VIRGINIA':'VA','WASHINGTON':'WA',
    'WEST VIRGINIA':'WV','WISCONSIN':'WI','WYOMING':'WY','DISTRICT OF COLUMBIA':'DC',
}


def stage_8_congressional(rec: dict, dry_run: bool = False) -> dict:
    """
    Resolve ZIP from address → congressional district → rep website.
    Uses free APIs: zippopotam.us + whoismyrepresentative.com + govtrack.us
    """
    notice_id = rec['notice_id']
    merged = {**rec.get('det_extract', {})}
    for k, v in rec.get('ai_extract', {}).items():
        if v is not None and merged.get(k) is None:
            merged[k] = v

    fields = rec.get('fields', {})
    address = merged.get('performance_address', '') or ''
    city = fields.get('place_of_performance_city', '') or ''
    state = fields.get('place_of_performance_state', '') or ''

    if not address and not city and not state:
        log(8, notice_id, "No location data — skipping")
        rec['congress'] = {}
        return rec

    if dry_run:
        log(8, notice_id, f"[DRY] Would lookup district for {city}, {state}")
        rec['congress'] = {}
        return rec

    # DC is at-large — no standard House district. Handle directly.
    if state == 'DC' or (address and ', DC' in address.upper()):
        rec['congress'] = {
            'congressional_district': 'DC-AL',
            'congress_member_url': 'https://norton.house.gov',
        }
        log(8, notice_id, "DC → DC-AL (at-large delegate)")
        return rec

    # Resolve ZIP code
    zip_code = _resolve_zip(address, city, state)
    if not zip_code:
        log(8, notice_id, f"Could not resolve ZIP for: {address[:40] or f'{city}, {state}'}")
        rec['congress'] = {}
        return rec

    # Lookup district from ZIP — retry with nearby ZIPs if first fails
    district_code, house_url = _rep_from_zip(zip_code)
    if not district_code:
        # Try adjacent ZIP codes (±1, ±2) as fallback for flaky API
        base = int(zip_code)
        for offset in [1, -1, 2, -2]:
            alt_zip = str(base + offset).zfill(5)
            time.sleep(0.3)
            district_code, house_url = _rep_from_zip(alt_zip)
            if district_code:
                log(8, notice_id, f"ZIP {zip_code} failed, used nearby {alt_zip}")
                break

    if district_code:
        rec['congress'] = {
            'zip_code': zip_code,
            'congressional_district': district_code,
            'congress_member_url': house_url,
        }
        log(8, notice_id, f"ZIP {zip_code} → {district_code} | {house_url or 'no URL'}")
    else:
        rec['congress'] = {'zip_code': zip_code}
        log(8, notice_id, f"ZIP {zip_code} → no district found")

    return rec


def _resolve_zip(address: str, city: str, state: str) -> Optional[str]:
    """Try to resolve a 5-digit ZIP from address, city, or state."""
    # 1. Direct ZIP in address
    m = ZIP_RE.search(address)
    if m:
        return m.group(1)

    # 2. City + state → ZIP via free API
    if city and state:
        z = _zip_from_city_state(city, state)
        if z:
            return z

    # 3. Parse state from address string
    state_re = re.compile(r'\b(' + '|'.join(STATE_ABBR.values()) + r')\b')
    m = state_re.search(address.upper())
    if m:
        detected_state = m.group(1)
        before = address[:m.start()].strip().rstrip(',').strip()
        city_guess = before.split()[-1] if before.split() else ''
        if city_guess:
            z = _zip_from_city_state(city_guess, detected_state)
            if z:
                return z

    return None


def _zip_from_city_state(city: str, state: str) -> Optional[str]:
    """Call zippopotam.us for ZIP lookup. Free, no key needed."""
    import urllib.parse
    city_enc = urllib.parse.quote(city.title())
    url = f'https://api.zippopotam.us/us/{state}/{city_enc}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Awardopedia/1.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read())
        places = data.get('places', [])
        if places:
            return places[0].get('post code')
    except Exception:
        pass
    return None


def _rep_from_zip(zip_code: str) -> tuple:
    """
    ZIP → congressional district + rep website.
    Returns (district_code, house_url) e.g. ("ID-1", "https://fulcher.house.gov/")
    """
    url = f'https://whoismyrepresentative.com/getall_mems.php?zip={zip_code}&output=json'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Awardopedia/1.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read())
    except Exception:
        return None, None

    results = data.get('results', [])
    house_members = [r for r in results if r.get('district', '').strip()]
    if not house_members:
        return None, None

    rep = house_members[0]
    state = rep.get('state', '').strip().upper()
    district = rep.get('district', '').strip()
    if not state or not district:
        return None, None

    try:
        district_num = int(district)
        district_code = f'{state}-{district_num}'
    except ValueError:
        district_code = f'{state}-{district}'
        district_num = 0

    # Get current rep website from GovTrack
    time.sleep(0.3)
    gt_url = (f'https://www.govtrack.us/api/v2/role?current=true'
              f'&state={state}&district={district_num}&role_type=representative')
    house_url = None
    try:
        req = urllib.request.Request(gt_url, headers={'User-Agent': 'Awardopedia/1.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            gt = json.loads(r.read())
        objects = gt.get('objects', [])
        if objects:
            house_url = objects[0].get('website') or rep.get('link', '').strip() or None
    except Exception:
        house_url = rep.get('link', '').strip() or None

    return district_code, house_url


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 9 — LINK VALIDATION
# ═════════════════════════════════════════════════════════════════════════════

def stage_9_link_check(rec: dict, dry_run: bool = False) -> dict:
    """Check SAM.gov URL is alive. HEAD request, 10s timeout."""
    notice_id = rec['notice_id']
    fields = rec.get('fields', {})
    sam_url = fields.get('sam_url')

    if not sam_url:
        log(9, notice_id, "No SAM URL")
        rec['link_check'] = {}
        return rec

    if dry_run:
        log(9, notice_id, f"[DRY] Would check {sam_url[:50]}")
        rec['link_check'] = {}
        return rec

    try:
        req = urllib.request.Request(
            sam_url, method='HEAD',
            headers={'User-Agent': 'Awardopedia/1.0 (link-checker)'}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            status = r.status
            final_url = r.url
            alive = status < 400
    except urllib.error.HTTPError as e:
        status = e.code
        final_url = sam_url
        alive = e.code < 400
    except Exception as e:
        status = 0
        final_url = sam_url
        alive = False

    rec['link_check'] = {
        'alive': alive,
        'status': status,
        'final_url': final_url,
    }

    if alive:
        log(9, notice_id, f"URL alive (HTTP {status})")
    else:
        log(9, notice_id, f"URL DEAD (HTTP {status})")

    return rec


# ═════════════════════════════════════════════════════════════════════════════
# STAGE 10 — STATIC SEO PAGES
# ═════════════════════════════════════════════════════════════════════════════

def stage_10_static_page(rec: dict, dry_run: bool = False) -> dict:
    """
    Generate a static HTML page for this opportunity.
    Delegates to generate_static.py's existing function.
    """
    notice_id = rec['notice_id']

    if dry_run:
        log(10, notice_id, "[DRY] Would generate static HTML page")
        return rec

    try:
        from generate_static import generate_page_for_opportunity
        ok = generate_page_for_opportunity(notice_id)
        if ok:
            log(10, notice_id, "Static page generated + uploaded")
            rec['static_page'] = str(STATIC_DIR / f"{notice_id}.html")
        else:
            log(10, notice_id, "Static page generation returned False")
    except Exception as e:
        log(10, notice_id, f"Static page failed: {e}")

    return rec


# ═════════════════════════════════════════════════════════════════════════════
# DB WRITE — Flush all pipeline results to DB after each record
# ═════════════════════════════════════════════════════════════════════════════

def flush_to_db(rec: dict, dry_run: bool = False):
    """
    Write all accumulated pipeline data to the DB.
    Updates both `opportunities` and `opportunity_intel` tables.
    """
    if dry_run:
        return

    notice_id = rec['notice_id']
    det = rec.get('det_extract', {})
    ai_ext = rec.get('ai_extract', {})
    ai_sum = rec.get('ai_summary', {})
    enrichment = rec.get('enrichment', {})
    congress = rec.get('congress', {})
    link = rec.get('link_check', {})

    # Merge deterministic + AI extraction (deterministic wins)
    merged = {}
    for k in EXTRACTORS:
        merged[k] = det.get(k)
        if merged[k] is None and ai_ext.get(k) is not None:
            merged[k] = ai_ext[k]

    # Build summary text
    summary_text = _build_summary_text(merged, ai_sum)

    conn = db_connect()
    conn.autocommit = True
    cur = conn.cursor()

    # ── Update opportunities table ──────────────────────────────────────
    updates = {}
    if summary_text:
        updates['llama_summary'] = summary_text
    if link.get('alive') is not None:
        updates['sam_url_alive'] = link['alive']
        updates['sam_url_checked'] = datetime.now(timezone.utc).isoformat()
    if enrichment.get('naics_description'):
        updates['naics_description'] = enrichment['naics_description']

    if updates:
        set_clause = ', '.join(f"{k} = %s" for k in updates)
        cur.execute(
            f"UPDATE opportunities SET {set_clause} WHERE notice_id = %s",
            list(updates.values()) + [notice_id]
        )

    # ── Upsert opportunity_intel ────────────────────────────────────────
    clearance = bool(merged.get('clearance_required', False))
    sole_src = bool(merged.get('sole_source', False))

    # Build full intel JSON
    intel_json = {
        **merged,
        'summary': ai_sum.get('summary', ''),
        'key_requirements': ai_sum.get('key_requirements', []),
        'document_types': [d['doc_type'] for d in rec.get('doc_types', [])],
        'confidence': rec.get('det_confidence', {}),
    }

    cur.execute("""
        INSERT INTO opportunity_intel (
            notice_id, pdf_enriched, pdf_intel,
            size_standard, clearance_required, sole_source,
            performance_address, contract_structure, wage_floor,
            award_basis, estimated_value_text,
            work_hours, key_requirements,
            doc_count,
            congressional_district, congress_member_url,
            has_controlled_docs,
            updated_at
        ) VALUES (
            %s, %s, %s::jsonb,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s,
            %s, %s::jsonb,
            %s,
            %s, %s,
            %s,
            NOW()
        )
        ON CONFLICT (notice_id) DO UPDATE SET
            pdf_enriched         = EXCLUDED.pdf_enriched,
            pdf_intel            = EXCLUDED.pdf_intel,
            size_standard        = EXCLUDED.size_standard,
            clearance_required   = EXCLUDED.clearance_required,
            sole_source          = EXCLUDED.sole_source,
            performance_address  = EXCLUDED.performance_address,
            contract_structure   = EXCLUDED.contract_structure,
            wage_floor           = EXCLUDED.wage_floor,
            award_basis          = EXCLUDED.award_basis,
            estimated_value_text = EXCLUDED.estimated_value_text,
            work_hours           = EXCLUDED.work_hours,
            key_requirements     = EXCLUDED.key_requirements,
            doc_count            = EXCLUDED.doc_count,
            congressional_district = COALESCE(EXCLUDED.congressional_district, opportunity_intel.congressional_district),
            congress_member_url    = COALESCE(EXCLUDED.congress_member_url, opportunity_intel.congress_member_url),
            has_controlled_docs  = EXCLUDED.has_controlled_docs,
            updated_at           = NOW()
    """, [
        notice_id,
        bool(rec.get('combined_text')),
        json.dumps(intel_json),
        merged.get('size_standard'),
        clearance,
        sole_src,
        merged.get('performance_address'),
        merged.get('contract_structure'),
        merged.get('wage_floor'),
        merged.get('award_basis'),
        merged.get('estimated_value') or 'Not published',
        merged.get('work_hours'),
        json.dumps(ai_sum.get('key_requirements', [])),
        len([p for p in rec.get('pdfs', []) if p.get('text')]),
        congress.get('congressional_district'),
        congress.get('congress_member_url'),
        rec.get('has_controlled_docs', False),
    ])

    conn.close()
    log(0, notice_id, "DB flushed (opportunities + opportunity_intel)")


def _build_summary_text(merged: dict, ai_sum: dict) -> str:
    """Build the full llama_summary field from merged extraction + AI summary."""
    lines = []

    summary = ai_sum.get('summary', '').strip()
    if summary:
        lines.append(summary)

    facts = []
    if merged.get('performance_address'):
        facts.append(f"Location: {merged['performance_address']}")
    if merged.get('contract_structure'):
        facts.append(f"Structure: {merged['contract_structure']}")
    if merged.get('size_standard'):
        facts.append(f"Size standard: {merged['size_standard']}")
    if merged.get('wage_floor'):
        facts.append(f"Prevailing wage: {merged['wage_floor']}")
    ev = merged.get('estimated_value')
    if ev and ev != 'Not published':
        facts.append(f"Estimated value: {ev}")
    if merged.get('award_basis'):
        facts.append(f"Award basis: {merged['award_basis']}")
    if merged.get('work_hours'):
        facts.append(f"Work hours: {merged['work_hours']}")
    if merged.get('clearance_required'):
        facts.append("Security clearance required")
    if merged.get('sole_source'):
        facts.append("Sole source / brand name restriction")

    key_reqs = ai_sum.get('key_requirements', [])
    if key_reqs:
        facts.append(f"Key requirements: {' · '.join(key_reqs[:5])}")

    if facts:
        lines.append('\n' + '\n'.join(facts))

    return '\n'.join(lines)


# ═════════════════════════════════════════════════════════════════════════════
# ORCHESTRATOR — Run all stages for each record
# ═════════════════════════════════════════════════════════════════════════════

STAGE_FUNCTIONS = {
    2:  stage_2_download_pdfs,
    3:  stage_3_classify_docs,
    4:  stage_4_deterministic_extract,
    5:  stage_5_ai_extract,
    6:  stage_6_ai_summary,
    7:  stage_7_enrichment,
    8:  stage_8_congressional,
    9:  stage_9_link_check,
    # 10: stage_10_static_page,  # DISABLED — enable after all records are cleaned
}


def parse_stage_range(stage_str: str) -> set:
    """Parse stage range string like '1-4' or '2,5,7' or '4-6' into a set of ints."""
    stages = set()
    for part in stage_str.split(','):
        part = part.strip()
        if '-' in part:
            lo, hi = part.split('-', 1)
            stages.update(range(int(lo), int(hi) + 1))
        else:
            stages.add(int(part))
    return stages


def load_raw_records(args) -> list:
    """Load raw SAM.gov records from API or file."""
    if args.from_file:
        path = Path(args.from_file)
        if not path.is_absolute():
            path = BASE_DIR / path
        data = json.loads(path.read_text())
        if isinstance(data, list):
            opps = data
        elif isinstance(data, dict):
            opps = data.get('opportunitiesData', data.get('data', []))
        else:
            opps = []
        print(f"Loaded {len(opps)} records from {path}")
        return opps

    if args.notice_id:
        # Load from DB for re-processing
        return _load_from_db(args.notice_id)

    if args.from_api:
        # Fresh API fetch (FIREFLY required in Phase B)
        return _fetch_from_sam(args.limit or 100)

    # Default: load from most recent sync file
    sync_file = DATA_DIR / 'sam_opps_sync_latest.json'
    if sync_file.exists():
        data = json.loads(sync_file.read_text())
        opps = data.get('opportunitiesData', data.get('data', []))
        print(f"Loaded {len(opps)} records from {sync_file.name}")
        return opps

    print("No data source specified. Use --from-file, --from-api, or --notice-id.")
    print("Or ensure data/sam_opps_sync_latest.json exists from a prior sync.")
    sys.exit(1)


def _load_from_db(notice_id: str) -> list:
    """Load a single record from DB + raw JSON for re-processing."""
    # Try to load raw JSON from audit trail
    audit_path = DATA_DIR / 'raw_opportunities' / f"{notice_id}.json"
    if audit_path.exists():
        raw = json.loads(audit_path.read_text())
        print(f"Loaded {notice_id} from audit trail")
        return [raw]

    # Fallback: try the sync file
    sync_file = DATA_DIR / 'sam_opps_sync_latest.json'
    if sync_file.exists():
        data = json.loads(sync_file.read_text())
        opps = data.get('opportunitiesData', data.get('data', []))
        match = [o for o in opps if o.get('noticeId') == notice_id]
        if match:
            print(f"Found {notice_id} in sync file")
            return match

    print(f"Could not find raw data for {notice_id}. Re-run with --from-api.")
    sys.exit(1)


def _fetch_from_sam(limit: int) -> list:
    """Fetch fresh records from SAM.gov API. Costs 1 API call."""
    import urllib.parse

    if not SAM_API_KEY:
        print("SAM_API_KEY not set in .env")
        sys.exit(1)

    posted_from = (datetime.today() - timedelta(days=364)).strftime("%m/%d/%Y")
    posted_to = datetime.today().strftime("%m/%d/%Y")

    params = urllib.parse.urlencode({
        "api_key":    SAM_API_KEY,
        "limit":      str(limit),
        "offset":     "0",
        "postedFrom": posted_from,
        "postedTo":   posted_to,
        "ptype":      "o",
        "status":     "active",
        "sortBy":     "responseDeadLine",
    })

    url = f"{SAM_OPPS_URL}?{params}"
    print(f"SAM.gov API (1 call): limit={limit}, sorted by soonest deadline")

    req = urllib.request.Request(url, headers={"User-Agent": "Awardopedia/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        print(f"SAM.gov HTTP {e.code}: {body}")
        sys.exit(1)

    # Save raw response
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / 'sam_opps_sync_latest.json').write_text(
        json.dumps(data, indent=2, default=str)
    )

    opps = data.get('opportunitiesData', data.get('data', []))
    print(f"Fetched {len(opps)} opportunities from SAM.gov")
    return opps


def _rehydrate_pdf_text(rec: dict) -> dict:
    """
    Re-read PDF text from persistent storage when running stages 5-6
    after stages 2-4 already ran in a prior invocation.
    PDFs live at data/pdfs/{notice_id}/.
    """
    notice_id = rec['notice_id']
    pdf_dir = PDF_DIR / notice_id

    if not pdf_dir.exists():
        return rec

    combined_text = ''
    pdfs = []
    pdf_files = sorted(pdf_dir.glob('doc_*.pdf'))

    for pdf_path in pdf_files:
        raw_text = _extract_pdf_text(str(pdf_path))
        idx = int(pdf_path.stem.split('_')[1])
        pdf_info = {
            'index': idx,
            'local_path': str(pdf_path),
            'filename': pdf_path.name,
            'text': '',
            'word_count': 0,
            'ocr_needed': False,
        }

        if not raw_text.strip():
            pdf_info['ocr_needed'] = True
            pdfs.append(pdf_info)
            continue

        clean_text, _ = strip_boilerplate(raw_text)
        pdf_info['text'] = clean_text
        pdf_info['word_count'] = len(clean_text.split())
        combined_text += f"\n\n--- DOCUMENT {idx}: {pdf_path.name} ---\n{clean_text}"
        pdfs.append(pdf_info)

    if combined_text:
        rec['combined_text'] = combined_text
        rec['pdfs'] = pdfs

        # Also re-classify docs if not already done
        if not rec.get('doc_types'):
            for pdf in pdfs:
                if pdf['text']:
                    doc_type = identify_doc_type(pdf['text'][:500])
                    rec.setdefault('doc_types', []).append({
                        'index': pdf['index'],
                        'filename': pdf['filename'],
                        'doc_type': doc_type,
                    })

        # Re-run deterministic extraction if not already populated
        if not rec.get('det_extract'):
            rec['det_extract'] = deterministic_extract(combined_text)
            rec['det_extract'] = _validate_extraction(rec['det_extract'])

        total_words = sum(p['word_count'] for p in pdfs)
        log(0, notice_id, f"Rehydrated {len(pdfs)} PDFs from disk ({total_words} words)")

    return rec


def run_pipeline(args):
    """Main orchestrator — run the full pipeline."""

    # Determine which stages to run
    if args.stage:
        active_stages = parse_stage_range(args.stage)
    elif args.skip_ai:
        active_stages = {1, 2, 3, 4, 7, 8, 9, 10}
    else:
        active_stages = set(range(1, 11))

    print(f"\n{'='*60}")
    print(f"AWARDOPEDIA OPPORTUNITY PIPELINE")
    print(f"{'='*60}")
    print(f"Started:  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Stages:   {sorted(active_stages)}")
    print(f"Mode:     {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"Limit:    {args.limit or 'all'}")
    print(f"{'='*60}\n")

    # ── Stage 1: Ingest ────────────────────────────────────────────────
    if 1 in active_stages:
        raw_records = load_raw_records(args)
        if args.limit:
            raw_records = raw_records[:args.limit]
        pipeline_records = stage_1_ingest(raw_records, dry_run=args.dry_run)
    else:
        # Stages 2+ only: load existing DB records
        pipeline_records = _load_existing_records(args)

    if not pipeline_records:
        print("\nNo records to process.")
        return

    print(f"\n{len(pipeline_records)} records entering pipeline\n")

    # ── Stages 2-10: Process each record ───────────────────────────────
    success, failed = 0, 0
    total_tokens = {'prompt': 0, 'completion': 0, 'total': 0}
    start = datetime.now()

    for i, rec in enumerate(pipeline_records, 1):
        notice_id = rec['notice_id']
        title = (rec.get('fields', {}).get('title') or '')[:55]
        print(f"\n[{i}/{len(pipeline_records)}] {title}")
        print(f"  Notice: {notice_id}")

        try:
            # If we need PDF text but don't have it (running stages 5-6
            # after 2-4 ran in a prior invocation), rehydrate from disk
            needs_text = active_stages & {4, 5, 6}
            if needs_text and not rec.get('combined_text') and 2 not in active_stages:
                rec = _rehydrate_pdf_text(rec)

            for stage_num in sorted(active_stages):
                if stage_num == 1:
                    continue  # already ran
                func = STAGE_FUNCTIONS.get(stage_num)
                if func:
                    rec = func(rec, dry_run=args.dry_run)

            # Flush all results to DB
            if not args.dry_run and active_stages - {1}:
                flush_to_db(rec, dry_run=args.dry_run)

            success += 1

            # Accumulate tokens
            rec_tokens = rec.get('_tokens', {})
            for k in total_tokens:
                total_tokens[k] += rec_tokens.get(k, 0)

        except Exception as e:
            log(0, notice_id, f"PIPELINE ERROR: {e}")
            import traceback
            traceback.print_exc()
            failed += 1

        # Be gentle between records
        if not args.dry_run and i < len(pipeline_records):
            time.sleep(0.5)

    # ── Summary ────────────────────────────────────────────────────────
    elapsed = (datetime.now() - start).seconds
    api_cost = (total_tokens['prompt'] / 1_000_000 * 3.0) + \
               (total_tokens['completion'] / 1_000_000 * 15.0)

    print(f"\n{'='*60}")
    print(f"PIPELINE COMPLETE")
    print(f"{'='*60}")
    print(f"Time:     {elapsed}s")
    print(f"Records:  {success} success, {failed} failed")
    if total_tokens['total'] > 0:
        print(f"Tokens:   {total_tokens['total']:,} (via OAuth proxy = $0)")
        print(f"API cost: ${api_cost:.4f} if not OAuth")
    print(f"{'='*60}")


def _load_existing_records(args) -> list:
    """
    Load existing opportunity records from DB for re-processing through stages 2+.
    Used when Stage 1 is skipped (data already ingested).
    """
    conn = db_connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    if args.notice_id:
        cur.execute("SELECT * FROM opportunities WHERE notice_id = %s", [args.notice_id])
    else:
        limit_clause = f"LIMIT {args.limit}" if args.limit else ""
        cur.execute(f"""
            SELECT * FROM opportunities
            ORDER BY response_deadline ASC NULLS LAST
            {limit_clause}
        """)

    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    # Also try to load resource links from sync file
    resource_map = {}
    sync_file = DATA_DIR / 'sam_opps_sync_latest.json'
    if sync_file.exists():
        try:
            data = json.loads(sync_file.read_text())
            opps = data.get('opportunitiesData', data.get('data', []))
            for o in opps:
                links = o.get('resourceLinks', [])
                if links:
                    resource_map[o.get('noticeId', '')] = links
        except Exception:
            pass

    pipeline_records = []
    for row in rows:
        nid = row['notice_id']

        # Try to reconstruct resource links from DB attachments or sync file
        resource_links = resource_map.get(nid, [])
        if not resource_links and row.get('attachments'):
            try:
                atts = row['attachments'] if isinstance(row['attachments'], list) else json.loads(row['attachments'])
                resource_links = [a['url'] for a in atts if a.get('url')]
            except Exception:
                pass

        rec = {
            'notice_id':      nid,
            'fields':         row,
            'raw':            {},
            'resource_links': resource_links,
            'pdfs':           [],
            'doc_types':      [],
            'det_extract':    {},
            'ai_extract':     {},
            'ai_summary':     {},
            'enrichment':     {},
            'congress':       {},
            'link_check':     {},
            'static_page':    None,
            'combined_text':  '',
        }
        pipeline_records.append(rec)

    print(f"Loaded {len(pipeline_records)} existing records from DB")
    return pipeline_records


# ═════════════════════════════════════════════════════════════════════════════
# CLI
# ═════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='Awardopedia 10-stage opportunity pipeline',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --dry-run                     # show what would happen
  %(prog)s --from-file data/opps.json    # process from saved JSON
  %(prog)s --from-api --limit 10         # fetch 10 from SAM.gov (FIREFLY)
  %(prog)s --notice-id abc123            # re-process one record
  %(prog)s --stage 4-6 --limit 5         # run stages 4-6 on 5 records
  %(prog)s --skip-ai                     # skip stages 5 & 6
        """
    )

    # Data source
    src = parser.add_mutually_exclusive_group()
    src.add_argument('--from-file', type=str, help='Load from local JSON file')
    src.add_argument('--from-api', action='store_true', help='Fetch fresh from SAM.gov (FIREFLY)')
    src.add_argument('--notice-id', type=str, help='Process a single notice ID')

    # Pipeline control
    parser.add_argument('--limit', type=int, default=None, help='Max records to process')
    parser.add_argument('--stage', type=str, default=None,
                        help='Run specific stages only (e.g. "1-4", "2,5,7", "4-6")')
    parser.add_argument('--skip-ai', action='store_true',
                        help='Skip AI stages (5 & 6) — run 1-4, 7-10')
    parser.add_argument('--deep', action='store_true',
                        help='Deep enrichment: feed all PDFs through Claude to fill every blank + cache report')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show plan without writing to DB or calling APIs')

    args = parser.parse_args()

    if args.deep:
        run_deep_enrichment(args)
    else:
        run_pipeline(args)


# ═════════════════════════════════════════════════════════════════════════════
# DEEP ENRICHMENT — Feed full PDFs through Claude to fill every blank + cache report
# ═════════════════════════════════════════════════════════════════════════════

DEEP_EXTRACT_PROMPT = """You are a federal contracting document analyst. You have the full solicitation package below.

OPPORTUNITY:
Title: {title}
Agency: {agency}
NAICS: {naics_code} — {naics_description}
Solicitation: {solicitation_number}

CURRENTLY KNOWN (do not overwrite unless you find something more specific):
{known_fields}

FULL SOLICITATION TEXT ({word_count} words, boilerplate stripped):
{pdf_text}

Extract ALL of the following fields from the documents. Be thorough — check every document including
amendments, wage determinations, SF-1449 forms, price schedules, and statements of work.

Return ONLY a JSON object with these keys:

{{
  "size_standard": "SBA size standard (e.g. '$22 million' or '1,250 employees') — check Box 10 on SF-1449",
  "contract_structure": "Base period + option years (e.g. '1 base year + 4 option years (5 years total)')",
  "award_basis": "Evaluation method: 'Lowest Price Technically Acceptable (LPTA)' or 'Best Value' — check Section M",
  "wage_floor": "Prevailing wage for primary occupation from wage determination (e.g. '$18.27/hr for Janitor')",
  "work_hours": "Required work schedule (e.g. '7:00 AM - 4:30 PM Monday-Friday')",
  "estimated_value": "Total estimated contract value — check J&A documents, price schedules, or magnitude statements",
  "performance_address": "Street address where work will be performed",
  "clearance_required": true or false,
  "sole_source": true or false,
  "incumbent_name": "Current contractor if this is a recompete (or null)",
  "key_requirements": ["up to 5 specific bid barriers: certifications, equipment, clearances, bonding, experience requirements"]
}}

For any field genuinely not in the documents, use null.
The estimated_value field is critical — check J&A documents, IGCE references, magnitude codes, price schedule totals, and any dollar figures in the solicitation that indicate total contract value."""


def run_deep_enrichment(args):
    """
    Deep enrichment: for records with PDFs, feed the full text through Claude
    to fill every blank field. Also generates and caches the report.
    Two passes per record = maximum intelligence extraction.
    """
    print(f"\n{'='*60}")
    print(f"AWARDOPEDIA DEEP ENRICHMENT")
    print(f"{'='*60}")
    print(f"Started:  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Mode:     {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"Limit:    {args.limit or 'all'}")
    print(f"{'='*60}\n")

    # Load records that have PDFs but are missing fields
    conn = db_connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    if args.notice_id:
        cur.execute("""
            SELECT o.*, i.size_standard, i.contract_structure, i.award_basis,
                   i.wage_floor, i.work_hours, i.estimated_value_text,
                   i.performance_address, i.clearance_required, i.sole_source,
                   i.key_requirements, i.pdf_enriched
            FROM opportunities o
            LEFT JOIN opportunity_intel i USING (notice_id)
            WHERE o.notice_id = %s
        """, [args.notice_id])
    else:
        limit_clause = f"LIMIT {args.limit}" if args.limit else ""
        cur.execute(f"""
            SELECT o.*, i.size_standard, i.contract_structure, i.award_basis,
                   i.wage_floor, i.work_hours, i.estimated_value_text,
                   i.performance_address, i.clearance_required, i.sole_source,
                   i.key_requirements, i.pdf_enriched
            FROM opportunities o
            LEFT JOIN opportunity_intel i USING (notice_id)
            WHERE (
                i.size_standard IS NULL OR i.contract_structure IS NULL
                OR i.award_basis IS NULL OR i.estimated_value_text IS NULL
                OR i.estimated_value_text = 'Not published'
            )
            ORDER BY o.response_deadline ASC NULLS LAST
            {limit_clause}
        """)

    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    print(f"{len(rows)} records with blank fields to deep-enrich\n")

    if not rows:
        print("Nothing to do.")
        return

    success, failed = 0, 0
    total_tokens = {'prompt': 0, 'completion': 0, 'total': 0}
    start = datetime.now()

    for i, row in enumerate(rows, 1):
        notice_id = row['notice_id']
        title = (row.get('title') or '')[:55]
        print(f"\n[{i}/{len(rows)}] {title}")
        print(f"  Notice: {notice_id}")

        # Rehydrate PDF text from disk
        pdf_dir = PDF_DIR / notice_id
        if not pdf_dir.exists():
            log(0, notice_id, "No PDFs on disk — skipping deep enrichment")
            continue

        combined_text = ''
        pdf_files = sorted(pdf_dir.glob('doc_*.pdf'))
        for pdf_path in pdf_files:
            raw_text = _extract_pdf_text(str(pdf_path))
            if raw_text.strip():
                clean, _ = strip_boilerplate(raw_text)
                combined_text += f"\n\n--- {pdf_path.name} ---\n{clean}"

        if not combined_text:
            log(0, notice_id, "No extractable PDF text — skipping")
            continue

        # Truncate
        words = combined_text.split()
        word_count = len(words)
        if word_count > 15000:
            combined_text = ' '.join(words[:15000]) + '\n[... truncated ...]'
            word_count = 15000

        # Build known fields string
        known = []
        for f in ['size_standard', 'contract_structure', 'award_basis', 'wage_floor',
                  'work_hours', 'estimated_value_text', 'performance_address']:
            v = row.get(f)
            if v and v != 'Not published':
                known.append(f"  {f}: {v}")
        known_str = '\n'.join(known) if known else '  (none — all blank)'

        # Find blanks
        blanks = [f for f in ['size_standard', 'contract_structure', 'award_basis', 'wage_floor',
                              'work_hours', 'estimated_value_text', 'performance_address']
                  if not row.get(f) or row.get(f) == 'Not published']

        log(0, notice_id, f"{word_count} words | {len(blanks)} blank fields: {', '.join(blanks)}")

        if args.dry_run:
            continue

        # ── Pass 1: Deep field extraction ────────────────────────────────
        prompt = DEEP_EXTRACT_PROMPT.format(
            title=row.get('title', ''),
            agency=row.get('agency_name', ''),
            naics_code=row.get('naics_code', ''),
            naics_description=row.get('naics_description', ''),
            solicitation_number=row.get('solicitation_number', ''),
            known_fields=known_str,
            word_count=word_count,
            pdf_text=combined_text,
        )

        try:
            result, tokens = call_claude_json(prompt, max_tokens=1024)
            total_tokens = {k: total_tokens[k] + tokens[k] for k in total_tokens}

            # Write extracted fields back to opportunity_intel
            conn = db_connect()
            conn.autocommit = True
            cur = conn.cursor()

            updates = []
            values = []
            field_map = {
                'size_standard': 'size_standard',
                'contract_structure': 'contract_structure',
                'award_basis': 'award_basis',
                'wage_floor': 'wage_floor',
                'work_hours': 'work_hours',
                'estimated_value': 'estimated_value_text',
                'performance_address': 'performance_address',
                'clearance_required': 'clearance_required',
                'sole_source': 'sole_source',
                'key_requirements': 'key_requirements',
            }

            filled = []
            for src_field, db_field in field_map.items():
                val = result.get(src_field)
                if val is None:
                    continue
                # Only overwrite if currently blank
                current_val = row.get(db_field)
                if current_val and current_val != 'Not published' and db_field not in ('key_requirements',):
                    continue
                if db_field == 'key_requirements':
                    val = json.dumps(val) if isinstance(val, list) else val
                    updates.append(f"key_requirements = %s::jsonb")
                elif db_field in ('clearance_required', 'sole_source'):
                    updates.append(f"{db_field} = %s")
                    val = bool(val)
                else:
                    updates.append(f"{db_field} = %s")
                values.append(val)
                filled.append(db_field)

            if updates:
                sql = f"UPDATE opportunity_intel SET {', '.join(updates)}, updated_at = NOW() WHERE notice_id = %s"
                cur.execute(sql, values + [notice_id])
                log(0, notice_id, f"FILLED {len(filled)} fields: {', '.join(filled)}")
            else:
                log(0, notice_id, "Claude found nothing new")

            conn.close()
            success += 1

        except Exception as e:
            log(0, notice_id, f"Deep extraction failed: {e}")
            failed += 1

        # Be gentle
        time.sleep(1)

    elapsed = (datetime.now() - start).seconds
    api_cost = (total_tokens['prompt'] / 1_000_000 * 3.0) + \
               (total_tokens['completion'] / 1_000_000 * 15.0)

    print(f"\n{'='*60}")
    print(f"DEEP ENRICHMENT COMPLETE")
    print(f"{'='*60}")
    print(f"Time:     {elapsed}s")
    print(f"Records:  {success} enriched, {failed} failed")
    if total_tokens['total'] > 0:
        print(f"Tokens:   {total_tokens['total']:,} (via OAuth proxy = $0)")
        print(f"API cost: ${api_cost:.4f} if not OAuth")
    print(f"{'='*60}")


if __name__ == '__main__':
    main()
