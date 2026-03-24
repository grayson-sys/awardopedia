-- Phase 8: Credit purchases tracking table
-- Run as doadmin, then GRANT to awardopedia_user

CREATE TABLE IF NOT EXISTS credit_purchases (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  credits INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  stripe_session_id VARCHAR(255) UNIQUE,
  stripe_payment_intent VARCHAR(255),
  price_id VARCHAR(255),
  pack_name VARCHAR(50),
  status VARCHAR(20) DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_credit_purchases_member ON credit_purchases(member_id);
CREATE INDEX idx_credit_purchases_session ON credit_purchases(stripe_session_id);

GRANT SELECT, INSERT, UPDATE ON credit_purchases TO awardopedia_user;
GRANT USAGE, SELECT ON SEQUENCE credit_purchases_id_seq TO awardopedia_user;
