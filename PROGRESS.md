# Awardopedia Progress
Last updated: 2025-03-17

## Phases
[x] Phase 0: Audit and stabilize existing work
[x] Phase 1: One perfect past contract record (USASpending API + FPDS enrichment)
[ ] Phase 2: One perfect upcoming opportunity record (SAM.gov API)
[ ] Phase 3: LLAMA summaries for both record types
[ ] Phase 4: Always-on background scraper scripts
[ ] Phase 5: Weekly dead-link checker script
[x] Phase 6: Public read API + API key system + llms.txt + TOS
[ ] Phase 7: SEO static HTML page generation + DO Spaces + Cloudflare CDN
[ ] Phase 8: Report generation + Stripe payment + PDF/CSV output + report caching
[ ] Phase 9: Auth system stub (scaffold only, do not build)

## Key values (IDs and URLs only — no secrets)
CLOUDFLARE_ZONE_ID: 5afbac2e8719ddb65bf709d3a4c4036f
DO_APP_ID: f3d120f9-452c-4368-9160-6754496f0b80
DO_DB_ID: cceb6c14-1eeb-4e42-b324-1a19e74ec9ca
DO_SPACES_BUCKET: awardopedia-static (not yet created)
GITHUB_REPO_URL: github.com/grayson-sys/awardopedia
DO_APP_URL: https://awardopedia-zf662.ondigitalocean.app
DO_API_URL: https://api.awardopedia.com (future Phase 6)
STRIPE_PRODUCT_ID: prod_U9gipmrwKbuGiI
OLLAMA_MODEL: llama3.2:3b

---

## 2026-03-17 — Session Notes

### Completed this session
- Full USASpending enrichment: 58 fields per contract record
- New DB columns: place of performance, solicitation number, business categories,
  sole source authority, date signed, last modified, congressional districts
- enrich_usaspending.py: fetches all available fields, verifies USASpending URL
- Fixed usaspending_url (was bare PIID → now uses generated_unique_award_id)
- Report prompt updated to use all 58 fields
- max_tokens bumped 1500→2500 (full prompt needs more room)
- SAM_API_KEY obtained (expires 2026-06-13, ~10 calls/day on personal tier)
- Discovered SAM.gov personal API = 10 req/day — bulk data via file download instead
- DEV_NOTES.md created with rate limit rules

### Next: 100 Perfect Records
- Use USASpending (no SAM.gov calls needed, no rate limit)
- Script: scripts/fetch_100_contracts.py
- Search for diverse DoD professional services contracts
- Enrich all 100 with same pipeline as NISGAA record
- Can do anytime — NOT blocked on SAM.gov reset

### Next: Phase 2 — Opportunities
- SAM.gov Data Services bulk file download (preferred — no API calls)
- sam.gov/data-services → Contract Opportunities → daily ZIP
- Script: scripts/bulk_fetch_opportunities.py
- Then: scripts/sync_opportunities_daily.py for nightly delta

### Phase sequence
Phase 1: One perfect contract record ✅ DONE
Phase 1b: 100 diverse contract records — NEXT
Phase 2: Opportunities (active solicitations) — after 1b
Phase 3: LLAMA summaries on all records
Phase 4: SAM.gov enrichment (contracting officer names)
Phase 5+: Scale, SEO pages, deploy
