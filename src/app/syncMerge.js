// 同步合并算法：从 cloudSync.js 拆出，供新的逐功能资源同步（resourceSync.js）与兼容门面共用。
// 行为与重构前保持一致：test/cloudSyncMerge.test.mjs、test/cloudSyncConflict.test.mjs 仍从 cloudSync.js 导入这些函数。
// 新增合并策略时，必须同时在 syncRegistry.js 登记。

import { buildBackupEnvelope, isBackupPayloadKey } from './webdavBackup.js';
import { getMergeStrategy, isDomainMergeKey } from './syncRegistry.js';
import { normalizeWatchlist } from './marketsWatchlistStorage.js';

function nowIso() {
  return new Date().toISOString();
}

export function parseTime(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function hashString(input = '') {
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

export function parsePayloadJson(value) {
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
  const switchChains = sortRecords(mergeRecordsById(remote.switchChains, local.switchChains));
  const snapshotsByCode = {
    ...(remote.snapshotsByCode && typeof remote.snapshotsByCode === 'object' ? remote.snapshotsByCode : {}),
    ...(local.snapshotsByCode && typeof local.snapshotsByCode === 'object' ? local.snapshotsByCode : {})
  };
  return stringifyPayloadJson({
    ...remote,
    ...local,
    transactions,
    switchChains,
    snapshotsByCode,
    lastNavMeta: local.lastNavMeta || remote.lastNavMeta || {}
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

// 本地优先合并（上行时使用）：共有项本地胜，领域数据按 id 合并。
export function mergePayloadValue(key, remoteValue, localValue) {
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

// 远端权威合并（下行时使用）：共有项远端胜，本地独有项保留。
export function mergePayloadValueRemoteWins(key, remoteValue, localValue) {
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
