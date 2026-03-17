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

## In progress
Waiting for user to say "go" for Phase 1.

## Next 3 steps
1. Pull llama3.2:3b: `ollama pull llama3.2:3b` (2GB download, do this now so it's ready for Phase 3)
2. Phase 1: Write fetch_one_contract.py for PIID FA8773-24-C-0001
3. Phase 1: Display real record end-to-end before fetching any more

## Known gotchas
- DB tables were created by doadmin — app user (awardopedia_user) needs grants after any CREATE TABLE. Always use doadmin for DDL, app user for DML.
- Previous agent spawned unbounded ingest overnight → 1.62M records. NEVER run ingest without --limit flag. Always test with --limit 10 first.
- Vercel token still in .env (VERCEL_TOKEN) — not needed anymore. Leave it, don't delete.
- Frontend has no router yet — single page with state-based view switching. Add react-router when Phase 6 (API key registration page) is needed.

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
