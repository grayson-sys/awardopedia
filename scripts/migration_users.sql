-- Awardopedia User System Migration
-- PostgreSQL 15
-- Run: PGPASSWORD=<DB_PASSWORD> psql 'postgresql://doadmin@<DB_HOST>:25060/awardopedia?sslmode=require' -f scripts/migration_users.sql

BEGIN;

-- ─────────────────────────────────────────
-- TEAMS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams (
    id                    SERIAL PRIMARY KEY,
    name                  TEXT NOT NULL,
    slug                  TEXT UNIQUE,
    email_domain          TEXT,
    logo_url              TEXT,
    website               TEXT,
    description           TEXT,
    subscription_tier     TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free','pro','enterprise')),
    subscription_expires_at TIMESTAMPTZ,
    max_members           INTEGER DEFAULT 5,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- EXTEND USERS TABLE
-- ─────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_uei TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_duns TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_cage TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_size TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_state TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_naics JSONB DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_psc JSONB DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS set_aside_sb BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS set_aside_wosb BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS set_aside_sdvosb BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS set_aside_vosb BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS set_aside_8a BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS set_aside_hubzone BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS set_aside_edwosb BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cert_8a_expires_at DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS seeking_prime BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS seeking_sub BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS capability_statement_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS capability_statement_text TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add check constraint for company_size (use DO block to avoid error if already exists)
DO $$ BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_users_company_size
        CHECK (company_size IS NULL OR company_size IN ('micro','small','medium','large'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add check constraint for subscription_tier
DO $$ BEGIN
    ALTER TABLE users ADD CONSTRAINT chk_users_subscription_tier
        CHECK (subscription_tier IS NULL OR subscription_tier IN ('free','pro','enterprise'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────
-- TEAM MEMBERS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_members (
    id          SERIAL PRIMARY KEY,
    team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role        TEXT DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
    invited_by  INTEGER REFERENCES users(user_id),
    joined_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);

-- ─────────────────────────────────────────
-- API KEYS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_keys (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    team_id         INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    key_hash        TEXT NOT NULL UNIQUE,
    key_prefix      TEXT NOT NULL,
    label           TEXT,
    scopes          JSONB DEFAULT '[]',
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    requests_today  INTEGER DEFAULT 0,
    requests_month  INTEGER DEFAULT 0
);

-- ─────────────────────────────────────────
-- WATCHLIST: CONTRACTS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watchlist_contracts (
    id                      SERIAL PRIMARY KEY,
    user_id                 INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    team_id                 INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    award_id                INTEGER NOT NULL REFERENCES awards(award_id) ON DELETE CASCADE,
    notes                   TEXT,
    recompete_expected_at   DATE,
    reminder_days_before    INTEGER DEFAULT 90,
    priority                TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
    pipeline_stage          TEXT,
    added_at                TIMESTAMPTZ DEFAULT NOW()
);

-- Partial unique indexes for user vs team scoped watchlists
CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_contracts_user
    ON watchlist_contracts(user_id, award_id) WHERE team_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_contracts_team
    ON watchlist_contracts(team_id, award_id) WHERE team_id IS NOT NULL;

-- ─────────────────────────────────────────
-- WATCHLIST: AGENCIES
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watchlist_agencies (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    team_id         INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    agency_code     TEXT NOT NULL,
    agency_name     TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_agencies_user
    ON watchlist_agencies(user_id, agency_code) WHERE team_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_agencies_team
    ON watchlist_agencies(team_id, agency_code) WHERE team_id IS NOT NULL;

-- ─────────────────────────────────────────
-- WATCHLIST: COMPETITORS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watchlist_competitors (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    team_id         INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    recipient_uei   TEXT NOT NULL,
    recipient_name  TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_competitors_user
    ON watchlist_competitors(user_id, recipient_uei) WHERE team_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_competitors_team
    ON watchlist_competitors(team_id, recipient_uei) WHERE team_id IS NOT NULL;

-- ─────────────────────────────────────────
-- SAVED SEARCHES
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS saved_searches (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    team_id             INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    filters             JSONB NOT NULL,
    alert_enabled       BOOLEAN DEFAULT TRUE,
    alert_frequency     TEXT DEFAULT 'weekly' CHECK (alert_frequency IN ('realtime','daily','weekly','never')),
    alert_day_of_week   INTEGER,
    alert_time          TIME DEFAULT '08:00',
    last_alerted_at     TIMESTAMPTZ,
    last_result_count   INTEGER,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- OPPORTUNITY PIPELINE
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS opportunity_pipeline (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    team_id             INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    award_id            INTEGER REFERENCES awards(award_id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    stage               TEXT NOT NULL DEFAULT 'identified' CHECK (stage IN ('identified','qualifying','pursuing','proposal_submitted','award_pending','won','lost','no_bid')),
    bid_decision        TEXT DEFAULT 'pending' CHECK (bid_decision IN ('bid','no_bid','pending')),
    bid_no_bid_reason   TEXT,
    estimated_value     NUMERIC(18,2),
    probability_pct     INTEGER CHECK (probability_pct IS NULL OR (probability_pct BETWEEN 0 AND 100)),
    due_date            DATE,
    notes               TEXT,
    assigned_to         INTEGER REFERENCES users(user_id),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- PIPELINE ACTIVITIES (AUDIT LOG)
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipeline_activities (
    id              SERIAL PRIMARY KEY,
    pipeline_id     INTEGER NOT NULL REFERENCES opportunity_pipeline(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    activity_type   TEXT NOT NULL,
    from_stage      TEXT,
    to_stage        TEXT,
    note            TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- PAST PERFORMANCE
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS past_performance (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    team_id             INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    award_id            INTEGER REFERENCES awards(award_id) ON DELETE SET NULL,
    piid                TEXT,
    agency_name         TEXT,
    description         TEXT,
    naics_code          TEXT,
    psc_code            TEXT,
    amount              NUMERIC(18,2),
    start_date          DATE,
    end_date            DATE,
    performance_rating  TEXT CHECK (performance_rating IS NULL OR performance_rating IN ('exceptional','very_good','satisfactory','marginal','unsatisfactory')),
    is_prime            BOOLEAN DEFAULT TRUE,
    prime_contractor    TEXT,
    verified            BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- NOTIFICATION PREFERENCES
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_preferences (
    id                          SERIAL PRIMARY KEY,
    user_id                     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE UNIQUE,
    email_enabled               BOOLEAN DEFAULT TRUE,
    email_watchlist_alerts      BOOLEAN DEFAULT TRUE,
    email_saved_search_digest   BOOLEAN DEFAULT TRUE,
    email_expiring_reminders    BOOLEAN DEFAULT TRUE,
    email_pipeline_reminders    BOOLEAN DEFAULT TRUE,
    email_marketing             BOOLEAN DEFAULT FALSE,
    digest_frequency            TEXT DEFAULT 'weekly' CHECK (digest_frequency IN ('daily','weekly','never')),
    digest_day_of_week          INTEGER DEFAULT 1,
    digest_time                 TIME DEFAULT '08:00:00',
    quiet_hours_start           TIME DEFAULT '22:00:00',
    quiet_hours_end             TIME DEFAULT '07:00:00',
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- FILE UPLOADS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS file_uploads (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    team_id             INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    file_type           TEXT CHECK (file_type IN ('avatar','company_logo','capability_statement','proposal_doc','other')),
    original_filename   TEXT,
    storage_key         TEXT NOT NULL,
    cdn_url             TEXT NOT NULL,
    mime_type           TEXT,
    file_size_bytes     INTEGER,
    ai_extracted_text   TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- INDEXES ON FK COLUMNS AND FILTERED FIELDS
-- ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_team_members_team_id     ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id     ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id         ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_team_id         ON api_keys(team_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash        ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_revoked         ON api_keys(revoked_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_watchlist_contracts_user  ON watchlist_contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_contracts_team  ON watchlist_contracts(team_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_contracts_award ON watchlist_contracts(award_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_agencies_user   ON watchlist_agencies(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_competitors_user ON watchlist_competitors(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id   ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_team_id   ON saved_searches(team_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_alert     ON saved_searches(alert_enabled, alert_frequency) WHERE alert_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_pipeline_user_id         ON opportunity_pipeline(user_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_team_id         ON opportunity_pipeline(team_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stage           ON opportunity_pipeline(stage);
CREATE INDEX IF NOT EXISTS idx_pipeline_due_date        ON opportunity_pipeline(due_date);
CREATE INDEX IF NOT EXISTS idx_pipeline_activities_pid  ON pipeline_activities(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_past_performance_user    ON past_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_past_performance_team    ON past_performance(team_id);
CREATE INDEX IF NOT EXISTS idx_file_uploads_user        ON file_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_file_uploads_team        ON file_uploads(team_id);
CREATE INDEX IF NOT EXISTS idx_file_uploads_type        ON file_uploads(file_type);
CREATE INDEX IF NOT EXISTS idx_users_email_verified     ON users(email_verified_at);
CREATE INDEX IF NOT EXISTS idx_users_last_active        ON users(last_active_at);
CREATE INDEX IF NOT EXISTS idx_teams_slug               ON teams(slug);
CREATE INDEX IF NOT EXISTS idx_teams_email_domain       ON teams(email_domain);

-- ─────────────────────────────────────────
-- UPDATED_AT TRIGGERS
-- ─────────────────────────────────────────

-- set_updated_at() function already exists from schema.sql

DO $$ BEGIN
    CREATE TRIGGER trg_teams_updated BEFORE UPDATE ON teams
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_saved_searches_updated BEFORE UPDATE ON saved_searches
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_pipeline_updated BEFORE UPDATE ON opportunity_pipeline
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_notification_prefs_updated BEFORE UPDATE ON notification_preferences
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
