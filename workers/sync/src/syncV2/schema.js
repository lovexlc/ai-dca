// Key-level account sync schema. The payload stored by this module is always
// an opaque encrypted document; the Worker never parses business plaintext.

export const MAX_SYNC_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_SYNC_MUTATION_ID_LENGTH = 128;

// Keep this allowlist server-side. The client registry is useful for UI and
// migration, but it must not be the security boundary for account isolation.
export const ACCOUNT_SYNC_KEYS = new Set([
  'aiDcaFundHoldingsLedger',
  'aiDcaAccountAllocationSettings',
  'aiDcaTradeLedger',
  'aiDcaTradeLedgerArchive',
  'aiDcaAccumulationState',
  'aiDcaPlanStore',
  'aiDcaDcaStore',
  'aiDcaSellPlanStore',
  'aiDcaSwitchStrategyPrefs',
  'aiDcaNotifyAccountConfig',
  'aiDcaMarketAlerts',
  'aiDcaHoldingAlerts',
  'aiDcaWorkspacePrefs',
  'aiDcaHomeDashboardState',
  'markets:watchlist:v1',
  'aiDcaAnalyticsOptOut_v1'
]);

export function normalizeSyncKey(value = '') {
  const key = String(value || '').trim();
  return ACCOUNT_SYNC_KEYS.has(key) ? key : '';
}

export function isAccountSyncKey(value = '') {
  return Boolean(normalizeSyncKey(value));
}

export async function ensureSyncV2Schema(env) {
  if (!env?.DB) throw new Error('D1 binding DB missing');
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sync_documents_v2 (
    user_id TEXT NOT NULL,
    sync_key TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL DEFAULT '',
    encrypted_payload TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (user_id, sync_key)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sync_changes_v2 (
    change_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    sync_key TEXT NOT NULL,
    revision INTEGER NOT NULL,
    operation TEXT NOT NULL,
    content_hash TEXT NOT NULL DEFAULT '',
    changed_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sync_mutations_v2 (
    user_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, mutation_id)
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sync_documents_v2_user_updated ON sync_documents_v2 (user_id, updated_at DESC)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sync_changes_v2_user_id ON sync_changes_v2 (user_id, change_id)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sync_mutations_v2_created ON sync_mutations_v2 (created_at)').run();
}
