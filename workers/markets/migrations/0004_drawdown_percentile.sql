-- Add drawdown_percentile column for precomputed drawdown percentile.
-- Computed during OTC fund sync from NAV history and persisted here
-- so list queries can return it without per-request KV reads.
ALTER TABLE otc_funds ADD COLUMN drawdown_percentile REAL;
