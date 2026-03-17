#!/usr/bin/env python3
"""
Phase 1 Step 1A — Fetch one contract from USASpending API
PIID: FA8773-24-C-0001
Output: ~/awardopedia/sample_contract.json
"""

import urllib.request
import urllib.error
import json
import sys
import os

PIID = "FA8773-24-C-0001"
OUTPUT_FILE = os.path.expanduser("~/awardopedia/sample_contract.json")
API_URL = f"https://api.usaspending.gov/api/v2/awards/{PIID}/"

print(f"Fetching: {API_URL}")

try:
    req = urllib.request.Request(
        API_URL,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Awardopedia/1.0 (awardopedia.com)"
        }
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())

    with open(OUTPUT_FILE, "w") as f:
        json.dump(data, f, indent=2, default=str)

    print(f"Saved to {OUTPUT_FILE}")
    print(f"Top-level keys: {list(data.keys())}")

except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.reason}")
    # Try alternate endpoint format
    print("Trying alternate endpoint...")
    ALT_URL = "https://api.usaspending.gov/api/v2/awards/CONT_AWD_FA877324C0001_9700_-NONE-_-NONE-/"
    try:
        req2 = urllib.request.Request(ALT_URL, headers={"User-Agent": "Awardopedia/1.0"})
        with urllib.request.urlopen(req2, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        with open(OUTPUT_FILE, "w") as f:
            json.dump(data, f, indent=2, default=str)
        print(f"Alternate succeeded. Saved to {OUTPUT_FILE}")
    except Exception as e2:
        print(f"Alternate also failed: {e2}")
        sys.exit(1)
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
