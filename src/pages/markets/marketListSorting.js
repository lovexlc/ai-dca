export const MARKET_SORT_OPTIONS = [
  ['price', '最新价'],
  ['changePercent', '今日涨跌幅'],
  ['change', '涨跌额'],
  ['premium', '溢价率'],
  ['historicalPercentile', '历史水位'],
  ['return1w', '近1周'],
  ['return1m', '近1月'],
  ['turnover', '成交额'],
  ['volume', '成交量'],
  ['turnoverRate', '换手率'],
  ['pe', '估值PE'],
];

export const MARKET_SECONDARY_SORT_OPTIONS = [
  ['turnover', '成交额'],
  ['symbol', '代码'],
  ['', '默认顺序'],
];

export const DEFAULT_MARKET_SORTING = [
  { id: 'price', desc: true },
  { id: 'turnover', desc: true },
];

const readNumber = (row, id) => {
  if (id === 'premium') return Number(row?.premiumPercent ?? row?.premium_rate);
  if (id === 'turnover') return Number(row?.turnover ?? row?.amount);
  if (id === 'volume') return Number(row?.volume ?? row?.totalVolume);
  if (id === 'turnoverRate') return Number(row?.turnoverRate ?? row?.turnover_rate);
  if (id === 'pe') return Number(row?.pe ?? row?.peTtm ?? row?.valuationPe);
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
