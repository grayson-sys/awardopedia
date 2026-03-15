# Awardopedia Data Model

## Overview

PostgreSQL 15 with pg_trgm and unaccent extensions for full-text and fuzzy search.

Data is sourced from USASpending.gov and synchronized weekly via the sync script.

## Tables

### awards

Core table storing federal contract award records.

| Column | Type | Description |
|--------|------|-------------|
| award_id | SERIAL PK | Internal ID |
| award_id_piid | VARCHAR(100) | Procurement Instrument Identifier |
| parent_award_piid | VARCHAR(100) | Parent award PIID |
| award_type | VARCHAR(50) | Contract, Grant, Loan, etc. |
| action_type | VARCHAR(20) | NEW, CONTINUATION, MODIFICATION |
| agency_code | VARCHAR(20) | Awarding agency code |
| agency_name | TEXT | Awarding agency name |
| sub_agency_name | TEXT | Sub-agency name |
| office_name | TEXT | Office name |
| awarding_agency_code | VARCHAR(20) | Awarding agency code |
| funding_agency_code | VARCHAR(20) | Funding agency code |
| recipient_uei | VARCHAR(20) | Unique Entity Identifier |
| recipient_duns | VARCHAR(20) | DUNS number (legacy) |
| recipient_name | TEXT | Contractor name |
| recipient_city | TEXT | Contractor city |
| recipient_state | CHAR(2) | Contractor state |
| recipient_zip | VARCHAR(10) | Contractor ZIP |
| recipient_country | CHAR(3) | Country code (default USA) |
| business_types | JSONB | Small business, woman-owned, etc. |
| federal_action_obligation | NUMERIC(18,2) | Dollar amount obligated |
| current_total_value | NUMERIC(18,2) | Current total value |
| potential_total_value | NUMERIC(18,2) | Potential total value (with options) |
| action_date | DATE | Date of action |
| period_of_performance_start | DATE | Performance start date |
| period_of_performance_end | DATE | Original end date |
| period_of_performance_current_end | DATE | Current end date |
| naics_code | VARCHAR(10) | NAICS industry code |
| naics_description | TEXT | NAICS description |
| psc_code | VARCHAR(10) | Product/Service Code |
| psc_description | TEXT | PSC description |
| contract_type | VARCHAR(100) | Contract pricing type |
| description | TEXT | Award description |
| place_of_performance_city | TEXT | Work location city |
| place_of_performance_state | CHAR(2) | Work location state |
| place_of_performance_zip | VARCHAR(10) | Work location ZIP |
| usaspending_id | VARCHAR(100) UNIQUE | USASpending unique key |
| usaspending_url | TEXT | Direct link to USASpending |
| last_modified_date | DATE | Last modified |
| created_at | TIMESTAMPTZ | Record created |
| updated_at | TIMESTAMPTZ | Record updated |

**Indexes:** Full-text search (GIN), trigram (gin_trgm_ops), agency_code, recipient_uei, naics_code, action_date, state, value, type, PIID.

### agencies

Aggregated agency data.

| Column | Type | Description |
|--------|------|-------------|
| agency_id | SERIAL PK | Internal ID |
| agency_code | VARCHAR(20) UNIQUE | Agency code |
| agency_name | TEXT | Agency name |
| sub_agency_name | TEXT | Sub-agency |
| office_name | TEXT | Office |
| total_awarded | NUMERIC(18,2) | Total dollar value |
| award_count | INTEGER | Number of awards |
| avg_award_value | NUMERIC(18,2) | Average award value |
| top_naics | JSONB | Top NAICS codes [{code, name, pct}] |
| top_contractors | JSONB | Top contractors [{name, uei, total}] |
| last_award_date | DATE | Most recent award |

### contractors

Aggregated contractor data.

| Column | Type | Description |
|--------|------|-------------|
| contractor_id | SERIAL PK | Internal ID |
| uei | VARCHAR(20) UNIQUE | Unique Entity Identifier |
| duns | VARCHAR(20) | DUNS number (legacy) |
| name | TEXT | Company name |
| doing_business_as | TEXT | DBA name |
| city | TEXT | City |
| state_code | CHAR(2) | State |
| zip | VARCHAR(10) | ZIP code |
| country_code | CHAR(3) | Country (default USA) |
| business_types | JSONB | Business type flags |
| naics_primary | VARCHAR(10) | Primary NAICS |
| total_awarded | NUMERIC(18,2) | Total dollar value |
| award_count | INTEGER | Number of awards |

### naics_codes

NAICS industry code reference with aggregated stats.

| Column | Type | Description |
|--------|------|-------------|
| naics_code | VARCHAR(10) PK | NAICS code |
| title | TEXT | NAICS title |
| description | TEXT | Description |
| sector | VARCHAR(10) | Sector code |
| subsector | VARCHAR(10) | Subsector code |
| total_awarded | NUMERIC(18,2) | Total dollar value |
| award_count | INTEGER | Number of awards |
| avg_award_value | NUMERIC(18,2) | Average award value |
| top_agencies | JSONB | Top agencies |
| top_contractors | JSONB | Top contractors |

### users

User accounts for AI credit system.

| Column | Type | Description |
|--------|------|-------------|
| user_id | SERIAL PK | Internal ID |
| email | VARCHAR(255) UNIQUE | User email |
| credits | INTEGER | Current credit balance |
| total_credits_purchased | INTEGER | Lifetime credits purchased |
| magic_token | VARCHAR(100) | Current magic link token |
| magic_expires | TIMESTAMPTZ | Token expiry |
| last_login | TIMESTAMPTZ | Last login time |

### credit_purchases

Stripe payment records.

| Column | Type | Description |
|--------|------|-------------|
| purchase_id | SERIAL PK | Internal ID |
| user_id | INTEGER FK | User reference |
| stripe_session_id | VARCHAR(200) UNIQUE | Checkout session |
| stripe_payment_id | VARCHAR(200) | Payment intent |
| credits_purchased | INTEGER | Credits bought |
| amount_cents | INTEGER | Amount paid in cents |
| status | VARCHAR(20) | pending, complete, refunded |

### credit_usage

AI credit consumption log.

| Column | Type | Description |
|--------|------|-------------|
| usage_id | SERIAL PK | Internal ID |
| user_id | INTEGER FK | User reference |
| award_id | INTEGER FK | Award analyzed |
| action | VARCHAR(50) | analyze, summarize, compare |
| credits_used | INTEGER | Credits consumed |
| result | TEXT | Cached AI response |

## Views

### expiring_contracts

Virtual table of contracts ending within 180 days with `days_remaining` calculation.

## Triggers

`set_updated_at()` — automatically updates `updated_at` on row modification for awards, agencies, contractors, and naics_codes tables.
