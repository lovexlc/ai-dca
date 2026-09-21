import { runAccountUserAction } from './accountLoadingState.js';
import { loadCloudSession } from './authSession.js';
import { persistLedgerState } from './holdingsLedger.js';
import { markHoldingTransactionsDirty, pushHoldingTransactions } from './holdingTransactionsSync.js';

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

const HOLDING_MUTATION_TIMEOUT_MS = 15000;

export async function persistHoldingTransactionMutation(
  nextState,
  { kind, label, deletedIds = [], deleteOnly = false, setLedger } = {}
) {
  return runAccountUserAction({ kind, resource: 'holdings/ledger', label }, async () => {
    if (typeof setLedger === 'function') setLedger(nextState);
    persistLedgerState(nextState);
    markHoldingTransactionsDirty();
    const session = loadCloudSession();
    if (!session?.accessToken) return { cloudAttempted: false, failed: [] };

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), HOLDING_MUTATION_TIMEOUT_MS) : null;
    try {
      const syncResult = await pushHoldingTransactions({
        session,
        force: deleteOnly ? false : true,
        deletedIds,
        deleteOnly,
        signal: controller?.signal
      });
      return {
        cloudAttempted: true,
        failed: Array.isArray(syncResult?.failed) ? syncResult.failed : []
      };
    } catch (error) {
      const timedOut = Boolean(controller?.signal?.aborted);
      return {
        cloudAttempted: true,
        timedOut,
        failed: [{
          message: timedOut ? '云端同步超时，本地记录已保存，稍后自动重试' : (error?.message || '云端同步失败')
        }]
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  });
}

export function persistDeletedHoldingTransaction({ ledger, txId, setLedger } = {}) {
  return persistHoldingTransactionMutation(buildLedgerAfterTransactionDelete(ledger, txId), {
    kind: 'delete',
    label: '正在删除交易',
    deletedIds: [txId],
    deleteOnly: true,
    setLedger
  });
}

export function describeHoldingTransactionSync(syncResult, localDescription, localOnlyDescription = '已保存至本地。') {
  const failed = Array.isArray(syncResult?.failed) ? syncResult.failed : [];
  if (failed.length) return `${localDescription}，云端同步失败：${failed[0]?.message || '稍后自动重试'}`;
  if (syncResult?.cloudAttempted) return `${localDescription}，已同步至云端。`;
  return `${localDescription}，${localOnlyDescription}`;
}
