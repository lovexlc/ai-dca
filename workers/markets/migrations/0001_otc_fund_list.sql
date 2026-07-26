-- Minimal OTC list row store for SQL ORDER BY / LIMIT experiments (D1 / SQLite).
-- Not a full migration of quote KV; probe + future list-rows source of truth candidate.

CREATE TABLE IF NOT EXISTS otc_fund_list (
  code TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  nav REAL,
  change_pct REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_otc_fund_list_change_pct
  ON otc_fund_list (change_pct DESC, code ASC);

CREATE TABLE IF NOT EXISTS otc_probe_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
