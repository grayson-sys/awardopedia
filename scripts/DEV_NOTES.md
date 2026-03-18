# Dev Notes — API Limits & Gotchas

## SAM.gov Public API Key (personal/non-federal account)

**HARD LIMIT: ~10 requests per day. Resets at midnight UTC (6pm Mountain).**

We discovered this empirically on 2026-03-17 after ~12 exploratory calls.

### What counts against the limit:
- Any call to `api.sam.gov/opportunities/v2/search`
- Any call to `api.sam.gov/contract-awards/v1/search`

### What does NOT count:
- USASpending API calls (no key, no limit — use freely)
- SAM.gov Data Services file downloads (direct ZIP download, not an API call)

### Rules for dev work:
1. **Never burn calls on exploration.** Know your query before you call.
2. **One call, max results.** Set `limit=100` (max per page). If you need pagination,
   plan how many pages you need BEFORE starting.
3. **Use USASpending for contract award lookups.** SAM.gov is only for opportunities
   and contracting officer enrichment.
4. **For bulk ingestion, use the file download, never the API.**
   - Opportunities: sam.gov/data-services → Contract Opportunities → daily ZIP
   - Awards: usaspending.gov/download_center/custom_award_data → bulk CSV

### Upgrade path when needed:
- SAM.gov System Account (GSA approval required, ~1,000 req/day for federal orgs)
- SAM.gov Data Services file downloads bypass the limit entirely

---

## USASpending API (no key required)

No meaningful rate limits encountered. Use freely for:
- Single award lookups: `GET /api/v2/awards/{piid}/`
  - Use bare PIID (no hyphens): `FA877324C0001` or `generated_unique_award_id`
  - Format: `CONT_AWD_{piid}_{agency_code}_-NONE-_-NONE-`
- Award search: `POST /api/v2/search/spending_by_award/`
  - NOTE: `Period of Performance End Date` and `NAICS Code` often return null
    in search results — always fetch full detail via award lookup to get complete data
- Bulk: `usaspending.gov/download_center/custom_award_data`

---

## ⏰ TODO: Get 100 Perfect Records (do when ready)

Run a USASpending search for 100 DoD professional services contracts
(NAICS 541xxx, set-aside, $1M-$8M, signed Sep-Dec 2024)
then enrich each one with `enrich_usaspending.py`.

**USASpending only — no SAM.gov calls needed. Can do anytime.**

Script to write: `scripts/fetch_100_contracts.py`
- Search USASpending for 100 diverse contracts (varied agencies, NAICS, set-asides)
- For each: fetch full award detail, run through same parse logic as enrich_usaspending.py
- Upsert all 100 into contracts table
- Goal: diverse enough to test all UI states, report edge cases, LLAMA summaries

---

## ⏰ TODO: Phase 2 — Opportunities Bulk Ingest (do after 6pm Mountain)

When SAM.gov API resets (midnight UTC = 6pm Mountain):
1. **Option A (preferred):** Download bulk file from sam.gov/data-services
   - No API calls, no limits, gets all 26,000+ active opportunities at once
   - Script: `scripts/bulk_fetch_opportunities.py`
2. **Option B (fallback):** Use API with limit=100, paginate carefully
   - 26,000 records ÷ 100/page = 260 pages = 260 API calls
   - EXCEEDS daily limit — must use Option A for full ingest
   - API only viable for daily delta sync (new postings since yesterday = ~100-200/day = 2 calls)
