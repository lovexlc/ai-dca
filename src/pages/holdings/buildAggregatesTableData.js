import { getAssignedAccount } from '../../app/accountManager.js';
import { attachUnrealized } from '../../app/costTracker.js';

export function buildAggregatesTableData({ aggregates, accountAssignments, costBasisBySymbol }) {
  const enriched = aggregates.filter((agg) => agg.hasPosition).map((agg) => {
    const sym = String(agg.code || '').trim().toUpperCase();
    const entry = sym ? costBasisBySymbol[sym] : null;
    const summary = entry ? entry.summary : null;
    const accountType = getAssignedAccount(sym || agg.code, accountAssignments);
    const base = summary ? {
      ...agg,
      accountType,
      ledgerTextbookCost: summary.textbookCost,
      ledgerEffectiveCost: summary.effectiveCost,
      ledgerRealizedPnl: summary.realizedPnl,
      ledgerIsNegativeCost: summary.isNegativeCost,
    } : { ...agg, accountType };
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
