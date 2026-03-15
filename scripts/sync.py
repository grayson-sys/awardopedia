#!/usr/bin/env python3
"""
Awardopedia — Weekly USASpending API Sync
Fetches awards from the last 7 days via the USASpending API and upserts into the database.
Intended to run as a weekly cron job.

Usage: python3 sync.py
Env: DATABASE_URL must be set
"""
import os
import sys
import json
import time
import urllib.request
import urllib.error
import psycopg2
from datetime import datetime, timedelta

API_BASE = "https://api.usaspending.gov/api/v2"
BATCH_SIZE = 100
MAX_PAGES = 50

def fetch_awards(page, date_from, date_to):
    """Fetch a page of awards from USASpending API."""
    url = f"{API_BASE}/search/spending_by_award/"
    payload = json.dumps({
        "filters": {
            "time_period": [{"start_date": date_from, "end_date": date_to}],
            "award_type_codes": ["A", "B", "C", "D"],
        },
        "fields": [
            "Award ID", "Recipient Name", "Action Date", "Total Obligation",
            "Awarding Agency", "Awarding Sub Agency", "Award Type",
            "recipient_id", "internal_id", "generated_internal_id",
            "Description", "Period of Performance Start Date",
            "Period of Performance Current End Date", "NAICS Code",
            "NAICS Description", "Place of Performance State Code",
        ],
        "page": page,
        "limit": BATCH_SIZE,
        "sort": "Action Date",
        "order": "desc",
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"API error (HTTP {e.code}): {e.read().decode()[:200]}")
        return None
    except Exception as e:
        print(f"Request failed: {e}")
        return None

def upsert_award(cur, award):
    """Upsert a single award record."""
    internal_id = award.get("generated_internal_id") or award.get("internal_id")
    if not internal_id:
        return False

    cur.execute("""
        INSERT INTO awards (
            usaspending_id, award_id_piid, description, agency_name,
            recipient_name, federal_action_obligation, award_type,
            action_date, period_of_performance_start,
            period_of_performance_current_end,
            naics_code, naics_description, place_of_performance_state,
            usaspending_url
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (usaspending_id) DO UPDATE SET
            federal_action_obligation = EXCLUDED.federal_action_obligation,
            period_of_performance_current_end = EXCLUDED.period_of_performance_current_end,
            updated_at = NOW()
    """, (
        internal_id,
        award.get("Award ID"),
        award.get("Description"),
        award.get("Awarding Agency"),
        award.get("Recipient Name"),
        parse_money(award.get("Total Obligation")),
        award.get("Award Type"),
        parse_date(award.get("Action Date")),
        parse_date(award.get("Period of Performance Start Date")),
        parse_date(award.get("Period of Performance Current End Date")),
        award.get("NAICS Code"),
        award.get("NAICS Description"),
        award.get("Place of Performance State Code"),
        f"https://www.usaspending.gov/award/{internal_id}" if internal_id else None,
    ))
    return True

def parse_money(val):
    if val is None:
        return None
    try:
        return float(str(val).replace(",", "").replace("$", ""))
    except (ValueError, TypeError):
        return None

def parse_date(val):
    if not val:
        return None
    try:
        return datetime.strptime(str(val)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None

def main():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    date_to = datetime.now().strftime("%Y-%m-%d")
    date_from = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    print(f"Syncing awards from {date_from} to {date_to}")

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    total_inserted = 0
    total_errors = 0

    for page in range(1, MAX_PAGES + 1):
        print(f"Fetching page {page}...")
        result = fetch_awards(page, date_from, date_to)

        if not result or not result.get("results"):
            print(f"No more results at page {page}")
            break

        awards = result["results"]
        batch_inserted = 0

        for award in awards:
            try:
                if upsert_award(cur, award):
                    batch_inserted += 1
            except Exception as e:
                total_errors += 1
                conn.rollback()
                continue

        try:
            conn.commit()
            total_inserted += batch_inserted
            print(f"  Page {page}: {batch_inserted} upserted, {total_errors} total errors")
        except Exception as e:
            conn.rollback()
            print(f"  Commit error: {e}")

        if not result.get("hasNext", True) or len(awards) < BATCH_SIZE:
            break

        time.sleep(0.5)

    cur.close()
    conn.close()
    print(f"\nSync complete: {total_inserted} awards upserted, {total_errors} errors")

if __name__ == "__main__":
    main()
