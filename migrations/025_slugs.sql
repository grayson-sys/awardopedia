-- 025_slugs.sql
-- SEO-friendly URL slugs for opportunities
-- Example: liquid-propane-gas-generator-fish-barrier-e6e3526f
-- Requires doadmin (FIREFLY)

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS slug VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_opps_slug ON opportunities(slug);

COMMENT ON COLUMN opportunities.slug IS 'SEO slug: slugified-title-shortid (e.g. liquid-propane-generator-e6e3526f)';

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON opportunities TO awardopedia_user;
