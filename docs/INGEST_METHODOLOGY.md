# Awardopedia Ingest Methodology

Repeatable playbook for the SAM.gov + USASpending + Ollama pipeline.
Scale target: 1,000 SAM.gov calls/day (with Role).

---

## 1. The Three Pillars

Every record in Awardopedia requires data from all three sources. They are **not interchangeable** — each provides fields the others cannot.

### SAM.gov (Contract Awards API + Opportunities API)
- **What it provides:** Contracting officer name, email, phone. For opportunities: full solicitation details, response deadlines, set-aside type.
- **Rate limit:** 10 calls/day (personal key, no role) or 1,000/day (with SAM.gov Role). Max 100 records per call.
- **Why it matters:** CO contact info is not available anywhere else. Without it, users cannot identify who to contact about a contract or solicitation. Every wasted call (0 records returned) costs 10% of the daily budget on a personal key.
- **What breaks without it:** No contracting officer data, no opportunity details. The platform becomes a USASpending mirror with no unique value.

### USASpending (Awards API v2)
- **What it provides:** 58 financial fields per PIID — award amounts, obligation history, dates (signed, period of performance start/end), place of performance (city/state/zip/congressional district), recipient details, business categories, solicitation number, sole source authority, funding agency.
- **Rate limit:** None. Unlimited calls.
- **Why it matters:** Source of truth for all financial data. SAM.gov does not carry award amounts or performance locations.
- **What breaks without it:** Records have CO contact info but no dollar amounts, no performance locations, no financial history. Reports cannot be generated.

### Ollama (llama3.2:3b via Metal GPU)
- **What it provides:** `llama_summary` — a one-sentence plain-English summary of each merged record.
- **Speed:** ~4 seconds/record on Mac Mini M-series Metal GPU.
- **Why it matters:** Makes federal contracts readable by non-specialists. Powers search and browse UX.
- **What breaks without it:** Records display raw government jargon. Search quality drops. The site loses its accessibility advantage.

---

## 2. The Two Query Types

### Contracts: T-100 (backward from now)

Fetch the 100 most recently signed definitive contracts, going backward in time.

```
Endpoint: https://api.sam.gov/contract-awards/v1/search
Query:    q=contractActionType:D
Sort:     sortBy=-signedDate  (descending = most recent first)
Limit:    limit=100

Full URL: https://api.sam.gov/contract-awards/v1/search?api_key={KEY}&q=contractActionType%3AD&limit=100&sortBy=-signedDate
```

- `contractActionType:D` = definitive contracts only (excludes BPA calls, delivery orders, etc.)
- No NAICS filter, no set-aside filter, no date range — maximizes records per call
- The minus prefix on `-signedDate` means descending (most recent first)
- First run returns T-1 through T-100 (the 100 most recent)
- Subsequent runs spider backward: T-101 through T-200, etc.

### Opportunities: T+100 (forward from now)

Fetch the 100 active solicitations with the soonest response deadlines, going forward in time.

```
Endpoint: https://api.sam.gov/opportunities/v2/search
Params:   ptype=o  (solicitations only)
          status=active
          sortBy=responseDeadLine  (ascending = soonest deadline first)
          limit=100

Full URL: https://api.sam.gov/opportunities/v2/search?api_key={KEY}&limit=100&offset=0&ptype=o&status=active&sortBy=responseDeadLine
```

- `ptype=o` = solicitations only (excludes pre-solicitation, sources sought, etc.)
- `status=active` = only currently accepting responses
- No `postedFrom`/`postedTo` — these choke results by limiting to recently posted opps
- Ascending sort = soonest deadline first (T+1 through T+100)
- Subsequent runs spider forward: T+101 through T+200, etc.

---

## 3. Pipeline Steps (per run)

Each run executes these five steps in order:

### Step 1: SAM.gov API Call (1 call = up to 100 records)
- Scripts: `fetch_batch.py` (contracts) or `sync_opportunities.py` (opportunities)
- Makes exactly ONE API call
- Saves raw JSON to `data/sam_batch_latest.json` or `data/sam_opps_sync_latest.json`
- Extracts PIID (contracts) or notice_id (opportunities) from each record
- Extracts CO name, email, phone from SAM.gov response

### Step 2: USASpending Enrichment (unlimited calls)
- For each PIID from Step 1, call `https://api.usaspending.gov/api/v2/awards/{piid}/`
- No rate limit — can run as fast as needed
- Returns 58 fields: amounts, dates, performance location, recipient, business categories
- Records not found on USASpending are skipped (logged, not fatal)

### Step 3: Ollama Summary (~4s/record)
- For each new record (not previously summarized), call local Ollama
- Model: `llama3.2:3b` running on Mac Mini Metal GPU
- Input: merged SAM.gov + USASpending fields
- Output: one-sentence `llama_summary` stored in DB
- ~7 minutes for a full batch of 100 records

### Step 4: Database Upsert
- Insert new records, update existing records with fresh CO data
- Contracts table: keyed on `piid`
- Opportunities table: keyed on `notice_id`
- Recompete detection: matches opportunity `solicitation_number` to existing contract PIIDs
- Sets `fpds_enriched = true` after SAM.gov + USASpending merge

### Step 5: Static Page Generation
- For each new record, generate an SEO HTML page
- Upload to DO Spaces (`awardopedia-static` bucket, nyc3)
- Update `static_page_url` and `static_page_generated` in DB
- Regenerate `sitemap.xml` with new URLs

---

## 4. Spidering Strategy

### Current capacity (personal key, no role)
- 10 SAM.gov calls/day = 1,000 records/day maximum
- Split: 5 contract calls + 5 opportunity calls = 500 contracts + 500 opportunities per day
- Currently running: 1 contract call (6pm) + 1 opportunity call (6:30pm) = 200 records/day

### With SAM.gov Role (target)
- 1,000 SAM.gov calls/day = 100,000 records/day maximum
- Can run every hour instead of once per day
- 12 contract calls + 12 opportunity calls = 2,400 records/day (conservative schedule)

### Cursor-based pagination

**Contracts (backward):**
1. Run 1: `sortBy=-signedDate`, `limit=100` → returns records T-1 to T-100
2. Record the oldest `signedDate` seen (e.g., `2026-03-15`)
3. Run 2: add `signedDate:[,20260314]` to query → returns T-101 to T-200
4. Continue until records are older than desired lookback window

**Opportunities (forward):**
1. Run 1: `sortBy=responseDeadLine`, `limit=100` → returns T+1 to T+100
2. Record the latest `responseDeadLine` seen (e.g., `2026-04-15`)
3. Run 2: add `responseDate=[20260416,]` or use `offset=100` → returns T+101 to T+200
4. Continue until deadlines are further out than desired lookahead window

### LaunchAgent schedule (Mac Mini)

| Time (MDT) | Time (UTC) | Script | Purpose |
|---|---|---|---|
| 6:00 PM | 00:00 +1 | `fetch_batch.py` | Contracts (T-100), right after midnight UTC reset |
| 6:30 PM | 00:30 +1 | `sync_opportunities.py` | Opportunities (T+100) |
| 7:00 PM | 01:00 +1 | `summarize_batch.py` | Ollama summaries for new records |
| 1:00 AM | 07:00 | `ingest_contracts.py` | USASpending-only bulk ingest (no SAM.gov call) |
| 3:00 AM Sun | 09:00 Sun | `check_links.py` | Weekly dead link checker |
| 5:00 AM | 11:00 | `generate_static.py --new-only` | SEO static pages + sitemap |

The 6pm MDT start time is intentional: midnight UTC = SAM.gov rate limit reset. We get a fresh 10 (or 1,000) calls immediately.

---

## 5. Error Recovery

### SAM.gov returns 0 records
- **Likely cause:** Over-filtered query (too many conditions = no matches)
- **Action:** Check the query string. Remove filters until records appear. The minimum viable query is `contractActionType:D` (contracts) or `ptype=o&status=active` (opportunities).
- **Do NOT** retry the same query — that wastes another API call.

### SAM.gov returns HTTP 429 (rate limit)
- **Cause:** Daily call limit exhausted.
- **Action:** Stop all SAM.gov calls. Wait until 6:00 PM MDT (midnight UTC) for reset.
- **Prevention:** Request a SAM.gov Role for 1,000/day. Never run more calls than budgeted.

### SAM.gov returns bad/unexpected data
- **Action:** Raw response is saved to `data/sam_batch_latest.json` (contracts) or `data/sam_opps_sync_latest.json` (opportunities). Inspect the file.
- **Common issues:** Changed field names (SAM.gov API updates without notice), nested vs flat structure, missing PIID field.
- **Recovery:** Update the `extract_co_data()` function in `fetch_batch.py` or `parse_opportunity()` in `fetch_opportunity.py` to handle the new structure.

### USASpending returns 404 for a PIID
- **Cause:** Contract exists in SAM.gov but not yet in USASpending (data lag of 1-30 days).
- **Action:** Skip the record. It will be picked up on a future run when USASpending catches up.
- **Not fatal:** The record is logged and skipped, pipeline continues.

### Ollama fails or times out
- **Cause:** `ollama serve` not running, or model not loaded.
- **Action:** Run `ollama serve` in a separate terminal. Verify with `ollama list`.
- **Workaround:** Use `--no-summary` flag to skip summaries. Run `summarize_batch.py` later to backfill.

### Database connection fails
- **Cause:** DO Managed DB may be in maintenance window, or credentials expired.
- **Action:** Check DO dashboard for DB status. Verify `DATABASE_URL` in `.env`. Ensure `NODE_TLS_REJECT_UNAUTHORIZED=0` is set for Node.js connections.

---

## 6. SAM.gov Rate Limit Notes

### Current state
- **Key type:** Personal API key (no role)
- **Limit:** 10 calls/day
- **Resets:** Midnight UTC = 6:00 PM MDT
- **Expiry:** Key expires 2026-06-13 — renew before then

### How to request a Role (for 1,000/day)
1. Log in to [sam.gov](https://sam.gov)
2. Go to **Workspace** (top nav)
3. Click **Request a Role**
4. Select entity type: **Individual**
5. Role description: "Independent developer building federal contract intelligence platform for public transparency (awardopedia.com)"
6. Domain: **Contract Awards** and **Contract Opportunities**
7. Approval typically takes 1-3 business days

### With Role: 1,000 calls/day
- Run contracts pipeline every hour (24 runs x 100 = 2,400 contracts/day)
- Run opportunities pipeline every hour (24 runs x 100 = 2,400 opportunities/day)
- Update LaunchAgent schedule from once/day to hourly
- At 1,000 calls/day: full SAM.gov coverage achievable within weeks

### Budget tracking
- Each script logs the API call to stdout
- Raw responses saved to `data/` directory with timestamps
- Never add a second SAM.gov call to any script — always exactly ONE call per run
- If a call returns 0 records, that's a wasted call — investigate before retrying
