#!/usr/bin/env python3
"""
fetch_batch.py — Deterministic batch ingestion pipeline

PIPELINE (SAM.gov is the hard bottleneck):
  Step 1: ONE SAM.gov Contract Awards API call (limit=100)
          → Returns up to 100 contracts WITH contracting officer data
  Step 2: For each PIID → fetch full detail from USASpending (no rate limit)
          → Returns 58 fields: amounts, dates, business categories, place of performance, etc.
  Step 3: Merge SAM.gov CO data + USASpending fields → complete record
  Step 4: Upsert all records to DB
  Step 5: Ollama generates llama_summary for each new record (~4s/record, ~7 min/100)

RATE LIMIT RULES (see DEV_NOTES.md):
  - Personal API key, no role: 10 calls/day  ← CURRENT STATE
  - Personal API key, with any SAM.gov role: 1,000 calls/day  ← GET THIS FIRST
  - This script makes EXACTLY ONE SAM.gov call per run. Do not add more.
  - Never call SAM.gov more than once per run, ever.

USAGE:
  python3 scripts/fetch_batch.py                    # run with defaults
  python3 scripts/fetch_batch.py --dry-run          # show what would be fetched, don't write DB
  python3 scripts/fetch_batch.py --query "naics:541512 AND typeOfSetAside:8AN"  # custom query
  python3 scripts/fetch_batch.py --no-summary       # skip Ollama (faster, fill in later)

PREREQUISITES:
  - SAM_API_KEY in .env (sam.gov → Account Details → Public API Key)
  - DATABASE_URL in .env
  - Ollama running locally: ollama serve (unless --no-summary)
  - Role requested in SAM.gov for 1,000/day limit (sam.gov → Workspace → Request a Role)
"""

import os, sys, json, time, urllib.request, urllib.error, subprocess
from pathlib import Path
from datetime import datetime

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

if not SAM_API_KEY:
    print("✗ SAM_API_KEY not set in .env — cannot proceed")
    sys.exit(1)

# ── Configuration ─────────────────────────────────────────────────────────────

# The ONE SAM.gov call. Adjust the query, never add more calls.
#
# Query syntax (FPDS section-based):
#   AND = space or + between terms
#   OR  = ~ between values  e.g. naics:541330~541512
#   NOT = ! prefix
#
# Good fields to filter on:
#   naics:{code}                    — NAICS code
#   typeOfSetAside:{code}           — 8AN=8(a) sole source, SBA=small biz, SDVOSB, WOSB, HZC
#   contractActionType:{code}       — D=definitive contract, A=BPA call, etc.
#   signedDate:[YYYYMMDD,YYYYMMDD]  — date range
#   dollarObligated:[min,max]       — amount range
#   fundedByAgencyID:{code}         — 9700=DoD, 4700=GSA, 7500=HHS
#
# Default: definitive contracts, most recently signed first (T-100).
# No NAICS, no set-aside, no date range — just time-ordered definitive contracts.
# Sort by -signedDate is added to the URL in fetch_sam_batch().

SAM_QUERY = "contractActionType:D"

SAM_LIMIT = 100   # max per call — do not exceed 100
SAM_URL   = "https://api.sam.gov/contract-awards/v1/search"

# ── SAM.gov fetch (the ONE call) ──────────────────────────────────────────────

def fetch_sam_batch(query: str, limit: int, dry_run: bool = False) -> list:
    """
    Make exactly ONE call to the SAM.gov Contract Awards API.
    Returns a list of raw contract dicts including CO data.
    Saves raw response to data/sam_batch_latest.json for inspection.
    """
    # Note: SAM.gov Contract Awards API does not support custom sortBy.
    # Records are returned in the API's default order.
    # We filter to definitive contracts (contractActionType:D) only.
    url = f"{SAM_URL}?api_key={SAM_API_KEY}&q={urllib.parse.quote(query)}&limit={limit}"

    print(f"\n{'[DRY RUN] ' if dry_run else ''}SAM.gov Contract Awards API (1 call):")
    print(f"  Query: {query}")
    print(f"  Limit: {limit}")
    print(f"  URL:   {SAM_URL}?api_key=***&q={urllib.parse.quote(query)}&limit={limit}")

    if dry_run:
        print("  [DRY RUN] Would make this call. Run without --dry-run to execute.")
        return []

    req = urllib.request.Request(url, headers={"User-Agent": "Awardopedia/1.0 (awardopedia.com)"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        print(f"  ✗ HTTP {e.code}: {body}")
        if e.code == 429:
            print("  Rate limit hit. Resets at midnight UTC (6pm Mountain).")
            print("  Also: request a Role at sam.gov for 1,000/day limit.")
        sys.exit(1)

    # Save raw response for inspection
    out_dir = Path(__file__).parent.parent / 'data'
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / 'sam_batch_latest.json'
    out_path.write_text(json.dumps(data, indent=2, default=str))
    print(f"  Raw response saved → {out_path}")

    # Handle both list and dict responses
    records = []
    if isinstance(data, list):
        records = data
    elif isinstance(data, dict):
        # Common patterns: data['contractData'], data['results'], data['_embedded'], etc.
        for key in ['awardSummary', 'contractData', 'results', 'data', 'contracts', '_embedded']:
            if key in data:
                val = data[key]
                records = val if isinstance(val, list) else list(val.values())[0] if isinstance(val, dict) else []
                break
        if not records and 'totalRecords' in data:
            # Response is the container itself
            records = data.get('opportunitiesData', data.get('items', []))

    print(f"  ✓ Got {len(records)} records from SAM.gov")

    # Log first record structure so we know field names
    if records:
        print(f"\n  First record keys: {list(records[0].keys())[:15]}")

    return records


def extract_co_data(sam_record: dict) -> dict:
    """
    Extract contracting officer fields from a SAM.gov Contract Awards record.
    Field names may vary — we try multiple known patterns from FPDS data schema.
    Logs any unknown structure to help us adapt.
    """
    co = {}

    # Try known FPDS field name patterns
    # Pattern 1: flat fields
    co['contracting_officer'] = (
        sam_record.get('contractingOfficerName') or
        sam_record.get('co_name') or
        sam_record.get('contractingOfficer') or
        _nested(sam_record, 'contractingOfficer', 'name') or
        _nested(sam_record, 'officer', 'fullName')
    )

    co['contracting_officer_email'] = (
        sam_record.get('contractingOfficerEmail') or
        sam_record.get('co_email') or
        _nested(sam_record, 'contractingOfficer', 'email') or
        _nested(sam_record, 'officer', 'email')
    )

    co['contracting_officer_phone'] = (
        sam_record.get('contractingOfficerPhone') or
        sam_record.get('co_phone') or
        _nested(sam_record, 'contractingOfficer', 'phone') or
        _nested(sam_record, 'officer', 'phone')
    )

    co['piid'] = (
        sam_record.get('piid') or
        # awardSummary nested structure
        _nested(sam_record, 'contractId', 'piid') or
        sam_record.get('contractNumber') or
        sam_record.get('award_id') or
        sam_record.get('id')
    )

    return co


def _nested(d: dict, *keys):
    """Safely traverse nested dict."""
    for k in keys:
        if not isinstance(d, dict): return None
        d = d.get(k)
    return d


# ── USASpending fetch (unlimited calls) ───────────────────────────────────────

def fetch_usaspending(piid: str) -> dict | None:
    """Fetch full award detail from USASpending. No rate limit."""
    urls = [
        f"https://api.usaspending.gov/api/v2/awards/{piid}/",
    ]
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Awardopedia/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            pass
    return None


# ── Import enrich logic from enrich_usaspending.py ────────────────────────────

sys.path.insert(0, str(Path(__file__).parent))
from enrich_usaspending import parse_award, upsert, run_ollama_summary


# ── DB: add CO columns if missing ─────────────────────────────────────────────

def ensure_co_columns():
    """Add CO email/phone columns if they don't exist yet."""
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    cur = conn.cursor()
    for col, typ in [
        ('contracting_officer_email', 'VARCHAR(255)'),
        ('contracting_officer_phone', 'VARCHAR(50)'),
    ]:
        try:
            cur.execute(f"ALTER TABLE contracts ADD COLUMN IF NOT EXISTS {col} {typ}")
        except Exception:
            pass
    conn.close()


# ── Main pipeline ─────────────────────────────────────────────────────────────

def main():
    import argparse, urllib.parse

    parser = argparse.ArgumentParser(description='Deterministic batch ingestion pipeline')
    parser.add_argument('--dry-run', action='store_true', help='Show plan, do not write DB')
    parser.add_argument('--query', default=SAM_QUERY, help='SAM.gov FPDS query string')
    parser.add_argument('--limit', type=int, default=SAM_LIMIT, help='Max records (≤100)')
    parser.add_argument('--no-summary', action='store_true', help='Skip Ollama summaries')
    args = parser.parse_args()

    if args.limit > 100:
        print("✗ Limit cannot exceed 100 (SAM.gov API max per call)")
        sys.exit(1)

    print("=" * 60)
    print("AWARDOPEDIA BATCH INGESTION PIPELINE")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    print("\n⚠️  SAM.gov rate limit reminder:")
    print("   No role:    10 calls/day")
    print("   With role: 1,000 calls/day  ← request at sam.gov → Workspace → Request a Role")
    print("   This script makes EXACTLY ONE SAM.gov call per run.")

    # Ensure DB has CO columns
    if not args.dry_run:
        ensure_co_columns()

    # ── STEP 1: ONE SAM.gov call ──────────────────────────────────────────────
    sam_records = fetch_sam_batch(args.query, args.limit, dry_run=args.dry_run)

    if not sam_records:
        if not args.dry_run:
            print("\nNo records returned from SAM.gov. Check query or rate limit.")
        return

    # ── STEPS 2-5: For each record ────────────────────────────────────────────
    success, skipped, errors = 0, 0, 0

    for i, sam_rec in enumerate(sam_records, 1):
        co = extract_co_data(sam_rec)
        piid = co.get('piid')

        if not piid:
            print(f"\n[{i}/{len(sam_records)}] ✗ No PIID found — skipping")
            print(f"  Record keys: {list(sam_rec.keys())[:10]}")
            skipped += 1
            continue

        print(f"\n[{i}/{len(sam_records)}] {piid}")

        if args.dry_run:
            print(f"  Would fetch USASpending + merge CO data + upsert + summarize")
            continue

        # Step 2: USASpending full detail
        print(f"  Fetching USASpending...")
        raw = fetch_usaspending(piid)
        if not raw:
            print(f"  ✗ Not found on USASpending — skipping")
            skipped += 1
            continue

        # Step 3: Parse + merge
        try:
            fields = parse_award(raw)
        except Exception as e:
            print(f"  ✗ Parse error: {e}")
            errors += 1
            continue

        # Merge in CO data from SAM.gov
        if co.get('contracting_officer'):
            fields['contracting_officer'] = co['contracting_officer']
            print(f"  CO: {co['contracting_officer']}")
        if co.get('contracting_officer_email'):
            fields['contracting_officer_email'] = co['contracting_officer_email']
            print(f"  Email: {co['contracting_officer_email']}")
        if co.get('contracting_officer_phone'):
            fields['contracting_officer_phone'] = co['contracting_officer_phone']

        fields['fpds_enriched'] = True

        # Step 4: Upsert
        try:
            upsert(fields)
            print(f"  ✓ Upserted")
            success += 1
        except Exception as e:
            print(f"  ✗ DB error: {e}")
            errors += 1
            continue

        # Step 5: Ollama summary
        if not args.no_summary:
            run_ollama_summary(piid)

        # Small pause to be kind
        time.sleep(0.3)

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"COMPLETE: {success} inserted, {skipped} skipped, {errors} errors")
    print(f"Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    if success > 0 and not args.no_summary:
        print(f"Summaries: {success} Ollama summaries generated")
    print("=" * 60)


if __name__ == '__main__':
    main()
