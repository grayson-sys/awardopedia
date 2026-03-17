-- Awardopedia v2 schema
-- Per MASTER_PROMPT specification

-- TABLE: contracts (Type 1 — awarded contracts)
CREATE TABLE contracts (
  -- Core identity
  piid VARCHAR(255) UNIQUE NOT NULL,
  award_id VARCHAR(255),
  modification_number VARCHAR(50),
  parent_piid VARCHAR(255),

  -- What was bought
  description TEXT,
  naics_code VARCHAR(10),
  naics_description VARCHAR(500),
  psc_code VARCHAR(10),
  psc_description VARCHAR(500),
  llama_summary TEXT,

  -- Who bought it
  agency_name VARCHAR(500),
  sub_agency_name VARCHAR(500),
  office_name VARCHAR(500),
  contracting_officer VARCHAR(255),
  contracting_office VARCHAR(255),

  -- Who won it
  recipient_name VARCHAR(500),
  recipient_uei VARCHAR(50),
  recipient_duns VARCHAR(20),
  recipient_address TEXT,
  recipient_city VARCHAR(255),
  recipient_state VARCHAR(2),
  recipient_zip VARCHAR(20),
  recipient_country VARCHAR(3),
  business_size VARCHAR(100),
  is_small_business BOOLEAN,

  -- Money
  award_amount NUMERIC(15,2),
  base_amount NUMERIC(15,2),
  ceiling_amount NUMERIC(15,2),
  federal_obligation NUMERIC(15,2),
  total_outlayed NUMERIC(15,2),

  -- Time
  start_date DATE,
  end_date DATE,
  fiscal_year INTEGER,

  -- How it was awarded
  set_aside_type VARCHAR(255),
  competition_type VARCHAR(255),
  number_of_offers INTEGER,
  contract_type VARCHAR(100),
  award_type VARCHAR(100),
  extent_competed VARCHAR(255),

  -- SLED stubs (nullable, for future use)
  jurisdiction_level VARCHAR(50),   -- federal/state/local/education
  state_code VARCHAR(2),
  county VARCHAR(255),
  municipality VARCHAR(255),
  school_district VARCHAR(255),
  sled_source_url TEXT,

  -- SEO and linking
  usaspending_url TEXT GENERATED ALWAYS AS ('https://www.usaspending.gov/award/' || piid) STORED,
  usaspending_alive BOOLEAN DEFAULT true,
  usaspending_checked TIMESTAMP,
  static_page_url TEXT,
  static_page_generated TIMESTAMP,

  -- Caching
  report_generated BOOLEAN DEFAULT false,
  report_url TEXT,
  report_generated_at TIMESTAMP,
  report_purchase_count INTEGER DEFAULT 0,

  -- Housekeeping
  data_source VARCHAR(50) DEFAULT 'usaspending',
  fpds_enriched BOOLEAN DEFAULT false,
  last_synced TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_contracts_piid ON contracts(piid);
CREATE INDEX idx_contracts_agency ON contracts(agency_name);
CREATE INDEX idx_contracts_naics ON contracts(naics_code);
CREATE INDEX idx_contracts_end_date ON contracts(end_date);
CREATE INDEX idx_contracts_recipient ON contracts(recipient_name);
CREATE INDEX idx_contracts_state ON contracts(recipient_state);
CREATE INDEX idx_contracts_llama ON contracts(llama_summary) WHERE llama_summary IS NULL;


-- TABLE: opportunities (Type 2 — upcoming solicitations)
CREATE TABLE opportunities (
  -- Core identity
  notice_id VARCHAR(255) UNIQUE NOT NULL,
  solicitation_number VARCHAR(255),
  related_piid VARCHAR(255),  -- links to contracts if recompete

  -- What they want
  title VARCHAR(500),
  description TEXT,
  naics_code VARCHAR(10),
  naics_description VARCHAR(500),
  psc_code VARCHAR(10),
  llama_summary TEXT,

  -- Who is buying
  agency_name VARCHAR(500),
  sub_agency_name VARCHAR(500),
  office_name VARCHAR(500),
  contracting_officer VARCHAR(255),
  contracting_officer_email VARCHAR(255),
  contracting_officer_phone VARCHAR(50),

  -- Incumbent (if recompete)
  incumbent_name VARCHAR(500),
  incumbent_uei VARCHAR(50),
  is_recompete BOOLEAN DEFAULT false,

  -- Money
  estimated_value_min NUMERIC(15,2),
  estimated_value_max NUMERIC(15,2),

  -- Time
  posted_date DATE,
  response_deadline DATE,
  archive_date DATE,

  -- How it will be awarded
  set_aside_type VARCHAR(255),
  contract_type VARCHAR(100),
  notice_type VARCHAR(100),
  place_of_performance_state VARCHAR(2),
  place_of_performance_city VARCHAR(255),

  -- Subcontracting
  subcontracting_plan VARCHAR(255),
  has_subcontracting_opportunities BOOLEAN,

  -- Documents
  sam_url TEXT,
  sam_url_alive BOOLEAN DEFAULT true,
  sam_url_checked TIMESTAMP,
  attachments JSONB,

  -- Caching
  report_generated BOOLEAN DEFAULT false,
  report_url TEXT,
  report_generated_at TIMESTAMP,
  report_purchase_count INTEGER DEFAULT 0,

  -- Housekeeping
  last_synced TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_opportunities_notice_id ON opportunities(notice_id);
CREATE INDEX idx_opportunities_agency ON opportunities(agency_name);
CREATE INDEX idx_opportunities_naics ON opportunities(naics_code);
CREATE INDEX idx_opportunities_deadline ON opportunities(response_deadline);
CREATE INDEX idx_opportunities_recompete ON opportunities(is_recompete);


-- TABLE: api_keys
CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  key_hash VARCHAR(255) UNIQUE NOT NULL,
  key_prefix VARCHAR(10),
  name VARCHAR(255),
  organization VARCHAR(255),
  daily_limit INTEGER DEFAULT 1000,
  weekly_limit INTEGER DEFAULT 5000,
  calls_today INTEGER DEFAULT 0,
  calls_this_week INTEGER DEFAULT 0,
  last_reset_daily TIMESTAMP,
  last_reset_weekly TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used TIMESTAMP,
  notes TEXT
);


-- TABLE: reports
CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  record_type VARCHAR(20),         -- contract/opportunity
  record_id VARCHAR(255),          -- piid or notice_id
  pdf_url TEXT,
  csv_url TEXT,
  generated_at TIMESTAMP,
  generation_cost NUMERIC(6,4),    -- actual Claude cost
  purchase_count INTEGER DEFAULT 0,
  last_purchased TIMESTAMP
);

CREATE INDEX idx_reports_record ON reports(record_type, record_id);


-- TABLE: users (STUB ONLY — do not build auth yet)
-- Full auth implementation deferred to future phase.
-- Teams, saved searches, alerts: future phase.
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  credits INTEGER DEFAULT 5,
  stripe_customer_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);


-- TABLE: dead_links
CREATE TABLE dead_links (
  id SERIAL PRIMARY KEY,
  record_type VARCHAR(20),
  record_id VARCHAR(255),
  url TEXT,
  first_failed TIMESTAMP,
  last_checked TIMESTAMP,
  http_status INTEGER,
  resolved BOOLEAN DEFAULT false
);

CREATE INDEX idx_dead_links_record ON dead_links(record_type, record_id);
