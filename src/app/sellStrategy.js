// 卖出策略（纯逻辑）：锁定默认 3 档（UI 可 3-5）、盈利 15/25/35% 、卖出比 33/33/34%。
// 调用方接口：
//   buildSellPlan(state)         -> { layers, totalProceeds, totalProfit, sellable, ... }
//   evaluateSellSignals(plan, currentPrice) -> { triggered: [...], next, nearestPct }
//
// 宽基指数（QQQ / VOO 等）会标记 sellable=false、返回空层。

import { canSell, getAssetType } from './assetType.js';
import { round } from './accumulation.js';

export const DEFAULT_GAIN_TRIGGERS = [15, 25, 35];
export const DEFAULT_SELL_RATIOS = [0.33, 0.33, 0.34];
export const MIN_SELL_TIERS = 3;
export const MAX_SELL_TIERS = 5;

export const defaultSellPlanState = {
  id: '',
  name: '',
  symbol: '',
  linkedPlanId: '',
  holdingCost: 0,
  holdingShares: 0,
  gainTriggers: [...DEFAULT_GAIN_TRIGGERS],
  sellRatios: [...DEFAULT_SELL_RATIOS],
  trailingStopPct: 0,
  isConfigured: false,
  createdAt: '',
  updatedAt: ''
};

function normalizeList(values, fallback) {
  const source = Array.isArray(values) && values.length ? values : fallback;
  return source.map((v, i) =>
    Number.isFinite(Number(v)) ? Number(v) : fallback[i] || 0
  );
}

export function buildSellPlan(state = {}) {
  const symbol = String(state.symbol || '').trim();
  const assetType = getAssetType(symbol);
  const sellable = canSell(symbol);

  const gains = normalizeList(state.gainTriggers, DEFAULT_GAIN_TRIGGERS);
  const ratiosRaw = normalizeList(state.sellRatios, DEFAULT_SELL_RATIOS).slice(0, gains.length);
  while (ratiosRaw.length < gains.length) ratiosRaw.push(0);

  const ratioSum = ratiosRaw.reduce((s, r) => s + Math.max(r, 0), 0) || 1;
  const ratios = ratiosRaw.map((r) => Math.max(r, 0) / ratioSum);

  const holdingCost = Math.max(Number(state.holdingCost) || 0, 0);
  const holdingShares = Math.max(Number(state.holdingShares) || 0, 0);

  const layers = sellable
    ? gains.map((gain, index) => {
        const triggerPrice = holdingCost > 0 ? holdingCost * (1 + gain / 100) : 0;
        const ratio = ratios[index] || 0;
        const shares = holdingShares * ratio;
        const proceeds = shares * triggerPrice;
        const profit = shares * (triggerPrice - holdingCost);
        return {
          id: `sell-${index + 1}`,
          label: `第 ${index + 1} 档`,
          gainPct: gain,
          ratio,
          triggerPrice: round(triggerPrice, 4),
          shares: round(shares, 4),
          proceeds: round(proceeds, 2),
          profit: round(profit, 2)
        };
      })
    : [];

  return {
    symbol,
    assetType,
    sellable,
    holdingCost,
    holdingShares,
    layers,
    totalRatio: ratios.reduce((s, r) => s + r, 0),
    totalSharesPlanned: layers.reduce((s, l) => s + l.shares, 0),
    totalProceeds: layers.reduce((s, l) => s + l.proceeds, 0),
    totalProfit: layers.reduce((s, l) => s + l.profit, 0)
  };
}

export function evaluateSellSignals(plan, currentPrice) {
  if (!plan || !plan.sellable || !Array.isArray(plan.layers) || !plan.layers.length) {
    return { triggered: [], next: null, nearestPct: 0 };
  }
  const price = Number(currentPrice) || 0;
  if (!(price > 0)) {
    return { triggered: [], next: plan.layers[0] || null, nearestPct: 0 };
  }
  const triggered = plan.layers.filter((l) => price >= l.triggerPrice);
  const next = plan.layers.find((l) => price < l.triggerPrice) || null;
  const nearestPct = next && next.triggerPrice > 0
    ? round(((next.triggerPrice - price) / next.triggerPrice) * 100, 2)
    : 0;
  return { triggered, next, nearestPct };
}

export const __testing = { normalizeList };
