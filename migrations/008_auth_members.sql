-- 008_auth_members.sql
-- Full auth + membership system for Awardopedia

-- ── Members table (replaces stub users table) ──────────────────────────────
CREATE TABLE IF NOT EXISTS members (
    id              SERIAL PRIMARY KEY,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,

    -- Identity
    first_name      VARCHAR(100),
    last_name       VARCHAR(100),
    profession      VARCHAR(100),           -- "Small Business Owner", "Contracts Manager", "Journalist", etc.

    -- Company (optional — individuals welcome)
    company_name    VARCHAR(255),
    company_size    VARCHAR(50),             -- "1-10", "11-50", "51-200", "201-1000", "1000+"
    company_uei     VARCHAR(20),             -- SAM.gov Unique Entity ID (if registered)
    company_naics   VARCHAR(10),             -- Primary NAICS code
    company_state   VARCHAR(2),              -- HQ state

    -- Matching preferences (for opportunity alerts)
    alert_naics     JSONB DEFAULT '[]',      -- ["561720", "238220"] — NAICS codes they care about
    alert_states    JSONB DEFAULT '[]',      -- ["CO", "WY"] — states they operate in
    alert_set_asides JSONB DEFAULT '[]',     -- ["SBA", "SDVOSB"] — set-aside types they qualify for
    alert_keywords  JSONB DEFAULT '[]',      -- ["janitorial", "cleaning"] — keyword triggers
    alert_min_value NUMERIC(15,2),           -- Minimum contract value worth alerting on
    alert_max_value NUMERIC(15,2),           -- Maximum they can handle
    alerts_enabled  BOOLEAN DEFAULT false,   -- Master switch for email alerts

    -- Credits & billing
    credits         INTEGER DEFAULT 0,       -- Report credits remaining
    stripe_customer_id VARCHAR(255),
    total_spent     NUMERIC(10,2) DEFAULT 0,

    -- Metadata
    role            VARCHAR(20) DEFAULT 'member',  -- 'member', 'admin', 'journalist'
    is_active       BOOLEAN DEFAULT true,
    email_verified  BOOLEAN DEFAULT false,
    last_login      TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_stripe ON members(stripe_customer_id);

-- ── Watchlist (opportunities a member is tracking) ─────────────────────────
CREATE TABLE IF NOT EXISTS watchlist (
    id              SERIAL PRIMARY KEY,
    member_id       INTEGER REFERENCES members(id) ON DELETE CASCADE,
    notice_id       VARCHAR(255) NOT NULL,
    added_at        TIMESTAMP DEFAULT NOW(),
    notes           TEXT,                     -- Personal notes about this opportunity
    UNIQUE(member_id, notice_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_member ON watchlist(member_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_notice ON watchlist(notice_id);

-- ── Report purchases (links members to their generated reports) ────────────
CREATE TABLE IF NOT EXISTS report_purchases (
    id              SERIAL PRIMARY KEY,
    member_id       INTEGER REFERENCES members(id) ON DELETE CASCADE,
    notice_id       VARCHAR(255) NOT NULL,
    report_id       INTEGER REFERENCES reports(id),
    credits_used    INTEGER DEFAULT 1,
    purchased_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rp_member ON report_purchases(member_id);

-- ── Sessions (JWT-based but track for analytics) ───────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id              SERIAL PRIMARY KEY,
    member_id       INTEGER REFERENCES members(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    expires_at      TIMESTAMP NOT NULL,
    created_at      TIMESTAMP DEFAULT NOW()
);
