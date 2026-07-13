import { resolvePremiumPercent } from './marketDisplayUtils.js';
export const MARKET_SORT_OPTIONS = [
  ['price', '最新价'],
  ['changePercent', '今日涨跌幅'],
  ['change', '今日涨跌额'],
  ['highDrawdown', '日高下跌'],
  ['closeHighDrawdown', '收盘高点下跌'],
  ['premium', '溢价率'],
  ['historicalPercentile', '历史水位'],
  ['return1w', '近1周'],
  ['return1m', '近1月'],
  ['return3m', '近3月'],
  ['return6m', '近6月'],
  ['return1y', '近1年'],
  ['returnBase', '成立以来'],
  ['totalShares', '基金规模'],
  ['turnover', '成交额'],
  ['volume', '成交量'],
  ['turnoverRate', '换手率'],
  ['feeRate', '管理费率'],
  ['redeemFeeRate', '申购费率'],
  ['limit', '申购限额'],
  ['updatedAt', '更新时间'],
];

export const MARKET_SECONDARY_SORT_OPTIONS = [
  ['turnover', '成交额'],
  ['totalShares', '基金规模'],
  ['symbol', '代码'],
  ['', '默认顺序'],
];

export const DEFAULT_MARKET_SORTING = [
  { id: 'price', desc: true },
  { id: 'turnover', desc: true },
];

const readNumber = (row, id) => {
  if (id === 'premium') return Number(resolvePremiumPercent(row));
  if (id === 'highDrawdown') return Number(row?.highDrawdown ?? row?.dayHighDrawdown);
  if (id === 'closeHighDrawdown') return Number(row?.closeHighDrawdown ?? row?.closeHighDrawdownPct);
  if (id === 'limit') {
    const status = String(row?.fundLimit?.buyStatus || '').toLowerCase();
    if (status === 'suspended' || status === 'closed') return 0;
    return Number(row?.fundLimit?.maxPurchasePerDay);
  }
  if (id === 'turnover') return Number(row?.turnover ?? row?.amount);
  if (id === 'volume') return Number(row?.volume ?? row?.totalVolume);
  if (id === 'turnoverRate') return Number(row?.turnoverRate ?? row?.turnover_rate);
  if (id === 'feeRate') return Number(row?.feeRate ?? row?.fundFee?.annualFeeRate ?? row?.expenseRatio);
  if (id === 'redeemFeeRate') return Number(row?.redeemFeeRate ?? row?.fundFee?.redeemFeeRate);
  return Number(row?.[id]);
};

export function compareMarketRows(a, b, sorting = DEFAULT_MARKET_SORTING) {
  for (const rule of sorting) {
    if (!rule?.id) continue;
    const aNumber = readNumber(a, rule.id);
    const bNumber = readNumber(b, rule.id);
    let result;
    if (Number.isFinite(aNumber) || Number.isFinite(bNumber)) {
      if (!Number.isFinite(aNumber)) result = 1;
      else if (!Number.isFinite(bNumber)) result = -1;
      else result = aNumber - bNumber;
    } else {
      result = String(a?.[rule.id] ?? '').localeCompare(String(b?.[rule.id] ?? ''), 'zh-CN');
    }
    if (result !== 0) return rule.desc ? -result : result;
  }
  return 0;
}

export function normalizeMarketSorting(sorting) {
  if (!Array.isArray(sorting) || !sorting.length) return DEFAULT_MARKET_SORTING.map((item) => ({ ...item }));
  return sorting.filter((item) => item && typeof item.id === 'string').slice(0, 2).map((item) => ({ id: item.id, desc: item.desc !== false }));
}
