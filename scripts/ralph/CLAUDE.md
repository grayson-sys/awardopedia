# Ralph Agent Instructions — Awardopedia

You are an autonomous coding agent working on the Awardopedia project.

## Your Task

1. Read `prd.json` (two directories up from this file: `../../prd.json`)
2. Read `progress.txt` (check **Codebase Patterns** section first)
3. Check you are on the correct feature branch from the PRD `branchName`. If not, check it out or create it from main.
4. Pick the **highest priority** story where `passes: false`
5. Implement that **single story** — nothing else
6. Run quality checks (see Quality Requirements below)
7. Update any nearby CLAUDE.md files if you discover reusable patterns
8. If checks pass, commit ALL changes with message: `feat: Phase {id} - {title}`
9. Update `prd.json` — set `passes: true` for the completed story
10. Append your progress to `progress.txt`
11. If all stories are `passes: true`, emit `<promise>COMPLETE</promise>`

---

## Project Context

**What is Awardopedia?**
Free federal contract intelligence platform. Users research government contract awards and upcoming solicitations. Revenue via AI-powered report credits (Claude API, sold via Stripe).

**Stack:**
- Frontend: React + Vite → `web/` → deployed as DO App Platform static site
- API: Node.js/Express → `server/server.js` (1,100+ lines) → deployed as DO App Platform service
- DB: DO Managed PostgreSQL 15 (cloud). `DATABASE_URL` in `.env`.
- Scripts: Python 3 via `.venv` (`~/awardopedia/.venv/bin/python3`)
- DO App URL: https://awardopedia.com

**Critical files:**
- `server/server.js` — all API routes
- `web/src/App.jsx` — frontend routing
- `.env` — all secrets (NEVER commit)
- `prd.json` — task list (you update this)
- `scripts/ralph/progress.txt` — your memory

**DB connection:** Uses `DATABASE_URL` env var. Node uses `pg` with `$1/$2` params. Python uses `psycopg2` with `%s` params. Both require `NODE_TLS_REJECT_UNAUTHORIZED=0` on DO.

---

## Quality Requirements

Before every commit:
```bash
cd ~/awardopedia/web && npm run build
```
The build must pass clean (zero errors). Do NOT commit broken code.

If server.js changed, verify it parses without syntax errors:
```bash
node --check ~/awardopedia/server/server.js
```

---

## STOP Rules — Do NOT Do These Without Human Approval

These actions require the human to say **FIREFLY** first. If your phase requires any of the following, STOP, describe exactly what you intend to do, and write "Awaiting FIREFLY." in your output. Do not proceed until you receive FIREFLY.

- Deploy to production (git push origin main)
- Any DB migration on the live production database
- Delete records or tables from production
- Run any SAM.gov API call (rate-limited: 10/day personal key)
- Any paid API call (Anthropic/Claude, Stripe test → live, SendGrid)
- Change DO App spec or Cloudflare DNS

**For Phase 8 specifically:** Stripe test mode is fine for wiring up the integration. Do NOT switch to live Stripe keys or make real charges without FIREFLY.

---

## Progress Report Format

APPEND to `scripts/ralph/progress.txt` (never replace):
```
## [Date] - Phase {id} - {title}
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered
  - Gotchas encountered
  - Useful context
---
```

## Codebase Patterns (consolidate reusable knowledge at TOP of progress.txt)

Key patterns already known — check progress.txt for the full list. Highlights:
- DB DDL: always use `doadmin` credentials. `awardopedia_user` for DML only. `GRANT` after every `CREATE TABLE`.
- Python DB inserts: use `%s` placeholders (psycopg2), NOT `$1/$2` (Node.js pattern).
- Frontend build: `cd ~/awardopedia/web && npm run build` must pass before any commit.
- VARCHAR(2) fields for state codes — truncate to 2 chars before insert.
- Never put secrets in MEMORY.md or progress.txt — GitHub secret scanning blocks the push.
- prd.json uses `passes: true/false` (not `status`).

---

## Current Phase Details

The next incomplete phase is determined by `prd.json` (`passes: false`). As of this writing, **Phase 8** is next:

### Phase 8: Report Generation + Stripe + PDF/CSV + Caching

**What to build:**
1. **Credit system** — `credits` table in DB (user_id, balance, created_at). For now, no auth — use session token or anonymous purchase tied to email.
2. **Stripe Checkout** — three credit packs already configured in Stripe:
   - Starter: `price_1TBNL847350RugxrNcVcMsAT` ($9 / 100 credits)
   - Pro: `price_1TBNL947350RugxrkUlb8rUY` ($29 / 500 credits)
   - Power: `price_1TBNL947350Rugxr4ilhHzTv` ($79 / 2,000 credits)
   - Webhook: `we_1TBNLj47350RugxrXSXwotWc`
3. **Report generation** — Claude API fills fixed XML report template (7 sections). Cost ~$0.023/report. Sell at $0.33/report (1 credit = $0.033, report costs 1 credit from user's balance).
4. **PDF + CSV** — generate downloadable versions of each report using `pdfkit` (Python) or a Node library.
5. **Caching** — store generated reports in DO Spaces (bucket `awardopedia-static`). Second request for same PIID serves cached version. Cache key: `reports/{piid}.json`. 90-day TTL.
6. **UI** — "Generate Report" button on ContractDetail.jsx and OpportunityDetail.jsx. Redirects to Stripe Checkout if no credits. Shows report inline after generation.

**API routes to add in server/server.js:**
- `POST /api/reports/purchase` → create Stripe Checkout session
- `GET /api/reports/success` → Stripe success redirect, credit user account
- `POST /api/reports/generate/:piid` → deduct 1 credit, call Claude, return report JSON
- `GET /api/reports/:piid` → return cached report if exists

**STOP before:**
- Switching Stripe from test to live keys → FIREFLY required
- Running any real Claude API call in production → FIREFLY required

Use `ANTHROPIC_API_KEY` from `.env` for Claude calls. Model: `claude-3-5-haiku-20241022` (cheapest, fast enough for reports).

**Report template** (7 sections — fill each from contract/opportunity data):
1. Executive Summary (2-3 sentences)
2. Opportunity Assessment (what this contract is, why it matters)
3. Competitive Landscape (incumbent info if available, small biz set-asides)
4. Technical Requirements (from description/SOW)
5. Contracting Officer Intelligence (CO name, email, phone if available)
6. Bid Strategy (concrete recommendations)
7. Risk Factors (what could disqualify a bidder)

---

When you are done with your phase and the build passes, commit, update prd.json, update progress.txt, and stop. Do not start the next phase.
