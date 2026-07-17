import { serializeSyncResourceValue } from './syncRegistry.js';

function parseValue(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function transactionsOf(value) {
  const parsed = parseValue(value);
  return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.transactions) ? parsed.transactions : []);
}

function transactionId(transaction, index) {
  return String(transaction?.id || `${transaction?.date || 'unknown'}:${transaction?.code || 'unknown'}:${index}`);
}

function transactionSummary(transaction) {
  return {
    id: transaction?.id || '',
    code: transaction?.code || '',
    name: transaction?.name || '',
    type: transaction?.type || transaction?.kind || '',
    date: transaction?.date || '',
    shares: transaction?.shares ?? '',
    price: transaction?.price ?? transaction?.costPrice ?? '',
    amount: transaction?.amount ?? '',
    note: transaction?.note || ''
  };
}

/** 返回只包含实际差异的交易行，供 UI 逐条选择。 */
export function buildTransactionConflictRows(localRaw, remoteRaw) {
  const local = new Map(transactionsOf(localRaw).map((item, index) => [transactionId(item, index), item]));
  const remote = new Map(transactionsOf(remoteRaw).map((item, index) => [transactionId(item, index), item]));
  const ids = new Set([...local.keys(), ...remote.keys()]);
  return [...ids]
    .map((id) => {
      const localRecord = local.get(id) || null;
      const remoteRecord = remote.get(id) || null;
      if (localRecord && remoteRecord && JSON.stringify(localRecord) === JSON.stringify(remoteRecord)) return null;
      const kind = localRecord && remoteRecord ? 'changed' : localRecord ? 'local-only' : 'remote-only';
      return {
        id,
        kind,
        local: localRecord,
        remote: remoteRecord,
        localSummary: localRecord ? transactionSummary(localRecord) : null,
        remoteSummary: remoteRecord ? transactionSummary(remoteRecord) : null,
        defaultDecision: kind === 'remote-only' ? 'abandon' : 'merge'
      };
    })
    .filter(Boolean)
    .sort((left, right) => `${left.localSummary?.date || left.remoteSummary?.date || ''}:${left.id}`.localeCompare(`${right.localSummary?.date || right.remoteSummary?.date || ''}:${right.id}`));
}

/**
 * 将用户选择落成交易流水。merge 表示把本机流水合入云端，abandon 表示放弃本机
 * 这一条；云端独有记录永远保留。相同 id 的记录不会重复添加。
 */
export function resolveTransactionConflicts(localRaw, remoteRaw, decisions = {}) {
  const local = new Map(transactionsOf(localRaw).map((item, index) => [transactionId(item, index), item]));
  const remote = new Map(transactionsOf(remoteRaw).map((item, index) => [transactionId(item, index), item]));
  const rows = buildTransactionConflictRows(localRaw, remoteRaw);
  const result = new Map(remote);
  for (const row of rows) {
    const decision = decisions[row.id] || row.defaultDecision;
    if (decision === 'merge' && local.has(row.id)) result.set(row.id, local.get(row.id));
    if (decision === 'abandon' && row.kind === 'local-only') result.delete(row.id);
  }
  return JSON.stringify({
    source: 'ai-dca-trade-ledger',
    version: 1,
    transactions: [...result.values()]
  });
}

export function normalizeHoldingsLedgerPayload(raw) {
  return serializeSyncResourceValue('aiDcaFundHoldingsLedger', raw);
}

export function getTransactionConflictCounts(rows = []) {
  return (Array.isArray(rows) ? rows : []).reduce((counts, row) => {
    counts[row.kind] = (counts[row.kind] || 0) + 1;
    return counts;
  }, { changed: 0, 'local-only': 0, 'remote-only': 0 });
}
