-- Migration 017: Add company enrichment columns to contracts
-- Allows storing company info directly on contracts (useful for SLED data without UEI)

ALTER TABLE contracts
ADD COLUMN IF NOT EXISTS company_brief TEXT,
ADD COLUMN IF NOT EXISTS company_ticker VARCHAR(10),
ADD COLUMN IF NOT EXISTS company_market_cap NUMERIC;

-- Index for finding unenriched contracts
CREATE INDEX IF NOT EXISTS idx_contracts_company_brief_null
ON contracts (data_source) WHERE company_brief IS NULL;

COMMENT ON COLUMN contracts.company_brief IS 'Brief description of contractor (from Yahoo Finance for public, Ollama for private)';
COMMENT ON COLUMN contracts.company_ticker IS 'Stock ticker if public company';
COMMENT ON COLUMN contracts.company_market_cap IS 'Market cap in dollars if public company';
