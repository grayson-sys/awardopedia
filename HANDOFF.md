# HANDOFF — Awardopedia Session 2026-03-18
Last updated: 2026-03-18 ~9pm MDT
Written by: MagnumHilux (OpenClaw)

## Where We Left Off

### DB State
- **Contracts**: 100 records (from USASpending — all 58 financial fields, Ollama summaries running)
- **Opportunities**: 100 records (from SAM.gov — CO email/phone on all, sorted by soonest deadline)
- **Total**: 200 records. Ollama summaries still generating in background (~4s/record).

### What's Working
- `sync_opportunities.py` — FIXED and working. Required params: `postedFrom` + `postedTo` (mandatory, max 364 days), `status=active`, `ptype=o`, `sortBy=responseDeadLine`. psycopg2 fix: %s not $1/$2. State field truncated to 2 chars.
- `ingest_contracts.py` — Working perfectly. USASpending, unlimited, 100 contracts/page.
- `summarize_batch.py` — Running. ~4s/record on Metal GPU.
- Site live at awardopedia.com on DO App Platform. All routes 200.
- Sitemap submitted to Google Search Console — Success, 2 pages discovered.

### What's Broken / Parked
- `fetch_batch.py` (SAM.gov Contract Awards API) — consistently returns 0 records for `contractActionType:D`. Unknown query issue. PARKED until SAM.gov Role (1,000/day) — then worth experimenting with.
- Our 100 contracts have NO CO email/phone (came from USASpending only, not SAM.gov Contract Awards API).

### SAM.gov Budget
- Personal key: 10 calls/day, resets midnight UTC (6pm MDT)
- Calls burned today: ~3 (2 debugging bad queries + 1 successful opportunities sync)
- Remaining today: ~7. Fresh budget tomorrow at 6pm MDT.

### Opportunity Data Quality Issue
- 8 of 100 opportunities have PAST deadlines (SAM.gov listed them as "active" anyway)
- 45 close in March 2026 (this week / this month)
- 47 close in April 2026
- Only 1 is green (6+ months out — Mississippi River project, 2028)
- Pool will go stale fast. Next sync should keep refreshing with new records.
- UI TODO: closing date on every opportunity row, color-coded (green/yellow/red).

### Next Steps (in order)
1. Wait for Ollama summaries to finish (check: `summarize_batch.py` in ps aux)
2. Run `generate_static.py` to regenerate sitemap with 200 records
3. Push updated `web/public/sitemap.xml` so Google sees full index
4. Fix opportunity pool staleness — consider syncing more frequently or filtering `response_deadline > CURRENT_DATE` before inserting
5. Phase 8: Stripe + report generation (Ralph is briefed, prd.json has it as next pending)
6. Get SAM.gov Role to unlock 1,000 calls/day (sam.gov → Workspace → Request a Role)

### FIREFLY Protocol
Before ANY SAM.gov call, deployment, DB migration, deletion, or paid API call:
- End message with "Awaiting FIREFLY."
- Wait for exactly: FIREFLY
- Nothing else counts. See MEMORY.md.

### Ralph Loop
- Run: `nohup bash scripts/ralph/ralph.sh 1 > /tmp/ralph_output.log 2>&1 &`
- Max 3 iterations. Reads CLAUDE.md for task. Writes to progress.txt.
- Brief Ralph in CLAUDE.md before running. One phase at a time.
- Ralph STOPS before: deploy, DB migration, deletion, paid API, infra changes.
