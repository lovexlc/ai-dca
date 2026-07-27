-- Fee metadata is kept alongside the D1 fund snapshot.
-- The quote/limit syncs do not update these columns, so manual corrections survive
-- the next scheduled market refresh.
ALTER TABLE otc_funds ADD COLUMN fee_fund_type TEXT;
ALTER TABLE otc_funds ADD COLUMN annual_fee_rate REAL;
ALTER TABLE otc_funds ADD COLUMN management_fee_rate REAL;
ALTER TABLE otc_funds ADD COLUMN custody_fee_rate REAL;
ALTER TABLE otc_funds ADD COLUMN sales_service_fee_rate REAL;
ALTER TABLE otc_funds ADD COLUMN redeem_fee_rate REAL;
ALTER TABLE otc_funds ADD COLUMN fee_source TEXT;
ALTER TABLE otc_funds ADD COLUMN fee_notice TEXT;
ALTER TABLE otc_funds ADD COLUMN fee_json TEXT;
ALTER TABLE otc_funds ADD COLUMN fee_synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_otc_funds_fee_source ON otc_funds (fee_source);
CREATE INDEX IF NOT EXISTS idx_otc_funds_annual_fee ON otc_funds (annual_fee_rate);
CREATE INDEX IF NOT EXISTS idx_otc_funds_redeem_fee ON otc_funds (redeem_fee_rate);
