-- Add HQ address and executive compensation to recipients table

ALTER TABLE recipients ADD COLUMN IF NOT EXISTS hq_address TEXT;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS hq_city TEXT;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS hq_state VARCHAR(10);
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS hq_zip VARCHAR(20);
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS hq_country VARCHAR(50);
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE recipients ADD COLUMN IF NOT EXISTS executive_compensation JSONB;  -- [{name, title, total_pay}]
