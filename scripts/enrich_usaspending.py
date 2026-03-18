#!/usr/bin/env python3
"""
enrich_usaspending.py — Pull ALL available fields from USASpending award detail
and update the contracts table with the full record.

Usage:
  python3 scripts/enrich_usaspending.py --piid FA8773-24-C-0001
  python3 scripts/enrich_usaspending.py --from-file sample_contract.json

Requires: DATABASE_URL in .env
"""

import os, sys, json, urllib.request, urllib.error
from datetime import datetime
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

# ── Fetch from USASpending ──────────────────────────────────────────────────

def fetch_award(piid: str) -> dict:
    """Fetch award detail using generated_unique_award_id format."""
    # Try direct PIID first (sometimes works)
    urls = [
        f"https://api.usaspending.gov/api/v2/awards/{piid}/",
    ]
    # Also try common generated_unique_award_id formats
    piid_clean = piid.replace('-', '')
    urls.append(f"https://api.usaspending.gov/api/v2/awards/CONT_AWD_{piid_clean}_9700_-NONE-_-NONE-/")

    for url in urls:
        try:
            print(f"Trying: {url}")
            req = urllib.request.Request(url, headers={
                "User-Agent": "Awardopedia/1.0 (awardopedia.com)",
                "Accept": "application/json"
            })
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode())
            print(f"  ✓ Got response (generated_id: {data.get('generated_unique_award_id','?')})")
            return data
        except urllib.error.HTTPError as e:
            print(f"  HTTP {e.code} — trying next")
        except Exception as e:
            print(f"  Error: {e} — trying next")

    raise RuntimeError(f"Could not fetch award for PIID {piid}")


# ── Parse all fields ────────────────────────────────────────────────────────

def parse_award(d: dict) -> dict:
    """Extract every useful field from USASpending award detail response."""
    tx = d.get('latest_transaction_contract_data') or {}
    recipient = d.get('recipient') or {}
    rec_loc = recipient.get('location') or {}
    pop = d.get('place_of_performance') or {}
    awarding = d.get('awarding_agency') or {}
    funding = d.get('funding_agency') or {}
    period = d.get('period_of_performance') or {}

    # Build the correct USASpending URL
    gen_id = d.get('generated_unique_award_id') or ''
    usaspending_url = f"https://www.usaspending.gov/award/{gen_id}" if gen_id else None

    # Verify the URL actually works (HEAD request)
    usaspending_alive = None
    if usaspending_url:
        try:
            req = urllib.request.Request(usaspending_url, method='HEAD',
                headers={"User-Agent": "Awardopedia/1.0"})
            with urllib.request.urlopen(req, timeout=10) as r:
                usaspending_alive = r.status < 400
                print(f"  USASpending URL verified: {r.status} → alive={usaspending_alive}")
        except Exception as e:
            usaspending_alive = False
            print(f"  USASpending URL check failed: {e}")

    business_categories = recipient.get('business_categories') or []

    return {
        # Identity
        'award_id':                   d.get('generated_unique_award_id'),
        'piid':                        d.get('piid'),

        # What was bought
        'description':                d.get('description'),
        'naics_code':                 tx.get('naics'),
        'naics_description':          tx.get('naics_description'),
        'psc_code':                   tx.get('product_or_service_code'),
        'psc_description':            tx.get('product_or_service_description'),
        'major_program':              tx.get('major_program'),

        # Who bought it
        'agency_name':                awarding.get('toptier_agency', {}).get('name'),
        'sub_agency_name':            awarding.get('subtier_agency', {}).get('name'),
        'office_name':                awarding.get('office_agency_name'),
        'funding_agency_name':        funding.get('toptier_agency', {}).get('name'),
        'funding_office_name':        funding.get('office_agency_name'),

        # Who won it
        'recipient_name':             recipient.get('recipient_name'),
        'recipient_uei':              recipient.get('recipient_uei'),
        'recipient_address':          rec_loc.get('address_line1'),
        'recipient_city':             rec_loc.get('city_name'),
        'recipient_state':            rec_loc.get('state_code'),
        'recipient_zip':              rec_loc.get('zip5'),
        'recipient_country':          rec_loc.get('location_country_code'),
        'recipient_county':           rec_loc.get('county_name'),
        'recipient_congressional_district': rec_loc.get('congressional_code'),
        'business_categories':        json.dumps(business_categories) if business_categories else None,
        'business_size':              'Small Business' if 'Small Business' in business_categories else None,
        'is_small_business':          'Small Business' in business_categories,

        # Place of performance (where work actually happens)
        'pop_city':                   pop.get('city_name'),
        'pop_state':                  pop.get('state_code'),
        'pop_zip':                    pop.get('zip5'),
        'pop_county':                 pop.get('county_name'),
        'pop_country':                pop.get('location_country_code'),
        'pop_congressional_district': pop.get('congressional_code'),

        # Money
        'award_amount':               d.get('total_obligation'),
        'base_amount':                d.get('base_exercised_options'),
        'ceiling_amount':             d.get('base_and_all_options'),

        # Time
        'start_date':                 period.get('start_date'),
        'end_date':                   period.get('end_date'),
        'date_signed':                d.get('date_signed'),
        'last_modified_date':         period.get('last_modified_date'),
        'fiscal_year':                int(period.get('start_date', '0-0-0').split('-')[0]) if period.get('start_date') else None,

        # How it was awarded
        'set_aside_type':             tx.get('type_set_aside_description'),
        'extent_competed':            tx.get('extent_competed_description'),
        'competition_type':           tx.get('other_than_full_and_open_description'),
        'number_of_offers':           _int(tx.get('number_of_offers_received')),
        'contract_type':              tx.get('type_of_contract_pricing_description'),
        'award_type':                 d.get('type_description'),
        'pricing_type':               tx.get('type_of_contract_pricing_description'),
        'solicitation_number':        tx.get('solicitation_identifier'),
        'solicitation_procedures':    tx.get('solicitation_procedures_description'),
        'sole_source_authority':      tx.get('other_than_full_and_open_description'),
        'commercial_item':            tx.get('commercial_item_acquisition_description'),
        'labor_standards':            tx.get('labor_standards') == 'Y',
        'subcontracting_plan':        tx.get('subcontracting_plan_description'),

        # Source / verification
        'usaspending_url':            usaspending_url,
        'usaspending_alive':          usaspending_alive,
        'usaspending_checked':        datetime.utcnow().isoformat(),
        'data_source':                'usaspending',
        'fpds_enriched':              False,   # will be True after SAM.gov enrichment
        'last_synced':                datetime.utcnow().isoformat(),
    }


def _int(v):
    try: return int(v)
    except: return None


# ── Upsert to DB ────────────────────────────────────────────────────────────

def upsert(fields: dict):
    piid = fields.pop('piid')
    cols = list(fields.keys())
    vals = list(fields.values())
    set_clause = ', '.join(f'{c} = %s' for c in cols)

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute(f"""
        UPDATE contracts SET {set_clause}
        WHERE piid = %s
    """, vals + [piid])

    if cur.rowcount == 0:
        # Insert if not found
        all_cols = ['piid'] + cols
        placeholders = ', '.join(['%s'] * len(all_cols))
        cur.execute(f"""
            INSERT INTO contracts ({', '.join(all_cols)})
            VALUES ({placeholders})
        """, [piid] + vals)
        print(f"  Inserted new record for {piid}")
    else:
        print(f"  Updated {cur.rowcount} row(s) for {piid}")

    conn.close()


# ── Main ────────────────────────────────────────────────────────────────────

def run_ollama_summary(piid: str):
    """Trigger llama_summary generation for a single PIID. Non-fatal if Ollama is down."""
    import subprocess
    script = Path(__file__).parent / 'generate_llama_summaries.py'
    try:
        result = subprocess.run(
            [sys.executable, str(script), '--piid', piid, '--force'],
            capture_output=True, text=True, timeout=90
        )
        if result.returncode == 0:
            # Extract the summary line from stdout
            for line in result.stdout.splitlines():
                if '✓' in line:
                    print(f"  Ollama: {line.strip()}")
                    return
            print("  Ollama: summary generated")
        else:
            print(f"  Ollama: failed (non-fatal) — {result.stderr[:80]}")
    except subprocess.TimeoutExpired:
        print("  Ollama: timeout (non-fatal) — run generate_llama_summaries.py manually")
    except Exception as e:
        print(f"  Ollama: error (non-fatal) — {e}")


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--piid', help='PIID to fetch and enrich')
    parser.add_argument('--from-file', help='Load from local JSON file instead of API')
    parser.add_argument('--no-summary', action='store_true', help='Skip Ollama summary generation')
    args = parser.parse_args()

    if args.from_file:
        print(f"Loading from file: {args.from_file}")
        with open(args.from_file) as f:
            raw = json.load(f)
    elif args.piid:
        raw = fetch_award(args.piid)
        out = Path(__file__).parent.parent / 'sample_contract.json'
        out.write_text(json.dumps(raw, indent=2, default=str))
        print(f"  Saved raw response → {out}")
    else:
        print("Usage: --piid PIID or --from-file path/to/file.json")
        sys.exit(1)

    print("\nParsing fields...")
    fields = parse_award(raw)

    print(f"\nFields to write ({len(fields)} total):")
    for k, v in fields.items():
        if v is not None and v is not False:
            print(f"  {k}: {str(v)[:80]}")

    print("\nWriting to DB...")
    piid = fields.get('piid') or raw.get('piid')
    upsert(fields)

    if not args.no_summary:
        print("\nGenerating Ollama summary...")
        run_ollama_summary(piid)
        print("\nGenerating static page...")
        try:
            from generate_static import generate_page_for_piid
            generate_page_for_piid(piid)
        except Exception as e:
            print(f"  [static page] skipped: {e}")

    print("\nDone. Record is fully enriched.")
