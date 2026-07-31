import {
  ACCOUNT_SYNC_REGISTRY,
  getSyncDescriptor,
  isAccountSyncKey
} from '../syncRegistry.js';
import { mergeSyncPayloadValue } from '../cloudSync.js';

function storage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function parseJson(value) {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function normalizeJsonValue(value) {
  const parsed = parseJson(value);
  return parsed === null ? String(value) : stableStringify(parsed);
}

function normalizeHoldingsLedger(value) {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return normalizeJsonValue(value);
  const next = { ...parsed };
  delete next.snapshotsByCode;
  delete next.lastNavMeta;
  return stableStringify(next);
}

function normalizeNotifyAccountConfig(value) {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return normalizeJsonValue(value);
  return stableStringify({
    barkDeviceKey: String(parsed.barkDeviceKey || '').trim(),
    serverChan3Uid: String(parsed.serverChan3Uid || '').trim(),
    serverChan3SendKey: String(parsed.serverChan3SendKey || '').trim()
  });
}

export function normalizeForSync(key, rawValue) {
  if (!isAccountSyncKey(key)) return rawValue == null ? null : String(rawValue);
  if (rawValue == null) return null;
  switch (getSyncDescriptor(key)?.adapter) {
    case 'holdingsLedger':
      return normalizeHoldingsLedger(rawValue);
    case 'notifyAccountConfig':
      return normalizeNotifyAccountConfig(rawValue);
    default:
      return normalizeJsonValue(rawValue);
  }
}

export function readLocalSyncValue(key) {
  return storage()?.getItem(String(key || '')) ?? null;
}

export function readLocalSyncValues(keys = ACCOUNT_SYNC_REGISTRY.map((descriptor) => descriptor.key)) {
  return new Map((Array.isArray(keys) ? keys : []).filter(isAccountSyncKey).map((key) => [key, normalizeForSync(key, readLocalSyncValue(key))]));
}

export function applyLocalSyncValue(key, normalizedValue) {
  const target = storage();
  if (!target || !isAccountSyncKey(key)) return false;
  if (normalizedValue == null) target.removeItem(key);
  else target.setItem(key, String(normalizedValue));
  if (typeof window !== 'undefined') {
    const detail = { keys: [key], source: 'sync-v2' };
    window.dispatchEvent(new CustomEvent('cloud-sync:v2-applied', { detail }));
    if (key === 'aiDcaFundHoldingsLedger') {
      window.dispatchEvent(new CustomEvent('holdings:ledger-updated', { detail }));
    }
  }
  return true;
}

function recordId(record) {
  return String(record?.id || '').trim();
}

function mergeById(remote = [], local = []) {
  const result = new Map();
  for (const item of Array.isArray(remote) ? remote : []) {
    const id = recordId(item);
    if (id) result.set(id, item);
  }
  for (const item of Array.isArray(local) ? local : []) {
    const id = recordId(item);
    if (!id) continue;
    const current = result.get(id);
    if (!current) result.set(id, item);
    else result.set(id, { ...current, ...item });
  }
  return Array.from(result.values());
}

export function mergeSyncValues(key, remoteValue, localValue) {
  const merged = mergeSyncPayloadValue(key, remoteValue, localValue);
  if (merged == null) return merged;
  // The legacy merge helper preserves the existing business conflict rules;
  // normalize once more so V2 hashes are deterministic and derived holdings
  // fields never re-enter the account document.
  return normalizeForSync(key, merged);
}

export async function contentHash(value) {
  const text = String(value == null ? 'null' : value);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return `fnv1a:${(hash >>> 0).toString(16)}`;
}

export function descriptorForKey(key) {
  return getSyncDescriptor(key);
}

export const __internals = {
  stableStringify,
  normalizeHoldingsLedger,
  normalizeNotifyAccountConfig,
  mergeById,
  parseJson
};
