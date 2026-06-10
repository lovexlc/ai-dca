// 本地业务数据 envelope helper，供账号云同步使用。
// 导出范围只包含业务白名单 key，避免 UI 状态、登录态、缓存和分析日志推高云端版本。

const LS_PREFIX = 'aiDca';
export const BACKUP_APPLIED_EVENT = 'ai-dca:backup-applied';
const HOLDINGS_BACKUP_KEYS = new Set([
  'aiDcaFundHoldingsLedger',
  'aiDcaFundHoldingsState'
]);
export const SYNCABLE_STORAGE_KEYS = new Set([
  'aiDcaAccountAssignments',
  'aiDcaAccumulationState',
  'aiDcaDcaState',
  'aiDcaDcaStore',
  'aiDcaFundHoldingsLedger',
  'aiDcaFundHoldingsState',
  'aiDcaHomeDashboardState',
  'aiDcaNotifyClientConfig',
  'aiDcaPlanState',
  'aiDcaPlanStore',
  'aiDcaPositionSnapshot',
  'aiDcaSellPlanDraft',
  'aiDcaSellPlanStore',
  'aiDcaSwitchStrategyPrefs',
  'aiDcaSwitchStrategyWorkerConfig',
  'aiDcaTradeLedger',
  'aiDcaTradeLedgerArchive',
  'aiDcaVixState',
  'aiDcaWebNotifyConfig',
  'aiDcaWorkspacePrefs'
]);
const _TRANSIENT_KEYS = new Set([
  'aiDcaPendingToasts',
  'aiDcaCloudSyncSession',
  'aiDcaCloudSyncMeta',
  'aiDcaSecureSyncRememberedKey'
]);
const BACKUP_VERSION = 1;

function safeLocalStorage() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}

export function isBackupPayloadKey(key = '') {
  return SYNCABLE_STORAGE_KEYS.has(String(key || ''));
}

export function collectBackupPayload() {
  const ls = safeLocalStorage();
  if (!ls) return { entries: {}, keys: [] };
  const entries = {};
  const keys = [];
  for (let i = 0; i < ls.length; i += 1) {
    const key = ls.key(i);
    if (!key) continue;
    if (!isBackupPayloadKey(key)) continue;
    const value = ls.getItem(key);
    if (value === null) continue;
    entries[key] = value; // 保留原始字符串，避免二次 JSON.parse 改变数据
    keys.push(key);
  }
  keys.sort();
  return { entries, keys };
}

export function buildBackupEnvelope() {
  const { entries, keys } = collectBackupPayload();
  const envelope = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    source: 'ai-dca',
    keyCount: keys.length,
    keys,
    payload: entries
  };
  return envelope;
}

export function applyBackupEnvelope(envelope, { wipePrefix = true } = {}) {
  const ls = safeLocalStorage();
  if (!ls) throw new Error('localStorage 不可用');
  if (!envelope || typeof envelope !== 'object') throw new Error('备份内容格式不合法');
  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object') throw new Error('备份缺少 payload 字段');

  if (wipePrefix) {
    const toDelete = [];
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (!key) continue;
      if (!key.startsWith(LS_PREFIX)) continue;
      if (!isBackupPayloadKey(key)) continue; // 保留登录态、缓存和 UI 临时状态
      toDelete.push(key);
    }
    toDelete.forEach((key) => ls.removeItem(key));
  }

  let restored = 0;
  const restoredKeys = [];
  Object.entries(payload).forEach(([key, value]) => {
    if (typeof key !== 'string') return;
    if (!isBackupPayloadKey(key)) return;
    if (value === null || value === undefined) return;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    ls.setItem(key, str);
    restored += 1;
    restoredKeys.push(key);
  });

  if (typeof window !== 'undefined') {
    const detail = { keys: restoredKeys, restoredKeyCount: restored };
    window.dispatchEvent(new CustomEvent(BACKUP_APPLIED_EVENT, { detail }));
    if (restoredKeys.some((key) => HOLDINGS_BACKUP_KEYS.has(key))) {
      window.dispatchEvent(new CustomEvent('holdings:ledger-updated', {
        detail: { ...detail, source: 'backup-applied' }
      }));
    }
  }

  return { restoredKeyCount: restored };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
