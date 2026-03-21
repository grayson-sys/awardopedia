-- 007_pipeline_feedback.sql
-- Human and AI feedback that flows back into pipeline improvements.
-- Rules are PROPOSED, never auto-applied. Human approval required.

CREATE TABLE IF NOT EXISTS pipeline_feedback (
    id              SERIAL PRIMARY KEY,
    notice_id       VARCHAR(255),
    field_name      VARCHAR(100) NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    explanation     TEXT NOT NULL,          -- Human: "what's wrong and how to catch it"
    proposed_rule   TEXT,                   -- Generalized pipeline rule description
    source          VARCHAR(20) NOT NULL,   -- 'human' or 'ai'
    status          VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
    approved_by     VARCHAR(100),
    approved_at     TIMESTAMP,
    implemented     BOOLEAN DEFAULT false,  -- Has the rule been coded into the pipeline?
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pf_status ON pipeline_feedback(status);
CREATE INDEX IF NOT EXISTS idx_pf_source ON pipeline_feedback(source);
