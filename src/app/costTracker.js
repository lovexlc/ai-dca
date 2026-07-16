// 成本追踪引擎（PR 3）。纯函数。
// 核心概念：
//   · textbookCost: 加权平均成本（卖出时以当时均价冲减，均价不会为负）
//   · effectiveCost: 「做T减成本」式计算 = (总买入 - 总卖出) / 剩余股数，可为负
//   · realizedPnl: 每笔卖出时以 textbookCost 估算 的已实现盈亏
// D11: 做T 成本重算使用加权平均。

export const TRADE_SIDES = Object.freeze({ BUY: 'buy', SELL: 'sell' });

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

/**
 * 按日期升序处理所有交易记录，得到各项成本指标。
 * trades: Array<{ side: 'buy'|'sell', shares: number, price: number, date?: string, fee?: number }>
 */
export function calculateCostBasis(trades = []) {
  const sorted = [...trades]
    .filter((t) => t && (t.side === 'buy' || t.side === 'sell'))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  let totalShares = 0;
  let textbookInvested = 0; // 加权平均口径下的成本余额
  let netCash = 0;          // 累计现金流：买付出、卖收入，可能为负
  let realizedPnl = 0;      // 已实现盈亏
  let buyShares = 0;
  let sellShares = 0;
  let totalBuyCash = 0;
  let totalSellCash = 0;

  const annotated = [];

  for (const t of sorted) {
    const qty = Math.max(Number(t.shares) || 0, 0);
    const px = Math.max(Number(t.price) || 0, 0);
    const fee = Math.max(Number(t.fee) || 0, 0);
    if (qty <= 0 || px < 0) continue;
    if (t.side === 'buy') {
      const cash = qty * px + fee;
      totalShares += qty;
      textbookInvested += cash;
      netCash += cash;
      buyShares += qty;
      totalBuyCash += cash;
      annotated.push({
        ...t,
        cash: round(cash, 2),
        textbookCostAfter: totalShares > 0 ? round(textbookInvested / totalShares, 4) : 0,
        effectiveCostAfter: totalShares > 0 ? round(netCash / totalShares, 4) : 0,
        sharesAfter: round(totalShares, 4),
        realizedAfter: round(realizedPnl, 2)
      });
    } else {
      // sell
      const sellQty = Math.min(qty, totalShares);
      const proceeds = sellQty * px - fee;
      if (totalShares > 0 && sellQty > 0) {
        const avg = textbookInvested / totalShares;
        const realizedThis = (px - avg) * sellQty - fee;
        realizedPnl += realizedThis;
        textbookInvested -= avg * sellQty;
      }
      totalShares -= sellQty;
      netCash -= proceeds;
      sellShares += sellQty;
      totalSellCash += proceeds;
      annotated.push({
        ...t,
        shares: sellQty,
        cash: round(proceeds, 2),
        textbookCostAfter: totalShares > 0 ? round(textbookInvested / totalShares, 4) : 0,
        effectiveCostAfter: totalShares > 0 ? round(netCash / totalShares, 4) : 0,
        sharesAfter: round(totalShares, 4),
        realizedAfter: round(realizedPnl, 2)
      });
    }
  }

  const remainingShares = totalShares;
  const textbookCost = remainingShares > 0 ? textbookInvested / remainingShares : 0;
  const effectiveCost = remainingShares > 0 ? netCash / remainingShares : 0;
  const isNegativeCost = remainingShares > 0 && effectiveCost < 0;

  return {
    annotated,
    summary: {
      totalBuys: round(buyShares, 4),
      totalSells: round(sellShares, 4),
      remainingShares: round(remainingShares, 4),
      totalBuyCash: round(totalBuyCash, 2),
      totalSellCash: round(totalSellCash, 2),
      netCash: round(netCash, 2),
      textbookCost: round(textbookCost, 4),
      effectiveCost: round(effectiveCost, 4),
      realizedPnl: round(realizedPnl, 2),
      isNegativeCost
    }
  };
}

/**
 * 按 symbol 分组，返回 map: { [symbol]: result of calculateCostBasis }。
 */
export function groupCostBasisBySymbol(trades = []) {
  const groups = new Map();
  for (const t of trades) {
    if (!t) continue;
    const key = String(t.symbol || t.code || '').trim().toUpperCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      ...t,
      symbol: key,
      side: t.side || (String(t.type || '').toUpperCase() === 'SELL' ? 'sell' : 'buy')
    });
  }
  const result = {};
  for (const [sym, list] of groups.entries()) {
    result[sym] = calculateCostBasis(list);
  }
  return result;
}

/**
 * 与实时价格结合，计算未实现盈亏。
 */
export function attachUnrealized(summary, currentPrice) {
  const price = Number(currentPrice);
  if (!summary || !Number.isFinite(price) || price <= 0 || summary.remainingShares <= 0) {
    return { ...summary, currentPrice: null, marketValue: 0, unrealizedPnl: 0, totalPnl: summary?.realizedPnl ?? 0 };
  }
  const marketValue = summary.remainingShares * price;
  const unrealized = (price - summary.textbookCost) * summary.remainingShares;
  return {
    ...summary,
    currentPrice: round(price, 4),
    marketValue: round(marketValue, 2),
    unrealizedPnl: round(unrealized, 2),
    totalPnl: round((summary.realizedPnl || 0) + unrealized, 2)
  };
}
