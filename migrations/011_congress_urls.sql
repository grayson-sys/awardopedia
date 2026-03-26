-- Migration: Add congress member URLs for contracts
-- Like opportunity_intel, links congressional district to representative's website

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS recipient_congress_url TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS pop_congress_url TEXT;

-- Index for filtering by district (useful for congressional research)
CREATE INDEX IF NOT EXISTS idx_contracts_recipient_district
    ON contracts(recipient_state, recipient_congressional_district);
CREATE INDEX IF NOT EXISTS idx_contracts_pop_district
    ON contracts(pop_state, pop_congressional_district);
