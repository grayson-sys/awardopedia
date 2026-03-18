-- Migration 002: Enrich contracts table with all USASpending fields
-- Run as doadmin

-- Fix usaspending_url: drop generated column, replace with plain text
-- (generated column used bare PIID — correct URL needs generated_unique_award_id)
ALTER TABLE contracts DROP COLUMN IF EXISTS usaspending_url;
ALTER TABLE contracts ADD COLUMN usaspending_url TEXT;

-- Solicitation
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS solicitation_number VARCHAR(255);

-- Dates
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS date_signed DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS last_modified_date DATE;

-- Place of performance (where the work happens — often different from recipient address)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS pop_city VARCHAR(255);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS pop_state VARCHAR(2);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS pop_zip VARCHAR(10);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS pop_county VARCHAR(255);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS pop_congressional_district VARCHAR(10);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS pop_country VARCHAR(3);

-- Recipient enrichment (full address was in JSON, never stored)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS recipient_county VARCHAR(255);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS recipient_congressional_district VARCHAR(10);

-- Vendor classification
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS business_categories JSONB;

-- Contract details from FPDS transaction data
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS major_program VARCHAR(255);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS sole_source_authority TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS commercial_item VARCHAR(255);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS labor_standards BOOLEAN;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS subcontracting_plan VARCHAR(255);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS pricing_type VARCHAR(100);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS solicitation_procedures VARCHAR(255);

-- Funding vs awarding agency (can differ)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS funding_agency_name VARCHAR(500);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS funding_office_name VARCHAR(500);

-- Indexes for new geo fields
CREATE INDEX IF NOT EXISTS idx_contracts_pop_state ON contracts(pop_state);
CREATE INDEX IF NOT EXISTS idx_contracts_solicitation ON contracts(solicitation_number);
