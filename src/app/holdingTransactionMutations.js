import { runAccountUserAction } from './accountLoadingState.js';
import { loadCloudSession } from './authSession.js';
import { persistLedgerState } from './holdingsLedger.js';
import { areHoldingTransactionsEqual } from './holdingTransactionEventState.js';
import {
  cancelScheduledHoldingTransactionPush,
  markHoldingTransactionMutation,
  pushHoldingTransactionRows,
  readCurrentHoldingTransactions,
  registerPendingHoldingTransactionChanges,
  scheduleHoldingTransactionRetry
} from './holdingTransactionsSync.js';

export function buildLedgerAfterTransactionSubmit(ledger, { draftMode = 'create', draftId = '', normalized } = {}) {
  const previousState = ledger || { transactions: [] };
  const list = Array.isArray(previousState.transactions) ? previousState.transactions : [];
  const previousTx = draftMode === 'edit' && draftId ? list.find((tx) => tx.id === draftId) : null;
  const previousPairId = previousTx?.switchPairId || '';
  const newPairId = normalized?.switchPairId || '';
  const remapSingle = (tx) => {
    if (previousPairId && previousPairId !== newPairId && tx.id === previousPairId && tx.switchPairId === normalized.id) {
      return { ...tx, switchPairId: '' };
    }
    return tx;
  };
  const transactions = draftMode === 'edit'
    ? list.map((tx) => (tx.id === normalized.id ? normalized : remapSingle(tx)))
    : [...list.map(remapSingle), normalized];
  return { ...previousState, transactions };
}

export function buildLedgerAfterTransactionDelete(ledger, txId) {
  return {
    ...(ledger || {}),
    transactions: (ledger?.transactions || [])
      .filter((item) => item.id !== txId)
      .map((item) => (item.switchPairId === txId ? { ...item, switchPairId: '' } : item))
  };
}

export function getTransactionSellValidation({ normalized, draftMode, draftId, transactions, aggregateByCodeMap } = {}) {
  if (normalized?.type !== 'SELL') return null;
  const targetAgg = aggregateByCodeMap?.get(normalized.code);
  let available = targetAgg ? targetAgg.totalShares : 0;
  if (draftMode === 'edit' && draftId) {
    const existing = (transactions || []).find((tx) => tx.id === draftId);
    if (existing?.code === normalized.code) available += existing.type === 'SELL' ? existing.shares : -existing.shares;
  }
  const allowStandaloneCostPrice = normalized.costPrice > 0 && available <= 1e-6;
  return !allowStandaloneCostPrice && normalized.shares > available + 1e-6 ? { available: Math.max(available, 0) } : null;
}

function transactionMap(state = {}) {
  const map = new Map();
  for (const transaction of Array.isArray(state?.transactions) ? state.transactions : []) {
    const id = String(transaction?.id || '').trim();
    if (id) map.set(id, transaction);
  }
  return map;
}

export function getChangedHoldingTransactionIds(previousState, nextState) {
  const previous = transactionMap(previousState);
  const next = transactionMap(nextState);
  const ids = new Set();
  for (const [id, transaction] of next) {
    if (JSON.stringify(previous.get(id) ?? null) !== JSON.stringify(transaction ?? null)) ids.add(id);
  }
  for (const id of previous.keys()) {
    if (!next.has(id)) ids.add(id);
  }
  return Array.from(ids);
}

/**
 * 与当前 runtime 账本 reconcile：React ledger 状态可能落后于 runtime
 * （例如 pull 刚完成合并），只把本次显式登记的变化行覆盖到 runtime 最新状态上，
 * 防止过期的 React 快照把 runtime 里更新的账本整体覆盖回去。
 */
export function reconcileLedgerWithRuntime(nextState, { upsertIds = [], deletedIds = [] } = {}) {
  const nextTransactions = Array.isArray(nextState?.transactions) ? nextState.transactions : [];
  const runtimeTransactions = readCurrentHoldingTransactions();
  if (areHoldingTransactionsEqual(runtimeTransactions, nextTransactions)) return nextState;

  const upsertSet = new Set((Array.isArray(upsertIds) ? upsertIds : [upsertIds]).map((id) => String(id || '').trim()).filter(Boolean));
  const deleteSet = new Set((Array.isArray(deletedIds) ? deletedIds : [deletedIds]).map((id) => String(id || '').trim()).filter(Boolean));
  const replacementById = new Map();
  for (const id of upsertSet) {
    const row = nextTransactions.find((tx) => String(tx?.id || '') === id);
    if (row) replacementById.set(id, row);
  }

  const merged = [];
  const seen = new Set();
  for (const tx of runtimeTransactions) {
    const id = String(tx?.id || '');
    if (deleteSet.has(id)) {
      seen.add(id);
      continue;
    }
    const replacement = replacementById.get(id);
    if (replacement) {
      merged.push(replacement);
      seen.add(id);
    } else {
      merged.push(tx);
    }
  }
  for (const tx of nextTransactions) {
    const id = String(tx?.id || '');
    if (!id || seen.has(id) || deleteSet.has(id)) continue;
    if (replacementById.has(id)) {
      merged.push(tx);
      seen.add(id);
    }
  }
  return { ...nextState, transactions: merged };
}

const HOLDING_MUTATION_TIMEOUT_MS = 15000;

export async function persistHoldingTransactionMutation(
  nextState,
  { kind, label, upsertIds = [], deletedIds = [], setLedger, timeoutMs = HOLDING_MUTATION_TIMEOUT_MS } = {}
) {
  return runAccountUserAction({ kind, resource: 'holdings/ledger', label }, async () => {
    cancelScheduledHoldingTransactionPush();
    const reconciled = reconcileLedgerWithRuntime(nextState, { upsertIds, deletedIds });
    if (typeof setLedger === 'function') setLedger(reconciled);
    persistLedgerState(reconciled);
    const session = loadCloudSession();
    const expectedCount = upsertIds.length + deletedIds.length;
    // 显式登记变化 id 与受保护的变化行快照：登录态写入按 userId 隔离的
    // 持久 pending journal（含删除），刷新后由 pull 入口恢复；匿名态跳过。
    registerPendingHoldingTransactionChanges({
      session,
      transactions: reconciled.transactions,
      upsertIds,
      deletedIds
    });
    // mutation epoch：让在途远端读取流程识别「拉取期间发生过本地保存」。
    markHoldingTransactionMutation();
    if (!session?.accessToken) {
      return { cloudAttempted: false, failed: [], pushed: [], deleted: [], expectedCount: 0 };
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const syncResult = await pushHoldingTransactionRows({
        session,
        upsertIds,
        deletedIds,
        signal: controller?.signal
      });
      if (syncResult.failed.length) scheduleHoldingTransactionRetry();
      else cancelScheduledHoldingTransactionPush();
      return {
        cloudAttempted: true,
        pushed: Array.isArray(syncResult?.pushed) ? syncResult.pushed : [],
        deleted: Array.isArray(syncResult?.deleted) ? syncResult.deleted : [],
        failed: Array.isArray(syncResult?.failed) ? syncResult.failed : [],
        expectedCount
      };
    } catch (error) {
      scheduleHoldingTransactionRetry();
      const timedOut = Boolean(controller?.signal?.aborted);
      return {
        cloudAttempted: true,
        pushed: [],
        deleted: [],
        timedOut,
        failed: [{
          id: '',
          message: timedOut ? '云端同步超时，本地记录已保存，稍后自动重试' : (error?.message || '云端同步失败')
        }],
        expectedCount
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  });
}

export function persistDeletedHoldingTransaction({ ledger, txId, setLedger } = {}) {
  const nextState = buildLedgerAfterTransactionDelete(ledger, txId);
  const upsertIds = getChangedHoldingTransactionIds(ledger, nextState).filter((id) => id !== txId);
  return persistHoldingTransactionMutation(nextState, {
    kind: 'delete',
    label: '正在删除交易',
    upsertIds,
    deletedIds: [txId],
    setLedger
  });
}

export function describeHoldingTransactionSync(syncResult, localDescription, localOnlyDescription = '已保存至本地。') {
  const failed = Array.isArray(syncResult?.failed) ? syncResult.failed : [];
  if (failed.length) return `${localDescription}，云端同步失败：${failed[0]?.message || '稍后自动重试'}`;
  if (syncResult?.cloudAttempted) {
    const confirmed = (syncResult?.pushed?.length || 0) + (syncResult?.deleted?.length || 0);
    const expected = Number(syncResult?.expectedCount || 0);
    // 有显式变化却没有任何云确认时，绝不能声称「已同步至云端」。
    if (!confirmed && expected > 0) {
      return `${localDescription}，云端同步尚未确认，稍后自动重试`;
    }
    return `${localDescription}，已同步至云端。`;
  }
  return `${localDescription}，${localOnlyDescription}`;
}
