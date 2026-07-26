-- Full OTC fund row: danjuan quote/returns + fund-limit columns + JSON blobs.
-- Replaces the probe-only otc_fund_list for real list/sync use.
-- Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS otc_funds (
  code TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  symbol TEXT,
  latest_nav REAL,
  latest_nav_date TEXT,
  change_pct REAL,
  ytd_return REAL,
  return_1w REAL,
  return_1m REAL,
  return_3m REAL,
  return_6m REAL,
  return_1y REAL,
  return_base REAL,
  max_drawdown REAL,
  fund_size REAL,
  fund_type_code TEXT,
  source TEXT,
  as_of TEXT,
  quote_updated_at INTEGER,
  quote_synced_at TEXT,
  buy_status TEXT,
  buy_status_text TEXT,
  min_purchase REAL,
  max_purchase_per_day REAL,
  limit_channel TEXT,
  redeem_status TEXT,
  fixed_invest TEXT,
  fixed_invest_min REAL,
  confirm_days REAL,
  limit_source TEXT,
  limit_json TEXT,
  limit_synced_at TEXT,
  quote_json TEXT,
  raw_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_otc_funds_change_pct
  ON otc_funds (change_pct DESC, code ASC);

CREATE INDEX IF NOT EXISTS idx_otc_funds_return_1m
  ON otc_funds (return_1m DESC, code ASC);

CREATE INDEX IF NOT EXISTS idx_otc_funds_return_1y
  ON otc_funds (return_1y DESC, code ASC);

CREATE INDEX IF NOT EXISTS idx_otc_funds_max_purchase
  ON otc_funds (max_purchase_per_day ASC, code ASC);

CREATE INDEX IF NOT EXISTS idx_otc_funds_name
  ON otc_funds (name COLLATE NOCASE);
