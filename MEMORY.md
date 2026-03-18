# MagnumHilux Memory
Last updated: 2026-03-18

Current phase: 6 — Public read API + API key system + llms.txt + TOS

## Stack
Frontend: React + Vite (~/awardopedia/web/) — DO App Platform (static, free tier)
Backend: Node.js/Express (~/awardopedia/server/server.js) — port 3001, DO App Platform (~$5/mo)
Database: PostgreSQL 15, DO Managed DB (~$15/mo) — awardopedia_user for DML, doadmin for DDL
Scripts: Python 3 on Mac Mini — scheduled via LaunchAgents (NOT cron — cron is broken)
AI summaries: llama3.2:3b via Ollama (running, Metal GPU, ~4-5s/record)
AI reports: Claude API (Anthropic) — 7-section XML format, cached 90 days
Domain: awardopedia.com → Cloudflare → DO App Platform
API server: cd ~/awardopedia/server && NODE_TLS_REJECT_UNAUTHORIZED=0 node server.js
Dev server: cd ~/awardopedia/web && npm run dev (port 5173, proxies /api → 3001)
Build: cd ~/awardopedia/web && npx vite build --mode development

## Completed phases
- Phase 0: Audit, schema rebuild, React+Vite scaffold, design system ✅
- Phase 1: NISGAA CIOPS LLC (FA877324C0001) — real contract, 58 fields, Claude report ✅
- Phase 2: OpportunityDetail.jsx, /api/reports/generate-opportunity, /api/reports/opportunity/:id ✅
- Phase 3: summarize.py + summarize_batch.py — llama3.2:3b via Ollama ✅
- Phase 4: ingest_contracts.py, enrich_fpds.py, sync_opportunities.py, summarize_batch.py + LaunchAgents ✅
- Phase 5: check_links.py — 10-thread concurrent, 3h time-boxed, Sunday 3am LaunchAgent ✅

## Current DB state
- contracts: 1 record (NISGAA CIOPS LLC / FA877324C0001) — waiting on 6pm SAM.gov batch for 100 more
- opportunities: 0 records — waiting on 6pm SAM.gov batch
- api_keys: table exists, owned by doadmin (⚠️ needs ownership fix — see gotchas)
- dead_links: table exists, owned by doadmin (⚠️ same)
- reports: table exists, 1 cached report (NISGAA)

## LaunchAgents (Mac Mini — use launchctl, NOT cron)
- 6:00pm daily: fetch_batch.py (SAM.gov 100 contracts + USASpending enrich)
- 6:30pm daily: sync_opportunities.py (SAM.gov 100 opportunities)
- 7:00pm daily: summarize_batch.py (Ollama summaries)
- 1:00am daily: ingest_contracts.py (USASpending only, no rate limit)
- 3:00am Sunday: check_links.py (dead link checker)
- Verify: launchctl list | grep awardopedia
- Plist files: ~/awardopedia/launchagents/ (copies) and ~/Library/LaunchAgents/ (live)

## Key files
- server/server.js — Express API, all routes (/api/contracts, /api/opportunities, /api/stats, /api/reports/*)
- web/src/App.jsx — main React app, state-based routing
- web/src/components/ContractDetail.jsx — contract detail + report generation
- web/src/components/OpportunityDetail.jsx — opportunity detail + report generation
- web/src/components/Nav.jsx — nav bar (BookOpen icon + "Awardopedia" wordmark)
- web/src/tokens.css — brand colors: navy #1B3A6B, gold #E9A820
- scripts/fetch_batch.py — master SAM.gov awards ingest (1 call = 100 records)
- scripts/fetch_opportunity.py — SAM.gov opportunity fetch
- scripts/ingest_contracts.py — USASpending bulk ingest (resumable, progress JSON)
- scripts/enrich_fpds.py — SAM.gov CO data enrichment
- scripts/sync_opportunities.py — daily opportunity delta
- scripts/summarize.py — Ollama summary generation (canonical)
- scripts/summarize_batch.py — batch summarizer for cron
- scripts/check_links.py — weekly dead link checker

## Known gotchas
- ⚠️ api_keys + dead_links tables owned by doadmin. Run in DO console BEFORE Phase 6:
    ALTER TABLE api_keys OWNER TO awardopedia_user;
    ALTER TABLE dead_links OWNER TO awardopedia_user;
- cron is broken on this Mac mini. Always use LaunchAgents (launchctl) instead.
- USASpending award detail: use generated_internal_id from search results, NOT constructed URL.
  Pattern: CONT_AWD_{PIID}_{AgencyCode}_{ParentPIID}_{ParentAgencyCode}
- SAM.gov rate limit: 10 calls/day (personal key, no role). Resets midnight UTC = 6pm MDT.
- DO PostgreSQL SSL: NODE_TLS_REJECT_UNAUTHORIZED=0 required in Node.js.
- FPDS ezsearch is DEAD. Use SAM.gov Contract Awards API: api.sam.gov/contract-awards/v1/search
- Report architecture: Claude API → XML sections → stored as JSONB in reports table → 90-day cache
- Frontend has no react-router — uses state-based view switching. Add router in Phase 6 for /api page.
- DB admin credentials in ~/awardopedia/.env (DO_TOKEN, doadmin password etc.)
- Stripe payment link (one-time $6): https://buy.stripe.com/9B628ka2m6w90ViegT83C01 (Phase 8)

## Phase 6 — what to build
Per MASTER_PROMPT.md:
1. Public read API at /api/v1/* (separate from existing /api/* internal routes)
   - GET /api/v1/contracts (filters: agency, naics, state, set_aside, expiring_within_days, min_amount, max_amount, q)
   - GET /api/v1/contracts/:piid
   - GET /api/v1/opportunities (filters: agency, naics, state, set_aside, deadline_within_days, is_recompete)
   - GET /api/v1/opportunities/:notice_id
   - GET /api/v1/stats
   - All responses wrapped in {data, meta: {source, attribution, api_docs, last_updated, total_results, page, limit}}
   - Rate limits: 1,000/day, 5,000/week per key. 429 response with retry_after on exceed.
2. API key registration page (web/src/pages/ApiKeys.jsx)
   - Form: name, email, organization, use_case
   - Server generates key, emails via SendGrid, stores hashed in api_keys table
   - No credit card
3. llms.txt at /web/public/llms.txt (served at awardopedia.com/llms.txt)
4. Terms of Service page (web/src/pages/Terms.jsx) + ~/awardopedia/TERMS_OF_SERVICE.md

## Ralph Loop
- scripts/ralph/ralph.sh — loop runner (max 3 iterations, claude tool default)
- scripts/ralph/CLAUDE.md — per-iteration instructions
- scripts/ralph/progress.txt — iteration history
- Run: cd ~/awardopedia && ./scripts/ralph/ralph.sh 1
- HARD STOPS: prod DB migrations, deletions, paid API calls, infra changes
