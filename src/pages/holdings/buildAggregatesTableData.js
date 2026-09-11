import { attachUnrealized } from '../../app/costTracker.js';
import { aggregateByCode, normalizeFundKind } from '../../app/holdingsLedgerCore.js';

export const MIN_DISPLAY_HOLDING_SHARES = 0.01;

export function hasMeaningfulHoldingPosition(agg = {}) {
  const shares = Math.abs(Number(agg.totalShares) || 0);
  const pendingBuyAmount = Number(agg.pendingBuyAmount) || 0;
  return Boolean(agg.hasPosition) && (shares >= MIN_DISPLAY_HOLDING_SHARES || pendingBuyAmount > 0);
}

function resolveTradingVenue(tx = {}) {
  return normalizeFundKind(tx.kind, tx.code, tx.name) === 'exchange' ? 'exchange' : 'off_exchange';
}

function snapshotFromAggregate(agg = {}) {
  return {
    code: agg.code,
    name: agg.name,
    latestNav: agg.latestNav || agg.currentPrice,
    previousNav: agg.previousNav || agg.previousPrice,
    currentPrice: agg.currentPrice,
    price: agg.currentPrice,
    previousClose: agg.previousPrice,
    changePercent: agg.changePercent,
    latestNavDate: agg.latestNavDate,
    previousNavDate: agg.previousNavDate,
    quoteDate: agg.quoteDate,
    asOf: agg.asOf,
    marketState: agg.marketState,
    updatedAt: agg.snapshotUpdatedAt,
    error: agg.snapshotError
  };
}

export function splitAggregatesByTradingVenue(aggregates = []) {
  const rows = [];
  for (const agg of Array.isArray(aggregates) ? aggregates : []) {
    const transactions = Array.isArray(agg?.transactions) ? agg.transactions : [];
    const groups = new Map();
    for (const tx of transactions) {
      const venue = resolveTradingVenue(tx);
      if (!groups.has(venue)) groups.set(venue, []);
      groups.get(venue).push(tx);
    }
    if (groups.size <= 1) {
      const venue = groups.keys().next().value || (agg.kind === 'exchange' ? 'exchange' : 'off_exchange');
      rows.push({ ...agg, tradingVenue: venue, aggregationKey: `${agg.code}:${venue}` });
      continue;
    }
    const snapshot = snapshotFromAggregate(agg);
    for (const [venue, venueTransactions] of groups) {
      const split = aggregateByCode(venueTransactions, { [agg.code]: snapshot });
      for (const item of split) {
        rows.push({ ...item, tradingVenue: venue, aggregationKey: `${item.code}:${venue}` });
      }
    }
  }
  return rows.sort((a, b) => {
    if (a.hasPosition !== b.hasPosition) return a.hasPosition ? -1 : 1;
    if (b.marketValue !== a.marketValue) return b.marketValue - a.marketValue;
    return String(a.aggregationKey).localeCompare(String(b.aggregationKey));
  });
}

export function buildAggregatesTableData({ aggregates, costBasisBySymbol }) {
  const splitAggregates = splitAggregatesByTradingVenue(aggregates);
  const enriched = splitAggregates.filter(hasMeaningfulHoldingPosition).map((agg) => {
    const sym = String(agg.code || '').trim().toUpperCase();
    const entry = sym ? costBasisBySymbol[sym] : null;
    const summary = entry ? entry.summary : null;
    const base = summary ? {
      ...agg,
      ledgerTextbookCost: summary.textbookCost,
      ledgerEffectiveCost: summary.effectiveCost,
      ledgerRealizedPnl: summary.realizedPnl,
      ledgerIsNegativeCost: summary.isNegativeCost,
    } : { ...agg };
    const price = Number(agg.currentPrice ?? agg.latestNav) || 0;
    if (summary && price > 0) {
      const withUnreal = attachUnrealized(summary, price);
      base.ledgerUnrealizedPnl = withUnreal.unrealizedPnl;
      base.ledgerTotalPnl = withUnreal.totalPnl;
    }
    return base;
  });
  const totalMv = enriched.reduce(
    (sum, row) => sum + (row.hasCurrentPrice ? (Number(row.marketValue) || 0) : 0),
    0,
  );
  if (totalMv <= 0) return enriched;
  return enriched.map((row) => ({
    ...row,
    weightPct: row.hasCurrentPrice ? ((Number(row.marketValue) || 0) / totalMv) * 100 : null,
  }));
}
