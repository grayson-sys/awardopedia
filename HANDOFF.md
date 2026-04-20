# HANDOFF — Awardopedia
**Last updated:** 2026-04-20
**Written by:** Claude Opus 4.6 session (April 8-20)
**Previous:** MagnumHilux (OpenClaw) session 2026-03-18
**Status:** Fully operational. All pipelines running nightly. No blockers.

---

## What Was Built (April 8-20)

Full data pipeline infrastructure from partially-ingested DB to fully automated system:

1. **12-stage opportunity pipeline** — stages 1-10 per-record + stage 11 award matching + stage 12 winner enrichment
2. **USASpending contract pipeline** — independent nightly ingest with 5-year retention
3. **Lineage linker** — deterministic matching of opportunities to contracts for incumbent/competitive intel
4. **Static SEO pages** — 6,500+ pages with slug URLs, share buttons, uploaded to DO Spaces CDN
5. **Competitive Landscape BETA** — free deterministic incumbent analysis on every opportunity page
6. **$1/report pricing** — Stripe integration with 5 credit packs ($5-$100), Anthropic API key for report generation
7. **Data quality** — QC scoring at 94% average, fair grading prompt, failure logging
8. **Search filters** — deadline dropdown, human-readable set-aside dropdown, non-biddable types filtered out
9. **Agency name normalization** — "Department of X" → "X Department" in frontend, guarded in pipeline
10. **Edit this record** — inline editing in main content area with submit/cancel in top bar

## Current State

### Database (DigitalOcean PostgreSQL)
- **~40,400 opportunities** (~4,500 open biddable)
- **~142K contracts** (5-year rolling window from USASpending)
- **2,693 lineage links** (contract ↔ opportunity matches)
- **0 biddable open records missing summaries** — fully caught up
- **6,500+ static SEO pages** generated and on CDN

### Cron Jobs (all times Mountain)
| Time | Script | What it does |
|------|--------|-------------|
| 10:00 PM | `nightly_pipeline.py` | Step 0: cleanup expired pages + PDFs. Step 1: fetch SAM.gov. Step 2: stages 1-10 on all needed records. Step 3: stage 11 award matching. Step 4: stage 12 winner enrichment. |
| 10:30 PM | `backfill_pipeline.py` | Catches anything nightly missed. Biddable open records only. QC spot-checks every 100th. |
| 2:00 AM | `usaspending_nightly.py` | Delta ingest of contracts modified in past 30 days. Prunes contracts >5 years. |
| 3:00 AM | `lineage_linker.py` | 4-pass deterministic matching: exact sol#, normalized sol#, base PIID chains, fuzzy scoring. |

### Pipeline Stages (pipeline_opportunity.py)
1. **Ingest** — SAM.gov API → DB
2. **Download PDFs** — SAM.gov v3 resources API
3. **Classify docs** — SF-1449, SOW, Wage Det, etc.
4. **Deterministic extract** — regex on correct doc types
5. **AI extract** — Claude fills NULLs + title-based location check when no PDFs
6. **AI summary** — Sonnet for solicitations, Haiku for awards. Writes `summary_model`.
7. **Enrichment** — NAICS/PSC lookups (auto-fetch missing codes), agency tree, office codes
8. **Congressional** — ZIP → district → rep website
9. **Link check** — verify SAM.gov URL alive
10. **Static pages** — SEO HTML with slug URLs, uploaded to DO Spaces
11. **Award matching** — batch: Award Notices → parent solicitations, copy winner/$$
12. **Winner enrichment** — batch: upsert winners into recipients, YFinance/AI briefs

### Key Decisions
- **Only biddable types get full enrichment**: Combined Synopsis, Solicitation, Presolicitation, Sale of Surplus. Award Notices → Stage 11 only. Sources Sought / Special Notice / Justification skipped.
- **Only open records** (deadline >= today) processed. No AI on expired records.
- **Agency names**: DB stores "Department of X > Sub-agency". Frontend flips to "X Department" via agencyNorm.js. Pipeline guards refuse to write raw ALL CAPS or literal 'name'.
- **Slug URLs**: `opportunity/frazier-mountain-road-paving-6b7cf1ef` in `slug` column. Old hash URLs redirect.
- **DNS hardcoded**: `165.227.209.1` in `/etc/hosts` for DB hostname.
- **PDFs cleaned nightly**: expired PDFs deleted. Text already in DB.
- **OAuth proxy** at `localhost:3456` for pipeline AI (free). Real Anthropic API key for paid reports only.

### Stripe Credit Packs
| Pack | Price | Credits |
|------|-------|---------|
| Starter | $5 | 5 |
| Standard (default) | $10 | 10 |
| Plus | $20 | 25 |
| Pro | $50 | 60 |
| Power | $100 | 130 |

1 credit = 1 report. Reports cached 90 days.

### Known Issues
- **USASpending API** DNS-fails intermittently from Mac mini. `/etc/hosts` fix only covers DB hostname.
- **Competitive Landscape** BETA — fuzzy matching can produce false positives at 0.60 confidence.
- **Static page template** doesn't include Competitive Landscape section yet.

### Files That Matter
| File | Purpose |
|------|---------|
| `scripts/pipeline_opportunity.py` | Main 12-stage pipeline (~3,000 lines) |
| `scripts/pipeline_contract.py` | USASpending contract enrichment |
| `scripts/nightly_pipeline.py` | Nightly orchestrator |
| `scripts/backfill_pipeline.py` | Catch-up enrichment + QC |
| `scripts/usaspending_nightly.py` | Delta USASpending ingest |
| `scripts/lineage_linker.py` | Contract ↔ opportunity matching |
| `scripts/generate_static.py` | SEO static HTML generation |
| `scripts/cleanup_expired_pages.py` | Nightly cleanup expired pages + PDFs |
| `scripts/reenrich_worker.py` | Parallel re-enrichment of old records |
| `server/server.js` | Express API (deployed on DO App Platform) |
| `web/src/components/OpportunityDetail.jsx` | Main opportunity detail page |
| `web/src/utils/agencyNorm.js` | Frontend agency name flip |

### Credentials (in .env)
- `DATABASE_URL` — DigitalOcean PostgreSQL (awardopedia_user)
- `ADMIN_DATABASE_URL` — doadmin for migrations
- `SAM_API_KEY` — 10 calls/day
- `ANTHROPIC_API_KEY` — paid report generation
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
- `DO_SPACES_*` — CDN for static pages
- GitHub token in git remote URL

### Memory System
Project memories: `~/.claude/projects/-Users-openclaw-awardopedia/memory/`
Bot house rules: `/Users/magnumhilux/bot_rules/BOT_HOUSE_RULES.md`

### What's Next
- Monitor pipelines nightly — `logs/nightly.log`
- End-to-end test a real Stripe payment → report generation
- Add Competitive Landscape data to static page template
- Consider parallelizing pipeline if daily ingest grows
- Iterate on QC failures logged at `logs/qc_failures.jsonl`

---

## Previous Session Notes (2026-03-18)

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
