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

    # Point of contact
    pocs = g('pointOfContact') or []
    primary = next((p for p in pocs if p.get('type','').lower() in ('primary','c')), pocs[0] if pocs else {})

    # Place of performance
    pop = g('placeOfPerformance') or {}
    pop_state = (g('placeOfPerformance.state.code') or
                 pop.get('state', {}).get('code') if isinstance(pop, dict) else None)
    pop_city  = (g('placeOfPerformance.city.name') or
                 pop.get('city', {}).get('name') if isinstance(pop, dict) else None)

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
        'title':                      g('title'),
        'description':                g('description', 'fullParentPathName'),
        'naics_code':                 str(g('naicsCode', 'naics') or '').strip() or None,
        'naics_description':          g('naicsDescription'),
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

    cols = [k for k, v in fields.items() if v is not None]
    vals = [fields[c] for c in cols]
    placeholders = ', '.join(f'${i+1}' for i in range(len(cols)))
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

        time.sleep(0.3)

    print(f"\nDone: {success} inserted, {errors} errors")
