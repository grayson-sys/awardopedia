-- Migration: Canonical lookup tables for competition and procurement fields
-- Each table has: code (raw value), display_name, description (tooltip), sort_order

-- Set-Aside Types (SBA definitions)
CREATE TABLE IF NOT EXISTS set_aside_types (
    code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 100
);

-- Competition Types / Sole Source Authority (FAR 6.302)
CREATE TABLE IF NOT EXISTS competition_types (
    code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    far_reference TEXT,
    sort_order INTEGER DEFAULT 100
);

-- Extent Competed
CREATE TABLE IF NOT EXISTS extent_competed (
    code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 100
);

-- Solicitation Procedures
CREATE TABLE IF NOT EXISTS solicitation_procedures (
    code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 100
);

-- Commercial Item designations (FAR Part 12)
CREATE TABLE IF NOT EXISTS commercial_items (
    code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 100
);

-- Subcontracting Plan types
CREATE TABLE IF NOT EXISTS subcontracting_plans (
    code TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 100
);

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS idx_set_aside_sort ON set_aside_types(sort_order);
CREATE INDEX IF NOT EXISTS idx_competition_sort ON competition_types(sort_order);
CREATE INDEX IF NOT EXISTS idx_extent_sort ON extent_competed(sort_order);
CREATE INDEX IF NOT EXISTS idx_solicitation_sort ON solicitation_procedures(sort_order);
CREATE INDEX IF NOT EXISTS idx_commercial_sort ON commercial_items(sort_order);
CREATE INDEX IF NOT EXISTS idx_subcontract_sort ON subcontracting_plans(sort_order);
