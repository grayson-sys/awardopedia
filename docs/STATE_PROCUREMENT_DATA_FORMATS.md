# State Procurement Data Formats Research

## Summary

This document details the data formats, fields, and API structures available from five state procurement systems, mapped against our existing SAM.gov/USASpending schema.

---

## 1. Georgia OCDS API

**Status**: Data publication DISCONTINUED (last update June 2019)
**Format**: OCDS 1.1 (Open Contracting Data Standard)
**Access**: Bulk download (JSON/CSV/Excel) or API

### API Endpoint
```
https://odapi.spa.ge/api/swagger.ui
https://odapi.spa.ge/api/releases/json
```
Note: SSL certificate expired as of March 2026.

### Data Volume (Historical)
- 275,439 tenders
- 183,794 awards
- 183,794 contracts
- 685,004 parties

### OCDS Release Schema Fields

**Top-Level Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `ocid` | string | Global unique identifier for contracting process |
| `id` | string | Release identifier |
| `date` | datetime | Release date |
| `tag` | array | Release type tags (planning, tender, award, contract) |
| `initiationType` | string | Initiation type (tender) |
| `parties` | array | All parties involved |
| `buyer` | object | Entity paying for contract |
| `planning` | object | Planning phase info |
| `tender` | object | Tender/solicitation details |
| `awards` | array | Award information |
| `contracts` | array | Contract details |
| `language` | string | ISO639-1 language code |

**Tender Object Fields**:
| Field | Type | Maps to SAM.gov |
|-------|------|-----------------|
| `tender.id` | string | `noticeId` |
| `tender.title` | string | `title` |
| `tender.description` | string | `description` |
| `tender.status` | string | `active` (Yes/No) |
| `tender.procuringEntity` | object | `fullParentPathName` |
| `tender.items` | array | Classification codes |
| `tender.value.amount` | number | (estimated value) |
| `tender.value.currency` | string | (always USD for SAM) |
| `tender.procurementMethod` | string | `typeOfSetAside` |
| `tender.mainProcurementCategory` | string | goods/works/services |
| `tender.tenderPeriod.startDate` | datetime | `postedDate` |
| `tender.tenderPeriod.endDate` | datetime | `responseDeadLine` |
| `tender.numberOfTenderers` | integer | (not in SAM opps) |
| `tender.documents` | array | PDF attachments |

**Award Object Fields**:
| Field | Type | Maps to USASpending |
|-------|------|---------------------|
| `award.id` | string | `generated_unique_award_id` |
| `award.title` | string | `description` |
| `award.status` | string | (active/cancelled) |
| `award.date` | datetime | `date_signed` |
| `award.value.amount` | number | `total_obligation` |
| `award.suppliers` | array | `recipient` |
| `award.items` | array | PSC/NAICS codes |
| `award.contractPeriod` | object | `period_of_performance` |

**Party/Organization Fields**:
| Field | Type | Maps to |
|-------|------|---------|
| `party.id` | string | (internal ref) |
| `party.name` | string | `recipient.recipient_name` |
| `party.identifier.id` | string | `recipient.recipient_uei` |
| `party.identifier.scheme` | string | (UEI scheme) |
| `party.address.streetAddress` | string | `recipient.location.address_line1` |
| `party.address.locality` | string | `recipient.location.city_name` |
| `party.address.region` | string | `recipient.location.state_code` |
| `party.address.postalCode` | string | `recipient.location.zip5` |
| `party.address.countryName` | string | `recipient.location.country_name` |
| `party.contactPoint.name` | string | `pointOfContact[].fullName` |
| `party.contactPoint.email` | string | `pointOfContact[].email` |
| `party.contactPoint.telephone` | string | `pointOfContact[].phone` |
| `party.roles` | array | buyer/supplier/tenderer |

**Item Classification Fields**:
| Field | Type | Maps to |
|-------|------|---------|
| `item.classification.scheme` | string | NAICS/UNSPSC/CPV |
| `item.classification.id` | string | `naicsCode` / `classificationCode` |
| `item.classification.description` | string | `naics_description` |

---

## 2. California data.ca.gov / Cal eProcure

**Status**: ACTIVE
**Format**: CSV, API (Socrata-based)
**Systems**:
- SCPRS (State Contract & Procurement Registration System) - contracts
- CSCR (California State Contracts Register) - bid opportunities
- Cal eProcure portal - search interface

### Dataset: Purchase Order Data (2012-2015)
URL: https://data.ca.gov/dataset/purchase-order-data

**Tables Available**:
1. Purchase Order (main transactions)
2. Supplier (vendor reference)
3. Department (agency reference)
4. UNSPSC (commodity classification)

### SCPRS Search Fields (Cal eProcure)

**Basic Search**:
| Field | Type | Maps to SAM.gov |
|-------|------|-----------------|
| Agency Name | dropdown | `fullParentPathName` |
| Vendor/Contractor Name | text | `recipient.recipient_name` |
| Contract Number | text | `solicitationNumber` |
| Dollar Value (min/max) | number | `total_obligation` |
| Start Date | date | `period_of_performance.start_date` |
| End Date | date | `period_of_performance.end_date` |
| UNSPSC Code | dropdown | Similar to `classificationCode` (PSC) |

**Advanced Search Fields**:
| Field | Type | Maps to |
|-------|------|---------|
| Contract Type | dropdown | `type_description` |
| Method of Procurement | dropdown | `solicitation_procedures` |
| Small Business Status | checkbox | `typeOfSetAside` |
| DVBE Status | checkbox | `business_categories` |
| Fiscal Year | dropdown | (derived from dates) |

### Expected CSV Columns (from Data Dictionary)
Based on system documentation, likely columns include:
- `purchase_order_id` - unique identifier
- `po_date` - order date
- `department_code` - agency code
- `department_name` - agency name
- `supplier_id` - vendor ID
- `supplier_name` - vendor name
- `unspsc_code` - commodity code
- `unspsc_description` - commodity description
- `line_item_amount` - dollar value
- `total_amount` - total PO value
- `contract_number` - linked contract
- `acquisition_method` - procurement type

---

## 3. Texas ESBD (Electronic State Business Daily)

**Status**: ACTIVE
**Format**: Web scraping required (no public API), CSV export available
**URL**: https://www.txsmartbuy.gov/esbd
**Threshold**: $25,000+ solicitations

### Search/Filter Fields

| Field | Type | Maps to SAM.gov |
|-------|------|-----------------|
| Keyword | text | `title` / `description` |
| Agency/Member Name | dropdown | `fullParentPathName` |
| Agency/Member Number | text | Agency code |
| Solicitation ID | text | `solicitationNumber` |
| NIGP Commodity Code | text | Similar to `classificationCode` |
| Part # | text | (specific item) |
| Status | dropdown | `active` |
| Date Range | date picker | `postedDate` / `responseDeadLine` |

### Status Values
- Posted
- Awarded
- No Award
- Closed
- Posting Cancelled
- Addendum Posted

### Result Columns (Scrapeable)

| Column | Maps to SAM.gov |
|--------|-----------------|
| Solicitation Title | `title` |
| Solicitation ID | `solicitationNumber` |
| Due Date | `responseDeadLine` |
| Due Time | `responseDeadLine` (time component) |
| Agency Number | Agency code from `fullParentPathCode` |
| Status | `active` + `archiveType` |
| Posting Date | `postedDate` |
| Created Date | (internal) |
| Last Updated | (modification date) |

### NIGP Code System
Texas uses NIGP (National Institute of Governmental Purchasing) codes:
- 5-digit class-item format (e.g., "91537")
- Different from federal PSC codes
- Mapping table needed to convert to PSC/NAICS

### CSV Export
- Limited to 20,000 results per export
- Contains same fields as search results

---

## 4. New York Contract Reporter (NYSCR)

**Status**: ACTIVE
**Format**: Web interface, Socrata API for data.ny.gov datasets
**URL**: https://www.nyscr.ny.gov
**Threshold**: $50,000+ opportunities

### Contracting Opportunities Search (NYSCR)

**Search Filters**:
| Field | Type | Maps to SAM.gov |
|-------|------|-----------------|
| Keyword | text | `title` / `description` |
| Date Range | preset/custom | `postedDate` |
| Agency | dropdown | `fullParentPathName` |
| Classifications | multi-select | `baseType` (Commodities, Services, Construction) |
| Categories | multi-select (28 options) | Broad groupings |
| Location (County) | multi-select | `placeOfPerformance.state` |
| Ad Type | dropdown | `type` |
| Set Asides | checkbox | `typeOfSetAside` |
| Contracting Goals | checkbox | MBE/WBE/SDVOB |

**Result Columns**:
| Column | Maps to SAM.gov |
|--------|-----------------|
| Title | `title` |
| CR# | `noticeId` equivalent |
| Agency/Company | `fullParentPathName` |
| Division | Subtier agency |
| Issue Date | `postedDate` |
| Due Date | `responseDeadLine` |
| Location | `placeOfPerformance` |
| Category | Classification type |
| Ad Type | `type` |

### Open Book NY Contract Data (data.ny.gov)

**Dataset**: Procurement Report for State Authorities
**API**: Socrata SODA API
**Endpoint**: `https://data.ny.gov/api/views/ehig-g5x3/rows.json`

**Full Field List**:
| Field Name | Data Type | Maps to |
|------------|-----------|---------|
| `authority_name` | text | `awarding_agency.toptier_agency.name` |
| `fiscal_year_end_date` | date | (fiscal year) |
| `procurements` | text | (has procurements flag) |
| `vendor_name` | text | `recipient.recipient_name` |
| `vendor_address_1` | text | `recipient.location.address_line1` |
| `vendor_address_2` | text | `recipient.location.address_line2` |
| `vendor_city` | text | `recipient.location.city_name` |
| `vendor_state` | text | `recipient.location.state_code` |
| `vendor_postal_code` | text | `recipient.location.zip5` |
| `vendor_province_region` | text | `recipient.location.foreign_province` |
| `vendor_country` | text | `recipient.location.country_name` |
| `procurement_description` | text | `description` |
| `type_of_procurement` | text | `mainProcurementCategory` |
| `award_process` | text | `solicitation_procedures` |
| `award_date` | date | `date_signed` |
| `begin_date` | date | `period_of_performance.start_date` |
| `renewal_date` | date | (extension date) |
| `end_date` | date | `period_of_performance.end_date` |
| `contract_amount` | number | `total_obligation` |
| `fair_market_value` | text | (estimated value) |
| `fmv_explanation` | text | (justification) |
| `amount_expended_for_fiscal_year` | number | (annual spend) |
| `amount_expended_to_date` | number | (cumulative spend) |
| `current_or_outstanding_balance` | number | (remaining) |
| `number_of_bids_or_proposals_received` | number | `number_of_offers_received` |
| `nys_or_foreign_business_enterprise` | text | `domestic_or_foreign_entity` |
| `vendor_is_a_mwbe` | text (Y/N) | `business_categories` contains MWBE |
| `solicited_mwbe` | text (Y/N) | (outreach flag) |
| `number_of_mwbe_proposals` | number | (MWBE bid count) |
| `exempt_from_publishing` | text | (exemption flag) |
| `reason_for_publishing_exemption` | text | (exemption reason) |
| `status` | text | open/completed |
| `transaction_number` | text | Contract/invoice ID |

---

## 5. Florida MFMP / FACTS

**Status**: ACTIVE
**Format**: Web interface (Angular SPA), no public API
**Systems**:
- MFMP (MyFloridaMarketPlace) - solicitations/bids
- VIP (Vendor Information Portal) - vendor search
- FACTS (Florida Accountability Contract Tracking System) - contract data

### MFMP Solicitation Types
| Type | Description | Maps to SAM.gov |
|------|-------------|-----------------|
| ITB | Invitation to Bid (lowest price) | `type` = Solicitation |
| RFP | Request for Proposal (best value) | `type` = Solicitation |
| ITN | Invitation to Negotiate | `type` = Solicitation |
| RFQ | Request for Quote (<$35K) | `type` = Combined Synopsis |

### MFMP Vendor Registration Fields
| Field | Maps to |
|-------|---------|
| FEIN/EIN | `recipient.recipient_unique_id` |
| Florida Sales Tax Number | (state-specific) |
| DUNS/UEI | `recipient.recipient_uei` |
| NIGP Codes | `classificationCode` equivalent |
| Business Categories | `business_categories` |

### FACTS Contract Search Fields

**Main Search**:
| Field | Type | Maps to |
|-------|------|---------|
| Agency Name | dropdown | `awarding_agency` |
| Vendor/Grantor Name | text | `recipient.recipient_name` |
| Dollar Value (From/To) | number | `total_obligation` |
| Beginning Date | date | `period_of_performance.start_date` |
| Ending Date | date | `period_of_performance.end_date` |
| Commodity/Service Type | dropdown (100+) | `naics_description` / PSC |
| Agency Contract ID | text | `piid` equivalent |
| Grant Award ID | text | (grants) |
| MFMP PO Number | text | (purchase order) |

**Advanced Search**:
| Field | Type | Maps to |
|-------|------|---------|
| Minority Vendor Designation | dropdown | `business_categories` |
| FLAIR Contract ID | text | (state system ID) |
| Contract Type | dropdown | `type_description` |
| Method of Procurement | dropdown | `solicitation_procedures` |
| Fiscal Year | dropdown | (derived) |
| Contract Status | dropdown | `status` |
| Administrative Cost | number | (overhead) |
| Periodic Increase | number | (escalation) |
| Purchase Order Status | dropdown | (PO status) |
| Order Date | date | (PO date) |
| Grant Award Type | dropdown | (grants) |
| Grant Award Status | dropdown | (grants) |
| Award Date | date | `date_signed` |

**Result Columns**:
| Column | Maps to |
|--------|---------|
| Agency Name | `awarding_agency` |
| Vendor/Grantor Name | `recipient.recipient_name` |
| Type | contract/grant/PO |
| Agency Contract ID | `piid` |
| Grant Award ID | (grants) |
| PO Number | (purchase order) |
| Total Amount | `total_obligation` |
| Commodity/Service Type | `naics_description` |

---

## Field Mapping Summary

### Core Identifier Fields
| Our Schema | Georgia OCDS | California | Texas ESBD | New York | Florida |
|------------|--------------|------------|------------|----------|---------|
| `noticeId` | `ocid` | contract_number | solicitation_id | CR# | agency_contract_id |
| `solicitationNumber` | `tender.id` | contract_number | solicitation_id | CR# | agency_contract_id |
| `title` | `tender.title` | (description) | solicitation_title | title | procurement_description |

### Agency Fields
| Our Schema | Georgia OCDS | California | Texas ESBD | New York | Florida |
|------------|--------------|------------|------------|----------|---------|
| `fullParentPathName` | `buyer.name` | department_name | agency_name | agency | agency_name |
| `officeAddress.state` | `buyer.address.region` | (CA) | (TX) | location | (FL) |

### Vendor Fields
| Our Schema | Georgia OCDS | California | Texas ESBD | New York | Florida |
|------------|--------------|------------|------------|----------|---------|
| `recipient.recipient_name` | `parties[supplier].name` | supplier_name | (in award) | vendor_name | vendor_name |
| `recipient.recipient_uei` | `parties[].identifier.id` | supplier_id | N/A | N/A | FEIN |
| `recipient.location.city` | `parties[].address.locality` | (lookup) | N/A | vendor_city | vendor_city |
| `recipient.location.state` | `parties[].address.region` | (lookup) | N/A | vendor_state | vendor_state |

### Financial Fields
| Our Schema | Georgia OCDS | California | Texas ESBD | New York | Florida |
|------------|--------------|------------|------------|----------|---------|
| `total_obligation` | `award.value.amount` | total_amount | N/A | contract_amount | total_amount |
| (estimated) | `tender.value.amount` | N/A | N/A | fair_market_value | N/A |

### Date Fields
| Our Schema | Georgia OCDS | California | Texas ESBD | New York | Florida |
|------------|--------------|------------|------------|----------|---------|
| `postedDate` | `tender.tenderPeriod.startDate` | po_date | posting_date | issue_date | (order_date) |
| `responseDeadLine` | `tender.tenderPeriod.endDate` | N/A | due_date + due_time | due_date | N/A |
| `date_signed` | `award.date` | N/A | N/A | award_date | award_date |
| `period_of_performance.start` | `contract.period.startDate` | start_date | N/A | begin_date | beginning_date |
| `period_of_performance.end` | `contract.period.endDate` | end_date | N/A | end_date | ending_date |

### Classification Fields
| Our Schema | Georgia OCDS | California | Texas ESBD | New York | Florida |
|------------|--------------|------------|------------|----------|---------|
| `naicsCode` | `item.classification.id` (NAICS) | N/A | N/A | N/A | N/A |
| `classificationCode` (PSC) | `item.classification.id` (CPV) | unspsc_code | nigp_code | category | commodity_type |
| `typeOfSetAside` | `tender.procurementMethod` | sb_status | N/A | set_asides | minority_vendor |

---

## Technical Implementation Notes

### API Availability
| State | API | Auth | Rate Limit |
|-------|-----|------|------------|
| Georgia | REST (expired cert) | None | Unknown |
| California | Socrata SODA | API key optional | Standard |
| Texas | None (scrape) | N/A | N/A |
| New York | Socrata SODA | API key optional | Standard |
| Florida | None (scrape) | N/A | N/A |

### Classification Code Mapping Required
1. **NIGP to NAICS/PSC**: Texas uses NIGP codes - need mapping table
2. **UNSPSC to NAICS/PSC**: California uses UNSPSC - need mapping table
3. **NY Categories to NAICS**: Need to map 28 NY categories to NAICS
4. **FL Commodity Types to NAICS**: Florida has 100+ commodity types

### Data Refresh Frequency
| State | Frequency | Notes |
|-------|-----------|-------|
| Georgia | Discontinued | Historical only |
| California | Daily/Weekly | Via portal |
| Texas | Real-time | Web interface |
| New York | Quarterly | Authority reports |
| Florida | Real-time | FACTS/MFMP |

---

## Recommended Pipeline Approach

### Phase 1: API-First States
1. **New York (data.ny.gov)** - Socrata API, well-documented schema
2. **California (data.ca.gov)** - Socrata API, purchase order data

### Phase 2: Scraping Required
3. **Texas ESBD** - Scrape search results, use CSV export
4. **Florida FACTS** - Scrape contract data, Angular SPA challenges

### Phase 3: Historical/OCDS
5. **Georgia** - Bulk download historical OCDS data only

### Normalization Pipeline
```
State Data -> Parse -> Normalize Classification Codes ->
Map to SAM.gov Schema -> Enrich with Canonical Lookups ->
Store in opportunities/contracts tables
```

---

## Sources

- [Georgia OCDS Publication](https://data.open-contracting.org/en/publication/24)
- [OCDS Schema Reference](https://standard.open-contracting.org/latest/en/schema/)
- [California Purchase Order Data](https://data.ca.gov/dataset/purchase-order-data)
- [Cal eProcure Portal](https://caleprocure.ca.gov/)
- [Texas ESBD](https://www.txsmartbuy.gov/esbd)
- [Texas Comptroller Open Data](https://comptroller.texas.gov/transparency/open-data/contracts.php)
- [NY Contract Reporter](https://www.nyscr.ny.gov/)
- [NY Open Data Procurement](https://data.ny.gov/Transparency/Procurement-Report-for-State-Authorities/ehig-g5x3)
- [Open Book New York](https://wwe2.osc.state.ny.us/transparency/contracts/contractsearch.cfm)
- [Florida MFMP](https://vendor.myfloridamarketplace.com/search/bids)
- [Florida FACTS](https://facts.fldfs.com/)
- [Florida FACTS FAQ](https://myfloridacfo.com/factshelp/facts-faq)
