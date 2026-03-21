#!/usr/bin/env python3
"""
fetch_opportunity.py — Fetch one or more opportunities from SAM.gov and load into DB

USAGE:
  python3 scripts/fetch_opportunity.py                        # search for best match (1 API call)
  python3 scripts/fetch_opportunity.py --notice-id abc123     # fetch specific notice (1 API call)
  python3 scripts/fetch_opportunity.py --from-file data/opps.json  # load from manual download
  python3 scripts/fetch_opportunity.py --dry-run              # show what would be fetched

SAM.gov Opportunities API: https://api.sam.gov/opportunities/v2/search
Rate limit: 10/day personal (same quota as Contract Awards API)
Resets: midnight UTC = 6 PM MDT

GETTING A BULK FILE (no API calls needed):
  1. Log into sam.gov
  2. Go to sam.gov/data-services → Contract Opportunities
  3. Download the daily ZIP file
  4. Unzip, save JSON to ~/awardopedia/data/opportunities_bulk.json
  5. Run: python3 scripts/fetch_opportunity.py --from-file data/opportunities_bulk.json --limit 100
"""

import os, sys, json, time, urllib.request, urllib.error, subprocess
from pathlib import Path
from datetime import datetime, date

# ── Load .env ─────────────────────────────────────────────────────────────────

env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2, psycopg2.extras

DATABASE_URL = os.environ['DATABASE_URL']
SAM_API_KEY  = os.environ.get('SAM_API_KEY', '')

# ── SAM.gov Opportunities API ─────────────────────────────────────────────────

SAM_OPPS_URL = "https://api.sam.gov/opportunities/v2/search"

# Default search: professional services, small biz set-aside, active, future deadline
DEFAULT_PARAMS = {
    "limit": "1",
    "offset": "0",
    "status": "active",
    "typeOfSetAsideCode": "8AN,SBA,SDVOSBC,WOSBC,EDWOSBC,HZC",
    "naics": "541330,541512,541519,541611,541690",
    "postedFrom": "01/01/2026",
    "dueDate": "01/01/2026",    # response deadline must be after this date
    "sortBy": "-modifiedDate",
}


def fetch_from_api(notice_id: str = None, limit: int = 1) -> list:
    """Make ONE SAM.gov Opportunities API call. Returns list of raw records."""
    import urllib.parse

    if not SAM_API_KEY:
        print("✗ SAM_API_KEY not set in .env")
        sys.exit(1)

    params = {"api_key": SAM_API_KEY}

    if notice_id:
        # Fetch specific notice by ID
        params.update({"noticeid": notice_id})
    else:
        # Search for best matches
        params.update(DEFAULT_PARAMS)
        params["limit"] = str(limit)

    url = SAM_OPPS_URL + "?" + urllib.parse.urlencode(params)
    display_url = url.replace(SAM_API_KEY, "***")
    print(f"\nSAM.gov Opportunities API (1 call):")
    print(f"  {display_url}")

    req = urllib.request.Request(url, headers={"User-Agent": "Awardopedia/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:400]
        print(f"  ✗ HTTP {e.code}: {body}")
        if e.code == 429:
            print("  Rate limit hit. Resets at midnight UTC (6 PM MDT).")
        sys.exit(1)

    # Save raw response
    out = Path(__file__).parent.parent / 'data'
    out.mkdir(exist_ok=True)
    (out / 'sam_opps_latest.json').write_text(json.dumps(data, indent=2, default=str))
    print(f"  Raw response saved → data/sam_opps_latest.json")

    opps = data.get('opportunitiesData', data.get('data', data if isinstance(data, list) else []))
    print(f"  ✓ Got {len(opps)} opportunities")
    return opps


def load_from_file(path: str, limit: int = None) -> list:
    """Load opportunities from a local JSON file (manual SAM.gov Data Services download)."""
    with open(path) as f:
        data = json.load(f)

    if isinstance(data, list):
        opps = data
    elif isinstance(data, dict):
        opps = data.get('opportunitiesData', data.get('data', []))
    else:
        opps = []

    if limit:
        opps = opps[:limit]

    print(f"  Loaded {len(opps)} opportunities from {path}")
    return opps


# ── Contact data cleanup ─────────────────────────────────────────────────────

import re as _re

def _clean_contact(contact: dict) -> dict:
    """
    Fix common SAM.gov contact data quality issues:
      1. Phone number stuffed into the name field → move to phone, derive name from email
      2. Name is blank/garbage but email has firstname.lastname@ → derive name
      3. Name contains "Telephone:", "Phone:", "N/A" etc. → clean up
    Returns a new dict with cleaned fields.
    """
    if not contact:
        return contact

    name  = (contact.get('fullName') or contact.get('name') or '').strip()
    email = (contact.get('email') or '').strip()
    phone = (contact.get('phone') or '').strip()

    # ── Step 1: Detect phone number in the name field ──────────────────────
    phone_in_name = _re.match(
        r'^(?:telephone|phone|tel|ph)[:\s]*(\+?[\d\s\-().ext]+)$', name, _re.IGNORECASE
    )
    if not phone_in_name:
        # Also catch bare phone numbers (10+ digits) as the entire name
        phone_in_name = _re.match(r'^(\d[\d\s\-().]{8,})$', name)

    if phone_in_name:
        extracted_phone = phone_in_name.group(1).strip()
        if not phone:
            phone = extracted_phone
        name = ''  # clear garbage name — will derive from email below

    # ── Step 1b: Detect contact block jammed into name field ───────────────
    # Pattern: "N732.73, Phone (215)697-6566, Email user@navy.mil Firstname Lastname"
    if name and ('Phone' in name or 'Email' in name or _re.search(r'[A-Z]\d{3}', name)):
        # Extract phone if present
        ph_match = _re.search(r'Phone\s*\(?(\d{3})\)?\s*[\-.]?(\d{3})[\-.]?(\d{4})', name)
        if ph_match and not phone:
            phone = f'({ph_match.group(1)}) {ph_match.group(2)}-{ph_match.group(3)}'
        # Extract email if present
        em_match = _re.search(r'Email\s+(\S+@\S+)', name)
        if em_match and not email:
            email = em_match.group(1)
        # Extract the actual human name (usually at the end after .mil/.gov)
        name_at_end = _re.search(r'(?:\.mil|\.gov|\.com)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)\s*$', name)
        if name_at_end:
            name = name_at_end.group(1).strip()
        else:
            name = ''  # Will derive from email below

    # ── Step 2: Clean up garbage names ─────────────────────────────────────
    GARBAGE = {'n/a', 'na', 'none', 'unknown', 'tbd', 'see email', '—', '-', '.'}
    if name.lower().strip('., ') in GARBAGE:
        name = ''

    # ── Step 2b: Flip "Last, First" → "First Last" ──────────────────────
    if name and ',' in name:
        parts = [p.strip() for p in name.split(',', 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            # Only flip if both parts look like names (not "Jr" or "III")
            suffixes = {'jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'esq'}
            if parts[1].lower().strip('.') not in suffixes:
                name = f"{parts[1]} {parts[0]}"

    # ── Step 3: Derive name from email if still blank ──────────────────────
    if not name and email and '@' in email:
        local = email.split('@')[0]
        # Handle formats: firstname.lastname, firstname.m.lastname, firstname_lastname
        parts = _re.split(r'[._]', local)
        # Filter out middle initials (single chars) and military suffixes (civ, mil, ctr)
        SKIP = {'civ', 'mil', 'ctr', 'ctr1', 'ctr2', 'usa', 'usn', 'usaf', 'usmc'}
        name_parts = [p.capitalize() for p in parts
                      if len(p) > 1 and p.lower() not in SKIP]
        if name_parts:
            name = ' '.join(name_parts)

    # ── Step 4: Title-case ALL CAPS names ──────────────────────────────
    if name and len(name) > 3 and name == name.upper():
        name = ' '.join(w.capitalize() for w in name.split())

    # ── Step 5: Strip trailing numeric suffixes ("Cody Smith26" → "Cody Smith")
    if name:
        name = _re.sub(r'\d+$', '', name).strip()

    return {**contact, 'fullName': name or None, 'phone': phone or None}


# ── Title cleanup ────────────────────────────────────────────────────────────

# Common government abbreviations that appear in titles
_TITLE_ABBREV = {
    'ASS':    'Assembly',
    'ASSY':   'Assembly',
    'MAINT':  'Maintenance',
    'EQUIP':  'Equipment',
    'SVCS':   'Services',
    'SVC':    'Service',
    'MGMT':   'Management',
    'GOVT':   'Government',
    'ADMIN':  'Administrative',
    'CONSTR': 'Construction',
    'MOD':    'Modification',
    'INSTAL': 'Installation',
    'RQMT':   'Requirement',
    'RQMTS':  'Requirements',
    'ACQSTN': 'Acquisition',
    'MFG':    'Manufacturing',
    'TECH':   'Technical',
    'ELEC':   'Electrical',
    'MECH':   'Mechanical',
    'FAC':    'Facility',
    'BLDG':   'Building',
    'OPS':    'Operations',
    'TRNG':   'Training',
    'COMMUN': 'Communications',
    'INFO':   'Information',
    'SYS':    'Systems',
    'SUPP':   'Support',
}

def _clean_title(raw: str) -> str:
    """
    Clean up SAM.gov opportunity titles:
      1. Strip leading PSC/category codes (e.g. "16--", "Z1DA--", "Y1DA--", "H930--")
      2. Fix ALL CAPS → Title Case
      3. Expand common abbreviations (ASS→Assembly, MAINT→Maintenance, etc.)
      4. Fix "In Repair/Modification Of" → "Repair and Modification"
      5. Preserve intentional codes and proper nouns
    """
    if not raw:
        return raw

    title = raw.strip()

    # Strip leading PSC/category codes: "16--", "Z1DA--", "H930--"
    title = _re.sub(r'^[A-Z0-9]{1,6}--\s*', '', title)

    # If ALL CAPS (or mostly caps), convert to title case with abbreviation expansion
    upper_chars = sum(1 for c in title if c.isupper())
    alpha_chars = sum(1 for c in title if c.isalpha())
    is_mostly_caps = alpha_chars > 3 and upper_chars / max(alpha_chars, 1) > 0.7

    if is_mostly_caps:
        # Normalize comma-separated tokens: "ASS,CHASSIS" → "ASS, CHASSIS"
        title = _re.sub(r',(?!\s)', ', ', title)

        words = title.split()
        cleaned = []
        LOWER_WORDS = {'in', 'of', 'at', 'to', 'by', 'for', 'and', 'the', 'or', 'on', 'a', 'an'}
        for i, w in enumerate(words):
            # Strip trailing punctuation for lookup
            punct = ''
            if w and w[-1] in ',.;:':
                punct = w[-1]
                w = w[:-1]

            upper = w.upper()
            if upper in _TITLE_ABBREV:
                cleaned.append(_TITLE_ABBREV[upper] + punct)
            elif upper in ('HVAC', 'HQ', 'NOC', 'NPS', 'CLC', 'BEQ', 'IDIQ', 'SATOC', 'OSINT', 'LLC'):
                # Known acronyms to preserve
                cleaned.append(w.upper() + punct)
            elif w.lower() in LOWER_WORDS and i > 0:
                cleaned.append(w.lower() + punct)
            elif w == w.upper() and len(w) > 1:
                cleaned.append(w.capitalize() + punct)
            else:
                cleaned.append(w + punct)

        title = ' '.join(cleaned)
        # Capitalize first word always
        if title:
            title = title[0].upper() + title[1:]

    # Clean up "Repair/Modification Of" → "Repair/Modification"
    title = _re.sub(r',?\s*in\s+Repair\b', ', Repair', title, flags=_re.IGNORECASE)
    title = _re.sub(r'\s+of\s*$', '', title, flags=_re.IGNORECASE)

    return title.strip()


def _title_case_desc(s):
    """Title-case ALL CAPS descriptions (NAICS/PSC come from Census in all caps)."""
    if not s:
        return s
    if s != s.upper():
        return s  # Already mixed case
    LOWER = {'of', 'the', 'and', 'for', 'in', 'at', 'by', 'to', 'or', 'a', 'an', 'not', 'nec'}
    UPPER = {'IT', 'HQ', 'HVAC', 'R&D', 'ADP', 'EDP', 'TV', 'FM', 'AM', 'AC', 'DC'}
    words = s.split()
    return ' '.join(
        w if w in UPPER else (w.lower() if i > 0 and w.lower() in LOWER else w.capitalize())
        for i, w in enumerate(words)
    )

# ── Parse SAM.gov opportunity record ─────────────────────────────────────────

def parse_opportunity(raw: dict) -> dict:
    """Parse a SAM.gov opportunity record into our DB schema."""

    # SAM.gov field names vary by response format — try multiple patterns
    def g(*keys):
        for k in keys:
            parts = k.split('.')
            v = raw
            for p in parts:
                if not isinstance(v, dict): break
                v = v.get(p)
            if v is not None and v != '':
                return v
        return None

    # Point of contact — clean up data quality issues
    pocs = g('pointOfContact') or []
    primary = next((p for p in pocs if p.get('type','').lower() in ('primary','c')), pocs[0] if pocs else {})
    primary = _clean_contact(primary)
    secondary = next((p for p in pocs if p.get('type','').lower() in ('secondary','s','alternative')), None)
    if secondary:
        secondary = _clean_contact(secondary)

    # Place of performance
    pop = g('placeOfPerformance') or {}
    pop_state = (g('placeOfPerformance.state.code') or
                 pop.get('state', {}).get('code') if isinstance(pop, dict) else None)
    if pop_state: pop_state = pop_state[:2].upper()  # VARCHAR(2) — truncate if needed
    pop_city  = (g('placeOfPerformance.city.name') or
                 pop.get('city', {}).get('name') if isinstance(pop, dict) else None)
    pop_country = (g('placeOfPerformance.country.code') or
                   g('placeOfPerformance.country.name') or None)

    # officeAddress — contracting office location (use as city/state fallback)
    office_addr = raw.get('officeAddress') or {}
    office_state = office_addr.get('state', '').strip() or None
    office_city = office_addr.get('city', '').strip() or None
    office_zip = office_addr.get('zipcode', '').strip() or None

    # Military "state" codes: AE=Armed Forces Europe, AP=Armed Forces Pacific, AA=Armed Forces Americas
    MILITARY_CODES = {'AE': 'Europe', 'AP': 'Pacific', 'AA': 'Americas'}

    # Use place of performance state if it's a valid 2-letter US code, else fall back to office
    if not pop_state or len(pop_state) > 2 or '-' in (pop_state or ''):
        pop_state = office_state
    if not pop_city:
        # Only fall back to office city if we ALSO don't have a performance state/zip.
        # Otherwise the office city (e.g. Omaha NE) gets mixed with the performance
        # state (e.g. Colorado) — producing nonsense like "Omaha, Colorado."
        if not pop_state:
            pop_city = office_city
        else:
            # We have a state but no city — try to derive city from ZIP via zippopotam.us
            pop_zip = (g('placeOfPerformance.zip') or '').strip()
            if pop_zip and len(pop_zip) >= 5:
                try:
                    import urllib.request as _ur
                    _zreq = _ur.Request(f'https://api.zippopotam.us/us/{pop_zip[:5]}',
                                        headers={'User-Agent': 'Awardopedia/1.0'})
                    with _ur.urlopen(_zreq, timeout=5) as _zr:
                        import json as _json
                        _zdata = _json.loads(_zr.read())
                        places = _zdata.get('places', [])
                        if places:
                            pop_city = places[0].get('place name')
                except Exception:
                    pass  # non-fatal — we'll just show state only

    # If state is a military code, replace with the region label and set city to APO/FPO context
    if pop_state in MILITARY_CODES:
        region = MILITARY_CODES[pop_state]
        pop_state = pop_state  # keep the 2-char code for DB consistency
        # Try to extract country from title (common pattern: "... in Germany", "... in Bulgaria and Romania")
        title_str = g('title') or ''
        import re as _re
        country_match = _re.search(r'\b(?:in|for)\s+([A-Z][a-z]+(?:\s+(?:and|&)\s+[A-Z][a-z]+)*)', title_str)
        if country_match:
            pop_city = country_match.group(1)  # e.g. "Bulgaria and Romania"
        elif not pop_city or pop_city == 'APO':
            pop_city = f"Armed Forces {region}"

    # Estimated value
    award = g('award') or {}
    est_min = g('estimatedValue.minAmount', 'minOffer')
    est_max = g('estimatedValue.maxAmount', 'maxOffer', 'award.amount')
    if not est_max and isinstance(award, dict):
        est_max = award.get('amount')

    # Notice type
    notice_type = g('type', 'noticeType', 'noticeTypeDescription', 'baseType')

    # Set-aside
    set_aside = (g('typeOfSetAside', 'typeOfSetAsideDescription') or '').upper()
    SET_ASIDE_MAP = {
        '8AN': '8(a) Sole Source', 'SBA': 'Small Business', 'SDVOSBC': 'SDVOSB',
        'WOSBC': 'WOSB', 'EDWOSBC': 'EDWOSB', 'HZC': 'HUBZone', 'TOTAL': 'Total Small Business',
    }
    set_aside_display = SET_ASIDE_MAP.get(set_aside, set_aside) or None

    # SAM URL
    notice_id = g('noticeId', 'id', 'opportunityId')
    sam_url = g('uiLink', 'url') or (f"https://sam.gov/opp/{notice_id}/view" if notice_id else None)

    return {
        'notice_id':                  notice_id,
        'solicitation_number':        g('solicitationNumber', 'sol_number'),
        'title':                      _clean_title(g('title')),
        'description':                g('description', 'fullParentPathName'),
        'naics_code':                 str(g('naicsCode', 'naics') or '').strip() or None,
        'naics_description':          _title_case_desc(g('naicsDescription')),
        'psc_code':                   g('classificationCode', 'pscCode', 'psc'),
        'agency_name':                g('fullParentPathName', 'departmentName', 'agencyName'),
        'sub_agency_name':            g('subtierName', 'subTierOrg'),
        'office_name':                g('officeName', 'office'),
        'contracting_officer':        primary.get('fullName') or primary.get('name'),
        'contracting_officer_email':  primary.get('email'),
        'contracting_officer_phone':  primary.get('phone'),
        'posted_date':                g('postedDate', 'publishDate'),
        'response_deadline':          g('responseDeadLine', 'responseDueDate', 'archiveDate'),
        'archive_date':               g('archiveDate'),
        'set_aside_type':             set_aside_display,
        'notice_type':                notice_type,
        'estimated_value_min':        float(est_min) if est_min else None,
        'estimated_value_max':        float(est_max) if est_max else None,
        'place_of_performance_state': pop_state,
        'place_of_performance_city':  pop_city,
        'alt_contact_name':           secondary.get('fullName') or secondary.get('name') if secondary else None,
        'alt_contact_email':          secondary.get('email') if secondary else None,
        'alt_contact_phone':          secondary.get('phone') if secondary else None,
        'sam_url':                    sam_url,
        'sam_url_alive':              True,
        'sam_url_checked':            datetime.utcnow().isoformat(),
        'last_synced':                datetime.utcnow().isoformat(),
    }


# ── DB upsert ─────────────────────────────────────────────────────────────────

def upsert_opportunity(fields: dict):
    """Upsert one opportunity into the DB."""
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()

    # Get actual column names from DB to avoid inserting into nonexistent columns
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'opportunities'
    """)
    db_cols = {r[0] for r in cur.fetchall()}

    cols = [k for k, v in fields.items() if v is not None and k in db_cols]
    vals = [fields[c] for c in cols]
    placeholders = ', '.join('%s' for _ in cols)  # psycopg2 uses %s, not $1/$2
    updates = ', '.join(f'{c} = EXCLUDED.{c}' for c in cols if c != 'notice_id')

    sql = f"""
        INSERT INTO opportunities ({', '.join(cols)})
        VALUES ({placeholders})
        ON CONFLICT (notice_id) DO UPDATE SET {updates}
    """
    cur.execute(sql, vals)
    conn.close()


# ── Ollama summary ────────────────────────────────────────────────────────────

def run_ollama_summary_opp(notice_id: str):
    """Generate llama_summary for an opportunity."""
    script = Path(__file__).parent / 'generate_llama_summaries.py'

    # Pass opportunity data inline — generate_llama_summaries handles contracts,
    # so we do a quick direct Ollama call here for opportunities
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT *, (response_deadline - CURRENT_DATE) AS days_to_deadline
        FROM opportunities WHERE notice_id = %s
    """, [notice_id])
    row = cur.fetchone()
    conn.close()

    if not row:
        return

    o = dict(row)
    days = o.get('days_to_deadline')
    if days is None:
        deadline_note = f"deadline {o.get('response_deadline','unknown')}"
    elif days < 0:
        deadline_note = f"closed {abs(days)} days ago"
    elif days == 0:
        deadline_note = "closes today"
    else:
        deadline_note = f"{days} days to respond"

    prompt = f"""OPPORTUNITY RECORD:
Title: {o.get('title','N/A')}
Agency: {o.get('agency_name','N/A')}
Set-aside: {o.get('set_aside_type','None')}
NAICS: {o.get('naics_code','N/A')} — {o.get('naics_description','N/A')}
Estimated value: ${float(o.get('estimated_value_min') or 0):,.0f} – ${float(o.get('estimated_value_max') or 0):,.0f}
Deadline: {o.get('response_deadline','?')} ({deadline_note})
Place of performance: {o.get('place_of_performance_city','N/A')}, {o.get('place_of_performance_state','N/A')}
Contracting officer: {o.get('contracting_officer','Unknown')}
Type: {o.get('notice_type','N/A')}
{"RECOMPETE — incumbent: " + str(o.get('incumbent_name','Unknown')) if o.get('is_recompete') else "New requirement"}

Write the summary now (2-3 sentences, plain English, for a small business owner):"""

    system = """You are a federal contracting analyst writing for small business owners.
Write a 2-3 sentence plain-English summary of this solicitation.
Rules:
- First sentence: what they're buying and who is asking
- Second sentence: key facts (estimated value, set-aside type, deadline urgency)
- Third sentence: one actionable insight (bid window, competition level, or incumbent status)
- No bullet points, no headers, no markdown
- Do not start with "This opportunity" — vary the opening"""

    import urllib.request as ur
    payload = json.dumps({
        "model": "llama3.2:3b",
        "system": system,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 200}
    }).encode()

    try:
        req = ur.Request("http://localhost:11434/api/generate",
                         data=payload, headers={"Content-Type": "application/json"})
        t0 = time.time()
        with ur.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode())
        summary = data.get('response', '').strip()
        elapsed = time.time() - t0
        print(f"  Ollama: ✓ {elapsed:.1f}s — {summary[:100]}...")

        conn2 = psycopg2.connect(DATABASE_URL)
        conn2.autocommit = True
        conn2.cursor().execute(
            "UPDATE opportunities SET llama_summary = %s WHERE notice_id = %s",
            [summary, notice_id]
        )
        conn2.close()
    except Exception as e:
        print(f"  Ollama: error (non-fatal) — {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--notice-id', help='Fetch a specific SAM.gov notice ID')
    parser.add_argument('--from-file', help='Load from a local JSON file (bulk download)')
    parser.add_argument('--limit', type=int, default=1, help='Max records to process')
    parser.add_argument('--dry-run', action='store_true', help='Parse and print, do not write DB')
    parser.add_argument('--no-summary', action='store_true', help='Skip Ollama summary')
    args = parser.parse_args()

    print("=" * 60)
    print("AWARDOPEDIA — OPPORTUNITY INGEST")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # Load records
    if args.from_file:
        raw_records = load_from_file(args.from_file, limit=args.limit)
    else:
        raw_records = fetch_from_api(notice_id=args.notice_id, limit=args.limit)

    if not raw_records:
        print("No records found.")
        sys.exit(0)

    print(f"\nProcessing {len(raw_records)} record(s)...\n")

    success, errors = 0, 0
    for i, raw in enumerate(raw_records, 1):
        fields = parse_opportunity(raw)
        notice_id = fields.get('notice_id')

        print(f"[{i}/{len(raw_records)}] {notice_id or 'NO-ID'} — {(fields.get('title') or '')[:50]}")

        if not notice_id:
            print("  ✗ No notice_id found — skipping")
            print(f"  Raw keys: {list(raw.keys())[:10]}")
            errors += 1
            continue

        if args.dry_run:
            for k, v in fields.items():
                if v: print(f"  {k}: {str(v)[:70]}")
            continue

        try:
            upsert_opportunity(fields)
            print(f"  ✓ Upserted")
            success += 1
        except Exception as e:
            print(f"  ✗ DB error: {e}")
            errors += 1
            continue

        if not args.no_summary:
            run_ollama_summary_opp(notice_id)
            try:
                from generate_static import generate_page_for_opportunity
                generate_page_for_opportunity(notice_id)
            except Exception as e:
                print(f"  [static page] skipped: {e}")

        time.sleep(0.3)

    print(f"\nDone: {success} inserted, {errors} errors")
