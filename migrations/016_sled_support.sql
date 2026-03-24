-- SLED (State, Local, Education, District) Support
-- Adds data_source tracking and jurisdiction pipeline rules

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Add data_source to contracts and opportunities
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS data_source VARCHAR(20) DEFAULT 'federal';
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS state_contract_id VARCHAR(100);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS jurisdiction_code VARCHAR(20); -- 'ny', 'ca', 'tx', etc.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS mwbe_status VARCHAR(50); -- Minority/Women-owned status

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS data_source VARCHAR(20) DEFAULT 'federal';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS jurisdiction_code VARCHAR(20);

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS idx_contracts_data_source ON contracts(data_source);
CREATE INDEX IF NOT EXISTS idx_contracts_jurisdiction ON contracts(jurisdiction_code);
CREATE INDEX IF NOT EXISTS idx_opportunities_data_source ON opportunities(data_source);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Jurisdictions table (states, counties, cities)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS jurisdictions (
  code VARCHAR(20) PRIMARY KEY,           -- 'ny', 'ca', 'ny-nyc', 'ca-la-county'
  name TEXT NOT NULL,                       -- 'New York', 'California', 'New York City'
  type VARCHAR(20) NOT NULL,               -- 'state', 'county', 'city', 'district'
  parent_code VARCHAR(20),                 -- 'ny' for 'ny-nyc'
  state_abbr VARCHAR(2),                   -- 'NY', 'CA'
  fips_code VARCHAR(10),
  population INTEGER,
  gdp_rank INTEGER,

  -- Data source info
  data_source_name TEXT,                   -- 'data.ny.gov', 'Cal eProcure'
  data_source_url TEXT,                    -- API endpoint or portal URL
  data_source_type VARCHAR(20),            -- 'socrata', 'scrape', 'api', 'manual'
  api_key_required BOOLEAN DEFAULT false,

  -- Pipeline status
  pipeline_status VARCHAR(20) DEFAULT 'planned', -- 'planned', 'research', 'building', 'testing', 'active'
  contracts_count INTEGER DEFAULT 0,
  opportunities_count INTEGER DEFAULT 0,
  last_fetch_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. Pipeline Rules table (per-jurisdiction data cleaning rules)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pipeline_rules (
  id SERIAL PRIMARY KEY,
  jurisdiction_code VARCHAR(20) REFERENCES jurisdictions(code),

  -- Rule identification
  rule_name VARCHAR(100) NOT NULL,         -- 'title_case_cities', 'strip_dept_prefix'
  stage INTEGER NOT NULL,                   -- Pipeline stage (1-9)
  rule_type VARCHAR(30) NOT NULL,          -- 'transform', 'validate', 'enrich', 'map'

  -- Plain English explanation
  problem_description TEXT NOT NULL,        -- "City names come in ALL CAPS"
  solution_description TEXT NOT NULL,       -- "Convert to Title Case while preserving acronyms"

  -- Rule implementation
  field_name VARCHAR(100),                  -- Which field this rule applies to
  rule_pattern TEXT,                        -- Regex pattern or condition
  rule_action TEXT,                         -- What to do (transform function, mapping, etc.)

  -- Tracking
  records_affected INTEGER DEFAULT 0,
  last_applied_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,

  -- Derived from federal?
  derived_from_rule_id INTEGER REFERENCES pipeline_rules(id),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_rules_jurisdiction ON pipeline_rules(jurisdiction_code);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Code crosswalk tables
-- ═══════════════════════════════════════════════════════════════════════════════

-- NY Category codes → NAICS
CREATE TABLE IF NOT EXISTS ny_category_naics_map (
  ny_category VARCHAR(100) PRIMARY KEY,
  ny_category_description TEXT,
  naics_code VARCHAR(10),
  naics_description TEXT,
  confidence DECIMAL(3,2) DEFAULT 0.8
);

-- UNSPSC → NAICS (California)
CREATE TABLE IF NOT EXISTS unspsc_naics_map (
  unspsc_code VARCHAR(20) PRIMARY KEY,
  unspsc_description TEXT,
  naics_code VARCHAR(10),
  psc_code VARCHAR(10),
  confidence DECIMAL(3,2) DEFAULT 0.7
);

-- NIGP → NAICS (Texas, Florida, many locals)
CREATE TABLE IF NOT EXISTS nigp_naics_map (
  nigp_code VARCHAR(20) PRIMARY KEY,
  nigp_description TEXT,
  naics_code VARCHAR(10),
  psc_code VARCHAR(10),
  confidence DECIMAL(3,2) DEFAULT 0.7
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Seed initial jurisdictions
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO jurisdictions (code, name, type, state_abbr, gdp_rank, data_source_name, data_source_url, data_source_type, pipeline_status) VALUES
  ('federal', 'Federal Government', 'federal', NULL, 0, 'SAM.gov / USASpending', 'https://api.sam.gov', 'api', 'active'),
  ('ny', 'New York', 'state', 'NY', 3, 'data.ny.gov', 'https://data.ny.gov/resource/contracts.json', 'socrata', 'building'),
  ('ca', 'California', 'state', 'CA', 1, 'data.ca.gov', 'https://data.ca.gov/dataset/purchase-order-data', 'socrata', 'planned'),
  ('tx', 'Texas', 'state', 'TX', 2, 'Texas ESBD', 'https://www.txsmartbuy.gov/esbd', 'scrape', 'planned'),
  ('fl', 'Florida', 'state', 'FL', 4, 'MyFloridaMarketplace', 'https://vendor.myfloridamarketplace.com', 'scrape', 'planned'),
  ('il', 'Illinois', 'state', 'IL', 5, 'BidBuy Illinois', 'https://www.bidbuy.illinois.gov', 'scrape', 'planned')
ON CONFLICT (code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. Seed federal pipeline rules (as reference for SLED adaptation)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO pipeline_rules (jurisdiction_code, rule_name, stage, rule_type, problem_description, solution_description, field_name, is_active) VALUES
  -- Stage 1: Ingest
  ('federal', 'parse_iso_dates', 1, 'transform',
   'Dates come in various formats (ISO, MM/DD/YYYY, timestamps)',
   'Normalize all dates to ISO 8601 format (YYYY-MM-DD)',
   'start_date,end_date,response_deadline', true),

  -- Stage 2: PDF Processing
  ('federal', 'extract_pdf_text', 2, 'enrich',
   'Solicitation details are locked in PDF attachments',
   'Download PDFs and extract text using pdfplumber, flag scanned images for OCR',
   'attachments', true),

  -- Stage 3: Classification
  ('federal', 'classify_documents', 3, 'enrich',
   'Multiple attachments without clear purpose (SOW, amendments, forms)',
   'AI classifies each document type: Statement of Work, Amendment, SF-1449, etc.',
   'attachments', true),

  -- Stage 4: Deterministic Extraction
  ('federal', 'extract_contact_block', 4, 'transform',
   'Contact info (name, email, phone) mixed into description field',
   'Regex patterns extract structured contact data to dedicated fields',
   'description', true),

  ('federal', 'title_case_cities', 4, 'transform',
   'City names appear in ALL CAPS (MCLEAN, ARLINGTON)',
   'Convert to Title Case while preserving acronyms (McLean, but keep USA)',
   'pop_city,recipient_city', true),

  ('federal', 'normalize_state_codes', 4, 'transform',
   'States appear as full names or codes inconsistently',
   'Standardize to 2-letter state abbreviation codes',
   'pop_state,recipient_state', true),

  -- Stage 5: AI Extraction
  ('federal', 'ai_extract_requirements', 5, 'enrich',
   'Key contract requirements buried in dense PDF text',
   'Claude extracts: clearance required, wage floor, performance address, sole source justification',
   'pdf_text', true),

  -- Stage 6: Summary Generation
  ('federal', 'generate_summary', 6, 'enrich',
   'Descriptions are jargon-heavy or truncated FPDS codes',
   'AI generates plain English summary with 5 key requirements',
   'description,pdf_text', true),

  -- Stage 7: Canonical Lookups
  ('federal', 'naics_lookup', 7, 'enrich',
   'NAICS codes have no human-readable description',
   'Join to naics_codes table to get industry description',
   'naics_code', true),

  ('federal', 'psc_lookup', 7, 'enrich',
   'PSC codes are cryptic (R425, D399)',
   'Join to psc_codes table to get product/service description',
   'psc_code', true),

  ('federal', 'office_code_lookup', 7, 'enrich',
   'Office codes (FA8620, W912HY) mean nothing to users',
   'Lookup or AI-resolve to full office name (Air Force, Army Corps, etc.)',
   'office_code', true),

  -- Stage 8: Successors
  ('federal', 'find_successor', 8, 'enrich',
   'No link between expiring contracts and recompete opportunities',
   'Match expired contracts to new opportunities by NAICS, agency, keywords',
   'piid', true),

  -- Stage 9: Congress
  ('federal', 'congress_lookup', 9, 'enrich',
   'No link to congressional representative for advocacy',
   'State + ZIP → Congressional district → GovTrack representative page',
   'pop_state,pop_zip,recipient_state,recipient_zip', true)

ON CONFLICT DO NOTHING;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON jurisdictions TO awardopedia_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline_rules TO awardopedia_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ny_category_naics_map TO awardopedia_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON unspsc_naics_map TO awardopedia_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON nigp_naics_map TO awardopedia_user;
GRANT USAGE, SELECT ON SEQUENCE pipeline_rules_id_seq TO awardopedia_user;
