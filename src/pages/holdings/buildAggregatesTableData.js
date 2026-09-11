import { attachUnrealized } from '../../app/costTracker.js';

// 场外基金赎回份额通常只保留两位小数，而申购确认份额可能保留四位。
// BUY/SELL 抵扣后不足 0.01 份的差值属于精度尾差，不应继续显示为持仓。
export const MIN_DISPLAY_HOLDING_SHARES = 0.01;

export function hasMeaningfulHoldingPosition(agg = {}) {
  const shares = Math.abs(Number(agg.totalShares) || 0);
  const pendingBuyAmount = Number(agg.pendingBuyAmount) || 0;
  return Boolean(agg.hasPosition) && (shares >= MIN_DISPLAY_HOLDING_SHARES || pendingBuyAmount > 0);
}

export function buildAggregatesTableData({ aggregates, costBasisBySymbol }) {
  const enriched = aggregates.filter(hasMeaningfulHoldingPosition).map((agg) => {
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
