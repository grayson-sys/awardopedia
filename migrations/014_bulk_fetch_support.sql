-- Migration: Support for bulk fetch and modification tracking

-- Base PIID for grouping modifications
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS base_piid VARCHAR(100);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS modification_number VARCHAR(20);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMP;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS usaspending_id VARCHAR(100);

-- Index for modification grouping
CREATE INDEX IF NOT EXISTS idx_contracts_base_piid ON contracts(base_piid);
CREATE INDEX IF NOT EXISTS idx_contracts_fetched ON contracts(fetched_at);

-- Watched contracts for incumbent alerts / recompete tracking
CREATE TABLE IF NOT EXISTS watched_contracts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    piid VARCHAR(100) NOT NULL,
    base_piid VARCHAR(100),
    notify_days_before INTEGER DEFAULT 180,  -- Alert X days before expiration
    notify_on_recompete BOOLEAN DEFAULT true,
    notify_on_award BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    last_notified_at TIMESTAMP,
    UNIQUE(user_id, piid)
);

-- Expiring contracts view (for alerts)
CREATE OR REPLACE VIEW expiring_contracts AS
SELECT
    c.piid,
    c.base_piid,
    c.recipient_name,
    c.agency_name,
    c.award_amount,
    c.end_date,
    (c.end_date - CURRENT_DATE) AS days_until_expiry,
    c.naics_code,
    c.psc_code,
    c.description
FROM contracts c
WHERE c.end_date > CURRENT_DATE
  AND c.end_date < CURRENT_DATE + INTERVAL '1 year'
ORDER BY c.end_date ASC;

-- Index for expiration queries
CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON contracts(end_date);
