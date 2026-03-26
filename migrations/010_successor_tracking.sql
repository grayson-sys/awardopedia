-- Add successor tracking columns to contracts table

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS successor_piid VARCHAR(100);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS successor_recipient TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS successor_amount NUMERIC(18,2);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS successor_start_date DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS successor_confidence NUMERIC(3,2);  -- 0.00 to 1.00
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS incumbent_retained BOOLEAN;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS successor_checked_at TIMESTAMP;

-- Index for finding contracts needing successor check
CREATE INDEX IF NOT EXISTS idx_contracts_successor_check
ON contracts (end_date, successor_checked_at)
WHERE end_date < CURRENT_DATE AND successor_checked_at IS NULL;
