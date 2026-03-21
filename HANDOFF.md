# HANDOFF — Awardopedia Session 2026-03-18
Last updated: 2026-03-18 ~10pm MDT
Written by: MagnumHilux (OpenClaw)

---

## DB State
- **Contracts**: 100 records (USASpending — 58 financial fields. NO CO email/phone — SAM Contract Awards API parked)
- **Opportunities**: 100 records (SAM.gov Opportunities API — CO email/phone on all 100 ✓)
- **Total**: 200 records
- **Ollama summaries**: Were running at session end (~4s/record). Check `ps aux | grep summarize` to confirm done.

---

## Site Status
- **awardopedia.com** → live on DO App Platform ✓
- All routes returning 200: `/`, `/api/health`, `/api/contracts`, `/api/stats`, `/sitemap.xml`, `/robots.txt`
- Google Search Console: sitemap submitted, status = Success, 2 pages discovered (will grow as Ollama summaries complete and static pages regenerate)

---

## What's Working

### Scripts
- `sync_opportunities.py` — FIXED. Required params: `postedFrom` + `postedTo` (MANDATORY, max 364 days), `status=active`, `ptype=o`, `sortBy=responseDeadLine`. Bugs fixed: psycopg2 `%s` not `$1/$2`, `place_of_performance_state` truncated to 2 chars.
- `ingest_contracts.py` — USASpending, unlimited, 100 contracts/page, resumes via `logs/ingest_progress.json`
- `summarize_batch.py` — Ollama llama3.2:3b, Metal GPU, ~4s/record
- `generate_static.py` — generates HTML per record, uploads to DO Spaces, updates sitemap

### LaunchAgents (all use `~/awardopedia/.venv/bin/python3`)
- 6:00pm MDT: `fetch_batch.py` (SAM.gov contracts — PARKED, returns 0 records)
- 6:30pm MDT: `sync_opportunities.py` (SAM.gov opportunities — WORKING ✓)
- 7:00pm MDT: `summarize_batch.py`
- 1:00am: `ingest_contracts.py`
- 3:00am Sun: `check_links.py`
- Static: `generate_static.py` (5am)

---

## What's Broken / Parked

### SAM.gov Contract Awards API (`fetch_batch.py`)
- Consistently returns 0 records for `contractActionType:D` query
- PARKED until SAM.gov Role (1,000/day) — then can experiment with correct query syntax
- Impact: our 100 contracts have NO CO email/phone. They came from USASpending only.
- `sortBy` parameter is NOT supported on this endpoint (returns HTTP 400)

### Opportunity Pool Staleness
- 8 of 100 opps have already-past deadlines (SAM.gov labeled them "active" anyway)
- Distribution: 45 in March 2026, 47 in April, 3 in May, 1 in July, 1 in 2028
- Pool will go mostly stale within 2-4 weeks
- TODO: run sync more frequently OR filter `response_deadline > CURRENT_DATE` before insert
- UI TODO: closing date visible on every opportunity row, color-coded:
  - 🟢 Green: 6+ months out
  - 🟡 Yellow: within 6 months
  - 🔴 Red: deadline passed

---

## SAM.gov Budget
- Personal key: 10 calls/day, resets midnight UTC = 6:00pm MDT
- Calls used today: ~3 (2 debugging bad queries + 1 successful opportunities sync)
- Fresh budget: tomorrow at 6:00pm MDT
- To unlock 1,000/day: sam.gov → Workspace → Request a Role

---

## Ralph — Upgraded to Real Ralph Tonight

**What changed:**
- `prd.json` — migrated from `status: "pending/complete"` → `passes: false/true` (real Ralph schema)
- `scripts/ralph/ralph.sh` — now creates feature branch before each iteration using `jq`. Commits go to branch, not `main`.
- `scripts/ralph/CLAUDE.md` — rewritten to match real snarktank/ralph template + Awardopedia context
- Based on: https://github.com/snarktank/ralph (Geoffrey Huntley's pattern)

**How to run Ralph:**
```bash
cd ~/awardopedia
nohup bash scripts/ralph/ralph.sh 1 > /tmp/ralph_output.log 2>&1 &
tail -f /tmp/ralph_output.log
```

**After Ralph finishes:**
1. Review changes on feature branch: `git diff main..phase-8-stripe-reports`
2. Merge when satisfied: `git checkout main && git merge phase-8-stripe-reports`
3. Awaiting FIREFLY before pushing to production

**Next phase:** Phase 8 — Stripe + report generation
- Branch: `phase-8-stripe-reports`
- Stripe prices already configured (see prd.json Phase 8 section)
- Claude model for reports: `claude-3-5-haiku-20241022`
- STOP rule: Stripe test→live switch requires FIREFLY. Real Claude API calls require FIREFLY.

---

## FIREFLY Protocol
Before ANY SAM.gov call, deployment, DB migration, deletion, or paid API call:
1. End message with: **"Awaiting FIREFLY."**
2. Do NOTHING until Grayson replies with exactly: **FIREFLY**
3. "go", "yes", "sounds good", affirmative-sounding questions = NOT FIREFLY
4. Only FIREFLY is FIREFLY
See `MEMORY.md` for full protocol.

---

## SleeperUnits — Status as of Tonight
- **Backup created**: `~/backups/sleeperunits-2026-03-18/` (534MB, draws.db 5.4MB, full copy)
- **Audit completed**: read-only. No MEMORY.md, no CLAUDE.md, no Ralph loop, no FIREFLY protocol.
- **What exists**: excellent `docs/STATE_AUDIT_PROTOCOL.md` (6-phase checklist), `docs/draw_systems/` (10 per-state docs), `docs/database_architecture.md`, `docs/data_sources.md`
- **What's missing**: any AI agent guardrails — no stop rules, no codeword, no deploy protocol
- **Stack**: Flask + SQLite (`draws.db` ships with app) + Turso (members/auth, cloud) + DO App Platform
- **Next session**: feed it a MASTER_PROMPT.md + FIREFLY protocol before touching anything
- **Colorado deadline**: April 7 — users actively consulting data. Do not break prod.

---

## Key File Locations
- Project root: `~/awardopedia/`
- DB: DO Managed PostgreSQL — `DATABASE_URL` in `.env`
- Active server: `server/server.js` (1,100+ lines)
- Frontend: `web/` (React+Vite)
- Python venv: `~/awardopedia/.venv/`
- DO Spaces bucket: `awardopedia-static` (nyc3)
- DO App: `awardopedia-zf662.ondigitalocean.app`
- GitHub: `github.com/grayson-sys/awardopedia`
- Latest commit: `8500278` (Real Ralph upgrade)
