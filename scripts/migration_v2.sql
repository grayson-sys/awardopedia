-- =============================================================
-- Awardopedia Migration v2
-- Adds: jurisdiction hierarchy, place-of-performance geography,
--       source attribution, confidence, PSC codes, sectors,
--       keywords/tags, set-aside, contract type
-- Run once against a clean or existing DB
-- =============================================================

-- ── Lookup tables ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sectors (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,   -- 'technology', 'construction', etc.
  label       TEXT NOT NULL,          -- 'Technology & IT'
  description TEXT,
  icon        TEXT                    -- emoji or icon name for UI
);

INSERT INTO sectors (slug, label, description, icon) VALUES
  ('technology',     'Technology & IT',          'Software, hardware, IT services, cybersecurity', '💻'),
  ('construction',   'Construction & Engineering','Buildings, bridges, roads, architect-engineering', '🏗️'),
  ('professional',   'Professional Services',     'Consulting, management support, legal, financial', '📋'),
  ('healthcare',     'Healthcare & Medical',      'Medical supplies, services, pharmaceuticals', '🏥'),
  ('defense',        'Defense & Security',        'Weapons, military equipment, security services', '🛡️'),
  ('transportation', 'Transportation & Logistics','Vehicles, aircraft, ships, freight', '🚛'),
  ('facilities',     'Facilities & Maintenance',  'Janitorial, landscaping, grounds, HVAC, repairs', '🔧'),
  ('research',       'Research & Development',    'Scientific R&D, studies, testing', '🔬'),
  ('energy',         'Energy & Utilities',        'Fuels, power, environmental services', '⚡'),
  ('education',      'Education & Training',      'Training services, educational materials', '🎓'),
  ('supplies',       'Equipment & Supplies',      'General equipment, tools, hardware, clothing', '📦'),
  ('other',          'Other',                     'Uncategorized or miscellaneous', '📄')
ON CONFLICT (slug) DO NOTHING;

-- PSC → sector mapping (covers the major PSC buckets)
CREATE TABLE IF NOT EXISTS psc_sector_map (
  psc_prefix  TEXT NOT NULL,   -- first 1-2 chars of PSC code
  sector_slug TEXT NOT NULL REFERENCES sectors(slug),
  PRIMARY KEY (psc_prefix)
);

INSERT INTO psc_sector_map (psc_prefix, sector_slug) VALUES
  -- Research & Development
  ('A', 'research'), ('B', 'research'),
  -- Construction & Engineering
  ('C', 'construction'), ('H', 'construction'),
  ('Y', 'construction'), ('Z', 'construction'),
  -- Environmental
  ('F', 'energy'),
  -- Maintenance & Facilities
  ('J', 'facilities'), ('P', 'facilities'),
  ('S', 'facilities'), ('X', 'facilities'),
  -- Professional Services
  ('K', 'professional'), ('L', 'professional'),
  ('M', 'professional'), ('N', 'professional'),
  ('Q', 'healthcare'),
  ('R', 'professional'),
  -- Medical
  ('T', 'professional'),
  -- Education & Training
  ('U', 'education'),
  -- Transportation
  ('V', 'transportation'),
  -- Weapons / Defense (10xx-19xx)
  ('10', 'defense'), ('11', 'defense'), ('12', 'defense'),
  ('13', 'defense'), ('14', 'transportation'), ('15', 'transportation'),
  ('16', 'transportation'), ('17', 'defense'), ('18', 'defense'),
  ('19', 'transportation'),
  -- Ground vehicles
  ('23', 'transportation'), ('24', 'transportation'),
  ('25', 'transportation'), ('26', 'transportation'),
  -- Tools & Hardware
  ('30', 'supplies'), ('31', 'supplies'), ('32', 'supplies'),
  ('33', 'supplies'), ('34', 'supplies'), ('35', 'supplies'),
  ('36', 'supplies'), ('37', 'supplies'), ('38', 'supplies'),
  ('39', 'supplies'),
  -- Plumbing / HVAC / Industrial
  ('40', 'facilities'), ('41', 'facilities'), ('42', 'facilities'),
  ('43', 'facilities'), ('44', 'facilities'), ('45', 'facilities'),
  ('46', 'facilities'), ('47', 'facilities'), ('48', 'facilities'),
  ('49', 'facilities'),
  -- Electrical / Electronics / Comms
  ('58', 'technology'), ('59', 'technology'),
  ('60', 'technology'), ('61', 'technology'), ('62', 'technology'),
  ('63', 'technology'), ('65', 'healthcare'), ('66', 'research'),
  ('67', 'research'), ('68', 'energy'),
  -- IT / ADP / Software
  ('70', 'technology'), ('71', 'technology'), ('72', 'technology'),
  ('73', 'technology'), ('74', 'technology'), ('75', 'technology'),
  ('76', 'technology'), ('77', 'technology'), ('78', 'technology'),
  ('79', 'technology'),
  -- Chemicals / Textiles / Materials
  ('80', 'supplies'), ('81', 'supplies'), ('82', 'supplies'),
  ('83', 'supplies'), ('84', 'supplies'), ('85', 'supplies'),
  -- Food & Agriculture
  ('89', 'supplies'),
  -- Fuels / Energy
  ('91', 'energy'),
  -- Construction materials / metals
  ('95', 'construction'), ('99', 'supplies'),
  -- D = IT (special services)
  ('D', 'technology')
ON CONFLICT (psc_prefix) DO NOTHING;

-- ── NAICS → sector fallback map (abbreviated — top-level 2-digit) ──
CREATE TABLE IF NOT EXISTS naics_sector_map (
  naics_prefix TEXT NOT NULL,  -- first 2 digits of NAICS code
  sector_slug  TEXT NOT NULL REFERENCES sectors(slug),
  PRIMARY KEY (naics_prefix)
);

INSERT INTO naics_sector_map (naics_prefix, sector_slug) VALUES
  ('11', 'supplies'),       -- Agriculture
  ('21', 'energy'),         -- Mining/Oil/Gas
  ('22', 'energy'),         -- Utilities
  ('23', 'construction'),   -- Construction
  ('31', 'supplies'),       -- Manufacturing
  ('32', 'supplies'),
  ('33', 'supplies'),
  ('42', 'supplies'),       -- Wholesale
  ('44', 'supplies'),       -- Retail
  ('45', 'supplies'),
  ('48', 'transportation'), -- Transportation
  ('49', 'transportation'),
  ('51', 'technology'),     -- Information
  ('52', 'professional'),   -- Finance/Insurance
  ('53', 'facilities'),     -- Real Estate
  ('54', 'professional'),   -- Professional/Scientific/Technical
  ('55', 'professional'),   -- Management
  ('56', 'facilities'),     -- Admin/Support/Facilities
  ('61', 'education'),      -- Education
  ('62', 'healthcare'),     -- Healthcare
  ('71', 'other'),          -- Arts/Entertainment
  ('72', 'other'),          -- Accommodation/Food
  ('81', 'professional'),   -- Other Services
  ('92', 'other')           -- Public Administration
ON CONFLICT (naics_prefix) DO NOTHING;

-- ── Jurisdictions reference table ─────────────────────────────
-- Stores every known jurisdiction (state, county, city)
-- with its FIPS code for reliable cross-referencing

CREATE TABLE IF NOT EXISTS jurisdictions (
  id              SERIAL PRIMARY KEY,
  fips_code       TEXT UNIQUE,           -- standard FIPS (state=2-digit, county=5-digit, place=7-digit)
  jurisdiction_type TEXT NOT NULL        -- 'federal' | 'state' | 'county' | 'city'
    CHECK (jurisdiction_type IN ('federal','state','county','city')),
  name            TEXT NOT NULL,         -- 'New Mexico', 'Santa Fe County', 'City of Santa Fe'
  short_name      TEXT,                  -- 'NM', 'Santa Fe'
  state_code      TEXT,                  -- 2-letter state abbrev (for counties/cities)
  parent_fips     TEXT,                  -- parent jurisdiction's FIPS
  lat             NUMERIC(9,6),
  lng             NUMERIC(9,6),
  population      INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Federal is special — one row
INSERT INTO jurisdictions (fips_code, jurisdiction_type, name, short_name)
VALUES ('US', 'federal', 'United States Federal Government', 'Federal')
ON CONFLICT (fips_code) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_jurisdictions_type  ON jurisdictions(jurisdiction_type);
CREATE INDEX IF NOT EXISTS idx_jurisdictions_state ON jurisdictions(state_code);
CREATE INDEX IF NOT EXISTS idx_jurisdictions_parent ON jurisdictions(parent_fips);

-- ── Alter awards table ────────────────────────────────────────

-- Source attribution
ALTER TABLE awards ADD COLUMN IF NOT EXISTS source_url        TEXT;
ALTER TABLE awards ADD COLUMN IF NOT EXISTS solicitation_url  TEXT;
ALTER TABLE awards ADD COLUMN IF NOT EXISTS source_system     TEXT NOT NULL DEFAULT 'usaspending_api';
ALTER TABLE awards ADD COLUMN IF NOT EXISTS source_fetched_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE awards ADD COLUMN IF NOT EXISTS confidence        NUMERIC(3,2) NOT NULL DEFAULT 1.0
  CHECK (confidence >= 0 AND confidence <= 1);

-- Jurisdiction (who issued the contract)
ALTER TABLE awards ADD COLUMN IF NOT EXISTS jurisdiction_type TEXT NOT NULL DEFAULT 'federal'
  CHECK (jurisdiction_type IN ('federal','state','county','city'));
ALTER TABLE awards ADD COLUMN IF NOT EXISTS jurisdiction_fips TEXT;  -- FK to jurisdictions.fips_code
ALTER TABLE awards ADD COLUMN IF NOT EXISTS source_name       TEXT;  -- e.g. 'NM General Services Dept'

-- Place of performance (WHERE the work happens — critical for map)
ALTER TABLE awards ADD COLUMN IF NOT EXISTS pop_country_code  TEXT DEFAULT 'USA';
ALTER TABLE awards ADD COLUMN IF NOT EXISTS pop_state_code    TEXT;   -- 'NM'
ALTER TABLE awards ADD COLUMN IF NOT EXISTS pop_state_name    TEXT;   -- 'New Mexico'
ALTER TABLE awards ADD COLUMN IF NOT EXISTS pop_county_fips   TEXT;   -- '35049'
ALTER TABLE awards ADD COLUMN IF NOT EXISTS pop_county_name   TEXT;   -- 'Santa Fe County'
ALTER TABLE awards ADD COLUMN IF NOT EXISTS pop_city_name     TEXT;   -- 'Santa Fe'
ALTER TABLE awards ADD COLUMN IF NOT EXISTS pop_zip           TEXT;
ALTER TABLE awards ADD COLUMN IF NOT EXISTS pop_lat           NUMERIC(9,6);
ALTER TABLE awards ADD COLUMN IF NOT EXISTS pop_lng           NUMERIC(9,6);

-- Contract classification
ALTER TABLE awards ADD COLUMN IF NOT EXISTS psc_code          TEXT;   -- 'S201' (Landscaping)
ALTER TABLE awards ADD COLUMN IF NOT EXISTS psc_description   TEXT;   -- 'Grounds Maintenance'
ALTER TABLE awards ADD COLUMN IF NOT EXISTS sector_slug       TEXT REFERENCES sectors(slug) DEFAULT 'other';
ALTER TABLE awards ADD COLUMN IF NOT EXISTS nigp_code         TEXT;   -- for future state/local
ALTER TABLE awards ADD COLUMN IF NOT EXISTS contract_type     TEXT;   -- 'Definitive Contract', 'BPA Call', etc.
ALTER TABLE awards ADD COLUMN IF NOT EXISTS set_aside_type    TEXT;   -- 'Small Business', 'SDVOSB', etc.

-- Discovery / organization
ALTER TABLE awards ADD COLUMN IF NOT EXISTS keywords          JSONB DEFAULT '[]';  -- AI-extracted
ALTER TABLE awards ADD COLUMN IF NOT EXISTS tags              JSONB DEFAULT '[]';  -- curated labels

-- ── New indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_awards_pop_state    ON awards(pop_state_code);
CREATE INDEX IF NOT EXISTS idx_awards_pop_county   ON awards(pop_county_fips);
CREATE INDEX IF NOT EXISTS idx_awards_pop_city     ON awards(pop_city_name);
CREATE INDEX IF NOT EXISTS idx_awards_sector       ON awards(sector_slug);
CREATE INDEX IF NOT EXISTS idx_awards_psc          ON awards(psc_code);
CREATE INDEX IF NOT EXISTS idx_awards_jurisdiction ON awards(jurisdiction_type);
CREATE INDEX IF NOT EXISTS idx_awards_confidence   ON awards(confidence);
CREATE INDEX IF NOT EXISTS idx_awards_keywords     ON awards USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_awards_tags         ON awards USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_awards_pop_lat_lng  ON awards(pop_lat, pop_lng) WHERE pop_lat IS NOT NULL;

-- ── Updated expiring_contracts view ───────────────────────────
DROP VIEW IF EXISTS expiring_contracts;
CREATE VIEW expiring_contracts AS
SELECT
  a.*,
  s.label  AS sector_label,
  s.icon   AS sector_icon,
  j.name   AS jurisdiction_name,
  (a.end_date - CURRENT_DATE) AS days_remaining
FROM awards a
LEFT JOIN sectors s      ON s.slug = a.sector_slug
LEFT JOIN jurisdictions j ON j.fips_code = a.jurisdiction_fips
WHERE a.end_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '180 days')
  AND a.amount > 0
ORDER BY a.end_date ASC;

-- ── Geographic spend summary view (for map choropleth) ────────
CREATE OR REPLACE VIEW geo_spend_summary AS
SELECT
  pop_state_code,
  pop_state_name,
  pop_county_fips,
  pop_county_name,
  pop_city_name,
  jurisdiction_type,
  sector_slug,
  COUNT(*)        AS award_count,
  SUM(amount)     AS total_amount,
  AVG(amount)     AS avg_amount,
  MIN(start_date) AS earliest_award,
  MAX(end_date)   AS latest_expiry
FROM awards
WHERE pop_state_code IS NOT NULL
GROUP BY
  pop_state_code, pop_state_name,
  pop_county_fips, pop_county_name,
  pop_city_name, jurisdiction_type, sector_slug;

COMMENT ON VIEW geo_spend_summary IS
  'Pre-aggregated geographic spend for map choropleth and drill-down. Filter by jurisdiction_type to toggle federal/state/county/city layers.';
