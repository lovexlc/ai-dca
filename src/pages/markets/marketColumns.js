export const MARKET_COLUMN_DEFINITIONS = {
  kind: { id: 'kind', label: '基金类型', group: '基础', base: true, card: true, table: true },
  symbol: { id: 'symbol', label: '代码', group: '基础', base: true, card: true, table: true },
  name: { id: 'name', label: '名称', group: '基础', base: true, card: true, table: true },
  price: { id: 'price', label: '最新价 / 净值', group: '行情', base: true, card: true, table: true },
  changePercent: { id: 'changePercent', label: '今日涨跌幅', group: '行情', base: true, card: true, table: true },
  change: { id: 'change', label: '今日涨跌额', group: '行情', base: true, card: true, table: true },
  updatedAt: { id: 'updatedAt', label: '更新时间', group: '行情', base: true, card: true, table: true },
  isHeld: { id: 'isHeld', label: '持仓', group: '状态', optional: true, card: true, table: true },
  isFavorite: { id: 'isFavorite', label: '自选', group: '状态', optional: true, card: false, table: true },
  alert: { id: 'alert', label: '提醒', group: '状态', optional: true, card: true, table: true },
  trend: { id: 'trend', label: '趋势', group: '分析', optional: true, analysis: true, card: false, table: true },
  highDrawdown: { id: 'highDrawdown', label: '日高下跌', group: '分析', optional: true, analysis: true, card: true, table: true },
  closeHighDrawdown: { id: 'closeHighDrawdown', label: '收盘高点下跌', group: '分析', optional: true, analysis: true, card: true, table: true },
  historicalPercentile: { id: 'historicalPercentile', label: '历史水位', group: '分析', optional: true, analysis: true, card: true, table: true },
  currentYearPercent: { id: 'currentYearPercent', label: '今年以来', group: '分析', optional: true, analysis: true, card: true, table: true },
  return1w: { id: 'return1w', label: '近1周', group: '分析', optional: true, analysis: true, card: true, table: true },
  return1m: { id: 'return1m', label: '近1月', group: '分析', optional: true, analysis: true, card: true, table: true },
  return3m: { id: 'return3m', label: '近3月', group: '分析', optional: true, analysis: true, card: true, table: true },
  return6m: { id: 'return6m', label: '近6月', group: '分析', optional: true, analysis: true, card: true, table: true },
  return1y: { id: 'return1y', label: '近1年', group: '分析', optional: true, analysis: true, card: true, table: true },
  returnBase: { id: 'returnBase', label: '成立以来', group: '分析', optional: true, analysis: true, card: true, table: true },
  premium: { id: 'premium', label: '溢价率', group: '增强', dynamic: true, card: true, table: true },
  limit: { id: 'limit', label: '申购限额', group: '增强', dynamic: true, card: true, table: true },
  turnover: { id: 'turnover', label: '成交额', group: '增强', dynamic: true, card: false, table: true },
  totalShares: { id: 'totalShares', label: '总份额', group: '增强', dynamic: true, card: false, table: true },
  feeRate: { id: 'feeRate', label: '费率', group: '增强', dynamic: true, card: false, table: true },
  redeemFeeRate: { id: 'redeemFeeRate', label: '卖出费率', group: '增强', dynamic: true, card: false, table: true },
};

export const BASE_COLUMNS = Object.values(MARKET_COLUMN_DEFINITIONS).filter((item) => item.base);
export const OPTIONAL_COLUMNS = Object.values(MARKET_COLUMN_DEFINITIONS).filter((item) => item.optional);
export const DYNAMIC_COLUMNS = Object.values(MARKET_COLUMN_DEFINITIONS).filter((item) => item.dynamic);
export const ANALYSIS_COLUMNS = Object.values(MARKET_COLUMN_DEFINITIONS).filter((item) => item.analysis);
export const CARD_METRIC_COLUMNS = Object.values(MARKET_COLUMN_DEFINITIONS).filter((item) => item.card && !['kind', 'symbol', 'name', 'price', 'updatedAt', 'isHeld', 'isFavorite', 'alert'].includes(item.id));
export const DEFAULT_MARKET_COLUMNS = ['kind', 'symbol', 'name', 'price', 'changePercent', 'change', 'updatedAt', 'isHeld', 'alert'];
export const DEFAULT_CARD_ANALYSIS_COLUMNS = [
  'highDrawdown',
  'closeHighDrawdown',
  'currentYearPercent',
  'premium',
  'return1w',
  'return1m',
];

export function normalizeColumnOrder(order = []) {
  const known = new Set(Object.keys(MARKET_COLUMN_DEFINITIONS));
  const normalized = Array.isArray(order) ? order.filter((id) => known.has(id)) : [];
  Object.keys(MARKET_COLUMN_DEFINITIONS).forEach((id) => {
    if (!normalized.includes(id)) normalized.push(id);
  });
  return normalized;
}

export function normalizeCardAnalysisColumns(columns = []) {
  const allowed = new Set(CARD_METRIC_COLUMNS.map((column) => column.id));
  return (Array.isArray(columns) ? columns : []).filter((id, index, list) => allowed.has(id) && list.indexOf(id) === index).slice(0, 6);
}
