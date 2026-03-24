#!/usr/bin/env python3
"""
pipeline_contract.py — Contract processing pipeline for USASpending data

Enriches contracts with clean descriptions, canonical lookups, recipient
enrichment (parent companies, Yahoo Finance for public, AI briefs for private).

STAGES:
  1. Fetch         — USASpending API → contracts table (or process existing)
  2. Descriptions  — AI cleans garbled FPDS descriptions
  3. Canonicals    — NAICS/PSC lookups from canonical tables
  4. Recipients    — Link to recipient canonical table, detect parent companies
  5. Financials    — Yahoo Finance for public, AI brief for private companies
  6. Summaries     — AI-generated plain English summaries
  7. Aggregates    — Compute award tracking by agency/NAICS/PSC
  8. Successors    — Find likely successor contracts for expired awards
  9. Congress      — State + district → representative website URL

USAGE:
  python3 scripts/pipeline_contract.py --limit 500          # process 500 records
  python3 scripts/pipeline_contract.py --stage 2-4          # run stages 2-4 only
  python3 scripts/pipeline_contract.py --dry-run            # show plan
  python3 scripts/pipeline_contract.py --fetch-new 500      # fetch 500 new from USASpending
"""

import os, sys, json, re, time, urllib.request, urllib.error, argparse
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Dict

# ── Load .env ────────────────────────────────────────────────────────────────
ENV_PATH = Path(__file__).parent.parent / '.env'
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

import psycopg2, psycopg2.extras

# ── Config ───────────────────────────────────────────────────────────────────
DATABASE_URL     = os.environ.get('DATABASE_URL', '')
CLAUDE_PROXY_URL = os.environ.get('CLAUDE_PROXY_URL', 'http://localhost:3456')
CLAUDE_MODEL     = 'claude-sonnet-4-20250514'

BASE_DIR = Path(__file__).parent.parent
LOG_DIR  = BASE_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)

USASPENDING_SEARCH_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/"
USASPENDING_DETAIL_URL = "https://api.usaspending.gov/api/v2/awards/"

# Yahoo Finance (using yfinance library)
try:
    import yfinance as yf
    HAS_YFINANCE = True
except ImportError:
    HAS_YFINANCE = False
    print("Warning: yfinance not installed. Public company enrichment disabled.")

# ═══════════════════════════════════════════════════════════════════════════════
# UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

def db_connect():
    return psycopg2.connect(DATABASE_URL)

def log(stage: int, piid: str, msg: str):
    tag = f"[S{stage}]" if stage else "[  ]"
    pid = (piid or '???')[:20]
    print(f"  {tag} {pid} — {msg}")

def call_claude(prompt: str, system: str = "", max_tokens: int = 1000) -> str:
    """Call Claude via OAuth proxy (OpenAI-compatible format)."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    else:
        messages.append({"role": "system", "content": "You are a helpful assistant for federal contracting data."})
    messages.append({"role": "user", "content": prompt})

    body = json.dumps({
        "model": CLAUDE_MODEL,
        "max_tokens": max_tokens,
        "messages": messages,
    }).encode()

    req = urllib.request.Request(
        f"{CLAUDE_PROXY_URL}/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"}
    )

    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.loads(r.read())

    # Extract text from OpenAI-format response
    choices = resp.get('choices', [])
    if choices:
        return choices[0].get('message', {}).get('content', '')
    return ''

def is_garbled_description(desc: str) -> bool:
    """Detect if description is garbled FPDS fixed-width data."""
    if not desc:
        return False
    # Signs of garbled data: multiple ! separators (old FPDS format)
    # Example: "200012!5700!000051!GV59 !ESC/NDK !F1962800C0018"
    if desc.count('!') >= 3:
        return True
    # Mostly numeric with separators
    if re.match(r'^[\d!|*\s]{20,}', desc):
        return True
    return False

# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 1: FETCH FROM USASPENDING
# ═══════════════════════════════════════════════════════════════════════════════

def stage1_fetch(limit: int = 500, dry_run: bool = False) -> List[str]:
    """Fetch new contracts from USASpending API (paginated, max 100 per page)."""
    print(f"\n=== STAGE 1: FETCH ({limit} records) ===")

    # Date range: last 5 years
    end_date = "2025-12-31"  # USASpending data cutoff
    start_date = "2021-01-01"  # 5 years back

    if dry_run:
        print(f"  [DRY RUN] Would fetch {limit} contracts from {start_date} to {end_date}")
        return []

    print(f"  Fetching from USASpending (date range: {start_date} to {end_date})...")

    # Paginate: USASpending max is 100 per page
    PAGE_SIZE = 100
    all_results = []
    page = 1

    while len(all_results) < limit:
        page_limit = min(PAGE_SIZE, limit - len(all_results))

        body = json.dumps({
            "filters": {
                "award_type_codes": ["A", "B", "C", "D"],
                "time_period": [{"start_date": start_date, "end_date": end_date}]
            },
            "fields": [
                "Award ID", "Recipient Name", "Start Date", "End Date",
                "Award Amount", "Awarding Agency", "generated_internal_id"
            ],
            "limit": page_limit,
            "page": page,
            "sort": "Award Amount",
            "order": "desc"
        }).encode()

        req = urllib.request.Request(
            USASPENDING_SEARCH_URL,
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": "Awardopedia/1.0"}
        )

        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())

        page_results = data.get('results', [])
        has_next = data.get('page_metadata', {}).get('hasNext', False)

        all_results.extend(page_results)
        print(f"  Page {page}: got {len(page_results)} records (total: {len(all_results)})")

        if not page_results or not has_next:
            break

        page += 1
        time.sleep(0.5)  # Be polite

    results = all_results
    print(f"  Got {len(results)} records")

    # Import from existing enrich script
    sys.path.insert(0, str(Path(__file__).parent))
    from enrich_usaspending import fetch_award, parse_award, upsert

    piids = []
    for i, row in enumerate(results, 1):
        piid = row.get('Award ID', '').strip()
        internal_id = row.get('generated_internal_id', '').strip()
        if not piid:
            continue

        print(f"  [{i}/{len(results)}] {piid}", end=' ')

        try:
            # Fetch full detail
            url = f"{USASPENDING_DETAIL_URL}{internal_id}/" if internal_id else None
            if url:
                req2 = urllib.request.Request(url, headers={"User-Agent": "Awardopedia/1.0"})
                with urllib.request.urlopen(req2, timeout=30) as r:
                    raw = json.loads(r.read())
            else:
                raw = fetch_award(piid)

            fields = parse_award(raw)
            upsert(fields)
            piids.append(piid)
            print("OK")
        except Exception as e:
            print(f"ERROR: {e}")

        time.sleep(0.2)  # Be polite to API

    print(f"  Fetched and inserted {len(piids)} contracts")
    return piids


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 2: CLEAN DESCRIPTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def stage2_descriptions(piids: List[str], dry_run: bool = False) -> int:
    """Use AI to clean garbled FPDS descriptions."""
    print(f"\n=== STAGE 2: CLEAN DESCRIPTIONS ===")

    conn = db_connect()
    cur = conn.cursor()

    # Find contracts with garbled descriptions
    if piids:
        placeholders = ','.join(['%s'] * len(piids))
        cur.execute(f"""
            SELECT piid, description FROM contracts
            WHERE piid IN ({placeholders}) AND description IS NOT NULL
        """, piids)
    else:
        cur.execute("""
            SELECT piid, description FROM contracts
            WHERE description IS NOT NULL
            LIMIT 500
        """)

    rows = cur.fetchall()
    garbled = [(piid, desc) for piid, desc in rows if is_garbled_description(desc)]

    print(f"  Found {len(garbled)} garbled descriptions out of {len(rows)}")

    if dry_run:
        for piid, desc in garbled[:3]:
            print(f"  [DRY RUN] Would clean: {piid} — {desc[:60]}...")
        return 0

    cleaned = 0
    # Batch process in groups of 10 to reduce API calls
    batch_size = 10
    for i in range(0, len(garbled), batch_size):
        batch = garbled[i:i+batch_size]

        # Build batch prompt
        prompt = """Parse these garbled FPDS contract descriptions into readable text.
For each, extract the actual description/purpose. Return JSON array with objects:
{"piid": "...", "clean_description": "..."}

Descriptions to clean:
"""
        for piid, desc in batch:
            prompt += f'\n- PIID: {piid}\n  Raw: {desc[:200]}\n'

        try:
            response = call_claude(prompt, max_tokens=2000)
            # Parse JSON from response
            json_match = re.search(r'\[.*\]', response, re.DOTALL)
            if json_match:
                results = json.loads(json_match.group())
                for item in results:
                    piid = item.get('piid')
                    clean = item.get('clean_description', '').strip()
                    if piid and clean and len(clean) > 10:
                        cur.execute(
                            "UPDATE contracts SET description = %s WHERE piid = %s",
                            [clean, piid]
                        )
                        cleaned += 1
                        log(2, piid, f"cleaned: {clean[:50]}...")
        except Exception as e:
            print(f"  Batch error: {e}")

        time.sleep(1)  # Rate limit

    conn.commit()
    conn.close()
    print(f"  Cleaned {cleaned} descriptions")
    return cleaned


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 3: CANONICAL LOOKUPS (NAICS/PSC)
# ═══════════════════════════════════════════════════════════════════════════════

def stage3_canonicals(piids: List[str], dry_run: bool = False) -> int:
    """Align NAICS/PSC codes with canonical lookup tables."""
    print(f"\n=== STAGE 3: CANONICAL LOOKUPS ===")

    conn = db_connect()
    cur = conn.cursor()

    # Get contracts needing lookup
    if piids:
        placeholders = ','.join(['%s'] * len(piids))
        cur.execute(f"""
            SELECT piid, naics_code, psc_code FROM contracts
            WHERE piid IN ({placeholders})
        """, piids)
    else:
        cur.execute("""
            SELECT piid, naics_code, psc_code FROM contracts LIMIT 500
        """)

    rows = cur.fetchall()
    updated = 0

    for piid, naics, psc in rows:
        updates = {}

        # NAICS lookup with parent code fallback
        if naics:
            candidates = [naics]
            if len(naics) == 5:
                candidates.append(naics + '0')
            if len(naics) >= 4:
                candidates.append(naics[:4])
            if len(naics) >= 3:
                candidates.append(naics[:3])
            if len(naics) >= 2:
                candidates.append(naics[:2])

            placeholders = ','.join(['%s'] * len(candidates))
            cur.execute(f"""
                SELECT code, description FROM naics_codes
                WHERE code IN ({placeholders})
                ORDER BY LENGTH(code) DESC LIMIT 1
            """, candidates)
            row = cur.fetchone()
            if row:
                updates['naics_description'] = row[1]

        # PSC lookup
        if psc:
            cur.execute("""
                SELECT code, description FROM psc_codes WHERE code = %s
            """, [psc])
            row = cur.fetchone()
            if row:
                updates['psc_description'] = row[1]

        if updates and not dry_run:
            set_clause = ', '.join(f"{k} = %s" for k in updates.keys())
            cur.execute(f"UPDATE contracts SET {set_clause} WHERE piid = %s",
                        list(updates.values()) + [piid])
            updated += 1
            if updated <= 5:
                log(3, piid, f"NAICS/PSC updated")

    if not dry_run:
        conn.commit()
    conn.close()

    print(f"  Updated {updated} contracts with canonical descriptions")
    return updated


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 4: RECIPIENT LINKING + PARENT DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def stage4_recipients(piids: List[str], dry_run: bool = False) -> int:
    """Link contracts to canonical recipients, detect parent companies."""
    print(f"\n=== STAGE 4: RECIPIENT LINKING ===")

    conn = db_connect()
    cur = conn.cursor()

    # Get unique recipients from contracts
    if piids:
        placeholders = ','.join(['%s'] * len(piids))
        cur.execute(f"""
            SELECT DISTINCT recipient_name, recipient_uei, recipient_city, recipient_state
            FROM contracts
            WHERE piid IN ({placeholders}) AND recipient_uei IS NOT NULL
        """, piids)
    else:
        cur.execute("""
            SELECT DISTINCT recipient_name, recipient_uei, recipient_city, recipient_state
            FROM contracts
            WHERE recipient_uei IS NOT NULL
            LIMIT 500
        """)

    recipients = cur.fetchall()
    print(f"  Found {len(recipients)} unique recipients")

    if dry_run:
        print(f"  [DRY RUN] Would process {len(recipients)} recipients")
        return 0

    # Upsert each recipient
    upserted = 0
    for name, uei, city, state in recipients:
        cur.execute("""
            INSERT INTO recipients (uei, legal_name, city, state, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            ON CONFLICT (uei) DO UPDATE SET
                legal_name = COALESCE(EXCLUDED.legal_name, recipients.legal_name),
                city = COALESCE(EXCLUDED.city, recipients.city),
                state = COALESCE(EXCLUDED.state, recipients.state),
                updated_at = NOW()
        """, [uei, name, city, state])
        upserted += 1

    conn.commit()

    # Detect parent companies using AI (batch)
    cur.execute("""
        SELECT uei, legal_name FROM recipients
        WHERE parent_uei IS NULL AND parent_detected_by IS NULL
        LIMIT 100
    """)
    to_detect = cur.fetchall()

    if to_detect:
        print(f"  Detecting parent companies for {len(to_detect)} recipients...")

        # Group by likely parent patterns
        name_groups = {}
        for uei, name in to_detect:
            # Extract base company name (before LLC, INC, etc.)
            base = re.sub(r'\s*(LLC|INC|CORP|CORPORATION|COMPANY|CO|LP|LLP|SERVICES|SOLUTIONS)\.?.*$',
                          '', name, flags=re.IGNORECASE).strip()
            if base not in name_groups:
                name_groups[base] = []
            name_groups[base].append((uei, name))

        # Find groups with multiple entries (potential subsidiaries)
        multi_groups = {k: v for k, v in name_groups.items() if len(v) > 1}

        if multi_groups:
            prompt = """Analyze these company groups and identify parent-subsidiary relationships.
For each group, determine which company is the parent (usually the one without "SERVICES", "FEDERAL", etc. suffix).

Return JSON array: [{"parent_uei": "...", "subsidiary_ueis": ["...", ...], "confidence": 0.0-1.0}]

Company groups:
"""
            for base, companies in list(multi_groups.items())[:20]:
                prompt += f"\nGroup '{base}':\n"
                for uei, name in companies:
                    prompt += f"  - {name} (UEI: {uei})\n"

            try:
                response = call_claude(prompt, max_tokens=2000)
                json_match = re.search(r'\[.*\]', response, re.DOTALL)
                if json_match:
                    results = json.loads(json_match.group())
                    for item in results:
                        parent_uei = item.get('parent_uei')
                        subs = item.get('subsidiary_ueis', [])
                        conf = item.get('confidence', 0.5)
                        for sub_uei in subs:
                            if sub_uei != parent_uei:
                                cur.execute("""
                                    UPDATE recipients SET
                                        parent_uei = %s,
                                        parent_detected_by = 'ai',
                                        parent_confidence = %s
                                    WHERE uei = %s
                                """, [parent_uei, conf, sub_uei])
                                log(4, sub_uei[:12], f"parent: {parent_uei}")
            except Exception as e:
                print(f"  Parent detection error: {e}")

        # Mark processed (even if no parent found)
        for uei, _ in to_detect:
            cur.execute("""
                UPDATE recipients SET parent_detected_by = COALESCE(parent_detected_by, 'none')
                WHERE uei = %s AND parent_detected_by IS NULL
            """, [uei])

    conn.commit()
    conn.close()
    print(f"  Upserted {upserted} recipients")
    return upserted


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 5: COMPANY FINANCIALS (Yahoo Finance + AI briefs)
# ═══════════════════════════════════════════════════════════════════════════════

# Known public company tickers
PUBLIC_COMPANIES = {
    'BOEING': 'BA',
    'LOCKHEED MARTIN': 'LMT',
    'RAYTHEON': 'RTX',
    'GENERAL DYNAMICS': 'GD',
    'GENERAL MOTORS': 'GM',
    'FORD': 'F',
    'NORTHROP GRUMMAN': 'NOC',
    'L3HARRIS': 'LHX',
    'BAE SYSTEMS': 'BAESY',
    'LEIDOS': 'LDOS',
    'BOOZ ALLEN': 'BAH',
    'SCIENCE APPLICATIONS INTERNATIONAL': 'SAIC',
    'CACI': 'CACI',
    'MANTECH': 'MANT',
    'PERATON': None,  # Private (Veritas Capital)
    'ACCENTURE': 'ACN',
    'DELOITTE': None,  # Private partnership
    'HONEYWELL': 'HON',
    'TEXTRON': 'TXT',
    '3M': 'MMM',
    'JOHNSON & JOHNSON': 'JNJ',
    'PFIZER': 'PFE',
    'MODERNA': 'MRNA',
    'IBM': 'IBM',
    'MICROSOFT': 'MSFT',
    'AMAZON': 'AMZN',
    'GOOGLE': 'GOOGL',
    'ORACLE': 'ORCL',
    'PALANTIR': 'PLTR',
    # Utilities (common in state contracts)
    'NATIONAL GRID': 'NGG',
    'DUKE ENERGY': 'DUK',
    'SOUTHERN COMPANY': 'SO',
    'DOMINION': 'D',
    'CONEDISON': 'ED',
    'CON EDISON': 'ED',
    'PACIFIC GAS': 'PCG',
    'PG&E': 'PCG',
    'XCEL ENERGY': 'XEL',
    'ENTERGY': 'ETR',
    'PSEG': 'PEG',
    'EDISON INTERNATIONAL': 'EIX',
    'EXELON': 'EXC',
    'AMERICAN ELECTRIC POWER': 'AEP',
    'NEXTERRA': 'NEE',
}

def get_ticker(name: str) -> Optional[str]:
    """Try to find stock ticker for a company name."""
    name_upper = name.upper()
    for key, ticker in PUBLIC_COMPANIES.items():
        if key in name_upper:
            return ticker
    return None

def stage5_financials(limit: int = 50, dry_run: bool = False) -> int:
    """Enrich recipients with Yahoo Finance data or AI briefs."""
    print(f"\n=== STAGE 5: COMPANY FINANCIALS ===")

    conn = db_connect()
    cur = conn.cursor()

    # Get recipients needing enrichment
    cur.execute("""
        SELECT uei, legal_name FROM recipients
        WHERE yahoo_enriched_at IS NULL AND company_brief IS NULL
        ORDER BY total_awarded DESC NULLS LAST
        LIMIT %s
    """, [limit])

    recipients = cur.fetchall()
    print(f"  Found {len(recipients)} recipients to enrich")

    if dry_run:
        for uei, name in recipients[:5]:
            ticker = get_ticker(name)
            print(f"  [DRY RUN] {name[:40]} — ticker: {ticker or 'private'}")
        return 0

    enriched = 0
    private_batch = []

    for uei, name in recipients:
        ticker = get_ticker(name)

        if ticker and HAS_YFINANCE:
            # Public company: get Yahoo Finance data
            try:
                stock = yf.Ticker(ticker)
                info = stock.info

                # Extract executive compensation
                officers = info.get('companyOfficers', [])[:5]
                exec_comp = []
                for officer in officers:
                    comp = {
                        'name': officer.get('name', ''),
                        'title': officer.get('title', ''),
                        'total_pay': officer.get('totalPay', {}).get('raw') if isinstance(officer.get('totalPay'), dict) else officer.get('totalPay'),
                    }
                    exec_comp.append(comp)

                cur.execute("""
                    UPDATE recipients SET
                        is_public_company = true,
                        stock_ticker = %s,
                        market_cap = %s,
                        employee_count = %s,
                        executives = %s,
                        executive_compensation = %s,
                        hq_address = %s,
                        hq_city = %s,
                        hq_state = %s,
                        hq_zip = %s,
                        hq_country = %s,
                        website = %s,
                        phone = %s,
                        yahoo_enriched_at = NOW()
                    WHERE uei = %s
                """, [
                    ticker,
                    info.get('marketCap'),
                    info.get('fullTimeEmployees'),
                    json.dumps(officers),
                    json.dumps(exec_comp),
                    info.get('address1'),
                    info.get('city'),
                    info.get('state'),
                    info.get('zip'),
                    info.get('country'),
                    info.get('website'),
                    info.get('phone'),
                    uei
                ])
                mcap = info.get('marketCap', 0) or 0
                log(5, uei[:12], f"Yahoo: {ticker} mcap=${mcap/1e9:.1f}B, {info.get('city', 'N/A')}, {info.get('state', 'N/A')}")
                enriched += 1
            except Exception as e:
                log(5, uei[:12], f"Yahoo error: {e}")
                private_batch.append((uei, name))
        else:
            # Private company: queue for AI brief
            private_batch.append((uei, name))

    # Generate AI briefs for private companies (batch of 10)
    if private_batch:
        print(f"  Generating briefs for {len(private_batch)} private companies...")

        for i in range(0, min(len(private_batch), 100), 10):  # Process up to 100 private companies per run
            batch = private_batch[i:i+10]

            prompt = """For each federal contractor, provide a 1-2 sentence description plus headquarters info.
Focus on: what they do, approximate size if known, key government clients.
Base this on publicly available information (LinkedIn, press releases, SEC filings).

Return JSON array with this structure:
[{
  "uei": "...",
  "brief": "...",
  "sources": "LinkedIn, press releases",
  "hq_city": "city or null",
  "hq_state": "state abbreviation or null",
  "website": "company website or null"
}]

Companies:
"""
            for uei, name in batch:
                prompt += f"- {name} (UEI: {uei})\n"

            try:
                response = call_claude(prompt, max_tokens=2000)
                json_match = re.search(r'\[.*\]', response, re.DOTALL)
                if json_match:
                    results = json.loads(json_match.group())
                    for item in results:
                        cur.execute("""
                            UPDATE recipients SET
                                is_public_company = false,
                                company_brief = %s,
                                brief_sources = %s,
                                hq_city = COALESCE(%s, hq_city),
                                hq_state = COALESCE(%s, hq_state),
                                website = COALESCE(%s, website),
                                yahoo_enriched_at = NOW()
                            WHERE uei = %s
                        """, [
                            item.get('brief', ''),
                            item.get('sources', 'AI summary'),
                            item.get('hq_city'),
                            item.get('hq_state'),
                            item.get('website'),
                            item.get('uei')
                        ])
                        enriched += 1
            except Exception as e:
                print(f"  Brief batch error: {e}")

            time.sleep(1)

    conn.commit()
    conn.close()
    print(f"  Enriched {enriched} companies")
    return enriched


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 6: AI SUMMARIES
# ═══════════════════════════════════════════════════════════════════════════════

def stage6_summaries(piids: List[str], dry_run: bool = False) -> int:
    """Generate AI summaries for contracts."""
    print(f"\n=== STAGE 6: AI SUMMARIES ===")

    conn = db_connect()
    cur = conn.cursor()

    # Get contracts needing summaries
    if piids:
        placeholders = ','.join(['%s'] * len(piids))
        cur.execute(f"""
            SELECT piid, description, naics_description, psc_description,
                   agency_name, recipient_name, award_amount
            FROM contracts
            WHERE piid IN ({placeholders}) AND llama_summary IS NULL
        """, piids)
    else:
        cur.execute("""
            SELECT piid, description, naics_description, psc_description,
                   agency_name, recipient_name, award_amount
            FROM contracts
            WHERE llama_summary IS NULL
            LIMIT 100
        """)

    rows = cur.fetchall()
    print(f"  Found {len(rows)} contracts needing summaries")

    if dry_run:
        print(f"  [DRY RUN] Would generate {len(rows)} summaries")
        return 0

    generated = 0

    # Batch process
    batch_size = 5
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]

        prompt = """Generate brief plain-English summaries for these federal contracts.
Each summary should be 2-3 sentences explaining what was purchased and why it matters.

Return JSON array: [{"piid": "...", "summary": "..."}]

Contracts:
"""
        for piid, desc, naics, psc, agency, recipient, amount in batch:
            amt_float = float(amount) if amount else 0
            amt_str = f"${amt_float/1e6:.1f}M" if amt_float > 1e6 else f"${amt_float:,.0f}" if amt_float else "Unknown"
            prompt += f"""
- PIID: {piid}
  Agency: {agency}
  Recipient: {recipient}
  Amount: {amt_str}
  NAICS: {naics or 'N/A'}
  PSC: {psc or 'N/A'}
  Description: {(desc or 'N/A')[:200]}
"""

        try:
            response = call_claude(prompt, max_tokens=2000)
            json_match = re.search(r'\[.*\]', response, re.DOTALL)
            if json_match:
                results = json.loads(json_match.group())
                for item in results:
                    piid = item.get('piid')
                    summary = item.get('summary', '').strip()
                    if piid and summary:
                        cur.execute(
                            "UPDATE contracts SET llama_summary = %s WHERE piid = %s",
                            [summary, piid]
                        )
                        generated += 1
                        if generated <= 5:
                            log(6, piid, f"summary: {summary[:50]}...")
        except Exception as e:
            print(f"  Summary batch error: {e}")

        time.sleep(1)

    conn.commit()
    conn.close()
    print(f"  Generated {generated} summaries")
    return generated


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 7: AWARD AGGREGATES
# ═══════════════════════════════════════════════════════════════════════════════

def stage7_aggregates(dry_run: bool = False) -> int:
    """Compute award tracking aggregates by agency/NAICS/PSC."""
    print(f"\n=== STAGE 7: AWARD AGGREGATES ===")

    conn = db_connect()
    cur = conn.cursor()

    if dry_run:
        print("  [DRY RUN] Would compute aggregates")
        return 0

    # Update recipient stats
    cur.execute("""
        UPDATE recipients r SET
            contract_count = sub.cnt,
            total_awarded = sub.total,
            top_agency = sub.top_agency
        FROM (
            SELECT
                recipient_uei,
                COUNT(*) as cnt,
                SUM(award_amount) as total,
                MODE() WITHIN GROUP (ORDER BY agency_name) as top_agency
            FROM contracts
            WHERE recipient_uei IS NOT NULL
            GROUP BY recipient_uei
        ) sub
        WHERE r.uei = sub.recipient_uei
    """)
    updated = cur.rowcount

    # Compute contracts by agency for each recipient
    cur.execute("""
        UPDATE recipients r SET
            contracts_by_agency = sub.by_agency
        FROM (
            SELECT
                recipient_uei,
                jsonb_object_agg(agency_name, cnt) as by_agency
            FROM (
                SELECT recipient_uei, agency_name, COUNT(*) as cnt
                FROM contracts
                WHERE recipient_uei IS NOT NULL AND agency_name IS NOT NULL
                GROUP BY recipient_uei, agency_name
            ) x
            GROUP BY recipient_uei
        ) sub
        WHERE r.uei = sub.recipient_uei
    """)

    # Compute contracts by NAICS
    cur.execute("""
        UPDATE recipients r SET
            contracts_by_naics = sub.by_naics
        FROM (
            SELECT
                recipient_uei,
                jsonb_object_agg(naics_code, cnt) as by_naics
            FROM (
                SELECT recipient_uei, naics_code, COUNT(*) as cnt
                FROM contracts
                WHERE recipient_uei IS NOT NULL AND naics_code IS NOT NULL
                GROUP BY recipient_uei, naics_code
            ) x
            GROUP BY recipient_uei
        ) sub
        WHERE r.uei = sub.recipient_uei
    """)

    conn.commit()
    conn.close()

    print(f"  Updated aggregates for {updated} recipients")
    return updated


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 8: SUCCESSOR DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def search_usaspending_successors(agency: str, naics: str, psc: str, end_date: str, limit: int = 20) -> list:
    """Search USASpending for potential successor contracts."""
    from datetime import datetime, timedelta

    # Search window: 6 months before to 18 months after contract end
    end_dt = datetime.strptime(end_date, '%Y-%m-%d') if isinstance(end_date, str) else end_date
    search_start = (end_dt - timedelta(days=180)).strftime('%Y-%m-%d')
    search_end = (end_dt + timedelta(days=540)).strftime('%Y-%m-%d')

    filters = {
        'award_type_codes': ['A', 'B', 'C', 'D'],
        'time_period': [{'start_date': search_start, 'end_date': search_end}],
    }

    # Add agency filter if we have it
    if agency:
        filters['agencies'] = [{'type': 'awarding', 'tier': 'toptier', 'name': agency}]

    # Add NAICS filter if we have it
    if naics:
        filters['naics_codes'] = [naics]

    body = json.dumps({
        'filters': filters,
        'fields': ['Award ID', 'Recipient Name', 'Description', 'Award Amount', 'Start Date', 'End Date'],
        'limit': limit,
        'sort': 'Award Amount',
        'order': 'desc'
    }).encode()

    req = urllib.request.Request(
        'https://api.usaspending.gov/api/v2/search/spending_by_award/',
        data=body,
        headers={'Content-Type': 'application/json', 'User-Agent': 'Awardopedia/1.0'}
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
        return data.get('results', [])
    except Exception as e:
        print(f"    USASpending search error: {e}")
        return []


def score_successor_match(original: dict, candidate: dict) -> float:
    """Score how likely a candidate is the successor to the original contract."""
    score = 0.0

    orig_end = original.get('end_date')
    cand_start = candidate.get('Start Date')

    if not orig_end or not cand_start:
        return 0.0

    # Time proximity: closer start to end = higher score (max 0.4)
    try:
        from datetime import datetime
        orig_end_dt = datetime.strptime(str(orig_end)[:10], '%Y-%m-%d')
        cand_start_dt = datetime.strptime(str(cand_start)[:10], '%Y-%m-%d')
        days_gap = abs((cand_start_dt - orig_end_dt).days)

        if days_gap <= 30:
            score += 0.4
        elif days_gap <= 90:
            score += 0.3
        elif days_gap <= 180:
            score += 0.2
        elif days_gap <= 365:
            score += 0.1
    except:
        pass

    # Description similarity (max 0.3)
    orig_desc = (original.get('description') or '').lower()
    cand_desc = (candidate.get('Description') or '').lower()

    if orig_desc and cand_desc:
        # Simple keyword overlap
        orig_words = set(re.findall(r'\b[a-z]{4,}\b', orig_desc))
        cand_words = set(re.findall(r'\b[a-z]{4,}\b', cand_desc))
        if orig_words and cand_words:
            overlap = len(orig_words & cand_words) / max(len(orig_words), 1)
            score += min(0.3, overlap * 0.5)

    # Value similarity (max 0.2)
    orig_val = float(original.get('award_amount') or 0)
    cand_val = float(candidate.get('Award Amount') or 0)

    if orig_val > 0 and cand_val > 0:
        ratio = min(orig_val, cand_val) / max(orig_val, cand_val)
        if ratio > 0.1:  # Within order of magnitude
            score += 0.2 * ratio

    # Same recipient bonus (max 0.1)
    orig_recip = (original.get('recipient_name') or '').upper()
    cand_recip = (candidate.get('Recipient Name') or '').upper()

    if orig_recip and cand_recip:
        # Check for company name overlap
        orig_parts = set(orig_recip.replace(',', '').replace('.', '').split())
        cand_parts = set(cand_recip.replace(',', '').replace('.', '').split())
        common = orig_parts & cand_parts - {'INC', 'LLC', 'CORP', 'THE', 'AND', 'OF'}
        if len(common) >= 2:
            score += 0.1

    return min(1.0, score)


def stage8_successors(limit: int = 50, dry_run: bool = False) -> int:
    """Find successor contracts for expired awards."""
    print(f"\n=== STAGE 8: SUCCESSOR DETECTION ===")

    conn = db_connect()
    cur = conn.cursor()

    # Find expired contracts without successor check
    cur.execute("""
        SELECT piid, agency_name, naics_code, psc_code, description,
               recipient_name, recipient_uei, award_amount, end_date
        FROM contracts
        WHERE end_date < CURRENT_DATE
          AND end_date > CURRENT_DATE - INTERVAL '2 years'
          AND successor_checked_at IS NULL
          AND award_amount > 100000
        ORDER BY award_amount DESC
        LIMIT %s
    """, [limit])

    contracts = cur.fetchall()
    print(f"  Found {len(contracts)} expired contracts to check")

    if dry_run:
        for row in contracts[:5]:
            print(f"  [DRY RUN] Would check: {row[0]} ({row[1]}) ended {row[8]}")
        return 0

    found = 0

    for piid, agency, naics, psc, desc, recip, uei, amount, end_date in contracts:
        # Search for potential successors
        candidates = search_usaspending_successors(
            agency=agency,
            naics=naics,
            psc=psc,
            end_date=str(end_date),
            limit=15
        )

        if not candidates:
            # Mark as checked even if nothing found
            cur.execute("""
                UPDATE contracts SET successor_checked_at = NOW()
                WHERE piid = %s
            """, [piid])
            continue

        # Score each candidate
        original = {
            'end_date': end_date,
            'description': desc,
            'recipient_name': recip,
            'award_amount': amount,
        }

        best_match = None
        best_score = 0.0

        for cand in candidates:
            # Skip if it's the same contract
            if cand.get('Award ID') == piid:
                continue

            score = score_successor_match(original, cand)
            if score > best_score:
                best_score = score
                best_match = cand

        # Only record if confidence > 0.3
        if best_match and best_score >= 0.3:
            incumbent_retained = (
                (recip or '').upper().split()[0] ==
                (best_match.get('Recipient Name') or '').upper().split()[0]
            ) if recip and best_match.get('Recipient Name') else None

            cur.execute("""
                UPDATE contracts SET
                    successor_piid = %s,
                    successor_recipient = %s,
                    successor_amount = %s,
                    successor_start_date = %s,
                    successor_confidence = %s,
                    incumbent_retained = %s,
                    successor_checked_at = NOW()
                WHERE piid = %s
            """, [
                best_match.get('Award ID'),
                best_match.get('Recipient Name'),
                best_match.get('Award Amount'),
                best_match.get('Start Date'),
                round(best_score, 2),
                incumbent_retained,
                piid
            ])

            status = "✓ retained" if incumbent_retained else "✗ lost" if incumbent_retained is False else "?"
            log(8, piid[:15], f"→ {best_match.get('Award ID')[:20]} ({status}, conf={best_score:.2f})")
            found += 1
        else:
            cur.execute("""
                UPDATE contracts SET successor_checked_at = NOW()
                WHERE piid = %s
            """, [piid])

        # Rate limit
        time.sleep(0.5)

    conn.commit()
    conn.close()

    print(f"  Found {found} likely successors out of {len(contracts)} checked")
    return found


# ═══════════════════════════════════════════════════════════════════════════════
# STAGE 9: CONGRESSIONAL LOOKUP
# ═══════════════════════════════════════════════════════════════════════════════

def _rep_from_state_district(state: str, district: str) -> Optional[str]:
    """
    State + district → representative's website URL.
    Uses GovTrack.us API (free, no key needed).
    """
    if not state or not district:
        return None

    state = state.upper().strip()

    # Handle at-large districts
    try:
        district_num = int(district)
    except (ValueError, TypeError):
        district_num = 0

    # GovTrack API for current representative
    gt_url = (f'https://www.govtrack.us/api/v2/role?current=true'
              f'&state={state}&district={district_num}&role_type=representative')

    try:
        req = urllib.request.Request(gt_url, headers={'User-Agent': 'Awardopedia/1.0'})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        objects = data.get('objects', [])
        if objects:
            return objects[0].get('website')
    except Exception:
        pass

    return None


def stage9_congress(limit: int = 500, dry_run: bool = False) -> int:
    """Lookup congress member URLs from state + district."""
    print(f"\n=== STAGE 9: CONGRESSIONAL LOOKUP ===")

    conn = db_connect()
    cur = conn.cursor()

    # Find contracts missing congress URLs where we have district data
    cur.execute("""
        SELECT piid, recipient_state, recipient_congressional_district,
               pop_state, pop_congressional_district
        FROM contracts
        WHERE (
            (recipient_congressional_district IS NOT NULL
             AND recipient_state IS NOT NULL
             AND recipient_congress_url IS NULL)
            OR
            (pop_congressional_district IS NOT NULL
             AND pop_state IS NOT NULL
             AND pop_congress_url IS NULL)
        )
        LIMIT %s
    """, [limit])

    contracts = cur.fetchall()
    print(f"  Found {len(contracts)} contracts needing congress URLs")

    if dry_run:
        for row in contracts[:5]:
            print(f"  [DRY RUN] Would lookup: {row[1]}-{row[2]} (recipient), {row[3]}-{row[4]} (PoP)")
        return 0

    # Cache lookups to avoid duplicate API calls
    cache = {}
    updated = 0

    for piid, recip_state, recip_dist, pop_state, pop_dist in contracts:
        recip_url = None
        pop_url = None

        # Lookup recipient district
        if recip_state and recip_dist:
            key = f"{recip_state}-{recip_dist}"
            if key not in cache:
                cache[key] = _rep_from_state_district(recip_state, recip_dist)
                time.sleep(0.3)  # Rate limit
            recip_url = cache[key]

        # Lookup place of performance district
        if pop_state and pop_dist:
            key = f"{pop_state}-{pop_dist}"
            if key not in cache:
                cache[key] = _rep_from_state_district(pop_state, pop_dist)
                time.sleep(0.3)  # Rate limit
            pop_url = cache[key]

        # Update if we found anything
        if recip_url or pop_url:
            cur.execute("""
                UPDATE contracts SET
                    recipient_congress_url = COALESCE(%s, recipient_congress_url),
                    pop_congress_url = COALESCE(%s, pop_congress_url)
                WHERE piid = %s
            """, [recip_url, pop_url, piid])
            updated += 1
            if updated <= 10:
                log(9, piid[:15], f"→ {recip_url or '-'} | {pop_url or '-'}")

    conn.commit()
    conn.close()

    print(f"  Updated {updated} contracts with congress URLs")
    print(f"  Cached {len(cache)} unique district lookups")
    return updated


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Contract processing pipeline')
    parser.add_argument('--limit', type=int, default=500, help='Max records to process')
    parser.add_argument('--stage', help='Run specific stages (e.g., 2-4)')
    parser.add_argument('--dry-run', action='store_true', help='Show plan, no writes')
    parser.add_argument('--fetch-new', type=int, help='Fetch N new contracts from USASpending')
    parser.add_argument('--skip-ai', action='store_true', help='Skip AI-intensive stages (2,5,6)')
    args = parser.parse_args()

    print("=" * 60)
    print("AWARDOPEDIA — CONTRACT PIPELINE")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Limit: {args.limit} | Dry run: {args.dry_run}")
    print("=" * 60)

    # Parse stage range
    stages = set(range(1, 10))  # Stages 1-9
    if args.stage:
        stages = set()
        for part in args.stage.split(','):
            if '-' in part:
                start, end = map(int, part.split('-'))
                stages.update(range(start, end + 1))
            else:
                stages.add(int(part))

    if args.skip_ai:
        stages -= {2, 5, 6}

    print(f"Stages to run: {sorted(stages)}")

    piids = []

    # Stage 1: Fetch
    if 1 in stages and args.fetch_new:
        piids = stage1_fetch(limit=args.fetch_new, dry_run=args.dry_run)
    elif 1 in stages:
        # Use existing contracts
        conn = db_connect()
        cur = conn.cursor()
        cur.execute("SELECT piid FROM contracts ORDER BY date_signed DESC NULLS LAST LIMIT %s",
                    [args.limit])
        piids = [r[0] for r in cur.fetchall()]
        conn.close()
        print(f"\nUsing {len(piids)} existing contracts")

    # Stage 2: Descriptions
    if 2 in stages:
        stage2_descriptions(piids, dry_run=args.dry_run)

    # Stage 3: Canonicals
    if 3 in stages:
        stage3_canonicals(piids, dry_run=args.dry_run)

    # Stage 4: Recipients
    if 4 in stages:
        stage4_recipients(piids, dry_run=args.dry_run)

    # Stage 5: Financials
    if 5 in stages:
        stage5_financials(limit=args.limit, dry_run=args.dry_run)

    # Stage 6: Summaries
    if 6 in stages:
        stage6_summaries(piids, dry_run=args.dry_run)

    # Stage 7: Aggregates
    if 7 in stages:
        stage7_aggregates(dry_run=args.dry_run)

    # Stage 8: Successor Detection
    if 8 in stages:
        stage8_successors(limit=args.limit, dry_run=args.dry_run)

    # Stage 9: Congressional Lookup
    if 9 in stages:
        stage9_congress(limit=args.limit, dry_run=args.dry_run)

    print("\n" + "=" * 60)
    print("PIPELINE COMPLETE")
    print("=" * 60)


if __name__ == '__main__':
    main()
