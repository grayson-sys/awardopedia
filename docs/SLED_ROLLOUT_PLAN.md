# SLED Data Rollout Plan

## Overview

Phased rollout of State, Local, Education, District (SLED) procurement data, adapting our federal pipelines to handle state-level variations.

**Approach:** One Perfect Record per state → Pipeline validation → Production rollout

---

## Priority Order (by data quality + market size)

| Phase | State | GDP Rank | Data Source | API? | Effort |
|-------|-------|----------|-------------|------|--------|
| 1 | New York | #3 | data.ny.gov | ✅ Socrata | Low |
| 2 | California | #1 | data.ca.gov | ✅ Socrata | Medium (UNSPSC mapping) |
| 3 | Texas | #2 | ESBD | ❌ CSV/Scrape | Medium |
| 4 | Florida | #4 | MFMP/FACTS | ❌ Scrape | High |
| 5 | Illinois | #5 | BidBuy | ❌ Scrape | High |

---

## Phase 1: New York (Pilot State)

### Data Source
- **Portal:** data.ny.gov (Socrata-powered)
- **Dataset:** State Contracts and Amendments
- **API:** `https://data.ny.gov/resource/xxxxx.json` (SODA 2.0)
- **Records:** ~50,000+ contracts

### Field Mapping to Awardopedia Schema

| NY Field | Our Field | Notes |
|----------|-----------|-------|
| `contract_number` | `piid` | State contract ID |
| `vendor_name` | `recipient_name` | |
| `vendor_address_line_1` | `recipient_address` | |
| `vendor_city` | `recipient_city` | |
| `vendor_state` | `recipient_state` | |
| `vendor_zip_code` | `recipient_zip` | |
| `agency_name` | `agency_name` | State agency |
| `contract_amount` | `award_amount` | |
| `start_date` | `start_date` | |
| `end_date` | `end_date` | |
| `contract_description` | `description` | |
| `award_date` | `date_signed` | |
| `award_method` | `competition_type` | Needs mapping |
| `number_of_bids_or_proposals_received` | `number_of_offers` | Bonus field! |
| `status` | `status` | Active/Expired |
| `mwbe` | `is_small_business` | Minority/Women-owned |

### New Fields (SLED-specific)
```sql
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS data_source VARCHAR(20); -- 'federal', 'ny', 'ca', etc.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS state_contract_id VARCHAR(50);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS procurement_method VARCHAR(100);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS mwbe_status VARCHAR(50);
```

### Pipeline Adaptation

```
Stage 1: Fetch (new)
  └─ fetch_ny_contracts.py
  └─ Socrata API pagination
  └─ Save raw JSON

Stage 2: Normalize (adapt)
  └─ Map NY fields → our schema
  └─ Set data_source = 'ny'
  └─ Handle NY-specific codes

Stage 3-7: Reuse existing pipeline
  └─ PDF download (if attachments exist)
  └─ Classification
  └─ AI extraction
  └─ Summary generation
  └─ NAICS/PSC lookup (may need NY category mapping)
```

### One Perfect Record Checklist
- [ ] Fetch single contract from NY API
- [ ] Map all fields correctly
- [ ] Store in contracts table with data_source='ny'
- [ ] Verify display in UI (recipient, dates, amounts)
- [ ] Run through AI summary (Stage 6)
- [ ] Confirm NAICS lookup works
- [ ] Test congressional district lookup (NY addresses)

---

## Phase 2: California

### Data Source
- **Portal:** data.ca.gov (Socrata-powered)
- **Dataset:** Purchase Order Data
- **Challenge:** Uses UNSPSC codes, not NAICS

### Additional Work Required
1. **UNSPSC → NAICS mapping table**
   - Download UNSPSC hierarchy
   - Create crosswalk table
   - ~20,000 UNSPSC codes → ~1,200 NAICS

2. **Cal eProcure Integration** (optional)
   - Apitude API for live solicitations
   - Paid service, evaluate ROI

### One Perfect Record Checklist
- [ ] Fetch single CA purchase order
- [ ] Map UNSPSC to NAICS
- [ ] Verify classification displays correctly
- [ ] Full pipeline run

---

## Phase 3: Texas

### Data Source
- **Portal:** txsmartbuy.gov/esbd
- **Access:** Web scraping + CSV export (max 20K records)
- **Challenge:** Uses NIGP codes

### Scraper Requirements
```python
# Texas ESBD Scraper
- Login handling (if required for full data)
- Search by date range
- Export to CSV
- Parse NIGP codes
```

### Additional Work Required
1. **NIGP → NAICS mapping table**
   - NIGP (National Institute of Governmental Purchasing) codes
   - Crosswalk available from NIGP organization

---

## Phase 4: Florida

### Data Source
- **Portal:** myfloridamarketplace.com
- **Access:** Angular SPA scraping (harder)
- **Secondary:** FACTS transparency portal

### Scraper Requirements
- Selenium/Playwright for SPA
- Handle pagination
- Extract from dynamic tables

---

## Phase 5: Illinois

### Data Source
- **Portal:** bidbuy.illinois.gov
- **Access:** Web scraping

---

## Code Classification Crosswalks

### Tables Needed

```sql
-- UNSPSC to NAICS/PSC (California)
CREATE TABLE unspsc_naics_map (
  unspsc_code VARCHAR(10) PRIMARY KEY,
  unspsc_description TEXT,
  naics_code VARCHAR(10),
  psc_code VARCHAR(10),
  confidence DECIMAL(3,2)
);

-- NIGP to NAICS/PSC (Texas, Florida)
CREATE TABLE nigp_naics_map (
  nigp_code VARCHAR(10) PRIMARY KEY,
  nigp_description TEXT,
  naics_code VARCHAR(10),
  psc_code VARCHAR(10),
  confidence DECIMAL(3,2)
);

-- NY Category Codes
CREATE TABLE ny_category_naics_map (
  ny_category VARCHAR(100) PRIMARY KEY,
  naics_code VARCHAR(10)
);
```

---

## UI Considerations

### State Filter
```jsx
// Add to search/filter UI
<select name="data_source">
  <option value="">All Sources</option>
  <option value="federal">Federal (SAM.gov)</option>
  <option value="ny">New York</option>
  <option value="ca">California</option>
  <!-- Add as we roll out -->
</select>
```

### State Badge
```jsx
// Show data source on contract cards
{contract.data_source !== 'federal' && (
  <Badge>{contract.data_source.toUpperCase()}</Badge>
)}
```

---

## Timeline Estimate

| Phase | State | Research | Build | Test | Production |
|-------|-------|----------|-------|------|------------|
| 1 | NY | Done | 2 days | 1 day | Week 1 |
| 2 | CA | 1 day | 3 days | 1 day | Week 2-3 |
| 3 | TX | 1 day | 4 days | 2 days | Week 4-5 |
| 4 | FL | 2 days | 5 days | 2 days | Week 6-8 |
| 5 | IL | 1 day | 4 days | 2 days | Week 9-10 |

---

## Success Metrics

Per state launch:
- [ ] 1,000+ contracts ingested
- [ ] 95%+ field mapping accuracy
- [ ] AI summaries generating
- [ ] No UI errors on state data
- [ ] Congressional district lookup working

---

## Next Steps

1. **Create `fetch_ny_contracts.py`** — Socrata API fetcher
2. **Run One Perfect Record** — Single NY contract through full pipeline
3. **Validate UI display** — Ensure NY contracts render correctly
4. **Build UNSPSC mapping** — Prep for California
5. **Scale NY to full dataset** — All 50K+ contracts
