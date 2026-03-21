-- 006_data_quality.sql
-- Track data quality scores over time with per-check detail

CREATE TABLE IF NOT EXISTS data_quality_runs (
    id              SERIAL PRIMARY KEY,
    run_date        TIMESTAMP NOT NULL DEFAULT NOW(),
    total_records   INTEGER NOT NULL,
    sample_size     INTEGER NOT NULL,
    score           NUMERIC(5,2) NOT NULL,        -- 0-100 cleanliness score
    issues_found    INTEGER NOT NULL DEFAULT 0,
    issues_fixed    INTEGER NOT NULL DEFAULT 0,
    issue_details   JSONB,                         -- [{field, notice_id, problem, fixed}]
    run_type        VARCHAR(20) DEFAULT 'scheduled', -- 'scheduled' or 'manual'
    alert_sent      BOOLEAN DEFAULT false,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dq_date ON data_quality_runs(run_date DESC);
