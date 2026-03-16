"""
Awardopedia — USASpending.gov Ingest Pipeline v2
Streams contract awards from the USASpending API and upserts into PostgreSQL.

Key design decisions:
- Streaming: never loads full result set into memory (BATCH_SIZE rows at a time)
- Source attribution: every row gets source_url, solicitation_url, source_fetched_at
- Geography: place_of_performance fields captured for map drill-down
- Sector: derived from PSC code → psc_sector_map, fallback to NAICS → naics_sector_map
- Confidence: 1.0 for structured API data, lower for scraped/AI-extracted
- Upsert: safe to re-run; updates existing rows on conflict

Run modes:
  python ingest.py                  # last 7 days
  python ingest.py --days 30        # last 30 days
  python ingest.py --full           # full reload (slow — millions of rows)
  python ingest.py --dry-run        # print first batch, no DB writes
"""

import os, sys, json, time, logging, argparse
from datetime import datetime, timedelta, timezone
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import HTTPError
import psycopg2
from psycopg2.extras import execute_values

# ── Config ────────────────────────────────────────────────────
USASPENDING_API  = "https://api.usaspending.gov/api/v2/search/spending_by_award/"
AWARD_DETAIL_URL = "https://www.usaspending.gov/award/{award_id}/"
SAM_SOLICITATION = "https://sam.gov/opp/{solicitation_id}/view"
BATCH_SIZE       = 100   # USASpending API max is 100/page
REQUEST_DELAY    = 0.5   # seconds between USASpending API pages (be a good citizen)
SOURCE_SYSTEM    = "usaspending_api"
CONFIDENCE       = 1.0   # structured API = full confidence

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("ingest")

# ── PSC → sector mapping (mirrors migration_v2.sql) ───────────
# First try 2-char prefix, then 1-char prefix
PSC_SECTOR = {
    # 2-char numeric buckets
    **{str(n): 'defense'        for n in range(10, 20)},
    **{str(n): 'transportation' for n in [14,15,16,19,23,24,25,26,48,49]},
    **{str(n): 'supplies'       for n in range(30, 50)},
    **{str(n): 'facilities'     for n in [40,41,42,43,44,45,46,47]},
    **{str(n): 'technology'     for n in range(58, 80)},
    **{str(n): 'healthcare'     for n in [65]},
    **{str(n): 'research'       for n in [66,67]},
    **{str(n): 'energy'         for n in [68,91]},
    **{str(n): 'supplies'       for n in range(80, 90)},
    '95': 'construction', '99': 'supplies',
    # 1-char letter buckets
    'A': 'research',      'B': 'research',
    'C': 'construction',  'D': 'technology',
    'F': 'energy',        'H': 'construction',
    'J': 'facilities',    'K': 'professional',
    'L': 'professional',  'M': 'professional',
    'N': 'professional',  'P': 'facilities',
    'Q': 'healthcare',    'R': 'professional',
    'S': 'facilities',    'T': 'professional',
    'U': 'education',     'V': 'transportation',
    'X': 'facilities',    'Y': 'construction',
    'Z': 'construction',
}

NAICS_SECTOR = {
    '11': 'supplies',      '21': 'energy',       '22': 'energy',
    '23': 'construction',  '31': 'supplies',      '32': 'supplies',
    '33': 'supplies',      '42': 'supplies',      '44': 'supplies',
    '45': 'supplies',      '48': 'transportation','49': 'transportation',
    '51': 'technology',    '52': 'professional',  '53': 'facilities',
    '54': 'professional',  '55': 'professional',  '56': 'facilities',
    '61': 'education',     '62': 'healthcare',    '71': 'other',
    '72': 'other',         '81': 'professional',  '92': 'other',
}

def psc_to_sector(psc_code: str | None, naics_code: str | None) -> str:
    """Derive human-readable sector slug from PSC, falling back to NAICS."""
    if psc_code:
        p = psc_code.strip().upper()
        # Try 2-char numeric prefix first
        if p[:2].isdigit() and p[:2] in PSC_SECTOR:
            return PSC_SECTOR[p[:2]]
        # Try 1-char letter prefix
        if p[:1].isalpha() and p[:1] in PSC_SECTOR:
            return PSC_SECTOR[p[:1]]
    if naics_code:
        n = str(naics_code).strip()[:2]
        if n in NAICS_SECTOR:
            return NAICS_SECTOR[n]
    return 'other'

# ── USASpending API ───────────────────────────────────────────

FIELDS = [
    "Award ID", "Recipient Name", "Recipient UEI",
    "Start Date", "End Date", "Award Amount",
    "Awarding Agency", "Awarding Sub Agency", "Funding Agency",
    "NAICS Code", "NAICS Description", "PSC Code", "PSC Description",
    "Award Description", "Award Type",
    "Place of Performance State Code", "Place of Performance State",
    "Place of Performance County Code", "Place of Performance County Name",
    "Place of Performance City Name", "Place of Performance Zip5",
    "Solicitation ID", "generated_internal_id",
]

def fetch_page(date_start: str, date_end: str, cursor: dict | None = None) -> dict:
    payload = {
        "filters": {
            "time_period": [{"start_date": date_start, "end_date": date_end}],
            "award_type_codes": ["A","B","C","D"]
        },
        "fields":    FIELDS,
        "limit":     min(BATCH_SIZE, 100),
        "sort":      "Award Amount",
        "order":     "desc",
        "subawards": False,
    }
    # Cursor-based pagination (USASpending style)
    if cursor:
        payload["last_record_unique_id"]   = cursor["last_record_unique_id"]
        payload["last_record_sort_value"]  = cursor["last_record_sort_value"]
    body = json.dumps(payload).encode()
    req = Request(USASPENDING_API, data=body,
                  headers={"Content-Type": "application/json",
                           "User-Agent": "Awardopedia/1.0 (awardopedia.com; data@awardopedia.com)"})
    for attempt in range(3):
        try:
            with urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except (HTTPError, Exception) as e:
            if attempt == 2:
                raise
            log.warning(f"Attempt {attempt+1} failed: {e} — retrying in 5s")
            time.sleep(5)

def build_source_url(award_id: str | None, internal_id: str | None) -> str | None:
    """Direct link to the award on USASpending.gov."""
    if internal_id:
        return f"https://www.usaspending.gov/award/{internal_id}/"
    if award_id:
        return f"https://www.usaspending.gov/search/?hash={award_id}"
    return None

def build_solicitation_url(solicitation_id: str | None) -> str | None:
    """Link to the solicitation on SAM.gov (if available)."""
    if solicitation_id:
        clean = solicitation_id.strip()
        if clean:
            return f"https://sam.gov/opp/{clean}/view"
    return None

def map_row(r: dict, fetched_at: str) -> dict:
    """Map a USASpending API row to the awards table schema."""
    piid          = r.get("Award ID")
    internal_id   = r.get("generated_internal_id")
    naics_code    = r.get("NAICS Code")
    psc_code      = r.get("PSC Code")
    naics_str     = str(naics_code) if naics_code else None
    pop_state     = r.get("Place of Performance State Code")
    pop_city      = r.get("Place of Performance City Name")
    pop_zip       = r.get("Place of Performance Zip5")
    solicitation  = r.get("Solicitation ID")
    description   = r.get("Award Description") or ""
    psc_desc      = r.get("PSC Description") or ""
    sector        = psc_to_sector(psc_code, naics_str)
    source_url    = build_source_url(piid, internal_id)
    keywords      = list({w.lower() for w in (description + " " + psc_desc).split()
                          if len(w) > 3 and w.isalpha()})[:20]
    return {
        # Core identifiers
        "award_id_piid":                  piid,
        "usaspending_id":                 internal_id or piid,
        "usaspending_url":                source_url,
        # Recipient
        "recipient_name":                 r.get("Recipient Name"),
        "recipient_uei":                  r.get("Recipient UEI"),
        "recipient_duns":                 r.get("Recipient DUNS"),
        # Amounts
        "federal_action_obligation":      r.get("Award Amount") or 0,
        # Dates
        "period_of_performance_start":    r.get("Start Date"),
        "period_of_performance_current_end": r.get("End Date"),
        # Agency
        "agency_name":                    r.get("Awarding Agency"),
        "sub_agency_name":                r.get("Awarding Sub Agency"),
        # Classification
        "naics_code":                     naics_str,
        "naics_description":              r.get("NAICS Description"),
        "psc_code":                       psc_code,
        "psc_description":                psc_desc or None,
        "contract_type":                  r.get("Award Type"),
        "sector_slug":                    sector,
        # Place of performance (both old + new columns)
        "place_of_performance_state":     pop_state,
        "place_of_performance_city":      pop_city,
        "place_of_performance_zip":       pop_zip,
        "pop_state_code":                 pop_state,
        "pop_state_name":                 r.get("Place of Performance State"),
        "pop_county_fips":                r.get("Place of Performance County Code"),
        "pop_county_name":                r.get("Place of Performance County Name"),
        "pop_city_name":                  pop_city,
        "pop_zip":                        pop_zip,
        # Source attribution
        "source_url":                     source_url,
        "solicitation_url":               build_solicitation_url(solicitation),
        "source_system":                  SOURCE_SYSTEM,
        "source_fetched_at":              fetched_at,
        "confidence":                     CONFIDENCE,
        # Jurisdiction
        "jurisdiction_type":              "federal",
        "jurisdiction_fips":              "US",
        # Discovery
        "description":                    description or None,
        "keywords":                       json.dumps(keywords),
        "tags":                           json.dumps([]),
    }

UPSERT_SQL = """
INSERT INTO awards (
  award_id_piid, usaspending_id, usaspending_url,
  recipient_name, recipient_uei, recipient_duns,
  federal_action_obligation,
  period_of_performance_start, period_of_performance_current_end,
  agency_name, sub_agency_name,
  naics_code, naics_description, psc_code, psc_description,
  contract_type, sector_slug,
  place_of_performance_state, place_of_performance_city, place_of_performance_zip,
  pop_state_code, pop_state_name, pop_county_fips, pop_county_name,
  pop_city_name, pop_zip,
  source_url, solicitation_url, source_system, source_fetched_at, confidence,
  jurisdiction_type, jurisdiction_fips,
  description, keywords, tags
) VALUES %s
ON CONFLICT (usaspending_id) DO UPDATE SET
  recipient_name                   = EXCLUDED.recipient_name,
  federal_action_obligation        = EXCLUDED.federal_action_obligation,
  period_of_performance_current_end = EXCLUDED.period_of_performance_current_end,
  description                      = COALESCE(EXCLUDED.description, awards.description),
  psc_code                         = COALESCE(EXCLUDED.psc_code, awards.psc_code),
  psc_description                  = COALESCE(EXCLUDED.psc_description, awards.psc_description),
  sector_slug                      = EXCLUDED.sector_slug,
  pop_state_code                   = COALESCE(EXCLUDED.pop_state_code, awards.pop_state_code),
  pop_county_fips                  = COALESCE(EXCLUDED.pop_county_fips, awards.pop_county_fips),
  pop_city_name                    = COALESCE(EXCLUDED.pop_city_name, awards.pop_city_name),
  source_url                       = COALESCE(EXCLUDED.source_url, awards.source_url),
  solicitation_url                 = COALESCE(EXCLUDED.solicitation_url, awards.solicitation_url),
  source_fetched_at                = EXCLUDED.source_fetched_at,
  keywords                         = EXCLUDED.keywords
"""

COLUMNS = [
  "award_id_piid","usaspending_id","usaspending_url",
  "recipient_name","recipient_uei","recipient_duns",
  "federal_action_obligation",
  "period_of_performance_start","period_of_performance_current_end",
  "agency_name","sub_agency_name",
  "naics_code","naics_description","psc_code","psc_description",
  "contract_type","sector_slug",
  "place_of_performance_state","place_of_performance_city","place_of_performance_zip",
  "pop_state_code","pop_state_name","pop_county_fips","pop_county_name",
  "pop_city_name","pop_zip",
  "source_url","solicitation_url","source_system","source_fetched_at","confidence",
  "jurisdiction_type","jurisdiction_fips",
  "description","keywords","tags",
]

def run(date_start: str, date_end: str, dry_run: bool = False):
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        # Try loading from .env
        env_path = os.path.join(os.path.dirname(__file__), "../.env")
        if os.path.exists(env_path):
            for line in open(env_path):
                if line.startswith("DATABASE_URL="):
                    db_url = line.split("=", 1)[1].strip()
    if not db_url:
        sys.exit("DATABASE_URL not set")

    conn = None if dry_run else psycopg2.connect(db_url)
    fetched_at = datetime.now(timezone.utc).isoformat()

    total_inserted = 0
    page = 0
    cursor = None

    log.info(f"Ingesting {date_start} → {date_end}  |  batch={BATCH_SIZE}  dry_run={dry_run}")

    while True:
        page += 1
        log.info(f"  Page {page} (cursor={'yes' if cursor else 'start'})…")
        data = fetch_page(date_start, date_end, cursor)
        results = data.get("results", [])

        if not results:
            log.info("  No more results.")
            break

        if dry_run:
            log.info(f"  DRY RUN — first row sample:")
            sample = map_row(results[0], fetched_at)
            for k, v in sample.items():
                log.info(f"    {k:25s} = {v!r}")
            break

        rows = [tuple(map_row(r, fetched_at).get(c) for c in COLUMNS) for r in results]

        with conn.cursor() as cur:
            execute_values(cur, UPSERT_SQL, rows)
            conn.commit()

        total_inserted += len(rows)
        log.info(f"  Page {page}: {len(rows)} rows upserted  (total: {total_inserted})")

        # Advance cursor
        meta = data.get("page_metadata", {})
        if not meta.get("hasNext", False):
            break
        cursor = {
            "last_record_unique_id":  meta["last_record_unique_id"],
            "last_record_sort_value": meta["last_record_sort_value"],
        }
        time.sleep(REQUEST_DELAY)

    if conn:
        conn.close()

    log.info(f"Done. {total_inserted} rows processed.")
    return total_inserted

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Awardopedia USASpending ingest")
    parser.add_argument("--days",    type=int, default=7,    help="Days to look back (default 7)")
    parser.add_argument("--full",    action="store_true",    help="Full reload (ignores --days)")
    parser.add_argument("--dry-run", action="store_true",    help="Fetch one page, print, no DB writes")
    parser.add_argument("--start",   type=str,               help="Override start date YYYY-MM-DD")
    parser.add_argument("--end",     type=str,               help="Override end date YYYY-MM-DD")
    args = parser.parse_args()

    today = datetime.now().strftime("%Y-%m-%d")
    if args.start and args.end:
        date_start, date_end = args.start, args.end
    elif args.full:
        date_start = "2000-01-01"
        date_end   = today
        log.warning("FULL RELOAD — this will take hours and pull millions of rows")
    else:
        date_start = (datetime.now() - timedelta(days=args.days)).strftime("%Y-%m-%d")
        date_end   = today

    run(date_start, date_end, dry_run=args.dry_run)
