-- Migration 004: Add CUI (Controlled Unclassified Information) flag
-- Applied 2026-03-27

-- Flag for opportunities with controlled/CUI documents
ALTER TABLE opportunity_intel ADD COLUMN IF NOT EXISTS has_controlled_docs BOOLEAN DEFAULT FALSE;

-- Index for filtering opportunities with CUI
CREATE INDEX IF NOT EXISTS idx_intel_controlled ON opportunity_intel(has_controlled_docs) WHERE has_controlled_docs = TRUE;

COMMENT ON COLUMN opportunity_intel.has_controlled_docs IS
    'True if any attachments have accessLevel=controlled or exportControlled=true. Indicates CUI requiring SAM.gov access request.';
