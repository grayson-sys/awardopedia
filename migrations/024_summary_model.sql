-- 024_summary_model.sql
-- Track which AI model generated each opportunity summary
-- Requires doadmin (FIREFLY)

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS summary_model VARCHAR(50);

-- Index for finding records by model (useful for quality audits)
CREATE INDEX IF NOT EXISTS idx_opps_summary_model ON opportunities(summary_model);

COMMENT ON COLUMN opportunities.summary_model IS 'Which AI model generated llama_summary: sonnet, haiku, llama, unknown';

-- Grant permissions to app user
GRANT SELECT, INSERT, UPDATE ON opportunities TO awardopedia_user;
