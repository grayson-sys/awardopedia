#!/usr/bin/env python3
"""
Awardopedia — Initial CSV Ingestion
Streams USASpending contract CSV (5-15GB) in chunks.
NEVER loads the full CSV into memory or context.
Progress written to ingestion_progress.json.
Usage: python3 ingest.py --file /path/to/contracts.csv
"""
import os, sys, csv, json, time, argparse, psycopg2
from datetime import datetime, date
from pathlib import Path

PROGRESS_FILE = Path(__file__).parent / "ingestion_progress.json"
BATCH_SIZE = 500

def save_progress(data: dict):
    data["last_updated"] = datetime.now().isoformat()
    with open(PROGRESS_FILE, "w") as f:
        json.dump(data, f, indent=2)

def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"rows_processed": 0, "rows_inserted": 0, "rows_skipped": 0,
            "errors": 0, "status": "not_started", "last_updated": None}

def parse_money(val: str) -> float | None:
    if not val or val.strip() in ("", "N/A", "NULL"): return None
    try: return float(val.replace(",", "").replace("$", "").strip())
    except: return None

def parse_date(val: str) -> date | None:
    if not val or val.strip() in ("", "N/A", "NULL"): return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y%m%d"):
        try: return datetime.strptime(val.strip(), fmt).date()
        except: continue
    return None

# USASpending CSV column mapping (field name → our column)
COL_MAP = {
    "award_id_piid":                    "award_id_piid",
    "parent_award_id_piid":             "parent_award_piid",
    "award_type":                       "award_type",
    "action_type":                      "action_type",
    "awarding_agency_code":             "awarding_agency_code",
    "awarding_agency_name":             "agency_name",
    "awarding_sub_agency_name":         "sub_agency_name",
    "awarding_office_name":             "office_name",
    "funding_agency_code":              "funding_agency_code",
    "recipient_uei":                    "recipient_uei",
    "recipient_duns":                   "recipient_duns",
    "recipient_name":                   "recipient_name",
    "recipient_city_name":              "recipient_city",
    "recipient_state_code":             "recipient_state",
    "recipient_zip_4_code":             "recipient_zip",
    "recipient_country_code":           "recipient_country",
    "federal_action_obligation":        "federal_action_obligation",
    "current_total_value_of_award":     "current_total_value",
    "potential_total_value_of_award":   "potential_total_value",
    "action_date":                      "action_date",
    "period_of_performance_start_date": "period_of_performance_start",
    "period_of_performance_current_end_date": "period_of_performance_current_end",
    "naics_code":                       "naics_code",
    "naics_description":                "naics_description",
    "product_or_service_code":          "psc_code",
    "product_or_service_code_description": "psc_description",
    "type_of_contract_pricing":         "contract_type",
    "award_description":                "description",
    "place_of_performance_city_name":   "place_of_performance_city",
    "place_of_performance_state_code":  "place_of_performance_state",
    "place_of_performance_zip_4":       "place_of_performance_zip",
    "unique_award_key":                 "usaspending_id",
}

INSERT_SQL = """
INSERT INTO awards (
    award_id_piid, parent_award_piid, award_type, action_type,
    awarding_agency_code, agency_name, sub_agency_name, office_name, funding_agency_code,
    recipient_uei, recipient_duns, recipient_name, recipient_city, recipient_state,
    recipient_zip, recipient_country,
    federal_action_obligation, current_total_value, potential_total_value,
    action_date, period_of_performance_start, period_of_performance_current_end,
    naics_code, naics_description, psc_code, psc_description, contract_type,
    description, place_of_performance_city, place_of_performance_state,
    place_of_performance_zip, usaspending_id, usaspending_url
) VALUES (
    %(award_id_piid)s, %(parent_award_piid)s, %(award_type)s, %(action_type)s,
    %(awarding_agency_code)s, %(agency_name)s, %(sub_agency_name)s, %(office_name)s, %(funding_agency_code)s,
    %(recipient_uei)s, %(recipient_duns)s, %(recipient_name)s, %(recipient_city)s, %(recipient_state)s,
    %(recipient_zip)s, %(recipient_country)s,
    %(federal_action_obligation)s, %(current_total_value)s, %(potential_total_value)s,
    %(action_date)s, %(period_of_performance_start)s, %(period_of_performance_current_end)s,
    %(naics_code)s, %(naics_description)s, %(psc_code)s, %(psc_description)s, %(contract_type)s,
    %(description)s, %(place_of_performance_city)s, %(place_of_performance_state)s,
    %(place_of_performance_zip)s, %(usaspending_id)s, %(usaspending_url)s
)
ON CONFLICT (usaspending_id) DO UPDATE SET
    federal_action_obligation = EXCLUDED.federal_action_obligation,
    current_total_value = EXCLUDED.current_total_value,
    potential_total_value = EXCLUDED.potential_total_value,
    period_of_performance_current_end = EXCLUDED.period_of_performance_current_end,
    updated_at = NOW();
"""

def build_url(row: dict) -> str:
    uid = row.get("usaspending_id", "")
    if uid: return f"https://www.usaspending.gov/award/{uid}"
    piid = row.get("award_id_piid", "")
    if piid: return f"https://www.usaspending.gov/search/?hash=award_id_piid:{piid}"
    return ""

def map_row(headers: list[str], values: list[str]) -> dict:
    raw = dict(zip(headers, values))
    row = {}
    for csv_col, db_col in COL_MAP.items():
        val = raw.get(csv_col, "").strip() or None
        row[db_col] = val

    # Type coercions
    for money_col in ("federal_action_obligation", "current_total_value", "potential_total_value"):
        row[money_col] = parse_money(row.get(money_col) or "")
    for date_col in ("action_date", "period_of_performance_start", "period_of_performance_current_end"):
        row[date_col] = parse_date(row.get(date_col) or "")

    row["usaspending_url"] = build_url(row)
    row.setdefault("recipient_country", "USA")
    return row

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, help="Path to USASpending CSV")
    parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    parser.add_argument("--limit", type=int, default=0, help="Stop after N rows (0=all)")
    args = parser.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set"); sys.exit(1)

    progress = load_progress() if args.resume else {
        "rows_processed": 0, "rows_inserted": 0, "rows_skipped": 0,
        "errors": 0, "status": "running", "file": args.file
    }
    progress["status"] = "running"
    save_progress(progress)

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    start_time = time.time()
    batch = []
    skip_rows = progress["rows_processed"] if args.resume else 0

    print(f"Starting ingestion: {args.file}")
    print(f"Resuming from row: {skip_rows}" if skip_rows else "Starting fresh")

    try:
        with open(args.file, newline="", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            headers = [h.lower().strip() for h in next(reader)]
            print(f"Columns detected: {len(headers)}")

            for i, values in enumerate(reader):
                if i < skip_rows: continue
                if args.limit and i >= skip_rows + args.limit: break

                try:
                    row = map_row(headers, values)
                    if not row.get("usaspending_id") and not row.get("award_id_piid"):
                        progress["rows_skipped"] += 1
                        continue
                    batch.append(row)
                except Exception as e:
                    progress["errors"] += 1
                    continue

                if len(batch) >= BATCH_SIZE:
                    try:
                        cur.executemany(INSERT_SQL, batch)
                        conn.commit()
                        progress["rows_inserted"] += len(batch)
                    except Exception as e:
                        conn.rollback()
                        progress["errors"] += len(batch)
                        print(f"Batch error at row {i}: {e}")
                    batch = []
                    progress["rows_processed"] = i + 1

                    # Progress report every 10k rows
                    if (i + 1) % 10000 == 0:
                        elapsed = time.time() - start_time
                        rate = (i + 1 - skip_rows) / elapsed
                        print(f"Row {i+1:,} | inserted={progress['rows_inserted']:,} "
                              f"| errors={progress['errors']} | {rate:.0f} rows/sec")
                        save_progress(progress)

        # Final batch
        if batch:
            cur.executemany(INSERT_SQL, batch)
            conn.commit()
            progress["rows_inserted"] += len(batch)
            progress["rows_processed"] += len(batch)

    except KeyboardInterrupt:
        print("\nInterrupted — progress saved")
    finally:
        progress["status"] = "complete" if not batch else "interrupted"
        save_progress(progress)
        cur.close()
        conn.close()

    elapsed = time.time() - start_time
    print(f"\nDone in {elapsed:.0f}s — {progress['rows_inserted']:,} rows inserted, "
          f"{progress['errors']} errors")
    save_progress(progress)

if __name__ == "__main__":
    main()
