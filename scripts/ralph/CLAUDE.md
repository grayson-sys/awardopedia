# Ralph Agent Instructions — Awardopedia / MagnumHilux

## Read these files first — in this exact order — before touching any code:

1. `~/awardopedia/MASTER_PROMPT.md` — your objectives, guardrails, and identity
2. `~/awardopedia/MEMORY.md` — current state, last action, known gotchas
3. `~/awardopedia/PROGRESS.md` — phase-level status
4. `~/awardopedia/prd.json` — find the next phase where `status` is `pending`
5. `scripts/ralph/progress.txt` — iteration history and codebase patterns

## Your task this iteration

1. Find the **lowest-numbered phase** in `prd.json` where `status = "pending"`
2. Implement **only that phase** — nothing else
3. Follow the instructions for that phase in `MASTER_PROMPT.md` exactly
4. Run `cd ~/awardopedia/web && npm run build` before committing — never commit broken code
5. Commit with message: `Phase {n}: {phase title}`
6. Update `prd.json` — set `status: "complete"` for the finished phase
7. Update `MEMORY.md` — append to Completed section, update In Progress and Next 3 steps
8. Append your progress to `scripts/ralph/progress.txt`

---

## CURRENT TASK — Phase 7.5 Documentation (pipeline is running, do this NOW)

The SAM.gov ingest pipeline is actively running in the background. Your job right now is to write the repeatable methodology document so we have a solid playbook when we scale to 1,000 SAM.gov calls/day.

**Write this file: `~/awardopedia/docs/INGEST_METHODOLOGY.md`**

It must cover:

1. **The Three Pillars** — explain each, why we need all three, what breaks without any one of them
   - SAM.gov: CO email/phone for contracts; opportunity details + CO for solicitations. Rate-limited: 10 calls/day (personal), 1,000/day (with Role). 100 records per call max.
   - USASpending: 58 financial fields per PIID. No rate limit. Source of truth for award amounts, dates, place of performance.
   - Ollama (llama3.2:3b): generates llama_summary. ~4s/record on Mac Mini Metal GPU.

2. **The Two Query Types** — explain T-100 and T+100 with the exact API URLs
   - Contracts (T-100): `contractActionType:D`, `sortBy=-signedDate`, limit=100 — most recently signed definitive contracts going backward from now
   - Opportunities (T+100): `ptype=o`, `status=active`, `sortBy=responseDeadLine`, limit=100 — soonest-closing active solicitations going forward from now

3. **The Pipeline Steps** (for each run):
   - Step 1: 1 SAM.gov call → 100 records
   - Step 2: For each PIID/notice_id → USASpending enrichment (unlimited)
   - Step 3: Ollama summary for each new record
   - Step 4: Upsert to DB (insert new, update existing with CO data)
   - Step 5: Static page generation for new records
   
4. **Spidering Strategy** (how to scale):
   - Current: 10 calls/day = 1,000 records/day max
   - With Role: 1,000 calls/day = 100,000 records/day max
   - Pagination: maintain cursor (oldest signedDate seen / latest deadline seen)
   - Next run fetches T-101 through T-200 (contracts) or T+101 through T+200 (opportunities)
   - LaunchAgent schedule: contracts at 6pm MDT, opportunities at 6:30pm MDT (midnight UTC reset)

5. **Error recovery** — what to do when SAM.gov returns 0 records, 429, or bad data

6. **SAM.gov Rate Limit Notes**:
   - Resets at midnight UTC = 6:00 PM MDT
   - Personal key: 10 calls/day
   - How to request Role: sam.gov → Workspace → Request a Role → describe as "independent developer building federal contract intelligence platform"
   - With Role: 1,000/day → run every hour instead of once/day

After writing INGEST_METHODOLOGY.md:
- Mark Phase 7.5 as complete in prd.json
- Commit: `Phase 7.5: Fix SAM.gov ingest — time-ordered queries + methodology doc`
- Update MEMORY.md
- Append to progress.txt

---

## PHASE 7.5 SPECIFIC INSTRUCTIONS — READ CAREFULLY

The next pending phase is 7.5: Fix SAM.gov ingest pipeline.

### The Three Pillars — NOT alternatives, ALL required:
1. **SAM.gov** — provides contracting officer email, phone, and opportunity details. 10 calls/day. 100 records per call = max 1,000 records/day. Every wasted call (returning 0 records) costs us 10% of our daily budget.
2. **USASpending** — provides 58 financial fields (amounts, dates, place of performance, etc.). NO rate limit. Called for every PIID after SAM.gov returns it.
3. **Ollama (llama3.2:3b)** — generates llama_summary from the merged SAM + USASpending record.

The pipeline: SAM.gov → match PIID to USASpending → merge → Ollama summary.
You CANNOT substitute USASpending for SAM.gov or vice versa. They provide different data.

### SAM.gov budget today: ~8 calls remaining (2 were burned on bad queries earlier)

---

### Fix 1: `scripts/sync_opportunities.py` (opportunities — T+100)

Current broken query uses `postedFrom/postedTo` (limits by WHEN posted) and `sortBy=-modifiedDate`.

**Correct approach:** Get the 100 opportunities with the SOONEST deadlines — sorted by responseDeadLine ascending. Spider outward from there on future runs.

Change the `fetch_opportunities()` function params to:
```
status=active
sortBy=responseDeadLine      ← ascending = soonest deadline first (T+100)
limit=100
ptype=o                      ← solicitations only
```
REMOVE: `postedFrom`, `postedTo` — these choke the result by limiting to recently POSTED opps.
KEEP: `status=active` and `ptype=o`.

The SAM.gov Opportunities API (v2) supports `sortBy=responseDeadLine` natively.

---

### Fix 2: `scripts/fetch_batch.py` (contracts — T-100)

Current broken query stacks 4 filters (NAICS + set-aside + action type + date range) = 0 results.

**Correct approach:** Get the 100 most recently signed definitive contracts. No NAICS, no set-aside filter. Just time-ordered from now going backward.

Change `SAM_QUERY` to:
```
contractActionType:D
```
(That's it. Just definitive contracts. No date filter, no NAICS, no set-aside.)

And add a sort parameter to the URL: `&sortBy=-signedDate` (minus = descending = most recent first).

Update the URL construction to include `&sortBy=-signedDate`.

---

### DRY-RUN REQUIREMENT — CRITICAL

After making both fixes:
1. Run `python3 scripts/sync_opportunities.py --dry-run` and capture the output
2. Run `python3 scripts/fetch_batch.py --dry-run` and capture the output
3. Write BOTH dry-run outputs to `scripts/ralph/progress.txt`
4. **STOP HERE** — do NOT run the real API calls
5. Message the user: "Phase 7.5 fixes are ready. Here are the dry-run URLs. Say 'go' to burn a real call."

The user will review the URLs and say "go" before any real SAM.gov call is made.

---

### What "complete" looks like for Phase 7.5:
- Both scripts fixed with time-ordered queries
- Dry-runs run and output written to progress.txt
- STOPPED before any real API call
- User notified and waiting for "go"
- Commit: `Phase 7.5: Fix SAM.gov ingest — time-ordered queries`
- NO frontend build needed (scripts only, no web changes)

## STOP AND DO NOT PROCEED if any of these apply:

- The next step involves deploying to production
- The next step involves running migrations on the production database
- The next step involves deleting any file or database record
- The next step involves making a paid API call (Stripe, Anthropic, SendGrid)
- The next step involves spawning sub-agents or parallel processes
- The next step involves infrastructure configuration changes

For any of the above: write what you were about to do to `scripts/ralph/progress.txt`, then stop and message the user via Telegram.

## One thing at a time

Complete ONE file. Test it. Commit it. Then move to the next.
Never build multiple components simultaneously.
If you feel the urge to do several things at once, write a plan to progress.txt instead.

## Error handling

If you hit an error:
1. Write exact error to MEMORY.md under "Known gotchas"
2. Try ONE well-justified fix
3. If that fails, write recovery plan to MEMORY.md and STOP
4. Never try more than two fixes without user input

## Completion signal

After finishing a phase:
- Check if ALL phases in prd.json have `status: "complete"`
- If yes: reply with `<promise>COMPLETE</promise>`
- If no: end your response normally (next Ralph iteration will pick up)

## Progress report format

APPEND to scripts/ralph/progress.txt:
```
## [datetime] — Phase {n}: {title}
- What was implemented
- Files changed
- Build result (pass/fail)
- Learnings / gotchas for future iterations
---
```
