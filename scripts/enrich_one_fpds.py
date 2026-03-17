#!/usr/bin/env python3
"""
Phase 1 Step 1B — Enrich one contract from FPDS
PIID: FA8773-24-C-0001
Output: ~/awardopedia/sample_contract_fpds.json
"""

import urllib.request
import urllib.parse
import json
import sys
import os

PIID = "FA8773-24-C-0001"
OUTPUT_FILE = os.path.expanduser("~/awardopedia/sample_contract_fpds.json")

# FPDS ezsearch endpoint
params = urllib.parse.urlencode({
    "q": f"PIID:{PIID}",
    "s": "FPDS",
    "templateName": "1.5.3",
    "indexName": "awardfull",
    "sortBy": "SIGNED_DATE",
    "desc": "Y",
    "start": "0",
    "N": "1"
})
URL = f"https://www.fpds.gov/ezsearch/fpdsportal?{params}&outputFormat=JSON"

print(f"Fetching FPDS: {URL[:100]}...")

try:
    req = urllib.request.Request(
        URL,
        headers={"User-Agent": "Awardopedia/1.0 (awardopedia.com)"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode()

    # Try JSON first
    try:
        data = json.loads(raw)
        with open(OUTPUT_FILE, "w") as f:
            json.dump(data, f, indent=2)
        print(f"JSON response saved to {OUTPUT_FILE}")
        print(f"Keys: {list(data.keys()) if isinstance(data, dict) else type(data)}")
    except json.JSONDecodeError:
        # Save raw for inspection
        with open(OUTPUT_FILE, "w") as f:
            f.write(raw[:5000])
        print("Non-JSON response (XML?). First 500 chars:")
        print(raw[:500])

except Exception as e:
    print(f"FPDS fetch failed: {e}")
    # Not fatal — USASpending data is sufficient for Phase 1
    print("Will proceed with USASpending data only.")
    sys.exit(0)
