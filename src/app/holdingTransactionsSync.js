// 持仓交易行同步：只同步 holdings/ledger 下的交易行，不同步 position snapshot。
//
// 同步协调规则（登录后所有交易读写共享）：
// - 串行队列：pull / push / 页面 hydrate / 手动恢复同一时刻只允许一个操作真正执行，
//   避免在途请求交叉读写 runtime；队列内直接调用（如 journal 恢复触发的 push）重入执行。
// - 去重：同一会话同一 force 的在途 pull 直接复用结果，重复 hydrate 不重复请求。
// - 会话身份：任何 runtime / 同步态写入前都复核当前登录会话，A→B 切换后
//   A 的在途结果一律丢弃，绝不写入 B 的运行时账本。
// - 幂等持久 pending journal：保存/删除在写入 runtime 的同时登记到按 userId
//   隔离的持久 journal（含删除），刷新后由 pull 入口恢复并重推；按 pushed id
//   云确认后才清理对应 journal 条目。
import { loadCloudSession } from './authSession.js';
import { getAccountLoadingSnapshot } from './accountLoadingState.js';
import { fetchLegacyMigrationStatus } from './accountApi.js';
import { isLikelyDateFundCode, sanitizeTransactions } from './holdingsLedgerBasics.js';
import {
  deleteHoldingTransaction,
  fetchHoldingTransaction,
  fetchHoldingTransactionRows,
  putHoldingTransaction
} from './holdingTransactionsApi.js';

export const HOLDING_TRANSACTION_SYNC_STATE_KEY = 'aiDcaHoldingTransactionSyncState';
export const HOLDING_TRANSACTION_PENDING_JOURNAL_PREFIX = 'aiDcaHoldingTxPendingJournal:';
export const HOLDING_TRANSACTION_PENDING_JOURNAL_VERSION = 1;
export const HOLDING_SYNC_SESSION_CHANGED_CODE = 'HOLDING_SYNC_SESSION_CHANGED';
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
// mutation epoch：每次本地保存/删除递增。远端读取流程用它识别
// 「拉取期间发生过本地变更」，应用时以 runtime 最新账本为准，
// 防止保存前发出的空结果晚到后覆盖保存后的状态。
let mutationEpoch = 0;
let operationSequence = 0;

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

function nowIsoText() {
  return new Date().toISOString();
}

function dispatch(name, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function isAbortError(error) {
  return String(error?.name || '') === 'AbortError' || String(error?.cause?.name || '') === 'AbortError';
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
  if (!Array.isArray(list)) return [];
  return sanitizeTransactions(list, { filterInvalid: false })
    .filter((item) => item && typeof item === 'object' && String(item.id || '').trim());
}

/** 供 mutation 层与 runtime 账本 reconcile 使用的最新交易行读取入口。 */
export function readCurrentHoldingTransactions() {
  return readLocalTransactions();
}

function writeLocalTransactions(transactions) {
  const ls = storage();
  if (!ls) return;
  const current = readLedgerEnvelope();
  const next = { ...current, transactions: Array.isArray(transactions) ? transactions : [] };
  delete next.snapshotsByCode;
  suppressWatch = true;
  try {
    ls.setItem(LEDGER_STORAGE_KEY, JSON.stringify(next));
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
  const next = { ...state, savedAt: nowIsoText() };
  if (ls) ls.setItem(HOLDING_TRANSACTION_SYNC_STATE_KEY, JSON.stringify(next));
  return next;
}

async function fetchAllRemoteRows(session, signal) {
  const rows = [];
  let cursor = '';
  const seenCursors = new Set();
  do {
    if (seenCursors.has(cursor)) throw new Error('持仓交易同步游标重复');
    seenCursors.add(cursor);
    const result = await fetchHoldingTransactionRows({ cursor, limit: 1000, signal }, session);
    if (Array.isArray(result?.rows)) rows.push(...result.rows);
    cursor = String(result?.nextCursor || '');
  } while (cursor);
  return rows;
}

function mapById(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const data = row?.data || row;
    const id = String(row?.id || data?.id || '').trim();
    if (!id || isLikelyDateFundCode(data?.code, data?.date)) continue;
    map.set(id, data);
  }
  return map;
}

function sameTransactions(a = [], b = []) {
  return hashValue(a) === hashValue(b);
}
function normalizeTransactionIds(ids = []) {
  const values = ids instanceof Set ? Array.from(ids) : Array.isArray(ids) ? ids : [ids];
  return new Set(values.map((id) => String(id || '').trim()).filter(Boolean));
}

// ---------------------------------------------------------------------------
// 会话身份保护：所有 runtime / 同步态写入前的强制复核。
// ---------------------------------------------------------------------------

function holdingSyncSessionIdentity(session) {
  return `${String(session?.userId || '')}:${hashValue(String(session?.accessToken || ''))}`;
}

function assertSameHoldingSyncSession(session) {
  const current = loadCloudSession();
  if (
    !current?.accessToken
    || String(current.userId || '') !== String(session?.userId || '')
    || String(current.accessToken || '') !== String(session?.accessToken || '')
  ) {
    const error = new Error('账号已切换，放弃写入本次持仓同步结果');
    error.code = HOLDING_SYNC_SESSION_CHANGED_CODE;
    error.silent = true;
    throw error;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 串行队列：pull / push / hydrate / 恢复共享的互斥与去重。
// ---------------------------------------------------------------------------

const operationsByKey = new Map();
let operationChain = Promise.resolve();
let operationDepth = 0;

async function runOperationExclusive(task) {
  operationDepth += 1;
  try {
    return await task();
  } finally {
    operationDepth -= 1;
  }
}

/**
 * 把一个交易同步操作排入串行队列。
 * - 同 key 的在途/排队操作直接复用同一 Promise（去重）；去重必须先于重入豁免，
 *   否则并发刷新会重入执行第二个 pull，破坏串行互斥；
 * - 已持锁（operationDepth > 0，例如保存与被挂起的 pull 并行）时直接执行，保持互斥。
 */
function enqueueHoldingOperation(key, task) {
  const existing = operationsByKey.get(key);
  if (existing) return existing;
  if (operationDepth > 0) return task();
  const promise = operationChain.then(() => runOperationExclusive(task));
  operationsByKey.set(key, promise);
  operationChain = promise.then(() => {}, () => {});
  // 清理登记时吞掉 rejection，避免产生 unhandled rejection。
  promise.then(() => {}, () => {}).then(() => {
    if (operationsByKey.get(key) === promise) operationsByKey.delete(key);
  });
  return promise;
}

// ---------------------------------------------------------------------------
// 幂等持久 pending journal（按 userId 隔离，含删除）。
// ---------------------------------------------------------------------------

export function pendingHoldingTransactionJournalKey(userId) {
  return `${HOLDING_TRANSACTION_PENDING_JOURNAL_PREFIX}${String(userId || '').trim()}`;
}

function emptyJournal() {
  return { version: HOLDING_TRANSACTION_PENDING_JOURNAL_VERSION, entries: {} };
}

function readPendingJournal(userId) {
  const ls = storage();
  if (!ls || !String(userId || '').trim()) return emptyJournal();
  try {
    const parsed = JSON.parse(ls.getItem(pendingHoldingTransactionJournalKey(userId)) || 'null');
    if (!parsed || typeof parsed !== 'object') return emptyJournal();
    // 版本化兼容读取：未知版本保留在存储中但绝不应用，避免旧格式误上传。
    if (Number(parsed.version) !== HOLDING_TRANSACTION_PENDING_JOURNAL_VERSION) {
      return { ...emptyJournal(), unsupported: true };
    }
    const entries = parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries) ? parsed.entries : {};
    return { version: HOLDING_TRANSACTION_PENDING_JOURNAL_VERSION, entries };
  } catch {
    return emptyJournal();
  }
}

function writePendingJournal(userId, entries) {
  const ls = storage();
  if (!ls || !String(userId || '').trim()) return false;
  const normalized = { ...entries };
  if (!Object.keys(normalized).length) {
    ls.removeItem(pendingHoldingTransactionJournalKey(userId));
    return true;
  }
  ls.setItem(pendingHoldingTransactionJournalKey(userId), JSON.stringify({
    version: HOLDING_TRANSACTION_PENDING_JOURNAL_VERSION,
    userId: String(userId || ''),
    entries: normalized,
    updatedAt: nowIsoText()
  }));
  return true;
}

/**
 * 显式登记一次保存/删除的变化 id 与受保护的变化行快照。
 * 匿名模式（无 session）不登记：账本本身就是真实本地持久化。
 */
export function registerPendingHoldingTransactionChanges({
  session = loadCloudSession(),
  transactions = [],
  upsertIds = [],
  deletedIds = []
} = {}) {
  if (!session?.accessToken) return { registered: false, count: 0 };
  const userId = String(session.userId || '').trim();
  if (!userId) return { registered: false, count: 0 };
  const syncState = readSyncState();
  const journal = readPendingJournal(userId);
  const entries = { ...journal.entries };
  const upsertSet = normalizeTransactionIds(upsertIds);
  const deleteSet = normalizeTransactionIds(deletedIds);
  const rowsById = new Map(
    (Array.isArray(transactions) ? transactions : [])
      .filter((tx) => tx && typeof tx === 'object')
      .map((tx) => [String(tx.id || '').trim(), tx])
  );
  let count = 0;
  for (const id of upsertSet) {
    if (deleteSet.has(id)) continue;
    const row = rowsById.get(id);
    if (!row) continue;
    entries[id] = {
      kind: 'upsert',
      row,
      baseRevision: Number(syncState.rows?.[id]?.revision || 0),
      updatedAt: nowIsoText()
    };
    count += 1;
  }
  for (const id of deleteSet) {
    entries[id] = {
      kind: 'delete',
      baseRevision: Number(syncState.rows?.[id]?.revision || 0),
      updatedAt: nowIsoText()
    };
    count += 1;
  }
  if (count) writePendingJournal(userId, entries);
  return { registered: true, count };
}

/** 只清理「未被更新mutation覆盖」的 journal 条目，防止清掉更新的保存意图。 */
function clearPendingJournalEntriesIfUnchanged(userId, ids, snapshotEntries) {
  if (!String(userId || '').trim() || !ids || !ids.length) return;
  const current = readPendingJournal(userId).entries;
  const idSet = normalizeTransactionIds(ids);
  let changed = false;
  for (const id of idSet) {
    const before = snapshotEntries?.[id];
    const nowEntry = current?.[id];
    if (!nowEntry) continue;
    if (before && JSON.stringify(before) === JSON.stringify(nowEntry)) {
      delete current[id];
      changed = true;
    }
  }
  if (changed) writePendingJournal(userId, current);
}

/** 把 journal 条目应用回当前 runtime 账本（新增/编辑 upsert、删除 tombstone）。 */
function applyPendingJournalEntriesToRuntime(entries) {
  const current = readLocalTransactions();
  const deleteIds = new Set();
  const upsertRows = [];
  for (const [id, entry] of Object.entries(entries || {})) {
    if (!entry || typeof entry !== 'object') continue;
    if (String(entry.kind || '') === 'delete') {
      deleteIds.add(String(id));
    } else if (String(entry.kind || '') === 'upsert' && entry.row && typeof entry.row === 'object') {
      upsertRows.push(entry.row);
    }
  }
  if (!deleteIds.size && !upsertRows.length) return null;
  let transactions = current;
  if (deleteIds.size) {
    transactions = transactions.filter((tx) => !deleteIds.has(String(tx?.id || '')));
  }
  if (upsertRows.length) {
    const byId = new Map(transactions.map((tx) => [String(tx.id || ''), tx]));
    for (const row of upsertRows) byId.set(String(row.id || ''), row);
    transactions = Array.from(byId.values());
  }
  if (sameTransactions(current, transactions)) return null;
  return { transactions, upsertIds: upsertRows.map((row) => String(row.id || '')), deletedIds: Array.from(deleteIds) };
}

const recoveredJournalUsers = new Set();

/** journal 恢复：本地应用（无网络依赖）+ 受保护 id 的推送重试；失败保留至下一轮。 */
async function runPendingJournalRecovery(session, signal) {
  const userId = String(session?.userId || '').trim();
  if (!userId) return { recovered: false };
  const journal = readPendingJournal(userId);
  const entryIds = Object.keys(journal.entries || {});
  if (!entryIds.length) {
    recoveredJournalUsers.add(userId);
    return { recovered: false, reason: 'empty' };
  }
  if (journal.unsupported) {
    recoveredJournalUsers.add(userId);
    return { recovered: false, reason: 'unsupported-version' };
  }

  assertSameHoldingSyncSession(session);
  const applied = applyPendingJournalEntriesToRuntime(journal.entries);
  if (applied) writeLocalTransactions(applied.transactions);

  const upsertIds = entryIds.filter((id) => String(journal.entries[id]?.kind || '') === 'upsert');
  const deletedIds = entryIds.filter((id) => String(journal.entries[id]?.kind || '') === 'delete');
  try {
    await runPushHoldingTransactionRows({ session, upsertIds, deletedIds });
  } catch {
    // 推送失败：journal 保留，下一轮 pull 继续重试；本地已应用，数据不丢。
  }
  const remaining = Object.keys(readPendingJournal(userId).entries || {}).length;
  if (!remaining) recoveredJournalUsers.add(userId);
  return { recovered: true, upsertIds, deletedIds, remaining };
}

async function assertMigrationComplete(session, signal) {
  const migration = await fetchLegacyMigrationStatus(session, { signal });
  if (migration?.needsMigration) {
    const error = new Error('账号旧数据尚未迁移，暂不读取持仓交易行');
    error.code = 'LEGACY_MIGRATION_REQUIRED';
    error.migration = migration;
    throw error;
  }
  return migration;
}

// ---------------------------------------------------------------------------
// pull：远端行按 id/revision 与当前 runtime 合并，保留 pending 行与删除 tombstone。
// ---------------------------------------------------------------------------

export function pullHoldingTransactions({ session = loadCloudSession(), force = false, signal } = {}) {
  if (!session?.accessToken) return Promise.reject(new Error('请先登录账户'));
  const key = `pull:${holdingSyncSessionIdentity(session)}:${force ? 'force' : 'normal'}`;
  return enqueueHoldingOperation(key, () => runPullHoldingTransactions({ session, force, signal }));
}

async function runPullHoldingTransactions({ session, force, signal }) {
  pullInFlight = true;
  try {
    // journal 恢复优先：即使云端不可用，也已把未确认的本地变更恢复进 runtime。
    await runPendingJournalRecovery(session, signal).catch(() => null);
    await assertMigrationComplete(session, signal);
    const remoteRows = await fetchAllRemoteRows(session, signal);
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
      // 已确认删除的行（tombstone：删除已获云确认或远端本就不存在）绝不复活。
      // 不能用「同步基线里见过这行」判断删除：页面刷新后 runtime 为空、
      // 同步基线仍在，若据此跳过，所有已同步远端行都无法重新 hydrate。
      if (known?.deleted) continue;
      merged.push(remote);
      const remoteRow = remoteRows.find((row) => String(row.id) === id);
      nextRows[id] = { revision: Number(remoteRow?.revision || 0), contentHash: String(remoteRow?.contentHash || ''), localHash: hashValue(remote), deleted: false };
    }

    // 写入前复核会话身份：切换账号后旧会话的合并结果一律丢弃。
    assertSameHoldingSyncSession(session);
    const nextTransactions = Array.from(new Map(merged.map((item) => [String(item.id), item])).values());
    if (!sameTransactions(localRows, nextTransactions)) writeLocalTransactions(nextTransactions);
    const state = writeSyncState({ ...previous, rows: nextRows, knownIds: Array.from(new Set([...Object.keys(nextRows), ...remoteMap.keys()])), lastPullAt: nowIsoText(), pendingLocalIds: Array.from(pendingLocalIds) });
    dispatch(HOLDING_TRANSACTION_SYNC_EVENTS.PULLED, { applied: localRows.length === nextTransactions.length ? (sameTransactions(localRows, nextTransactions) ? 0 : nextTransactions.length) : nextTransactions.length, remoteCount: remoteMap.size, pendingLocalIds: state.pendingLocalIds });
    return { transactions: nextTransactions, remoteCount: remoteMap.size, pendingLocalIds: state.pendingLocalIds };
  } finally {
    pullInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// push（按显式变化 id）：缺失 id 必须报告未完成；按 pushed id 验证云确认。
// ---------------------------------------------------------------------------

export function pushHoldingTransactionRows({
  session = loadCloudSession(),
  upsertIds = [],
  deletedIds = [],
  signal
} = {}) {
  if (!session?.accessToken) return Promise.reject(new Error('请先登录账户'));
  operationSequence += 1;
  const key = `push-rows:${holdingSyncSessionIdentity(session)}#${operationSequence}`;
  return enqueueHoldingOperation(key, () => runPushHoldingTransactionRows({ session, upsertIds, deletedIds, signal }));
}

async function runPushHoldingTransactionRows({ session, upsertIds, deletedIds, signal }) {
  await assertMigrationComplete(session, signal);
  const previous = readSyncState();
  const journalSnapshot = readPendingJournal(String(session?.userId || '')).entries;
  const localMap = mapById(readLocalTransactions());
  const upsertIdSet = normalizeTransactionIds(upsertIds);
  const deletedIdSet = normalizeTransactionIds(deletedIds);
  const pushed = [];
  const deleted = [];
  const failed = [];

  for (const id of upsertIdSet) {
    const local = localMap.get(id);
    if (!local) {
      // 缺失 upsert id：必须报告未完成，禁止静默 continue 后声称已同步。
      failed.push({ id, message: '本地账本中缺少该交易行，云端同步未完成' });
      continue;
    }
    const known = previous.rows?.[id];
    const baseRevision = Number(known?.revision || 0);
    try {
      const result = await putHoldingTransaction(id, local, {
        baseRevision,
        force: false,
        end: { id: 'browser', type: 'PC Web' },
        signal
      }, session);
      // 按 pushed id 验证云确认：2xx 但未确认同一 id 视为未完成，不标记已同步。
      const confirmedId = String(result?.transaction?.id || result?.id || '').trim();
      if (confirmedId !== id) {
        failed.push({ id, message: '云端响应未确认该交易行，稍后自动重试' });
        previous.rows[id] = {
          ...(known || {}),
          revision: Number(known?.revision || 0),
          localHash: hashValue(local),
          pending: true,
          deleted: false
        };
        continue;
      }
      const rowRevision = Number(result?.rowRevision || result?.transaction?.revision || baseRevision + 1);
      const contentHash = String(result?.transaction?.contentHash || result?.contentHash || known?.contentHash || '');
      previous.rows[id] = {
        ...(known || {}),
        revision: rowRevision,
        contentHash,
        localHash: hashValue(local),
        pending: false,
        deleted: false
      };
      pushed.push(id);
    } catch (error) {
      if (signal?.aborted) throw error;
      previous.rows[id] = {
        ...(known || {}),
        revision: Number(known?.revision || 0),
        localHash: hashValue(local),
        pending: true,
        deleted: false
      };
      failed.push({ id, message: error?.message || String(error) });
    }
  }

  for (const id of deletedIdSet) {
    if (localMap.has(id)) continue;
    const known = previous.rows?.[id];
    if (known?.deleted) {
      // 远端已删除（本地 tombstone 证明）：视为已确认，同步清理 journal。
      deleted.push(id);
      continue;
    }
    let baseRevision = Number(known?.revision || 0);
    if (!baseRevision) {
      try {
        const remote = await fetchHoldingTransaction(id, { signal }, session);
        baseRevision = Number(remote?.revision || 0);
      } catch (error) {
        if (Number(error?.status) !== 404) {
          if (signal?.aborted) throw error;
          failed.push({ id, message: error?.message || String(error) });
          continue;
        }
      }
    }
    if (!baseRevision) {
      previous.rows[id] = { ...(known || {}), revision: Number(known?.revision || 0), deleted: true, localHash: '' };
      deleted.push(id);
      continue;
    }
    try {
      const result = await deleteHoldingTransaction(id, {
        baseRevision,
        force: false,
        end: { id: 'browser', type: 'PC Web' },
        signal
      }, session);
      const confirmedId = String(result?.transaction?.id || result?.id || '').trim();
      if (confirmedId && confirmedId !== id) {
        failed.push({ id, message: '云端响应未确认该删除，稍后自动重试' });
        continue;
      }
      previous.rows[id] = {
        ...(known || {}),
        revision: Number(result?.rowRevision || baseRevision + 1),
        deleted: true,
        localHash: ''
      };
      deleted.push(id);
    } catch (error) {
      if (signal?.aborted) throw error;
      failed.push({ id, message: error?.message || String(error) });
    }
  }

  // 写同步态前复核会话身份；journal 按 userId 隔离，跨账号写入天然不可能。
  assertSameHoldingSyncSession(session);
  const knownIds = new Set([
    ...(previous.knownIds || []),
    ...Object.keys(previous.rows || {}),
    ...localMap.keys(),
    ...deletedIdSet
  ]);
  const state = writeSyncState({
    ...previous,
    knownIds: Array.from(knownIds),
    lastPushAt: nowIsoText(),
    pendingLocalIds: Array.from(new Set(failed.map((item) => item.id).filter(Boolean)))
  });
  // 云确认成功的 id 才清理 journal；被更新 mutation 覆盖的条目保留。
  clearPendingJournalEntriesIfUnchanged(
    String(session?.userId || ''),
    [...pushed, ...deleted],
    journalSnapshot
  );
  dispatch(HOLDING_TRANSACTION_SYNC_EVENTS.PUSHED, { pushed, deleted, failed });
  if (failed.length && !pushed.length && !deleted.length) {
    const error = new Error(failed[0].message || '持仓交易行同步失败');
    error.failed = failed;
    throw error;
  }
  return { pushed, deleted, failed, pendingLocalIds: state.pendingLocalIds };
}

// ---------------------------------------------------------------------------
// push（全量 dirty 行）：自动同步、合并迁移与手动合并共用。
// ---------------------------------------------------------------------------

export function pushHoldingTransactions({ session = loadCloudSession(), force = false, deletedIds = [], deleteOnly = false, signal } = {}) {
  if (!session?.accessToken) return Promise.reject(new Error('请先登录账户'));
  operationSequence += 1;
  const key = `push-all:${holdingSyncSessionIdentity(session)}#${operationSequence}`;
  return enqueueHoldingOperation(key, () => runPushHoldingTransactionsAll({ session, force, deletedIds, deleteOnly, signal }));
}

async function runPushHoldingTransactionsAll({ session, force, deletedIds, deleteOnly, signal }) {
  pushInFlight = true;
  try {
    await assertMigrationComplete(session, signal);
    const remoteRows = await fetchAllRemoteRows(session, signal);
    const remoteMap = new Map(remoteRows.map((row) => [String(row.id || ''), row]));
    const requestedDeletedIds = new Set(
      (Array.isArray(deletedIds) ? deletedIds : [deletedIds])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    );
    const localRows = readLocalTransactions();
    const localMap = mapById(localRows);
    const previous = readSyncState();
    const journalSnapshot = readPendingJournal(String(session?.userId || '')).entries;
    const pushed = [];
    const deleted = [];
    const failed = [];

    if (!deleteOnly) {
      for (const [id, local] of localMap) {
        const known = previous.rows?.[id];
        const remote = remoteMap.get(id);
        const localHash = hashValue(local);
        if (!force && !known?.pending && known?.localHash === localHash && (!remote || Number(remote.revision || 0) === Number(known.revision || 0))) continue;
        const baseRevision = Number(known?.revision ?? remote?.revision ?? 0);
        try {
          let result;
          try {
            result = await putHoldingTransaction(id, local, { baseRevision, force: false, end: { id: 'browser', type: 'PC Web' }, signal }, session);
          } catch (error) {
            if (!error?.isRevisionConflict || !force) throw error;
            result = await putHoldingTransaction(id, local, { force: true, end: { id: 'browser', type: 'PC Web' }, signal }, session);
          }
          const confirmedId = String(result?.transaction?.id || result?.id || '').trim();
          if (confirmedId !== id) {
            failed.push({ id, message: '云端响应未确认该交易行，稍后自动重试' });
            continue;
          }
          const rowRevision = Number(result?.rowRevision || result?.transaction?.revision || 0);
          const contentHash = String(result?.transaction?.contentHash || result?.contentHash || '');
          previous.rows[id] = { revision: rowRevision, contentHash, localHash, pending: false, deleted: false };
          pushed.push(id);
        } catch (error) {
          if (signal?.aborted) throw error;
          failed.push({ id, message: error?.message || String(error) });
        }
      }
    }

    // 页面主动删除时，即使本地同步基线还没有写入 knownIds，也必须按明确的交易 id 删除远端行。
    // 其它远端未知行仍沿用 knownIds 保护，避免 hydrate 尚未完成时误删数据。
    const deletionIds = new Set([...(previous.knownIds || []), ...requestedDeletedIds]);
    for (const id of deletionIds) {
      if (localMap.has(id)) continue;
      const known = previous.rows?.[id];
      const remote = remoteMap.get(id);
      if (known?.deleted) {
        deleted.push(id);
        continue;
      }
      const baseRevision = Number(known?.revision ?? remote?.revision ?? 0);
      if (!baseRevision) continue;
      try {
        let result;
        try {
          result = await deleteHoldingTransaction(id, { baseRevision, force: false, end: { id: 'browser', type: 'PC Web' }, signal }, session);
        } catch (error) {
          if (!error?.isRevisionConflict || !force) throw error;
          result = await deleteHoldingTransaction(id, { force: true, end: { id: 'browser', type: 'PC Web' }, signal }, session);
        }
        const confirmedId = String(result?.transaction?.id || result?.id || '').trim();
        if (confirmedId && confirmedId !== id) {
          failed.push({ id, message: '云端响应未确认该删除，稍后自动重试' });
          continue;
        }
        previous.rows[id] = { ...(known || {}), revision: Number(result?.rowRevision || baseRevision + 1), deleted: true, localHash: '' };
        deleted.push(id);
      } catch (error) {
        if (signal?.aborted) throw error;
        failed.push({ id, message: error?.message || String(error) });
      }
    }

    assertSameHoldingSyncSession(session);
    writeSyncState({ ...previous, knownIds: Array.from(new Set([...Object.keys(previous.rows || {}), ...localMap.keys()])), lastPushAt: nowIsoText(), pendingLocalIds: failed.map((item) => item.id) });
    clearPendingJournalEntriesIfUnchanged(
      String(session?.userId || ''),
      [...pushed, ...deleted],
      journalSnapshot
    );
    dispatch(HOLDING_TRANSACTION_SYNC_EVENTS.PUSHED, { pushed, deleted, failed });
    if (failed.length && !pushed.length && !deleted.length) {
      const error = new Error(failed[0].message || '持仓交易同步失败');
      error.failed = failed;
      throw error;
    }
    return { pushed, deleted, failed };
  } finally {
    pushInFlight = false;
  }
}

export async function syncHoldingTransactions({ direction = 'both', session = loadCloudSession(), force = false, signal } = {}) {
  const pulled = direction === 'push' ? null : await pullHoldingTransactions({ session, force, signal });
  const pushed = direction === 'pull' ? null : await pushHoldingTransactions({ session, force, signal });
  return { pulled, pushed };
}

export function markHoldingTransactionsDirty() {
  dirty = true;
  return true;
}

/** 本地保存/删除时递增 mutation epoch：远端读取流程据此识别拉取期间的本地变更。 */
export function markHoldingTransactionMutation() {
  mutationEpoch += 1;
  dirty = true;
  return mutationEpoch;
}

export function holdingTransactionMutationEpoch() {
  return mutationEpoch;
}

function isHoldingUserActionBusy() {
  return getAccountLoadingSnapshot().operations.some((operation) => operation.scope === 'user' && operation.resource === 'holdings/ledger');
}

function schedulePush(delay = PUSH_DEBOUNCE_MS) {
  if (typeof window === 'undefined') return false;
  const session = loadCloudSession();
  if (!session?.accessToken) return false;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { runPush(); }, delay);
  return true;
}


export function cancelScheduledHoldingTransactionPush() {
  if (typeof window !== 'undefined') {
    window.clearTimeout(pushTimer);
    pushTimer = null;
  }
  return true;
}

export function scheduleHoldingTransactionRetry(delay = PUSH_DEBOUNCE_MS) {
  return schedulePush(delay);
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
  if (pushInFlight || pullInFlight) {
    // 有同步操作在途：等它结束后再试，不能把这次待上传变更直接丢掉。
    schedulePush(PUSH_DEBOUNCE_MS);
    return;
  }
  if (isHoldingUserActionBusy()) {
    schedulePush(PUSH_DEBOUNCE_MS);
    return;
  }
  if (!dirty && readLocalTransactions().length === 0) return;
  const session = loadCloudSession();
  if (!session?.accessToken) return;
  dirty = false;
  try {
    await pushHoldingTransactions({ session });
  } catch (error) {
    dirty = true;
    if (error?.code === HOLDING_SYNC_SESSION_CHANGED_CODE || isAbortError(error)) return;
    dispatch(HOLDING_TRANSACTION_SYNC_EVENTS.ERROR, { phase: 'push', message: error?.message || String(error) });
  }
}

async function runPull() {
  if (pushInFlight || pullInFlight) {
    schedulePull(PULL_DEBOUNCE_MS);
    return;
  }
  const session = loadCloudSession();
  if (!session?.accessToken) return;
  try {
    const result = await pullHoldingTransactions({ session });
    if (result.pendingLocalIds?.length) {
      dirty = true;
      schedulePush(0);
    }
  } catch (error) {
    if (error?.code === HOLDING_SYNC_SESSION_CHANGED_CODE || isAbortError(error)) return;
    dispatch(HOLDING_TRANSACTION_SYNC_EVENTS.ERROR, { phase: 'pull', message: error?.message || String(error) });
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
    if (this === window.localStorage && key === LEDGER_STORAGE_KEY && before !== String(value) && !suppressWatch) {
      dirty = true;
      if (!isHoldingUserActionBusy()) schedulePush();
    }
    return result;
  };
  proto.removeItem = function patchedRemoveItem(key) {
    const had = this === window.localStorage && key === LEDGER_STORAGE_KEY && this.getItem(key) !== null;
    const result = originalRemoveItem.call(this, key);
    if (had && !suppressWatch) {
      dirty = true;
      if (!isHoldingUserActionBusy()) schedulePush();
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
