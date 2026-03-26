-- 018_saved_opportunities_lists.sql
-- Custom lists for organizing saved opportunities + enhanced business profile

-- ── Opportunity Lists (custom folders/categories) ───────────────────────────
CREATE TABLE IF NOT EXISTS opportunity_lists (
    id              SERIAL PRIMARY KEY,
    member_id       INTEGER REFERENCES members(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    color           VARCHAR(7) DEFAULT '#1B3A6B',  -- hex color for UI
    icon            VARCHAR(50) DEFAULT 'folder',   -- icon name
    is_default      BOOLEAN DEFAULT false,          -- "Saved" default list
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(member_id, name)
);

CREATE INDEX IF NOT EXISTS idx_opp_lists_member ON opportunity_lists(member_id);

-- ── Saved Opportunities (many-to-many with lists) ───────────────────────────
CREATE TABLE IF NOT EXISTS saved_opportunities (
    id              SERIAL PRIMARY KEY,
    member_id       INTEGER REFERENCES members(id) ON DELETE CASCADE,
    notice_id       VARCHAR(255) NOT NULL,
    list_id         INTEGER REFERENCES opportunity_lists(id) ON DELETE CASCADE,
    notes           TEXT,                           -- personal notes
    priority        VARCHAR(20) DEFAULT 'medium',   -- 'high', 'medium', 'low'
    status          VARCHAR(30) DEFAULT 'watching', -- 'watching', 'pursuing', 'submitted', 'won', 'lost', 'passed'
    saved_at        TIMESTAMP DEFAULT NOW(),
    UNIQUE(member_id, notice_id, list_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_member ON saved_opportunities(member_id);
CREATE INDEX IF NOT EXISTS idx_saved_notice ON saved_opportunities(notice_id);
CREATE INDEX IF NOT EXISTS idx_saved_list ON saved_opportunities(list_id);

-- ── Enhanced business profile fields ─────────────────────────────────────────
ALTER TABLE members ADD COLUMN IF NOT EXISTS company_description TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS company_capabilities JSONB DEFAULT '[]';
ALTER TABLE members ADD COLUMN IF NOT EXISTS company_certifications JSONB DEFAULT '[]';
ALTER TABLE members ADD COLUMN IF NOT EXISTS company_past_performance TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS alert_frequency VARCHAR(20) DEFAULT 'daily';  -- 'instant', 'daily', 'weekly'
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_alert_sent TIMESTAMP;

-- ── Email Notifications Log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_notifications (
    id              SERIAL PRIMARY KEY,
    member_id       INTEGER REFERENCES members(id) ON DELETE CASCADE,
    notice_id       VARCHAR(255),                   -- NULL for digest emails
    email_type      VARCHAR(50) NOT NULL,           -- 'opportunity_match', 'daily_digest', 'weekly_digest'
    subject         VARCHAR(255),
    sent_at         TIMESTAMP DEFAULT NOW(),
    opened_at       TIMESTAMP,                      -- tracking pixel
    clicked_at      TIMESTAMP                       -- link click
);

CREATE INDEX IF NOT EXISTS idx_email_member ON email_notifications(member_id);
CREATE INDEX IF NOT EXISTS idx_email_sent ON email_notifications(sent_at);

-- ── Opportunity Match Scores (for smart matching) ────────────────────────────
CREATE TABLE IF NOT EXISTS opportunity_matches (
    id              SERIAL PRIMARY KEY,
    member_id       INTEGER REFERENCES members(id) ON DELETE CASCADE,
    notice_id       VARCHAR(255) NOT NULL,
    match_score     NUMERIC(5,2),                   -- 0-100 match percentage
    match_reasons   JSONB DEFAULT '[]',             -- ["NAICS match", "State match", "Keyword: janitorial"]
    notified        BOOLEAN DEFAULT false,
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(member_id, notice_id)
);

CREATE INDEX IF NOT EXISTS idx_match_member ON opportunity_matches(member_id);
CREATE INDEX IF NOT EXISTS idx_match_score ON opportunity_matches(match_score DESC);
CREATE INDEX IF NOT EXISTS idx_match_notified ON opportunity_matches(notified) WHERE notified = false;
