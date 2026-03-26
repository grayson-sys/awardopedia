-- Migration: US Geographic entities (states, counties, places, territories, military bases)
-- Source: Census Bureau FIPS codes + DoD installations

CREATE TABLE IF NOT EXISTS geographies (
    fips_code VARCHAR(20) PRIMARY KEY,
    name TEXT NOT NULL,
    type VARCHAR(20) NOT NULL,  -- state, county, place, territory, military_base
    parent_fips VARCHAR(20),
    state_abbr VARCHAR(2),
    state_fips VARCHAR(2),
    population INTEGER,
    lat NUMERIC(9,6),
    lng NUMERIC(9,6),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_geo_type ON geographies(type);
CREATE INDEX IF NOT EXISTS idx_geo_state ON geographies(state_abbr);
CREATE INDEX IF NOT EXISTS idx_geo_parent ON geographies(parent_fips);
CREATE INDEX IF NOT EXISTS idx_geo_name ON geographies(name);

COMMENT ON TABLE geographies IS 'Canonical US geographic entities for location filtering';
COMMENT ON COLUMN geographies.fips_code IS 'Federal Information Processing Standard code';
COMMENT ON COLUMN geographies.type IS 'state, county, place (city/town), territory, military_base';
COMMENT ON COLUMN geographies.parent_fips IS 'Parent geography (place->county->state)';
