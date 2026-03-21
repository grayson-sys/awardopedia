-- 004_alt_contact.sql
-- Add alternative/secondary point of contact columns from SAM.gov opportunity records.

ALTER TABLE opportunities
    ADD COLUMN IF NOT EXISTS alt_contact_name  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS alt_contact_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS alt_contact_phone VARCHAR(50);
