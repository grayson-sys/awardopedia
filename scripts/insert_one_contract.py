#!/usr/bin/env python3
"""
Phase 1 Step 1C — Map USASpending JSON to schema and insert into contracts table
"""

import json
import os
import psycopg2
from datetime import datetime

# Load env
def get_env():
    env = {}
    env_path = os.path.expanduser("~/awardopedia/.env")
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

env = get_env()

# Load USASpending data
with open(os.path.expanduser("~/awardopedia/sample_contract.json")) as f:
    d = json.load(f)

tx = d.get("latest_transaction_contract_data", {})
recipient = d.get("recipient", {})
awarding = d.get("awarding_agency", {})
perf = d.get("period_of_performance", {})
pop = d.get("place_of_performance", {})
naics_h = d.get("naics_hierarchy", {})
psc_h = d.get("psc_hierarchy", {})

# Business size / small biz
biz_cats = recipient.get("business_categories", [])
is_small = "Small Business" in biz_cats

# Pricing type codes → readable
pricing_map = {
    "A": "Fixed Price Redetermination",
    "B": "Fixed Price Level of Effort",
    "J": "Firm Fixed Price",
    "K": "Fixed Price with Economic Price Adjustment",
    "L": "Fixed Price Incentive",
    "M": "Fixed Price Award Fee",
    "R": "Cost Plus Award Fee",
    "S": "Cost No Fee",
    "T": "Cost Sharing",
    "U": "Cost Plus Fixed Fee",
    "V": "Cost Plus Incentive Fee",
    "Y": "Time and Materials",
    "Z": "Labor Hours",
    "1": "Order Dependent",
    "2": "Combination",
    "3": "Other",
}

extent_map = {
    "A": "Full and Open Competition",
    "B": "Not Available for Competition",
    "C": "Not Competed",
    "D": "Full and Open Competition after Exclusion of Sources",
    "E": "Follow On to Competed Action",
    "F": "Competed under SAP",
    "G": "Not Competed under SAP",
}

record = {
    "piid": d.get("piid") or "FA8773-24-C-0001",
    "award_id": d.get("generated_unique_award_id"),
    "description": d.get("description"),
    "naics_code": tx.get("naics"),
    "naics_description": tx.get("naics_description", "").title() if tx.get("naics_description") else None,
    "psc_code": tx.get("product_or_service_code"),
    "psc_description": psc_h.get("base_code", {}).get("description"),
    "agency_name": awarding.get("toptier_agency", {}).get("name"),
    "sub_agency_name": awarding.get("subtier_agency", {}).get("name"),
    "office_name": awarding.get("office_agency_name"),
    "recipient_name": recipient.get("recipient_name"),
    "recipient_uei": recipient.get("recipient_uei"),
    "recipient_duns": recipient.get("recipient_unique_id"),
    "recipient_city": recipient.get("location", {}).get("city_name") if isinstance(recipient.get("location"), dict) else None,
    "recipient_state": recipient.get("location", {}).get("state_code") if isinstance(recipient.get("location"), dict) else None,
    "recipient_country": recipient.get("location", {}).get("country_code") if isinstance(recipient.get("location"), dict) else None,
    "business_size": "Small Business" if is_small else "Other Than Small",
    "is_small_business": is_small,
    "award_amount": d.get("total_obligation"),
    "base_amount": d.get("base_exercised_options"),
    "ceiling_amount": d.get("base_and_all_options"),
    "federal_obligation": d.get("total_account_obligation"),
    "total_outlayed": d.get("total_account_outlay"),
    "start_date": perf.get("start_date"),
    "end_date": perf.get("end_date"),
    "fiscal_year": 2024,
    "set_aside_type": tx.get("type_set_aside_description"),
    "competition_type": None,
    "number_of_offers": int(tx["number_of_offers_received"]) if tx.get("number_of_offers_received") else None,
    "contract_type": pricing_map.get(tx.get("type_of_contract_pricing", ""), tx.get("type_of_contract_pricing")),
    "award_type": d.get("type_description"),
    "extent_competed": extent_map.get(tx.get("extent_competed", ""), tx.get("extent_competed")),
    "data_source": "usaspending",
    "fpds_enriched": False,
}

print("Mapped record:")
for k, v in record.items():
    print(f"  {k}: {v}")

# Insert
conn = psycopg2.connect(env["DATABASE_URL"])
cur = conn.cursor()

cols = list(record.keys())
vals = [record[c] for c in cols]
placeholders = ", ".join(["%s"] * len(cols))
col_str = ", ".join(cols)

sql = f"INSERT INTO contracts ({col_str}) VALUES ({placeholders}) ON CONFLICT (piid) DO UPDATE SET " + \
      ", ".join([f"{c} = EXCLUDED.{c}" for c in cols if c != "piid"])

cur.execute(sql, vals)
conn.commit()

# Verify
cur.execute("SELECT piid, recipient_name, agency_name, award_amount, end_date FROM contracts")
rows = cur.fetchall()
print(f"\nDB now has {len(rows)} contract(s):")
for r in rows:
    print(f"  {r}")

conn.close()
print("\nDone.")
