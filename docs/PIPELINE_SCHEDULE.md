# Pipeline Processing Schedule

## Measured Times (per 1,000 records)

| Stage | What | Time | Notes |
|-------|------|------|-------|
| 1 | Ingest + cleanup | 15 min | Contact cleanup, title cleanup, NAICS title-case |
| 2-4 | PDFs + classify + extract | 2h 52min | SAM.gov v3 resources API + pdftotext + regex extraction |
| 7 | Enrichment + office codes | 55 min first / 30 min cached | NAICS/PSC lookup, agency norm, office AI cache |
| 6 | AI summaries | 4h 10min | Claude Sonnet via OAuth proxy, 8.7M tokens/1000 records |
| 8-9 | Congressional + links | (included in 2-4) | ZIP lookup + HEAD checks |
| QA | Quality check | 10 min | 100-record sample + AI spot-check |
| **Total** | **First batch** | **8.4 hours** | |
| **Total** | **Subsequent** | **8.0 hours** | Office codes cached |

## Schedule to 26,000 Records

- **Done:** 2,000 (batch 1 complete, batch 2 in progress)
- **Remaining:** 24,000 (24 batches of 1,000)
- **SAM.gov API:** 24 calls needed, 10/day limit = 2.4 days of fetching
- **Processing bottleneck:** 8 hours per batch

### Option A: 24h continuous (3 batches/day)
- **8 days** to complete all 26,000

### Option B: Overnight only (2 batches/day)
- **12 days** to complete all 26,000

### Option C: With SAM.gov Role (1000 calls/day)
- Could fetch all 26K in one day, then process over 8 days

## Cost
- OAuth proxy: **$0** (flat rate via Claude Max subscription)
- If API key: ~$839 for 210M tokens
- Disk space: ~72GB for PDFs
- SAM.gov API: Free (within daily limits)

## Timing measured 2026-03-21 on Mac Mini (M-series, local processing)
