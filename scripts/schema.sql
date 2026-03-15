-- Awardopedia Database Schema
-- PostgreSQL 15
-- Run: psql $DATABASE_URL -f schema.sql

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ─────────────────────────────────────────
-- CORE TABLES
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agencies (
    agency_id         SERIAL PRIMARY KEY,
    agency_code       VARCHAR(20) UNIQUE NOT NULL,
    agency_name       TEXT NOT NULL,
    sub_agency_name   TEXT,
    office_name       TEXT,
    total_awarded     NUMERIC(18,2) DEFAULT 0,
    award_count       INTEGER DEFAULT 0,
    avg_award_value   NUMERIC(18,2) DEFAULT 0,
    top_naics         JSONB,           -- [{code, name, pct}]
    top_contractors   JSONB,           -- [{name, uei, total}]
    last_award_date   DATE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contractors (
    contractor_id     SERIAL PRIMARY KEY,
    uei               VARCHAR(20) UNIQUE,    -- Unique Entity Identifier
    duns              VARCHAR(20),
    name              TEXT NOT NULL,
    doing_business_as TEXT,
    city              TEXT,
    state_code        CHAR(2),
    zip               VARCHAR(10),
    country_code      CHAR(3) DEFAULT 'USA',
    business_types    JSONB,           -- small business, woman-owned, etc.
    naics_primary     VARCHAR(10),
    total_awarded     NUMERIC(18,2) DEFAULT 0,
    award_count       INTEGER DEFAULT 0,
    first_award_date  DATE,
    last_award_date   DATE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS naics_codes (
    naics_code        VARCHAR(10) PRIMARY KEY,
    title             TEXT NOT NULL,
    description       TEXT,
    sector            VARCHAR(10),
    subsector         VARCHAR(10),
    total_awarded     NUMERIC(18,2) DEFAULT 0,
    award_count       INTEGER DEFAULT 0,
    avg_award_value   NUMERIC(18,2) DEFAULT 0,
    top_agencies      JSONB,
    top_contractors   JSONB,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS awards (
    award_id              SERIAL PRIMARY KEY,
    award_id_piid         VARCHAR(100),       -- Procurement Instrument Identifier
    parent_award_piid     VARCHAR(100),
    award_type            VARCHAR(50),        -- Contract, Grant, Loan, etc.
    action_type           VARCHAR(20),        -- NEW, CONTINUATION, MODIFICATION, etc.

    -- Parties
    agency_code           VARCHAR(20),
    agency_name           TEXT,
    sub_agency_name       TEXT,
    office_name           TEXT,
    awarding_agency_code  VARCHAR(20),
    funding_agency_code   VARCHAR(20),
    recipient_uei         VARCHAR(20),
    recipient_duns        VARCHAR(20),
    recipient_name        TEXT,
    recipient_city        TEXT,
    recipient_state       CHAR(2),
    recipient_zip         VARCHAR(10),
    recipient_country     CHAR(3),
    business_types        JSONB,

    -- Financials
    federal_action_obligation  NUMERIC(18,2),
    current_total_value        NUMERIC(18,2),
    potential_total_value      NUMERIC(18,2),

    -- Dates
    action_date           DATE,
    period_of_performance_start DATE,
    period_of_performance_end   DATE,
    period_of_performance_current_end DATE,

    -- Classification
    naics_code            VARCHAR(10),
    naics_description     TEXT,
    psc_code              VARCHAR(10),        -- Product/Service Code
    psc_description       TEXT,
    contract_type         VARCHAR(100),

    -- Description
    description           TEXT,
    place_of_performance_city   TEXT,
    place_of_performance_state  CHAR(2),
    place_of_performance_zip    VARCHAR(10),

    -- Metadata
    usaspending_id        VARCHAR(100) UNIQUE,
    usaspending_url       TEXT,
    last_modified_date    DATE,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- AUTH + CREDITS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    user_id       SERIAL PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL,
    credits       INTEGER DEFAULT 0,
    total_credits_purchased INTEGER DEFAULT 0,
    magic_token   VARCHAR(100),
    magic_expires TIMESTAMPTZ,
    last_login    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_purchases (
    purchase_id       SERIAL PRIMARY KEY,
    user_id           INTEGER REFERENCES users(user_id),
    stripe_session_id VARCHAR(200) UNIQUE,
    stripe_payment_id VARCHAR(200),
    credits_purchased INTEGER NOT NULL,
    amount_cents      INTEGER NOT NULL,
    status            VARCHAR(20) DEFAULT 'pending', -- pending, complete, refunded
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_usage (
    usage_id      SERIAL PRIMARY KEY,
    user_id       INTEGER REFERENCES users(user_id),
    award_id      INTEGER REFERENCES awards(award_id),
    action        VARCHAR(50),   -- analyze, summarize, compare
    credits_used  INTEGER DEFAULT 1,
    result        TEXT,          -- cached AI response
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────

-- Awards — primary lookups
CREATE INDEX IF NOT EXISTS idx_awards_agency_code       ON awards(agency_code);
CREATE INDEX IF NOT EXISTS idx_awards_recipient_uei     ON awards(recipient_uei);
CREATE INDEX IF NOT EXISTS idx_awards_naics_code        ON awards(naics_code);
CREATE INDEX IF NOT EXISTS idx_awards_action_date       ON awards(action_date DESC);
CREATE INDEX IF NOT EXISTS idx_awards_end_date          ON awards(period_of_performance_current_end);
CREATE INDEX IF NOT EXISTS idx_awards_state             ON awards(recipient_state);
CREATE INDEX IF NOT EXISTS idx_awards_value             ON awards(federal_action_obligation DESC);
CREATE INDEX IF NOT EXISTS idx_awards_type              ON awards(award_type);
CREATE INDEX IF NOT EXISTS idx_awards_piid              ON awards(award_id_piid);

-- Full-text search on awards
CREATE INDEX IF NOT EXISTS idx_awards_fts ON awards
    USING gin(to_tsvector('english',
        coalesce(description,'') || ' ' ||
        coalesce(recipient_name,'') || ' ' ||
        coalesce(agency_name,'') || ' ' ||
        coalesce(naics_description,'')
    ));

-- Trigram search for partial matches
CREATE INDEX IF NOT EXISTS idx_awards_desc_trgm   ON awards USING gin(description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contractor_name_trgm ON contractors USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_agency_name_trgm   ON agencies USING gin(agency_name gin_trgm_ops);

-- Contractors
CREATE INDEX IF NOT EXISTS idx_contractors_state  ON contractors(state_code);
CREATE INDEX IF NOT EXISTS idx_contractors_naics  ON contractors(naics_primary);

-- ─────────────────────────────────────────
-- EXPIRING CONTRACTS VIEW
-- ─────────────────────────────────────────

CREATE OR REPLACE VIEW expiring_contracts AS
SELECT
    award_id, award_id_piid, description, agency_name, recipient_name,
    federal_action_obligation, potential_total_value,
    period_of_performance_current_end AS end_date,
    (period_of_performance_current_end - CURRENT_DATE) AS days_remaining,
    naics_code, naics_description, recipient_state, usaspending_url
FROM awards
WHERE period_of_performance_current_end BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '180 days')
  AND federal_action_obligation > 0
ORDER BY period_of_performance_current_end ASC;

-- ─────────────────────────────────────────
-- UPDATED_AT TRIGGER
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_awards_updated     BEFORE UPDATE ON awards     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_agencies_updated   BEFORE UPDATE ON agencies   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_contractors_updated BEFORE UPDATE ON contractors FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_naics_updated      BEFORE UPDATE ON naics_codes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
