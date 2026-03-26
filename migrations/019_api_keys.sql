-- 019_api_keys.sql
-- Add member-linked API keys and agent API support

-- ── Add member_id to existing api_keys table ─────────────────────────────────
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS member_id INTEGER REFERENCES members(id) ON DELETE CASCADE;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS searches_today INTEGER DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS use_case TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked BOOLEAN DEFAULT false;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS request_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_api_keys_member ON api_keys(member_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- ── API usage log (for analytics and debugging) ─────────────────────────────
CREATE TABLE IF NOT EXISTS api_usage_log (
    id              SERIAL PRIMARY KEY,
    api_key_id      INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
    member_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,
    endpoint        VARCHAR(100) NOT NULL,
    query_params    JSONB,
    response_count  INTEGER,                         -- Number of results returned
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_key ON api_usage_log(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_date ON api_usage_log(created_at);

-- ── Add CAPTCHA verification to members ──────────────────────────────────────
ALTER TABLE members ADD COLUMN IF NOT EXISTS captcha_verified BOOLEAN DEFAULT false;
