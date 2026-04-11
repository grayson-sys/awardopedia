-- 026_contract_lineage.sql
-- Link USASpending contracts to SAM.gov opportunities
-- Powers the "Competitive Landscape" beta module on opportunity pages
-- Requires doadmin (FIREFLY)

CREATE TABLE IF NOT EXISTS contract_lineage (
    id              SERIAL PRIMARY KEY,
    notice_id       VARCHAR(255) NOT NULL,
    piid            VARCHAR(255) NOT NULL,
    link_type       VARCHAR(32) NOT NULL,  -- 'solicitation_exact', 'solicitation_norm', 'base_piid', 'fuzzy'
    confidence      NUMERIC(3,2) NOT NULL, -- 0.00 to 1.00
    match_reasons   JSONB,                  -- ["same_agency", "same_naics", "title_overlap:70"]
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (notice_id, piid)
);

CREATE INDEX IF NOT EXISTS idx_lineage_notice_id ON contract_lineage(notice_id);
CREATE INDEX IF NOT EXISTS idx_lineage_piid ON contract_lineage(piid);
CREATE INDEX IF NOT EXISTS idx_lineage_confidence ON contract_lineage(confidence DESC);

COMMENT ON TABLE contract_lineage IS 'Links SAM.gov opportunities to USASpending contracts (incumbents, recompetes, predecessors)';
COMMENT ON COLUMN contract_lineage.link_type IS 'solicitation_exact = definite recompete, base_piid = modification chain, fuzzy = scored match';
COMMENT ON COLUMN contract_lineage.confidence IS '0.00-1.00. Exact solicitation match = 0.99, base piid = 0.95, fuzzy = 0.60-0.85';

GRANT SELECT, INSERT, UPDATE, DELETE ON contract_lineage TO awardopedia_user;
GRANT USAGE, SELECT ON SEQUENCE contract_lineage_id_seq TO awardopedia_user;
