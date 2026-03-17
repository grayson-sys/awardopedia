# MagnumHilux Memory
Last updated: 2025-03-17

Current phase: 0 — Audit and stabilize (COMPLETE)
Current task: Phase 0 complete. Ready for Phase 1.

## Stack
Frontend: React + Vite (~/awardopedia/web/) — DO App Platform (not yet deployed, pending Phase 0→1)
Backend: none yet — Phase 1 will add Express API if needed, or Next.js API routes. TBD.
Database: PostgreSQL 15, DO Managed DB (~$15/mo)
Scripts: Run locally on Mac Mini (none written yet — Phase 4)
AI summaries: llama3.2:3b via Ollama (not yet pulled — needs `ollama pull llama3.2:3b`)
Domain: awardopedia.com via Cloudflare Registrar
CDN/DNS/Bots: Cloudflare

## Key commands
Build frontend: cd ~/awardopedia/web && npm run build
Dev server: cd ~/awardopedia/web && npm run dev
DB connect (app user): psycopg2 using DATABASE_URL from .env
DB connect (admin): use doadmin credentials — retrieve via DO API using DO_TOKEN. See ~/awardopedia/.env for DO_TOKEN.

## Completed (append-only)
2025-03-17 — Phase 0: Audit complete. Found Next.js on Vercel, wrong schema, 100 stale records.
2025-03-17 — Deleted Next.js frontend (web/). Dropping Next.js + Vercel entirely.
2025-03-17 — Dropped all DB tables. Ran fresh schema migration (migrations/001_initial_schema.sql).
2025-03-17 — Schema: contracts, opportunities, api_keys, reports, users (stub), dead_links.
2025-03-17 — Scaffolded React+Vite frontend. Design system tokens applied. Inter + JetBrains Mono.
2025-03-17 — Built mock UI: contract table row → click → expanded detail. Opportunity table row → click → expanded detail. Build passes clean.
2025-03-17 — Saved MASTER_PROMPT.md to ~/awardopedia/MASTER_PROMPT.md.
2025-03-17 — Phase 1: Fetched PIID FA8773-24-C-0001 (NISGAA CIOPS LLC / DoD / $3.4M). Real record in DB.
2025-03-17 — Phase 1: Created Express API server (server/server.js) on port 3001. Routes: /api/contracts, /api/opportunities, /api/stats, /health.
2025-03-17 — Phase 1: Updated frontend to fetch live from API. Vite proxy /api → localhost:3001. Mock data removed.
2025-03-17 — Phase 1: Build passes. Dev server running at localhost:5173. One real contract displaying.

## In progress
Phase 1 complete. Waiting for user to say "go" for Phase 2.

## Next 3 steps
1. Phase 2: Register SAM.gov API key (free at sam.gov) and add SAM_API_KEY to .env
2. Phase 2: Write fetch_one_opportunity.py to fetch one active solicitation
3. Phase 2: Insert + display opportunity end-to-end like Phase 1

## Known gotchas
- DB tables were created by doadmin — app user (awardopedia_user) needs grants after any CREATE TABLE. Always use doadmin for DDL, app user for DML.
- Previous agent spawned unbounded ingest overnight → 1.62M records. NEVER run ingest without --limit flag. Always test with --limit 10 first.
- Vercel token still in .env (VERCEL_TOKEN) — not needed anymore. Leave it, don't delete.
- Frontend has no router yet — single page with state-based view switching. Add react-router when Phase 6 (API key registration page) is needed.
- USASpending PIID lookup: direct /api/v2/awards/{piid}/ returns 404 for this format. Use generated_unique_award_id format: CONT_AWD_{piid_no_dashes}_{agency_code}_-NONE-_-NONE-
- FPDS ezsearch endpoint is DEAD. Replacement: SAM.gov Contract Awards API → https://open.gsa.gov/api/contract-awards/
  Full variance doc from FPDS legacy → SAM API: linked from that page. Requires SAM_API_KEY (same free key as opportunities).
  Use this in Phase 4 enrich_fpds.py — rename to enrich_contracts.py. Endpoint: api.sam.gov/prod/contractawards/v1/
  This fills in: contracting officer name, modification history, pricing details — everything FPDS used to provide.
  ⚠️ DO NOT FORGET — Phase 4 enrichment depends on this.
- DO PostgreSQL SSL: set NODE_TLS_REJECT_UNAUTHORIZED=0 in server.js (self-signed cert). Already done.
- API server: start with `cd ~/awardopedia/server && node server.js`
- Dev server: start with `cd ~/awardopedia/web && npm run dev`
- API is proxied via Vite: frontend calls /api/* → localhost:3001

## Ralph Loop
- scripts/ralph/ralph.sh — the loop runner (max 3 iterations, claude tool default)
- scripts/ralph/CLAUDE.md — per-iteration instructions Claude Code reads on startup
- scripts/ralph/progress.txt — iteration history + codebase patterns
- To run: `cd ~/awardopedia && ./scripts/ralph/ralph.sh 1` (one iteration at a time)
- ralph.sh is capped at 3 iterations max. Never run unattended overnight.

## Files changed (Phase 0)
- ~/awardopedia/MASTER_PROMPT.md (new)
- ~/awardopedia/MEMORY.md (new)
- ~/awardopedia/PROGRESS.md (new)
- ~/awardopedia/prd.json (new)
- ~/awardopedia/migrations/001_initial_schema.sql (new)
- ~/awardopedia/web/ (new — React+Vite scaffold)
- ~/awardopedia/web/src/tokens.css
- ~/awardopedia/web/src/index.css
- ~/awardopedia/web/src/App.jsx
- ~/awardopedia/web/src/components/Nav.jsx
- ~/awardopedia/web/src/components/ContractDetail.jsx
- ~/awardopedia/web/src/components/OpportunityDetail.jsx
