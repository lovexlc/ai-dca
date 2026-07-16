import { applyBackupEnvelope, buildBackupEnvelope, isBackupPayloadKey } from './webdavBackup.js';
import { fetchCloudSyncMeta, fetchLatestCloudBackup, loadCloudSession, uploadLatestCloudBackup } from './authClient.js';
import { computeBackupContentHash, decryptBackupEnvelope, encryptBackupEnvelope, loadRememberedKey, rememberKeyForEncryptedEnvelope, saveRememberedKey } from './secureVault.js';
import { TRANSIENT_SYNC_KEYS, getMergeStrategy, isDomainMergeKey } from './syncRegistry.js';
import { normalizeWatchlist } from './marketsWatchlistStorage.js';
import { getClientEnd } from './syncClient.js';
import {
  initializeCloudSync,
  pullCloudSnapshot,
  pushCloudSnapshot,
  releaseCurrentWriter,
  scheduleCloudAutoPull as scheduleV2AutoPull,
  scheduleCloudAutoUpload as scheduleV2AutoUpload,
  startSyncCoordinator,
  syncNow,
  takeOverEditing
} from './syncCoordinator.js';

export const CLOUD_SYNC_META_KEY = 'aiDcaCloudSyncMeta';

function storage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function nowIso() {
  return new Date().toISOString();
}

function parseTime(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashString(input = '') {
  let hash = 0x811c9dc5;
  const text = String(input || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

export function createLocalDataSnapshot(envelope = buildBackupEnvelope()) {
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const keys = Object.keys(payload).sort();
  return {
    signature: hashString(stableStringify(payload)),
    keyCount: keys.length,
    keys
  };
}

function snapshotFromEnvelope(envelope) {
  return createLocalDataSnapshot(envelope || { payload: {} });
}

function normalizeEnvelopePayload(envelope = {}) {
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const keys = Array.from(new Set([
    ...(Array.isArray(envelope?.keys) ? envelope.keys : []),
    ...Object.keys(payload)
  ].map((key) => String(key || '')).filter(Boolean))).sort();
  return { payload, keys };
}

function previewKeys(keys = [], limit = 6) {
  const list = (Array.isArray(keys) ? keys : []).slice(0, limit);
  const suffix = keys.length > limit ? ` 等 ${keys.length} 项` : '';
  return `${list.join('、')}${suffix}`;
}

function parsePayloadJson(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return null;
  }
}

function stringifyPayloadJson(value) {
  return JSON.stringify(value);
}

function recordTimestamp(record = {}) {
  return parseTime(record?.updatedAt || record?.updated_at || record?.modifiedAt || record?.date || record?.createdAt || record?.created_at);
}

// 逻辑时钟：每条记录可带单调递增的修订号 + 稳定的来源设备 id，
// 让多端合并在墙钟时间错乱（时钟漂移）时仍可确定性裁决，避免静默丢边。
function recordRevision(record = {}) {
  const raw = record?.rev ?? record?._rev ?? record?.revision ?? record?.clock;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function recordOrigin(record = {}) {
  return String(record?.deviceId || record?.origin || record?.deviceID || record?.updatedBy || '').trim();
}

// >0：local 胜；<0：remote 胜；0：真正平局。优先级：修订号 → 时间戳 → 来源 id。
export function compareRecordVersions(local = {}, remote = {}) {
  const revL = recordRevision(local);
  const revR = recordRevision(remote);
  if (revL !== null && revR !== null && revL !== revR) return revL > revR ? 1 : -1;
  const tL = recordTimestamp(local);
  const tR = recordTimestamp(remote);
  if (tL !== tR) return tL > tR ? 1 : -1;
  const oL = recordOrigin(local);
  const oR = recordOrigin(remote);
  if (oL && oR && oL !== oR) return oL > oR ? 1 : -1;
  return 0;
}

function mergeRecordsById(remoteList = [], localList = [], { localWinsOnTie = true } = {}) {
  const map = new Map();
  for (const record of Array.isArray(remoteList) ? remoteList : []) {
    if (!record || typeof record !== 'object') continue;
    const id = String(record.id || '').trim();
    if (!id) continue;
    map.set(id, record);
  }
  for (const record of Array.isArray(localList) ? localList : []) {
    if (!record || typeof record !== 'object') continue;
    const id = String(record.id || '').trim();
    if (!id) continue;
    const existing = map.get(id);
    if (!existing) {
      map.set(id, record);
      continue;
    }
    const order = compareRecordVersions(record, existing);
    if (order > 0 || (order === 0 && localWinsOnTie)) {
      map.set(id, record);
    }
  }
  return Array.from(map.values());
}

function sortRecords(list = []) {
  return [...list].sort((a, b) => {
    const da = String(a?.date || a?.createdAt || a?.updatedAt || '');
    const db = String(b?.date || b?.createdAt || b?.updatedAt || '');
    if (da !== db) return da.localeCompare(db);
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

function mergeArrayPayload(remoteValue, localValue) {
  const remote = parsePayloadJson(remoteValue);
  const local = parsePayloadJson(localValue);
  if (!Array.isArray(remote) || !Array.isArray(local)) return localValue ?? remoteValue;
  return stringifyPayloadJson(sortRecords(mergeRecordsById(remote, local)));
}

function mergePlanLikeStorePayload(remoteValue, localValue, { activeKey = 'activePlanId' } = {}) {
  const remote = parsePayloadJson(remoteValue);
  const local = parsePayloadJson(localValue);
  if (!remote || typeof remote !== 'object' || !local || typeof local !== 'object') return localValue ?? remoteValue;
  const plans = sortRecords(mergeRecordsById(remote.plans, local.plans));
  const localActiveId = String(local?.[activeKey] || '').trim();
  const remoteActiveId = String(remote?.[activeKey] || '').trim();
  const activeId = plans.some((plan) => plan.id === localActiveId)
    ? localActiveId
    : (plans.some((plan) => plan.id === remoteActiveId) ? remoteActiveId : plans[0]?.id || '');
  return stringifyPayloadJson({
    ...remote,
    ...local,
    plans,
    [activeKey]: activeId
  });
}

function mergePlanStorePayload(remoteValue, localValue) {
  return mergePlanLikeStorePayload(remoteValue, localValue, { activeKey: 'activePlanId' });
}

function mergeDcaStorePayload(remoteValue, localValue) {
  return mergePlanLikeStorePayload(remoteValue, localValue, { activeKey: 'activeDcaId' });
}

function mergeObjectByCode(remoteValue, localValue) {
  const remote = parsePayloadJson(remoteValue);
  const local = parsePayloadJson(localValue);
  if (!remote || typeof remote !== 'object' || !local || typeof local !== 'object') return localValue ?? remoteValue;
  return stringifyPayloadJson({ ...remote, ...local });
}

function mergeHoldingsLedgerPayload(remoteValue, localValue) {
  const remote = parsePayloadJson(remoteValue);
  const local = parsePayloadJson(localValue);
  if (!remote || typeof remote !== 'object' || !local || typeof local !== 'object') return localValue ?? remoteValue;
  const transactions = sortRecords(mergeRecordsById(remote.transactions, local.transactions));
  return stringifyPayloadJson({
    source: 'ai-dca-trade-ledger',
    version: 1,
    transactions
  });
}

// 自选清单：lists 按 id 合并；同 id 清单的 us/cn 取并集（自选是增量行为，不能让某端的新增被覆盖丢失）；
// activeListId 优先保留本地选择；最后用 normalizeWatchlist 兜底默认清单 + 重算顶层 us/cn。
function unionSymbols(remoteList = [], localList = []) {
  const seen = new Set();
  const out = [];
  for (const sym of [...(Array.isArray(remoteList) ? remoteList : []), ...(Array.isArray(localList) ? localList : [])]) {
    const key = String(sym || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(sym);
  }
  return out;
}

function mergeWatchlistPayload(remoteValue, localValue) {
  const remote = parsePayloadJson(remoteValue);
  const local = parsePayloadJson(localValue);
  if (!remote || typeof remote !== 'object' || !local || typeof local !== 'object') return localValue ?? remoteValue;
  const remoteLists = Array.isArray(remote.lists) ? remote.lists : [];
  const localLists = Array.isArray(local.lists) ? local.lists : [];
  const byId = new Map();
  for (const list of remoteLists) {
    const id = String(list?.id || '').trim();
    if (id) byId.set(id, list);
  }
  for (const list of localLists) {
    const id = String(list?.id || '').trim();
    if (!id) continue;
    const remoteSide = byId.get(id);
    if (!remoteSide) {
      byId.set(id, list);
      continue;
    }
    // 取较新清单的元信息，但 us/cn 始终并集，保证两端新增都不丢。
    const newer = compareRecordVersions(list, remoteSide) >= 0 ? list : remoteSide;
    byId.set(id, {
      ...remoteSide,
      ...newer,
      us: unionSymbols(remoteSide.us, list.us),
      cn: unionSymbols(remoteSide.cn, list.cn)
    });
  }
  const lists = Array.from(byId.values());
  const localActiveId = String(local.activeListId || '').trim();
  const activeListId = lists.some((item) => item.id === localActiveId)
    ? localActiveId
    : String(remote.activeListId || '').trim();
  return stringifyPayloadJson(normalizeWatchlist({ ...remote, ...local, lists, activeListId }));
}

function mergePayloadValue(key, remoteValue, localValue) {
  if (localValue == null) return remoteValue;
  if (remoteValue == null) return localValue;
  switch (getMergeStrategy(key)) {
    case 'planStore':
      return mergePlanStorePayload(remoteValue, localValue);
    case 'dcaStore':
      return mergeDcaStorePayload(remoteValue, localValue);
    case 'holdingsLedger':
      return mergeHoldingsLedgerPayload(remoteValue, localValue);
    case 'arrayById':
      return mergeArrayPayload(remoteValue, localValue);
    case 'objectMerge':
      return mergeObjectByCode(remoteValue, localValue);
    case 'watchlist':
      return mergeWatchlistPayload(remoteValue, localValue);
    default:
      return localValue;
  }
}

function canAutoMergeChangedKey(key) {
  return isDomainMergeKey(key);
}

// 远端权威合并：远端覆盖两端共有的项，但保留本地独有（remote 没有、local 有）的数据。
// 用于跨端接管的拉取：另一端是最新事实来源，本端未上传的独有数据不丢。
function unionRecordsRemoteWins(remoteList = [], localList = []) {
  const map = new Map();
  for (const record of Array.isArray(localList) ? localList : []) {
    const id = String(record?.id || '').trim();
    if (id) map.set(id, record);
  }
  for (const record of Array.isArray(remoteList) ? remoteList : []) {
    const id = String(record?.id || '').trim();
    if (id) map.set(id, record); // 远端覆盖共有项
  }
  return Array.from(map.values());
}

function mergeArrayRemoteWins(remoteValue, localValue) {
  const remote = parsePayloadJson(remoteValue);
  const local = parsePayloadJson(localValue);
  if (!Array.isArray(remote) || !Array.isArray(local)) return remoteValue ?? localValue;
  return stringifyPayloadJson(sortRecords(unionRecordsRemoteWins(remote, local)));
}

function mergePlanLikeRemoteWins(remoteValue, localValue, { activeKey = 'activePlanId' } = {}) {
  const remote = parsePayloadJson(remoteValue);
  const local = parsePayloadJson(localValue);
  if (!remote || typeof remote !== 'object' || !local || typeof local !== 'object') return remoteValue ?? localValue;
  const plans = sortRecords(unionRecordsRemoteWins(remote.plans, local.plans));
  const remoteActiveId = String(remote?.[activeKey] || '').trim();
  const localActiveId = String(local?.[activeKey] || '').trim();
  const activeId = plans.some((plan) => plan.id === remoteActiveId)
    ? remoteActiveId
    : (plans.some((plan) => plan.id === localActiveId) ? localActiveId : plans[0]?.id || '');
  return stringifyPayloadJson({ ...local, ...remote, plans, [activeKey]: activeId });
}

function mergeHoldingsLedgerRemoteWins(remoteValue, localValue) {
  const remote = parsePayloadJson(remoteValue);
  const local = parsePayloadJson(localValue);
  if (!remote || typeof remote !== 'object' || !local || typeof local !== 'object') return remoteValue ?? localValue;
  const transactions = sortRecords(unionRecordsRemoteWins(remote.transactions, local.transactions));
  const switchChains = sortRecords(unionRecordsRemoteWins(remote.switchChains, local.switchChains));
  const snapshotsByCode = {
    ...(local.snapshotsByCode && typeof local.snapshotsByCode === 'object' ? local.snapshotsByCode : {}),
    ...(remote.snapshotsByCode && typeof remote.snapshotsByCode === 'object' ? remote.snapshotsByCode : {})
  };
  return stringifyPayloadJson({
    ...local,
    ...remote,
    transactions,
    switchChains,
    snapshotsByCode,
    lastNavMeta: remote.lastNavMeta || local.lastNavMeta || {}
  });
}

function mergeObjectRemoteWins(remoteValue, localValue) {
  const remote = parsePayloadJson(remoteValue);
  const local = parsePayloadJson(localValue);
  if (!remote || typeof remote !== 'object' || !local || typeof local !== 'object') return remoteValue ?? localValue;
  return stringifyPayloadJson({ ...local, ...remote });
}

function mergeWatchlistRemoteWins(remoteValue, localValue) {
  const remote = parsePayloadJson(remoteValue);
  const local = parsePayloadJson(localValue);
  if (!remote || typeof remote !== 'object' || !local || typeof local !== 'object') return remoteValue ?? localValue;
  const byId = new Map();
  for (const list of Array.isArray(local.lists) ? local.lists : []) {
    const id = String(list?.id || '').trim();
    if (id) byId.set(id, list);
  }
  for (const list of Array.isArray(remote.lists) ? remote.lists : []) {
    const id = String(list?.id || '').trim();
    if (!id) continue;
    const localSide = byId.get(id);
    // 清单内自选 us/cn 仍取并集（增量行为不能丢），其余元信息以远端为准。
    byId.set(id, localSide ? { ...localSide, ...list, us: unionSymbols(list.us, localSide.us), cn: unionSymbols(list.cn, localSide.cn) } : list);
  }
  const lists = Array.from(byId.values());
  const remoteActiveId = String(remote.activeListId || '').trim();
  const activeListId = lists.some((item) => item.id === remoteActiveId)
    ? remoteActiveId
    : String(local.activeListId || '').trim();
  return stringifyPayloadJson(normalizeWatchlist({ ...local, ...remote, lists, activeListId }));
}

function mergePayloadValueRemoteWins(key, remoteValue, localValue) {
  if (remoteValue == null) return localValue; // 远端没有、本地有 → 保留本地独有
  if (localValue == null) return remoteValue;
  switch (getMergeStrategy(key)) {
    case 'planStore':
      return mergePlanLikeRemoteWins(remoteValue, localValue, { activeKey: 'activePlanId' });
    case 'dcaStore':
      return mergePlanLikeRemoteWins(remoteValue, localValue, { activeKey: 'activeDcaId' });
    case 'holdingsLedger':
      return mergeHoldingsLedgerRemoteWins(remoteValue, localValue);
    case 'arrayById':
      return mergeArrayRemoteWins(remoteValue, localValue);
    case 'objectMerge':
      return mergeObjectRemoteWins(remoteValue, localValue);
    case 'watchlist':
      return mergeWatchlistRemoteWins(remoteValue, localValue);
    default:
      return remoteValue; // lww：远端覆盖
  }
}

// 远端权威合并整份 envelope：共有项远端胜、本地独有项保留。
export function mergeRemoteAuthoritative(remoteEnvelope = {}, localEnvelope = {}) {
  const remote = normalizeEnvelopePayload(remoteEnvelope);
  const local = normalizeEnvelopePayload(localEnvelope);
  const allKeys = Array.from(new Set([...remote.keys, ...local.keys])).filter((key) => isBackupPayloadKey(key)).sort();
  const payload = allKeys.reduce((acc, key) => {
    acc[key] = mergePayloadValueRemoteWins(key, remote.payload[key], local.payload[key]);
    return acc;
  }, {});
  const keys = Object.keys(payload).filter((key) => isBackupPayloadKey(key)).sort();
  return {
    version: Number(localEnvelope?.version || remoteEnvelope?.version || 1) || 1,
    exportedAt: nowIso(),
    source: 'ai-dca',
    keyCount: keys.length,
    keys,
    payload: keys.reduce((acc, key) => {
      acc[key] = payload[key];
      return acc;
    }, {})
  };
}

export function mergeBackupEnvelopes(remoteEnvelope = {}, localEnvelope = {}) {
  const remote = normalizeEnvelopePayload(remoteEnvelope);
  const local = normalizeEnvelopePayload(localEnvelope);
  const allKeys = Array.from(new Set([...remote.keys, ...local.keys])).filter((key) => isBackupPayloadKey(key)).sort();
  const payload = allKeys.reduce((acc, key) => {
    acc[key] = mergePayloadValue(key, remote.payload[key], local.payload[key]);
    return acc;
  }, {});
  const keys = Object.keys(payload).filter((key) => isBackupPayloadKey(key)).sort();
  return {
    version: Number(localEnvelope?.version || remoteEnvelope?.version || 1) || 1,
    exportedAt: nowIso(),
    source: 'ai-dca',
    keyCount: keys.length,
    keys,
    payload: keys.reduce((acc, key) => {
      acc[key] = payload[key];
      return acc;
    }, {})
  };
}

export function summarizeBackupConflict({ localEnvelope = null, remoteEnvelope = null, remote = null, localMeta = null } = {}) {
  const local = normalizeEnvelopePayload(localEnvelope || buildBackupEnvelope());
  const remoteData = normalizeEnvelopePayload(remoteEnvelope || { payload: {} });
  const localSet = new Set(local.keys);
  const remoteSet = new Set(remoteData.keys);
  const remoteOnlyKeys = remoteData.keys.filter((key) => !localSet.has(key));
  const localOnlyKeys = local.keys.filter((key) => !remoteSet.has(key));
  const changedKeys = remoteData.keys.filter((key) => localSet.has(key) && remoteData.payload[key] !== local.payload[key]);
  const autoMergeChangedKeys = changedKeys.filter((key) => canAutoMergeChangedKey(key));
  const unresolvedChangedKeys = changedKeys.filter((key) => !canAutoMergeChangedKey(key));
  const autoMergeKeys = Array.from(new Set([...autoMergeChangedKeys, ...remoteOnlyKeys, ...localOnlyKeys])).sort();
  const sameKeys = remoteData.keys.filter((key) => localSet.has(key) && remoteData.payload[key] === local.payload[key]);
  const parts = [];
  if (unresolvedChangedKeys.length) parts.push(`${unresolvedChangedKeys.length} 项需要手动选择：${previewKeys(unresolvedChangedKeys)}`);
  if (autoMergeKeys.length) parts.push(`${autoMergeKeys.length} 项可自动合并：${previewKeys(autoMergeKeys)}`);
  if (remoteOnlyKeys.length) parts.push(`${remoteOnlyKeys.length} 项只在云端存在：${previewKeys(remoteOnlyKeys)}`);
  if (localOnlyKeys.length) parts.push(`${localOnlyKeys.length} 项只在本机存在：${previewKeys(localOnlyKeys)}`);
  if (!parts.length) parts.push('两端数据内容一致，仅版本元数据不同');
  return {
    hasChanges: changedKeys.length > 0 || remoteOnlyKeys.length > 0 || localOnlyKeys.length > 0,
    hasConflict: unresolvedChangedKeys.length > 0,
    hasLocalChanges: changedKeys.length > 0 || localOnlyKeys.length > 0,
    remoteVersion: remote?.version ?? null,
    remoteUpdatedAt: remote?.updatedAt || remote?.encryptedEnvelope?.meta?.localUpdatedAt || '',
    remoteKeyCount: remoteData.keys.length,
    localVersion: localMeta?.version ?? null,
    localUpdatedAt: localMeta?.localUpdatedAt || '',
    localKeyCount: local.keys.length,
    changedKeys,
    autoMergeChangedKeys,
    unresolvedChangedKeys,
    autoMergeKeys,
    remoteOnlyKeys,
    localOnlyKeys,
    sameKeyCount: sameKeys.length,
    summaryText: parts.join('；')
  };
}

async function readRemoteBackupWithEnvelope({ securityPassword = '', useRemembered = false } = {}) {
  const remote = await fetchLatestCloudBackup(loadCloudSession());
  const encryptedEnvelope = remote?.encryptedEnvelope;
  if (!encryptedEnvelope?.ciphertext) return { remote, envelope: null };
  const remembered = useRemembered ? loadRememberedKey() : null;
  const secret = remembered?.rawKey ? `raw:${remembered.rawKey}` : securityPassword;
  const envelope = await decryptBackupEnvelope(encryptedEnvelope, secret);
  return { remote, envelope };
}

export async function prepareCloudSyncConflict({ securityPassword = '', useRemembered = false } = {}) {
  const localEnvelope = buildBackupEnvelope();
  const currentMeta = ensureLocalChangeBaseline({ localSnapshot: createLocalDataSnapshot(localEnvelope) });
  const { remote, envelope: remoteEnvelope } = await readRemoteBackupWithEnvelope({ securityPassword, useRemembered });
  if (!remoteEnvelope) return null;
  return summarizeBackupConflict({ localEnvelope, remoteEnvelope, remote, localMeta: currentMeta });
}

export function loadCloudSyncMeta() {
  const ls = storage();
  if (!ls) return null;
  try { return JSON.parse(ls.getItem(CLOUD_SYNC_META_KEY) || 'null'); } catch { return null; }
}

export function saveCloudSyncMeta(meta = {}) {
  const ls = storage();
  if (!ls) return null;
  const payload = { ...meta, savedAt: nowIso() };
  ls.setItem(CLOUD_SYNC_META_KEY, JSON.stringify(payload));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cloud-sync:meta-changed', { detail: { meta: payload } }));
  }
  return payload;
}

export function ensureLocalChangeBaseline({ localSnapshot, localUpdatedAt } = {}) {
  const currentMeta = loadCloudSyncMeta() || {};
  const envelope = localSnapshot ? null : buildBackupEnvelope();
  const snapshot = localSnapshot || createLocalDataSnapshot(envelope);
  const fallbackUpdatedAt = localUpdatedAt || currentMeta.localUpdatedAt || currentMeta.updatedAt || (snapshot.keyCount ? nowIso() : '');
  const next = {
    ...currentMeta,
    localSignature: currentMeta.localSignature || snapshot.signature,
    localKeyCount: currentMeta.localKeyCount ?? snapshot.keyCount,
    localUpdatedAt: fallbackUpdatedAt || currentMeta.localUpdatedAt || ''
  };
  if (next.localSignature !== currentMeta.localSignature || next.localUpdatedAt !== currentMeta.localUpdatedAt || next.localKeyCount !== currentMeta.localKeyCount) {
    return saveCloudSyncMeta(next);
  }
  return currentMeta;
}

function markLocalChanged({ signature, keyCount } = {}) {
  const currentMeta = loadCloudSyncMeta() || {};
  const changedAt = nowIso();
  return saveCloudSyncMeta({
    ...currentMeta,
    localSignature: signature,
    localKeyCount: keyCount,
    localUpdatedAt: changedAt,
    direction: 'local-change'
  });
}

function isSyncableKey(key = '') {
  const value = String(key || '');
  return isBackupPayloadKey(value) && !TRANSIENT_SYNC_KEYS.has(value);
}

function shouldUploadSnapshot(snapshot, meta, { force = false } = {}) {
  if (force) return true;
  if (!snapshot?.keyCount) return false;
  return snapshot.signature !== meta?.uploadedSignature;
}

export async function uploadEncryptedCloudBackup({ securityPassword, rememberDevice = true, force = false, useRemembered = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const localMeta = ensureLocalChangeBaseline();
  const envelope = buildBackupEnvelope();
  const snapshot = createLocalDataSnapshot(envelope);
  if (!shouldUploadSnapshot(snapshot, localMeta, { force })) {
    return {
      skipped: true,
      reason: 'unchanged-local-data',
      version: localMeta?.version ?? null,
      updatedAt: localMeta?.updatedAt || '',
      keyCount: snapshot.keyCount
    };
  }
  const remembered = useRemembered ? loadRememberedKey() : null;
  const encrypted = await encryptBackupEnvelope(envelope, securityPassword, {
    rememberDevice,
    rawKey: remembered?.rawKey || '',
    cryptoMeta: remembered?.crypto || null
  });
  const clientUpdatedAt = localMeta?.localUpdatedAt || envelope.exportedAt;
  const payload = {
    baseVersion: force ? null : (localMeta?.version ?? null),
    clientUpdatedAt,
    end: getClientEnd(),
    encryptedEnvelope: {
      version: encrypted.version,
      source: encrypted.source,
      crypto: encrypted.crypto,
      meta: {
        ...encrypted.meta,
        localSignature: snapshot.signature,
        localUpdatedAt: clientUpdatedAt
      },
      ciphertext: encrypted.ciphertext
    }
  };
  let result;
  try {
    result = await uploadLatestCloudBackup(payload, session);
  } catch (err) {
    const currentVersion = Number(err?.data?.currentVersion);
    if (!force && err?.status === 409 && Number.isFinite(currentVersion) && currentVersion >= 0) {
      // 跨端并发：另一安装实例在本端上传前已更新云端。直接走「远端权威 + 保留本地独有」自动解决，
      // 不再弹手动合并/覆盖对话框（用户诉求：非同时操作即覆盖即可）。
      return pullRemoteAuthoritativeMerge({ securityPassword, rememberDevice, useRemembered });
    }
    throw err;
  }
  if (rememberDevice && encrypted.rememberedKey) {
    saveRememberedKey(encrypted.rememberedKey, { username: session.username, version: result.version, crypto: encrypted.crypto });
  }
  saveCloudSyncMeta({
    ...localMeta,
    version: result.version,
    updatedAt: result.updatedAt,
    keyCount: envelope.keyCount,
    localSignature: snapshot.signature,
    localKeyCount: snapshot.keyCount,
    localUpdatedAt: clientUpdatedAt,
    uploadedSignature: snapshot.signature,
    uploadedAt: result.updatedAt,
    appliedContentHash: encrypted.meta?.contentHash || '',
    lastEndType: result.lastEndType || getClientEnd().type,
    direction: 'upload'
  });
  return result;
}

export async function mergeLocalIntoCloudBackup({ securityPassword = '', rememberDevice = true, useRemembered = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const localEnvelope = buildBackupEnvelope();
  const localSnapshot = createLocalDataSnapshot(localEnvelope);
  const localMeta = ensureLocalChangeBaseline({ localSnapshot });
  const { remote, envelope: remoteEnvelope } = await readRemoteBackupWithEnvelope({ securityPassword, useRemembered });
  if (!remoteEnvelope) {
    return uploadEncryptedCloudBackup({ securityPassword, rememberDevice, force: true, useRemembered });
  }
  const mergedEnvelope = mergeBackupEnvelopes(remoteEnvelope, localEnvelope);
  const remembered = useRemembered ? loadRememberedKey() : null;
  const encrypted = await encryptBackupEnvelope(mergedEnvelope, securityPassword, {
    rememberDevice,
    rawKey: remembered?.rawKey || '',
    cryptoMeta: remembered?.crypto || null
  });
  const result = await uploadLatestCloudBackup({
    baseVersion: remote.version ?? null,
    clientUpdatedAt: localMeta?.localUpdatedAt || mergedEnvelope.exportedAt,
    end: getClientEnd(),
    conflictResolution: 'merge-local-over-remote',
    encryptedEnvelope: {
      version: encrypted.version,
      source: encrypted.source,
      crypto: encrypted.crypto,
      meta: {
        ...encrypted.meta,
        localSignature: createLocalDataSnapshot(mergedEnvelope).signature,
        localUpdatedAt: localMeta?.localUpdatedAt || mergedEnvelope.exportedAt
      },
      ciphertext: encrypted.ciphertext
    }
  }, session);
  if (rememberDevice && encrypted.rememberedKey) {
    saveRememberedKey(encrypted.rememberedKey, { username: session.username, version: result.version, crypto: encrypted.crypto });
  }
  suppressAutoUpload = true;
  try {
    applyBackupEnvelope(mergedEnvelope, { wipePrefix: true });
  } finally {
    if (typeof window !== 'undefined') {
      window.setTimeout(() => { suppressAutoUpload = false; }, 0);
    } else {
      suppressAutoUpload = false;
    }
  }
  const mergedSnapshot = createLocalDataSnapshot(mergedEnvelope);
  lastObservedSignature = mergedSnapshot.signature;
  saveCloudSyncMeta({
    ...localMeta,
    version: result.version,
    updatedAt: result.updatedAt,
    keyCount: mergedEnvelope.keyCount,
    localSignature: mergedSnapshot.signature,
    localKeyCount: mergedSnapshot.keyCount,
    localUpdatedAt: localMeta?.localUpdatedAt || mergedEnvelope.exportedAt,
    uploadedSignature: mergedSnapshot.signature,
    uploadedAt: result.updatedAt,
    appliedContentHash: encrypted.meta?.contentHash || '',
    remoteSignature: mergedSnapshot.signature,
    remoteUpdatedAt: result.updatedAt,
    direction: 'merge'
  });
  return { ...result, mergedKeyCount: mergedEnvelope.keyCount, conflictResolution: 'merge-local-over-remote' };
}

export async function overwriteCloudWithLocal({ securityPassword = '', rememberDevice = true, useRemembered = false } = {}) {
  // "采用本地"：忽略云端内容，用本机数据强制覆盖云端（force 上传，baseVersion=null）。
  // 仅上传本机已加密 envelope；用户密钥仍只在本地，不会上传明文密钥。
  return uploadEncryptedCloudBackup({ securityPassword, rememberDevice, useRemembered, force: true });
}

export async function restoreEncryptedCloudBackup({ securityPassword = '', useRemembered = false, rememberDevice = true, onlyIfRemoteNewer = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const remote = await fetchLatestCloudBackup(session);
  const encryptedEnvelope = remote?.encryptedEnvelope;
  if (!encryptedEnvelope?.ciphertext) throw new Error('云端暂无可恢复数据');
  const remembered = useRemembered ? loadRememberedKey() : null;
  const secret = remembered?.rawKey ? `raw:${remembered.rawKey}` : securityPassword;
  const envelope = await decryptBackupEnvelope(encryptedEnvelope, secret);
  if (rememberDevice && !remembered?.rawKey && securityPassword) {
    await rememberKeyForEncryptedEnvelope(encryptedEnvelope, securityPassword, {
      username: session.username,
      version: remote.version
    });
  }
  const remoteSnapshot = snapshotFromEnvelope(envelope);
  const remoteContentHash = encryptedEnvelope?.meta?.contentHash || remote.contentHash || '';
  const currentEnvelope = buildBackupEnvelope();
  const currentSnapshot = createLocalDataSnapshot(currentEnvelope);
  const currentMeta = ensureLocalChangeBaseline({ localSnapshot: currentSnapshot });
  const remoteUpdatedAt = remote.updatedAt || encryptedEnvelope?.meta?.localUpdatedAt || '';
  const localUpdatedAt = currentMeta?.localUpdatedAt || '';
  const sameData = remoteSnapshot.signature === currentSnapshot.signature;
  const remoteIsNewer = parseTime(remoteUpdatedAt) > parseTime(localUpdatedAt);

  if (onlyIfRemoteNewer && (sameData || !remoteIsNewer)) {
    saveCloudSyncMeta({
      ...currentMeta,
      version: remote.version,
      updatedAt: remote.updatedAt,
      remoteSignature: remoteSnapshot.signature,
      remoteUpdatedAt,
      localSignature: currentSnapshot.signature,
      localKeyCount: currentSnapshot.keyCount,
      appliedContentHash: remoteContentHash,
      direction: sameData ? 'restore-skip-same' : 'restore-skip-local-newer'
    });
    return {
      skipped: true,
      reason: sameData ? 'same-data' : 'local-newer-or-equal',
      version: remote.version,
      updatedAt: remote.updatedAt,
      localUpdatedAt,
      remoteUpdatedAt
    };
  }

  suppressAutoUpload = true;
  let applied;
  try {
    applied = applyBackupEnvelope(envelope, { wipePrefix: true });
  } finally {
    if (typeof window !== 'undefined') {
      window.setTimeout(() => { suppressAutoUpload = false; }, 0);
    } else {
      suppressAutoUpload = false;
    }
  }
  lastObservedSignature = remoteSnapshot.signature;
  saveCloudSyncMeta({
    ...currentMeta,
    version: remote.version,
    updatedAt: remote.updatedAt,
    keyCount: applied.restoredKeyCount,
    localSignature: remoteSnapshot.signature,
    localKeyCount: remoteSnapshot.keyCount,
    localUpdatedAt: remoteUpdatedAt,
    uploadedSignature: remoteSnapshot.signature,
    uploadedAt: remote.updatedAt,
    appliedContentHash: remoteContentHash,
    remoteSignature: remoteSnapshot.signature,
    remoteUpdatedAt,
    direction: 'restore'
  });
  return { ...applied, version: remote.version, updatedAt: remote.updatedAt, localUpdatedAt: remoteUpdatedAt };
}

// 远端权威拉取：远端覆盖两端共有项、保留本地独有项，应用到本地。
// 若本地存在远端没有的独有数据，则把合并结果回传，使云端也纳入这些独有项（上传带端标识，
// 服务端按「同端不涨版本、跨端才涨」决定版本）。
export async function pullRemoteAuthoritativeMerge({ securityPassword = '', useRemembered = false, rememberDevice = true } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const localEnvelope = buildBackupEnvelope();
  const { remote, envelope: remoteEnvelope } = await readRemoteBackupWithEnvelope({ securityPassword, useRemembered });
  if (!remoteEnvelope) {
    // 云端无数据：本地有则推上去，否则空操作。
    return uploadEncryptedCloudBackup({ securityPassword, rememberDevice, useRemembered, force: true });
  }
  if (rememberDevice && securityPassword && remote?.encryptedEnvelope?.ciphertext) {
    await rememberKeyForEncryptedEnvelope(remote.encryptedEnvelope, securityPassword, {
      username: session.username,
      version: remote.version
    });
  }
  const merged = mergeRemoteAuthoritative(remoteEnvelope, localEnvelope);
  const mergedHash = await computeBackupContentHash(merged);
  const remoteHash = await computeBackupContentHash(remoteEnvelope);
  const mergedSnapshot = createLocalDataSnapshot(merged);
  const currentMeta = loadCloudSyncMeta() || {};
  // 先把合并结果落到本地（远端覆盖共有项、保留本地独有）。
  suppressAutoUpload = true;
  let applied;
  try {
    applied = applyBackupEnvelope(merged, { wipePrefix: true });
  } finally {
    if (typeof window !== 'undefined') {
      window.setTimeout(() => { suppressAutoUpload = false; }, 0);
    } else {
      suppressAutoUpload = false;
    }
  }
  lastObservedSignature = mergedSnapshot.signature;
  if (mergedHash === remoteHash) {
    // 本地无额外数据：纯拉取，不回传，版本不动。
    saveCloudSyncMeta({
      ...currentMeta,
      version: remote.version,
      updatedAt: remote.updatedAt,
      keyCount: merged.keyCount,
      localSignature: mergedSnapshot.signature,
      localKeyCount: mergedSnapshot.keyCount,
      uploadedSignature: mergedSnapshot.signature,
      uploadedAt: remote.updatedAt,
      appliedContentHash: remoteHash,
      remoteSignature: mergedSnapshot.signature,
      remoteUpdatedAt: remote.updatedAt,
      direction: 'pull'
    });
    return { ...applied, pulled: true, reuploaded: false, version: remote.version };
  }
  // 本地有额外数据：把合并结果回传，使云端也包含本地独有项。
  const remembered = useRemembered ? loadRememberedKey() : null;
  const encrypted = await encryptBackupEnvelope(merged, securityPassword, {
    rememberDevice,
    rawKey: remembered?.rawKey || '',
    cryptoMeta: remembered?.crypto || null
  });
  const result = await uploadLatestCloudBackup({
    baseVersion: remote.version ?? null,
    clientUpdatedAt: merged.exportedAt,
    end: getClientEnd(),
    conflictResolution: 'remote-authoritative-keep-local',
    encryptedEnvelope: {
      version: encrypted.version,
      source: encrypted.source,
      crypto: encrypted.crypto,
      meta: {
        ...encrypted.meta,
        localSignature: mergedSnapshot.signature,
        localUpdatedAt: merged.exportedAt
      },
      ciphertext: encrypted.ciphertext
    }
  }, session);
  if (rememberDevice && encrypted.rememberedKey) {
    saveRememberedKey(encrypted.rememberedKey, { username: session.username, version: result.version, crypto: encrypted.crypto });
  }
  saveCloudSyncMeta({
    ...currentMeta,
    version: result.version,
    updatedAt: result.updatedAt,
    keyCount: merged.keyCount,
    localSignature: mergedSnapshot.signature,
    localKeyCount: mergedSnapshot.keyCount,
    localUpdatedAt: merged.exportedAt,
    uploadedSignature: mergedSnapshot.signature,
    uploadedAt: result.updatedAt,
    appliedContentHash: encrypted.meta?.contentHash || mergedHash,
    remoteSignature: mergedSnapshot.signature,
    remoteUpdatedAt: result.updatedAt,
    direction: 'pull-merge'
  });
  return { ...applied, pulled: true, reuploaded: true, version: result.version };
}

export async function refreshRemoteCloudMeta() {
  const meta = await fetchCloudSyncMeta(loadCloudSession());
  if (meta?.version != null) {
    const currentMeta = ensureLocalChangeBaseline();
    saveCloudSyncMeta({
      ...currentMeta,
      version: meta.version,
      updatedAt: meta.updatedAt,
      remoteUpdatedAt: meta.updatedAt,
      remoteContentHash: meta.contentHash || '',
      direction: 'remote'
    });
  }
  return meta;
}

let autoSyncStarted = false;
let autoSyncTimer = null;
let originalSetItem = null;
let originalRemoveItem = null;
let originalClear = null;
let autoUploadInFlight = false;
let suppressAutoUpload = false;
let lastObservedSignature = '';
let autoPullTimer = null;
let autoPullInFlight = false;

function observeLocalChange() {
  if (suppressAutoUpload) return false;
  const envelope = buildBackupEnvelope();
  const snapshot = createLocalDataSnapshot(envelope);
  const meta = ensureLocalChangeBaseline({ localSnapshot: snapshot });
  const previousSignature = lastObservedSignature || meta?.localSignature || '';
  lastObservedSignature = snapshot.signature;
  if (snapshot.signature === previousSignature) return false;
  markLocalChanged(snapshot);
  return true;
}

function legacyScheduleCloudAutoUpload({ delay = 2500, changed = false } = {}) {
  const session = loadCloudSession();
  const remembered = loadRememberedKey();
  if (!changed) return false;
  if (!session?.accessToken || !remembered?.rawKey || typeof window === 'undefined') return false;
  window.clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(async () => {
    if (autoUploadInFlight || autoPullInFlight) return;
    autoUploadInFlight = true;
    window.dispatchEvent(new CustomEvent('cloud-sync:auto-upload-started'));
    try {
      const result = await uploadEncryptedCloudBackup({ useRemembered: true, rememberDevice: true });
      window.dispatchEvent(new CustomEvent('cloud-sync:auto-uploaded', { detail: { result } }));
    } catch (err) {
      window.dispatchEvent(new CustomEvent('cloud-sync:auto-error', {
        detail: {
          message: err?.message || String(err),
          conflict: err?.isCloudSyncConflict ? err.conflict : null
        }
      }));
    } finally {
      autoUploadInFlight = false;
    }
  }, delay);
  return true;
}

// 自动拉取：让另一台设备无需手动「恢复」也能拿到最新数据。
// 新鲜度判定用内容哈希（与版本号解耦——版本号现在只统计跨端接管次数，不再反映同端的每次改动），
// 因此即便另一台「同平台」设备改了数据、版本号没涨，本端也能凭 contentHash 差异感知并拉取。
// 远端有新内容时统一走「远端权威 + 保留本地独有」合并，避免删除本地独有数据；全程与上传互斥。
async function runCloudAutoPull() {
  const session = loadCloudSession();
  const remembered = loadRememberedKey();
  if (!session?.accessToken || !remembered?.rawKey) return;
  if (autoUploadInFlight || autoPullInFlight || suppressAutoUpload) return;
  autoPullInFlight = true;
  try {
    const remoteMeta = await fetchCloudSyncMeta(session);
    const remoteHash = String(remoteMeta?.contentHash || '');
    if (!remoteHash) return; // 云端暂无备份
    const localMeta = loadCloudSyncMeta() || {};
    const appliedHash = String(localMeta?.appliedContentHash || '');
    if (remoteHash === appliedHash) return; // 远端内容与本端已应用的一致，无需拉取
    const result = await pullRemoteAuthoritativeMerge({ useRemembered: true });
    window.dispatchEvent(new CustomEvent('cloud-sync:auto-pulled', { detail: { result } }));
  } catch (err) {
    window.dispatchEvent(new CustomEvent('cloud-sync:auto-error', {
      detail: {
        message: err?.message || String(err),
        conflict: err?.isCloudSyncConflict ? err.conflict : null
      }
    }));
  } finally {
    autoPullInFlight = false;
  }
}

function legacyScheduleCloudAutoPull({ delay = 1500 } = {}) {
  const session = loadCloudSession();
  const remembered = loadRememberedKey();
  if (!session?.accessToken || !remembered?.rawKey || typeof window === 'undefined') return false;
  window.clearTimeout(autoPullTimer);
  autoPullTimer = window.setTimeout(() => { runCloudAutoPull(); }, delay);
  return true;
}

function maybeScheduleAfterStorageMutation() {
  const changed = observeLocalChange();
  if (changed) scheduleCloudAutoUpload({ changed });
}

function legacyStartCloudAutoSync() {
  if (typeof window === 'undefined' || !window.localStorage || !window.Storage || autoSyncStarted) return;
  autoSyncStarted = true;
  const initialSnapshot = createLocalDataSnapshot(buildBackupEnvelope());
  lastObservedSignature = initialSnapshot.signature;
  ensureLocalChangeBaseline({ localSnapshot: initialSnapshot });
  const proto = window.Storage.prototype;
  originalSetItem = proto.setItem;
  originalRemoveItem = proto.removeItem;
  originalClear = proto.clear;
  proto.setItem = function patchedSetItem(key, value) {
    const before = this === window.localStorage && isSyncableKey(key) ? this.getItem(key) : null;
    const result = originalSetItem.call(this, key, value);
    if (this === window.localStorage && isSyncableKey(key) && before !== String(value)) maybeScheduleAfterStorageMutation();
    return result;
  };
  proto.removeItem = function patchedRemoveItem(key) {
    const hadValue = this === window.localStorage && isSyncableKey(key) && this.getItem(key) !== null;
    const result = originalRemoveItem.call(this, key);
    if (hadValue) maybeScheduleAfterStorageMutation();
    return result;
  };
  proto.clear = function patchedClear() {
    const before = this === window.localStorage ? createLocalDataSnapshot(buildBackupEnvelope()).signature : '';
    const result = originalClear.call(this);
    if (this === window.localStorage) {
      const after = createLocalDataSnapshot(buildBackupEnvelope()).signature;
      if (before !== after) maybeScheduleAfterStorageMutation();
    }
    return result;
  };
  window.addEventListener('storage', (event) => {
    if (isSyncableKey(event.key)) maybeScheduleAfterStorageMutation();
  });

  // 自动拉取触发器：回到前台 / 窗口聚焦 / 周期轮询，让其它设备的改动落到本机。
  window.addEventListener('visibilitychange', () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') scheduleCloudAutoPull();
  });
  window.addEventListener('focus', () => scheduleCloudAutoPull());
  window.setInterval(() => scheduleCloudAutoPull({ delay: 0 }), 60000);
  scheduleCloudAutoPull({ delay: 1500 }); // 启动后稍候拉取一次

  // 已登录时立即刷新远端 meta，让状态如实反映云端版本
  const session = loadCloudSession();
  if (session?.accessToken) {
    refreshRemoteCloudMeta().catch((err) => {
      console.warn('[cloudSync] 启动时刷新远端 meta 失败', err);
    });
  }
}

// v2 单写端同步入口。旧的 v1 实现保留在本文件内，仅供历史数据/兼容测试使用，
// 产品登录、自动同步和手动同步均从这里进入新的协调器。
export {
  initializeCloudSync,
  pullCloudSnapshot,
  pushCloudSnapshot,
  releaseCurrentWriter,
  syncNow,
  takeOverEditing
};

export function scheduleCloudAutoUpload(options = {}) {
  return scheduleV2AutoUpload(options);
}

export function scheduleCloudAutoPull(options = {}) {
  return scheduleV2AutoPull(options);
}

export function startCloudAutoSync() {
  return startSyncCoordinator();
}
