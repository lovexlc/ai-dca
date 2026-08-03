import { normalizeWatchlist } from '../marketsWatchlistStorage.js';
import { getMergeStrategy } from '../syncRegistry.js';

function parseValue(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return null;
  }
}

function stringifyValue(value) {
  return JSON.stringify(value);
}

function timestamp(record = {}) {
  const value = record?.updatedAt || record?.updated_at || record?.modifiedAt || record?.date || record?.createdAt || record?.created_at;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function revision(record = {}) {
  const value = Number(record?.rev ?? record?._rev ?? record?.revision ?? record?.clock);
  return Number.isFinite(value) ? value : null;
}

function origin(record = {}) {
  return String(record?.deviceId || record?.origin || record?.deviceID || record?.updatedBy || '').trim();
}

function ambiguousConflict(message = '同步记录缺少可靠版本信息') {
  const error = new Error(message);
  error.code = 'SYNC_V2_AMBIGUOUS_CONFLICT';
  return error;
}

function valuesEqual(left, right) {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return left === right; }
}

function compareRecords(local = {}, remote = {}) {
  const localRevision = revision(local);
  const remoteRevision = revision(remote);
  if (localRevision !== null && remoteRevision !== null && localRevision !== remoteRevision) {
    return localRevision > remoteRevision ? 1 : -1;
  }
  const localTime = timestamp(local);
  const remoteTime = timestamp(remote);
  if (localTime !== remoteTime) return localTime > remoteTime ? 1 : -1;
  const localOrigin = origin(local);
  const remoteOrigin = origin(remote);
  if (localOrigin && remoteOrigin && localOrigin !== remoteOrigin) return localOrigin > remoteOrigin ? 1 : -1;
  return 0;
}

function mergeRecordsById(remoteList = [], localList = []) {
  const records = new Map();
  for (const record of Array.isArray(remoteList) ? remoteList : []) {
    const id = String(record?.id || '').trim();
    if (id) records.set(id, record);
  }
  for (const record of Array.isArray(localList) ? localList : []) {
    const id = String(record?.id || '').trim();
    if (!id) continue;
    const remote = records.get(id);
    if (!remote) {
      records.set(id, record);
      continue;
    }
    const comparison = compareRecords(record, remote);
    if (comparison > 0) records.set(id, record);
    else if (comparison === 0 && !valuesEqual(record, remote)) {
      throw ambiguousConflict(`记录 ${id} 缺少可靠版本信息，无法自动合并`);
    }
  }
  return [...records.values()];
}

function sortRecords(records = []) {
  return [...records].sort((left, right) => {
    const leftDate = String(left?.date || left?.createdAt || left?.updatedAt || '');
    const rightDate = String(right?.date || right?.createdAt || right?.updatedAt || '');
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  });
}

function mergeArray(remoteValue, localValue) {
  const remote = parseValue(remoteValue);
  const local = parseValue(localValue);
  if (!Array.isArray(remote) || !Array.isArray(local)) return localValue ?? remoteValue;
  return stringifyValue(sortRecords(mergeRecordsById(remote, local)));
}

function mergePlanLike(remoteValue, localValue, activeKey) {
  const remote = parseValue(remoteValue);
  const local = parseValue(localValue);
  if (!remote || typeof remote !== 'object' || !local || typeof local !== 'object') return localValue ?? remoteValue;
  const plans = sortRecords(mergeRecordsById(remote.plans, local.plans));
  const localActive = String(local?.[activeKey] || '').trim();
  const remoteActive = String(remote?.[activeKey] || '').trim();
  const active = plans.some((plan) => plan.id === localActive)
    ? localActive
    : plans.some((plan) => plan.id === remoteActive) ? remoteActive : (plans[0]?.id || '');
  return stringifyValue({ ...remote, ...local, plans, [activeKey]: active });
}

function mergeHoldingsLedger(remoteValue, localValue) {
  const remote = parseValue(remoteValue);
  const local = parseValue(localValue);
  if (!remote || typeof remote !== 'object' || !local || typeof local !== 'object') return localValue ?? remoteValue;
  return stringifyValue({
    ...remote,
    ...local,
    transactions: sortRecords(mergeRecordsById(remote.transactions, local.transactions)),
    switchChains: sortRecords(mergeRecordsById(remote.switchChains, local.switchChains)),
    snapshotsByCode: {
      ...(remote.snapshotsByCode && typeof remote.snapshotsByCode === 'object' ? remote.snapshotsByCode : {}),
      ...(local.snapshotsByCode && typeof local.snapshotsByCode === 'object' ? local.snapshotsByCode : {})
    },
    lastNavMeta: local.lastNavMeta || remote.lastNavMeta || {}
  });
}

function unionSymbols(remoteList = [], localList = []) {
  const seen = new Set();
  const output = [];
  for (const symbol of [...(Array.isArray(remoteList) ? remoteList : []), ...(Array.isArray(localList) ? localList : [])]) {
    const value = String(symbol || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(symbol);
  }
  return output;
}

function mergeWatchlist(remoteValue, localValue) {
  const remote = parseValue(remoteValue);
  const local = parseValue(localValue);
  if (!remote || typeof remote !== 'object' || !local || typeof local !== 'object') return localValue ?? remoteValue;
  const byId = new Map();
  for (const list of [...(Array.isArray(remote.lists) ? remote.lists : []), ...(Array.isArray(local.lists) ? local.lists : [])]) {
    const id = String(list?.id || '').trim();
    if (!id) continue;
    const current = byId.get(id);
    if (!current) {
      byId.set(id, list);
      continue;
    }
    const comparison = compareRecords(list, current);
    if (comparison === 0 && !valuesEqual(list, current)) {
      throw ambiguousConflict(`自选清单 ${id} 缺少可靠版本信息，无法自动合并`);
    }
    const newer = comparison > 0 ? list : current;
    byId.set(id, {
      ...current,
      ...newer,
      us: unionSymbols(current.us, list.us),
      cn: unionSymbols(current.cn, list.cn)
    });
  }
  const lists = [...byId.values()];
  const localActive = String(local.activeListId || '').trim();
  const remoteActive = String(remote.activeListId || '').trim();
  const activeListId = lists.some((item) => item.id === localActive) ? localActive : remoteActive;
  return stringifyValue(normalizeWatchlist({ ...remote, ...local, lists, activeListId }));
}

export function mergeSyncValues(key, remoteValue, localValue) {
  if (localValue === remoteValue) return localValue;
  if (localValue == null) return remoteValue;
  if (remoteValue == null) return localValue;
  switch (getMergeStrategy(key)) {
    case 'arrayById':
      return mergeArray(remoteValue, localValue);
    case 'planStore':
      return mergePlanLike(remoteValue, localValue, 'activePlanId');
    case 'dcaStore':
      return mergePlanLike(remoteValue, localValue, 'activeDcaId');
    case 'holdingsLedger':
      return mergeHoldingsLedger(remoteValue, localValue);
    case 'objectMerge': {
      const remote = parseValue(remoteValue);
      const local = parseValue(localValue);
      return remote && local && typeof remote === 'object' && typeof local === 'object'
        ? stringifyValue({ ...remote, ...local })
        : localValue;
    }
    case 'watchlist':
      return mergeWatchlist(remoteValue, localValue);
    default: {
      const local = parseValue(localValue);
      const remote = parseValue(remoteValue);
      if (!local || !remote || typeof local !== 'object' || typeof remote !== 'object' || Array.isArray(local) || Array.isArray(remote)) {
        throw ambiguousConflict('整项数据缺少可靠版本信息，无法自动合并');
      }
      const comparison = compareRecords(local, remote);
      if (comparison > 0) return localValue;
      if (comparison < 0) return remoteValue;
      throw ambiguousConflict('整项数据缺少可靠版本信息，无法自动合并');
    }
  }
}
