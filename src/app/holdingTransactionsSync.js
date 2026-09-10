// 持仓交易行同步：只同步 holdings/ledger 下的交易行，不同步 position snapshot。
import { loadCloudSession } from './authSession.js';
import { fetchLegacyMigrationStatus } from './accountApi.js';
import { removeAccountRuntimeStorageKey, setAccountRuntimeStorageRaw } from './accountRuntimeStore.js';
import {
  deleteHoldingTransaction,
  fetchHoldingTransactionRows,
  putHoldingTransaction
} from './holdingTransactionsApi.js';

export const HOLDING_TRANSACTION_SYNC_STATE_KEY = 'aiDcaHoldingTransactionSyncState';
export const HOLDING_TRANSACTION_SYNC_EVENTS = {
  PULLED: 'holdings:transactions-pulled',
  PUSHED: 'holdings:transactions-pushed',
  ERROR: 'holdings:transactions-error'
};

const LEDGER_STORAGE_KEY = 'aiDcaFundHoldingsLedger';
const PUSH_DEBOUNCE_MS = 2500;
const PULL_DEBOUNCE_MS = 1500;
const PULL_INTERVAL_MS = 60000;

let started = false;
let pushTimer = null;
let pullTimer = null;
let pushInFlight = false;
let pullInFlight = false;
let suppressWatch = false;
let dirty = false;

function storage() {
  return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
}

function hashValue(value) {
  const text = JSON.stringify(value ?? null);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

function dispatch(name, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function readLedgerEnvelope() {
  const ls = storage();
  if (!ls) return { transactions: [] };
  try {
    const parsed = JSON.parse(ls.getItem(LEDGER_STORAGE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : { transactions: [] };
  } catch {
    return { transactions: [] };
  }
}

function readLocalTransactions() {
  const list = readLedgerEnvelope().transactions;
  return Array.isArray(list) ? list.filter((item) => item && typeof item === 'object' && String(item.id || '').trim()) : [];
}

function writeLocalTransactions(transactions) {
  const ls = storage();
  if (!ls) return;
  const current = readLedgerEnvelope();
  const next = { ...current, transactions: Array.isArray(transactions) ? transactions : [] };
  delete next.snapshotsByCode;
  const raw = JSON.stringify(next);
  suppressWatch = true;
  try {
    setAccountRuntimeStorageRaw(LEDGER_STORAGE_KEY, raw);
    ls.setItem(LEDGER_STORAGE_KEY, raw);
  } finally {
    suppressWatch = false;
  }
  dispatch('holdings:ledger-updated', { state: next, source: 'cloud-transactions' });
}

function readSyncState() {
  const ls = storage();
  if (!ls) return { rows: {}, knownIds: [] };
  try {
    const parsed = JSON.parse(ls.getItem(HOLDING_TRANSACTION_SYNC_STATE_KEY) || 'null');
    return parsed && typeof parsed === 'object'
      ? { ...parsed, rows: parsed.rows && typeof parsed.rows === 'object' ? parsed.rows : {}, knownIds: Array.isArray(parsed.knownIds) ? parsed.knownIds : [] }
      : { rows: {}, knownIds: [] };
  } catch {
    return { rows: {}, knownIds: [] };
  }
}

function writeSyncState(state) {
  const ls = storage();
  const next = { ...state, savedAt: new Date().toISOString() };
  if (ls) ls.setItem(HOLDING_TRANSACTION_SYNC_STATE_KEY, JSON.stringify(next));
  return next;
}

async function fetchAllRemoteRows(session) {
  const rows = [];
  let cursor = '';
  do {
    const result = await fetchHoldingTransactionRows({ cursor, limit: 1000 }, session);
    if (Array.isArray(result?.rows)) rows.push(...result.rows);
    cursor = String(result?.nextCursor || '');
  } while (cursor);
  return rows;
}

function mapById(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const id = String(row?.id || row?.data?.id || '').trim();
    if (id) map.set(id, row?.data || row);
  }
  return map;
}

function sameTransactions(a = [], b = []) {
  return hashValue(a) === hashValue(b);
}

async function assertMigrationComplete(session) {
  const migration = await fetchLegacyMigrationStatus(session);
  if (migration?.needsMigration) {
    const error = new Error('账号旧数据尚未迁移，暂不读取持仓交易行');
    error.code = 'LEGACY_MIGRATION_REQUIRED';
    error.migration = migration;
    throw error;
  }
  return migration;
}

export async function pullHoldingTransactions({ session = loadCloudSession(), force = false } = {}) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  await assertMigrationComplete(session);
  const remoteRows = await fetchAllRemoteRows(session);
  const remoteMap = mapById(remoteRows);
  const localRows = readLocalTransactions();
  const localMap = mapById(localRows);
  const previous = readSyncState();
  const merged = [];
  const nextRows = { ...(previous.rows || {}) };
  const pendingLocalIds = new Set();

  for (const [id, local] of localMap) {
    const remote = remoteMap.get(id);
    const known = previous.rows?.[id];
    const localDirty = force ? false : !known || known.localHash !== hashValue(local);
    if (!remote) {
      merged.push(local);
      if (!known || localDirty) pendingLocalIds.add(id);
      nextRows[id] = { ...(known || {}), revision: Number(known?.revision || 0), contentHash: String(known?.contentHash || ''), localHash: hashValue(local), pending: true, deleted: false };
    } else if (!localDirty) {
      merged.push(remote);
      const remoteRow = remoteRows.find((row) => String(row.id) === id);
      nextRows[id] = { revision: Number(remoteRow?.revision || known?.revision || 0), contentHash: String(remoteRow?.contentHash || known?.contentHash || ''), localHash: hashValue(remote), deleted: false };
    } else {
      merged.push(local);
      pendingLocalIds.add(id);
      const remoteRow = remoteRows.find((row) => String(row.id) === id);
      nextRows[id] = { ...(known || {}), revision: Number(remoteRow?.revision || known?.revision || 0), contentHash: String(remoteRow?.contentHash || known?.contentHash || ''), localHash: hashValue(local), pending: true, deleted: false };
    }
  }

  for (const [id, remote] of remoteMap) {
    if (localMap.has(id)) continue;
    const known = previous.rows?.[id];
    if (known?.revision && previous.knownIds?.includes(id)) continue;
    merged.push(remote);
    const remoteRow = remoteRows.find((row) => String(row.id) === id);
    nextRows[id] = { revision: Number(remoteRow?.revision || 0), contentHash: String(remoteRow?.contentHash || ''), localHash: hashValue(remote), deleted: false };
  }

  const nextTransactions = Array.from(new Map(merged.map((item) => [String(item.id), item])).values());
  if (!sameTransactions(localRows, nextTransactions)) writeLocalTransactions(nextTransactions);
  const state = writeSyncState({ ...previous, rows: nextRows, knownIds: Array.from(new Set([...Object.keys(nextRows), ...remoteMap.keys()])), lastPullAt: new Date().toISOString(), pendingLocalIds: Array.from(pendingLocalIds) });
  dispatch(HOLDING_TRANSACTION_SYNC_EVENTS.PULLED, {
    applied: localRows.length === nextTransactions.length ? (sameTransactions(localRows, nextTransactions) ? 0 : nextTransactions.length) : nextTransactions.length,
    remoteCount: remoteMap.size,
    pendingLocalIds: state.pendingLocalIds,
    transactions: nextTransactions
  });
  return { transactions: nextTransactions, remoteCount: remoteMap.size, pendingLocalIds: state.pendingLocalIds };
}

export async function pushHoldingTransactions({ session = loadCloudSession(), force = false } = {}) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  await assertMigrationComplete(session);
  const remoteRows = await fetchAllRemoteRows(session);
  const remoteMap = new Map(remoteRows.map((row) => [String(row.id || ''), row]));
  const localRows = readLocalTransactions();
  const localMap = mapById(localRows);
  const previous = readSyncState();
  const pushed = [];
  const deleted = [];
  const failed = [];

  for (const [id, local] of localMap) {
    const known = previous.rows?.[id];
    const remote = remoteMap.get(id);
    const localHash = hashValue(local);
    if (!force && !known?.pending && known?.localHash === localHash && (!remote || Number(remote.revision || 0) === Number(known.revision || 0))) continue;
    const baseRevision = Number(known?.revision ?? remote?.revision ?? 0);
    try {
      let result;
      try {
        result = await putHoldingTransaction(id, local, { baseRevision, force: false, end: { id: 'browser', type: 'PC Web' } }, session);
      } catch (error) {
        if (!error?.isRevisionConflict) throw error;
        result = await putHoldingTransaction(id, local, { force: true, end: { id: 'browser', type: 'PC Web' } }, session);
      }
      const rowRevision = Number(result?.rowRevision || result?.transaction?.revision || 0);
      const contentHash = String(result?.transaction?.contentHash || result?.contentHash || '');
      previous.rows[id] = { revision: rowRevision, contentHash, localHash, pending: false, deleted: false };
      pushed.push(id);
    } catch (error) {
      failed.push({ id, message: error?.message || String(error) });
    }
  }

  for (const id of previous.knownIds || []) {
    if (localMap.has(id)) continue;
    const known = previous.rows?.[id];
    if (!known?.revision || known.deleted) continue;
    try {
      const result = await deleteHoldingTransaction(id, { baseRevision: known.revision, force: false, end: { id: 'browser', type: 'PC Web' } }, session);
      previous.rows[id] = { ...known, revision: Number(result?.rowRevision || known.revision + 1), deleted: true, localHash: '' };
      deleted.push(id);
    } catch (error) {
      failed.push({ id, message: error?.message || String(error) });
    }
  }

  writeSyncState({ ...previous, knownIds: Array.from(new Set([...Object.keys(previous.rows || {}), ...localMap.keys()])), lastPushAt: new Date().toISOString(), pendingLocalIds: failed.map((item) => item.id) });
  dispatch(HOLDING_TRANSACTION_SYNC_EVENTS.PUSHED, { pushed, deleted, failed });
  if (failed.length && !pushed.length && !deleted.length) {
    const error = new Error(failed[0].message || '持仓交易同步失败');
    error.failed = failed;
    throw error;
  }
  return { pushed, deleted, failed };
}

export async function syncHoldingTransactions({ direction = 'both', session = loadCloudSession(), force = false } = {}) {
  const pulled = direction === 'push' ? null : await pullHoldingTransactions({ session, force });
  const pushed = direction === 'pull' ? null : await pushHoldingTransactions({ session, force });
  return { pulled, pushed };
}

export function markHoldingTransactionsDirty() {
  dirty = true;
  return true;
}

function schedulePush(delay = PUSH_DEBOUNCE_MS) {
  if (typeof window === 'undefined') return false;
  const session = loadCloudSession();
  if (!session?.accessToken) return false;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { runPush(); }, delay);
  return true;
}

function schedulePull(delay = PULL_DEBOUNCE_MS) {
  if (typeof window === 'undefined') return false;
  const session = loadCloudSession();
  if (!session?.accessToken) return false;
  window.clearTimeout(pullTimer);
  pullTimer = window.setTimeout(() => { runPull(); }, delay);
  return true;
}

async function runPush() {
  if (pushInFlight || pullInFlight) return;
  if (!dirty && readLocalTransactions().length === 0) return;
  const session = loadCloudSession();
  if (!session?.accessToken) return;
  pushInFlight = true;
  dirty = false;
  try {
    await pushHoldingTransactions({ session });
  } catch (error) {
    dirty = true;
    dispatch(HOLDING_TRANSACTION_SYNC_EVENTS.ERROR, { phase: 'push', message: error?.message || String(error) });
  } finally {
    pushInFlight = false;
  }
}

async function runPull() {
  if (pushInFlight || pullInFlight) return;
  const session = loadCloudSession();
  if (!session?.accessToken) return;
  pullInFlight = true;
  try {
    const result = await pullHoldingTransactions({ session });
    if (result.pendingLocalIds?.length) {
      dirty = true;
      schedulePush(0);
    }
  } catch (error) {
    dispatch(HOLDING_TRANSACTION_SYNC_EVENTS.ERROR, { phase: 'pull', message: error?.message || String(error) });
  } finally {
    pullInFlight = false;
  }
}

export function startHoldingTransactionAutoSync() {
  if (typeof window === 'undefined' || !window.localStorage || !window.Storage) return false;
  if (started) return false;
  started = true;
  const proto = window.Storage.prototype;
  const originalSetItem = proto.setItem;
  const originalRemoveItem = proto.removeItem;
  proto.setItem = function patchedSetItem(key, value) {
    const before = this === window.localStorage ? this.getItem(key) : null;
    const result = originalSetItem.call(this, key, value);
    if (this === window.localStorage && key === LEDGER_STORAGE_KEY) {
      setAccountRuntimeStorageRaw(key, value);
      if (before !== String(value) && !suppressWatch) {
        dirty = true;
        schedulePush();
      }
    }
    return result;
  };
  proto.removeItem = function patchedRemoveItem(key) {
    const had = this === window.localStorage && key === LEDGER_STORAGE_KEY && this.getItem(key) !== null;
    const result = originalRemoveItem.call(this, key);
    if (this === window.localStorage && key === LEDGER_STORAGE_KEY) {
      removeAccountRuntimeStorageKey(key);
      if (had && !suppressWatch) {
        dirty = true;
        schedulePush();
      }
    }
    return result;
  };
  window.addEventListener('focus', () => schedulePull());
  window.addEventListener('visibilitychange', () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') schedulePull();
  });
  window.setInterval(() => schedulePull(0), PULL_INTERVAL_MS);
  schedulePull(PULL_DEBOUNCE_MS);
  return true;
}
