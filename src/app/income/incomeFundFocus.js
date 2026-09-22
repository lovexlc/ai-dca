import {
  aggregateByCode,
  buildSoldLots,
  normalizeFundCode,
  normalizeFundKind,
  summarizePortfolio,
  summarizeSoldLots,
} from '../holdingsLedgerCore.js';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function resolveIncomeFundFocus(source = null) {
  if (!source || typeof source !== 'object') return null;
  const code = normalizeFundCode(source.code || '');
  const name = normalizeText(source.name);
  const aggregationKey = normalizeText(source.aggregationKey);
  const tradingVenue = normalizeText(source.tradingVenue)
    || (aggregationKey.includes(':') ? aggregationKey.slice(aggregationKey.lastIndexOf(':') + 1) : '');
  const kind = normalizeText(source.kind).toLowerCase();
  if (!code && !name) return null;
  return { code, name, kind, tradingVenue };
}

function transactionTradingVenue(tx) {
  const kind = normalizeFundKind(tx?.kind, tx?.code, tx?.name);
  return kind === 'exchange' ? 'exchange' : 'off_exchange';
}

function matchesResolvedFocus(tx, focus) {
  const txCode = normalizeFundCode(tx?.code || '');
  if (focus.code) {
    if (txCode !== focus.code) return false;
  } else if (focus.name && normalizeText(tx?.name) !== focus.name) {
    return false;
  }
  if (focus.tradingVenue && transactionTradingVenue(tx) !== focus.tradingVenue) {
    return false;
  }
  if (!focus.tradingVenue && ['exchange', 'otc', 'qdii'].includes(focus.kind)) {
    const txKind = normalizeFundKind(tx?.kind, tx?.code, tx?.name);
    if (txKind !== focus.kind) return false;
  }
  return true;
}

export function filterIncomeTransactions(transactions = [], source = null) {
  const list = Array.isArray(transactions) ? transactions : [];
  const focus = resolveIncomeFundFocus(source);
  return focus ? list.filter((tx) => matchesResolvedFocus(tx, focus)) : list;
}

export function scopeIncomeData({ ledger, portfolio, aggregates = [], focus = null } = {}) {
  const resolvedFocus = resolveIncomeFundFocus(focus);
  if (!resolvedFocus) {
    return {
      ledger,
      portfolio,
      aggregates: Array.isArray(aggregates) ? aggregates : [],
    };
  }

  const sourceLedger = ledger && typeof ledger === 'object'
    ? ledger
    : { transactions: [], snapshotsByCode: {} };
  const transactions = filterIncomeTransactions(sourceLedger.transactions, resolvedFocus);
  const snapshotsByCode = resolvedFocus.code && sourceLedger.snapshotsByCode?.[resolvedFocus.code]
    ? { [resolvedFocus.code]: sourceLedger.snapshotsByCode[resolvedFocus.code] }
    : {};
  const scopedLedger = { ...sourceLedger, transactions, snapshotsByCode };
  const scopedAggregates = aggregateByCode(transactions, snapshotsByCode);
  const soldSummary = summarizeSoldLots(buildSoldLots(transactions));
  const scopedPortfolio = summarizePortfolio(scopedAggregates, soldSummary);

  return {
    ledger: scopedLedger,
    portfolio: { ...(portfolio || {}), ...scopedPortfolio },
    aggregates: scopedAggregates,
    focus: resolvedFocus,
  };
}
