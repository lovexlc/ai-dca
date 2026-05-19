// 资产类型判断：D5 锁定的策略规则上游推导。
// - index：宽基指数，只买不减仓，不准挂卖出计划
// - stock：个股（Mag7 / TSM 等），允许 70% 核仓 + 30% T 仓 + 唶卖
// - fund ：中国场内基金（6 位代码），现阶段仅买入，不推荐卖出计划
// - unknown：未知。

import { EXTRA_SYMBOL_CODES } from './extraSymbols.js';

export const INDEX_SYMBOLS = new Set([
  'QQQ', 'SPY', 'VOO', 'IVV', 'QLD', 'TQQQ', 'SSO', 'UPRO',
  'DIA', 'IWM', 'VTI', 'VT'
]);

export const STRATEGY_PARAMS = {
  index: {
    firstBuyDrop: 9,
    stepDrop: 3.5,
    levels: 7,
    multipliers: [1, 1, 1.5, 1.5, 2, 2, 3],
    highLevelRatio: 0.1
  },
  stock: {
    firstBuyDrop: 30,
    stepDrop: 4.5,
    levels: 6,
    multipliers: [1, 1, 1.5, 2, 2, 2.5],
    highLevelRatio: 0.1
  }
};

export function getAssetType(symbol) {
  const raw = String(symbol || '').trim();
  if (!raw) return 'unknown';
  const code = raw.toUpperCase();
  if (INDEX_SYMBOLS.has(code)) return 'index';
  if (EXTRA_SYMBOL_CODES.has(code)) return 'stock';
  if (/^\d{6}$/.test(raw)) return 'fund';
  if (/^[A-Z]{1,5}$/.test(code)) return 'stock';
  return 'unknown';
}

export function getStrategyParams(symbol) {
  const type = getAssetType(symbol);
  return STRATEGY_PARAMS[type] || STRATEGY_PARAMS.stock;
}

export function getAssetTypeLabel(symbol) {
  switch (getAssetType(symbol)) {
    case 'index': return '宽基指数';
    case 'stock': return '个股';
    case 'fund': return '基金';
    default: return '未知';
  }
}

export function canSell(symbol) {
  return getAssetType(symbol) !== 'index';
}

export function canHaveTradingPosition(symbol) {
  return getAssetType(symbol) === 'stock';
}
