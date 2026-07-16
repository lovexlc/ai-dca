// 本地业务数据 envelope helper，供账号云同步使用。
// 导出范围只包含业务白名单 key，避免 UI 状态、登录态、缓存和分析日志推高云端版本。
// 「哪些 key 同步」唯一来源是 syncRegistry.js，本文件只负责 envelope 的收集 / 应用。

import { HOLDINGS_BACKUP_KEYS, SYNCABLE_STORAGE_KEYS } from './syncRegistry.js';
import { BACKUP_APPLIED_EVENT } from './backupEvents.js';

export { BACKUP_APPLIED_EVENT };
const HOLDINGS_EVENT_KEYS = new Set([
  'aiDcaFundHoldingsLedger',
  'aiDcaFundHoldingsState'
]);
// 恢复后需主动广播领域事件、让对应消费者重新读取的 key（无 React storage 监听兜底者）。
const PREMIUM_STATE_KEY = 'aiDcaPremiumState';
export { SYNCABLE_STORAGE_KEYS };
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

export function collectBackupPayload(allowedKeys = SYNCABLE_STORAGE_KEYS) {
  const ls = safeLocalStorage();
  if (!ls) return { entries: {}, keys: [] };
  const entries = {};
  const keys = [];
  for (let i = 0; i < ls.length; i += 1) {
    const key = ls.key(i);
    if (!key) continue;
    if (!allowedKeys.has(key)) continue;
    const value = ls.getItem(key);
    if (value === null) continue;
    entries[key] = value; // 保留原始字符串，避免二次 JSON.parse 改变数据
    keys.push(key);
  }
  keys.sort();
  return { entries, keys };
}

export function buildBackupEnvelope({ keys: requestedKeys = SYNCABLE_STORAGE_KEYS } = {}) {
  const { entries, keys } = collectBackupPayload(requestedKeys);
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

export function buildHoldingsBackupEnvelope() {
  return buildBackupEnvelope({ keys: HOLDINGS_BACKUP_KEYS });
}

export function filterBackupEnvelope(envelope = {}, allowedKeys = SYNCABLE_STORAGE_KEYS) {
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const filteredPayload = Object.fromEntries(Object.entries(payload).filter(([key]) => allowedKeys.has(key)));
  const keys = Object.keys(filteredPayload).sort();
  return {
    ...envelope,
    keyCount: keys.length,
    keys,
    payload: filteredPayload
  };
}

export function applyBackupEnvelope(envelope, { wipePrefix = true, scopeKeys = SYNCABLE_STORAGE_KEYS } = {}) {
  const ls = safeLocalStorage();
  if (!ls) throw new Error('localStorage 不可用');
  if (!envelope || typeof envelope !== 'object') throw new Error('备份内容格式不合法');
  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object') throw new Error('备份缺少 payload 字段');

  if (wipePrefix) {
    // 清理所有可同步 key（不再依赖 'aiDca' 前缀，使 markets:watchlist:v1 等非前缀 key 也能被覆盖清理）。
    // 登录态 / 缓存 / UI 临时状态因不在白名单内而被保留。
    const toDelete = [];
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (!key) continue;
      if (!scopeKeys.has(key)) continue;
      toDelete.push(key);
    }
    toDelete.forEach((key) => ls.removeItem(key));
  }

  let restored = 0;
  const restoredKeys = [];
  Object.entries(payload).forEach(([key, value]) => {
    if (typeof key !== 'string') return;
    if (!scopeKeys.has(key)) return;
    if (value === null || value === undefined) return;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    ls.setItem(key, str);
    restored += 1;
    restoredKeys.push(key);
  });

  if (typeof window !== 'undefined') {
    const detail = { keys: restoredKeys, restoredKeyCount: restored };
    window.dispatchEvent(new CustomEvent(BACKUP_APPLIED_EVENT, { detail }));
    if (restoredKeys.some((key) => HOLDINGS_EVENT_KEYS.has(key))) {
      window.dispatchEvent(new CustomEvent('holdings:ledger-updated', {
        detail: { ...detail, source: 'backup-applied' }
      }));
    }
    // 会员状态 UI 监听 aidca:premium-changed；恢复是直接写 localStorage，需补发一次以刷新。
    if (restoredKeys.includes(PREMIUM_STATE_KEY)) {
      window.dispatchEvent(new CustomEvent('aidca:premium-changed', { detail: { source: 'backup-applied' } }));
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
