-- 005_office_codes.sql
-- Canonical office code lookup table. Populated by AI on first encounter,
-- then reused forever. Saves token cost over time.

CREATE TABLE IF NOT EXISTS office_codes (
    code            VARCHAR(20) PRIMARY KEY,    -- e.g. "36C776", "W912GB", "SPRPA1"
    agency_code     VARCHAR(10),                -- top-level: "036" (VA), "097" (DLA), etc.
    abbreviation    VARCHAR(50),                -- e.g. "PCAC", "ENDIST EUROPE"
    full_name       VARCHAR(500) NOT NULL,      -- e.g. "Program Contracting Activity Central"
    city            VARCHAR(255),
    state           VARCHAR(50),
    country         VARCHAR(100) DEFAULT 'USA',
    parent_agency   VARCHAR(255),               -- e.g. "Department of Veterans Affairs"
    source          VARCHAR(20) DEFAULT 'ai',   -- 'ai' or 'manual'
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_office_codes_agency ON office_codes(agency_code);
