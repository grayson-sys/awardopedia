-- Migration 003: Add columns needed by pipeline_opportunity.py
-- Applied 2026-03-20 during Phase B pipeline testing

ALTER TABLE opportunity_intel ADD COLUMN IF NOT EXISTS work_hours TEXT;
ALTER TABLE opportunity_intel ADD COLUMN IF NOT EXISTS key_requirements JSONB;
