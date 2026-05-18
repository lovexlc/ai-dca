// 仓位管理引擎（PR 4）。纯函数。
// 锁定默认值：个股单仓上限 50%（D4）、底仓比例 70%（D4）、宽基不限仓位。
//
// snapshot阅。结构：
//   { totalAssets: number, prices: { [symbol]: number }, shares: { [symbol]: number } }
// 也可以传入 byCostBasis（可选）用于计算未实现盈亏。

import { getAssetType, INDEX_SYMBOLS } from './assetType.js';

export const STOCK_MAX_WEIGHT_PCT = 50;
export const CORE_POSITION_RATIO_PCT = 70;
export const TRADE_POSITION_RATIO_PCT = 30;

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

/**
 * 计算各标獣的仓位占比。
 * 返回：
 *   { rows: [{ symbol, type, shares, price, marketValue, weightPct, coreShares, tradeShares, exceedsCap }],
 *     cashValue, cashWeightPct, totalMarketValue, totalAssets,
 *     warnings: [{ symbol, kind, message }] }
 */
export function calculatePositions({ totalAssets = 0, prices = {}, shares = {} } = {}) {
  const rows = [];
  let totalMarketValue = 0;
  const safeTotal = Math.max(Number(totalAssets) || 0, 0);

  for (const sym of Object.keys(shares)) {
    const code = sym.toUpperCase();
    const qty = Math.max(Number(shares[sym]) || 0, 0);
    if (qty <= 0) continue;
    const px = Math.max(Number(prices[code] ?? prices[sym]) || 0, 0);
    const marketValue = qty * px;
    const type = getAssetType(code);
    const isStock = type === 'stock';
    rows.push({
      symbol: code,
      type,
      shares: round(qty, 4),
      price: round(px, 4),
      marketValue: round(marketValue, 2),
      coreShares: isStock ? round(qty * CORE_POSITION_RATIO_PCT / 100, 4) : round(qty, 4),
      tradeShares: isStock ? round(qty * TRADE_POSITION_RATIO_PCT / 100, 4) : 0
    });
    totalMarketValue += marketValue;
  }

  const denom = safeTotal > 0 ? safeTotal : totalMarketValue;
  const cashValue = Math.max(safeTotal - totalMarketValue, 0);

  for (const row of rows) {
    row.weightPct = denom > 0 ? round((row.marketValue / denom) * 100, 2) : 0;
    row.exceedsCap = row.type === 'stock' && row.weightPct > STOCK_MAX_WEIGHT_PCT;
  }

  rows.sort((a, b) => b.marketValue - a.marketValue);

  const warnings = [];
  for (const row of rows) {
    if (row.exceedsCap) {
      warnings.push({
        symbol: row.symbol,
        kind: 'over_cap',
        message: `${row.symbol} 仓位 ${row.weightPct}% 超过个股上限 ${STOCK_MAX_WEIGHT_PCT}%。`
      });
    }
  }

  return {
    rows,
    totalMarketValue: round(totalMarketValue, 2),
    totalAssets: round(denom, 2),
    cashValue: round(cashValue, 2),
    cashWeightPct: denom > 0 ? round((cashValue / denom) * 100, 2) : 0,
    warnings
  };
}

/**
 * 检查按一笔买入后是否会超仓（仅对个股生效，宽基不限仓位）。
 * 返回：{ ok, currentWeightPct, projectedWeightPct, capPct, message }
 */
export function checkWeightLimit({
  symbol,
  buyAmount = 0,
  positionsResult
} = {}) {
  if (!symbol || !positionsResult) return { ok: true, message: '缺少仓位快照，跳过超仓检查。' };
  const code = String(symbol).toUpperCase();
  if (INDEX_SYMBOLS.has(code)) {
    return { ok: true, currentWeightPct: null, projectedWeightPct: null, capPct: null, message: '宽基指数不限仓位。' };
  }
  const row = positionsResult.rows.find((r) => r.symbol === code);
  const current = row ? row.marketValue : 0;
  const total = positionsResult.totalAssets;
  if (!total) return { ok: true, message: '未录总资产，不能检查。' };
  const projected = current + Math.max(Number(buyAmount) || 0, 0);
  const projectedWeight = round((projected / total) * 100, 2);
  const currentWeight = round((current / total) * 100, 2);
  const ok = projectedWeight <= STOCK_MAX_WEIGHT_PCT;
  return {
    ok,
    currentWeightPct: currentWeight,
    projectedWeightPct: projectedWeight,
    capPct: STOCK_MAX_WEIGHT_PCT,
    message: ok
      ? `买入后仓位将达 ${projectedWeight}%（上限 ${STOCK_MAX_WEIGHT_PCT}%）。`
      : `买入后仓位将达 ${projectedWeight}%，超过个股上限 ${STOCK_MAX_WEIGHT_PCT}%，考虑减量或换标的。`
  };
}

/**
 * 生成再平衡建议（简化版）。超仓的提议减仓、足仓提议保持、偶现金过多提议加仓宽基。
 */
export function generateRebalanceAdvice(positionsResult) {
  const advice = [];
  if (!positionsResult) return advice;
  for (const row of positionsResult.rows) {
    if (row.exceedsCap) {
      const excess = row.weightPct - STOCK_MAX_WEIGHT_PCT;
      advice.push({
        symbol: row.symbol,
        kind: 'trim',
        message: `${row.symbol} 仓位占比 ${row.weightPct}%，超上限 ${round(excess, 2)}%，建议逐步减。`
      });
    }
  }
  if (positionsResult.cashWeightPct > 30) {
    advice.push({
      symbol: 'CASH',
      kind: 'deploy',
      message: `现金占比 ${positionsResult.cashWeightPct}%，考虑按金字塔加仓宽基。`
    });
  }
  if (!advice.length) {
    advice.push({ symbol: '*', kind: 'ok', message: '仓位在限额内，无需调仓。' });
  }
  return advice;
}
