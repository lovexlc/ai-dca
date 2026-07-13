const INDEX_MATCHERS = {
  nasdaq100: /纳指100|纳斯达克100|纳指 ETF|纳斯达克 ETF/i,
  sp500: /标普500|标普 500/i,
  us50: /美国50/i,
  nasdaqTech: /纳指科技|纳斯达克科技/i,
  globalTech: /全球科技/i,
  dividend: /红利/i,
};

export const ETF_FILTER_GROUPS = [
  {
    id: 'index',
    label: '跟踪指数',
    options: [
      ['nasdaq100', '纳指100'], ['sp500', '标普500'], ['us50', '美国50'],
      ['nasdaqTech', '纳斯达克科技'], ['globalTech', '全球科技'], ['dividend', '红利'], ['other', '其他'],
    ],
  },
  { id: 'fundType', label: '基金属性', options: [['ETF', 'ETF'], ['LOF', 'LOF'], ['QDII', 'QDII'], ['link', '联接基金']] },
  { id: 'status', label: '状态', options: [['held', '持仓'], ['favorite', '自选'], ['tradable', '可交易'], ['alert', '有提醒']] },
  { id: 'changeRange', label: '价格表现', options: [['all', '全部'], ['gt5', '> 5%'], ['2to5', '2% ~ 5%'], ['0to2', '0% ~ 2%'], ['neg2to0', '-2% ~ 0%'], ['neg5to2', '-5% ~ -2%'], ['ltNeg5', '< -5%']] },
  { id: 'historicalRange', label: '历史水位', options: [['all', '全部'], ['gt80', '> 80%'], ['50to80', '50% ~ 80%'], ['20to50', '20% ~ 50%'], ['lt20', '< 20%']] },
  { id: 'premiumRisk', label: '溢价风险', options: [['all', '全部'], ['lt1', '溢价率 < 1%'], ['1to3', '1% ~ 3%'], ['gt3', '> 3%']] },
];

export const OTC_FILTER_GROUPS = [
  { id: 'limitRange', label: '申购限额', options: [['unlimited', '不限额'], ['lte1000', '≤ 1000'], ['lte5000', '≤ 5000'], ['lte10000', '≤ 1万'], ['gt10000', '> 1万'], ['suspended', '暂停申购']] },
  { id: 'subscriptionStatus', label: '申购状态', options: [['open', '可申购'], ['suspended', '暂停申购'], ['limited', '限额申购']] },
  { id: 'feeRange', label: '费率', options: [['zero', '0费率'], ['low', '低费率（≤0.5%）'], ['front', '前端收费']] },
  { id: 'index', label: '跟踪指数', options: [['nasdaq100', '纳指100'], ['sp500', '标普500'], ['us50', '美国50'], ['nasdaqTech', '全球科技'], ['dividend', '红利']] },
  { id: 'dca', label: '定投相关', options: [['supported', '支持定投'], ['discount', '定投费率优惠']] },
];

export function getMarketFilterGroups({ isOtc = false } = {}) {
  return isOtc ? OTC_FILTER_GROUPS : ETF_FILTER_GROUPS;
}

function hasIndex(row, value) {
  const classified = String(row?.indexCategory || row?.indexType || row?.trackingIndex || '').trim();
  if (classified) {
    const matchesKnownIndex = Object.values(INDEX_MATCHERS).some((matcher) => matcher.test(classified))
      || ETF_FILTER_GROUPS[0]?.options.some(([id, label]) => id !== 'other' && (classified === id || classified === label));
    if (value === 'other') return !matchesKnownIndex;
    return classified.toLowerCase() === String(value).toLowerCase()
      || classified === ETF_FILTER_GROUPS[0]?.options.find(([id]) => id === value)?.[1]
      || INDEX_MATCHERS[value]?.test(classified);
  }
  if (value === 'other') return !Object.values(INDEX_MATCHERS).some((matcher) => matcher.test(String(row?.name || '')));
  return INDEX_MATCHERS[value]?.test(String(row?.name || '')) || false;
}

function matchesRange(value, range) {
  const number = Number(value);
  if (!Number.isFinite(number) || range === 'all') return range === 'all';
  if (range === 'gt5') return number > 5;
  if (range === '2to5') return number >= 2 && number <= 5;
  if (range === '0to2') return number >= 0 && number < 2;
  if (range === 'neg2to0') return number >= -2 && number < 0;
  if (range === 'neg5to2') return number >= -5 && number < -2;
  if (range === 'ltNeg5') return number < -5;
  if (range === 'gt80') return number > 80;
  if (range === '50to80') return number >= 50 && number <= 80;
  if (range === '20to50') return number >= 20 && number < 50;
  if (range === 'lt20') return number < 20;
  if (range === 'lt1') return number < 1;
  if (range === '1to3') return number >= 1 && number <= 3;
  if (range === 'gt3') return number > 3;
  return true;
}

function matchesFilter(row, filter) {
  const value = filter?.value;
  if (value == null || value === '' || value === 'all') return true;
  if (filter.id === 'kind') return row?.kind === value;
  if (filter.id === 'isHeld') return String(Boolean(row?.isHeld)) === String(value);
  if (filter.id === 'changePercentMin') return Number(row?.changePercent) >= Number(value);
  if (filter.id === 'index') return hasIndex(row, value);
  if (filter.id === 'fundType') {
    const name = String(row?.name || '');
    return value === 'ETF' ? row?.kind === 'exchange' : value === 'LOF' ? /LOF/i.test(name) : value === 'QDII' ? /QDII/i.test(name) : /联接/.test(name);
  }
  if (filter.id === 'status') {
    if (value === 'held') return Boolean(row?.isHeld);
    if (value === 'favorite') return Boolean(row?.isFavorite);
    if (value === 'alert') return Boolean(row?.alertEnabled || row?.isAlertEnabled);
    return row?.kind === 'exchange' || !['suspended', 'closed'].includes(String(row?.fundLimit?.buyStatus || '').toLowerCase());
  }
  if (filter.id === 'changeRange') return matchesRange(row?.changePercent, value);
  if (filter.id === 'historicalRange') return matchesRange(row?.historicalPercentile, value);
  if (filter.id === 'premiumRisk') return matchesRange(row?.premiumPercent ?? row?.premium_rate, value);
  if (filter.id === 'limitRange') {
    const status = String(row?.fundLimit?.buyStatus || '').toLowerCase();
    const rawLimit = row?.fundLimit?.maxPurchasePerDay;
    const limit = Number(rawLimit);
    if (value === 'suspended') return status === 'suspended' || status === 'closed';
    if (value === 'unlimited') return Boolean(row?.fundLimit) && Number.isFinite(limit) && limit <= 0 && !['suspended', 'closed'].includes(status);
    if (!Number.isFinite(limit)) return false;
    if (value === 'lte1000') return limit <= 1000;
    if (value === 'lte5000') return limit <= 5000;
    if (value === 'lte10000') return limit <= 10000;
    if (value === 'gt10000') return limit > 10000;
  }
  if (filter.id === 'subscriptionStatus') {
    const status = String(row?.fundLimit?.buyStatus || '').toLowerCase();
    if (value === 'open') return !status || status === 'open' || status === 'normal';
    if (value === 'suspended') return status === 'suspended' || status === 'closed';
    return Number(row?.fundLimit?.maxPurchasePerDay) > 0 && !['suspended', 'closed'].includes(status);
  }
  if (filter.id === 'feeRange') {
    const fee = Number(row?.feeRate ?? row?.fundFee?.annualFeeRate);
    if (value === 'zero') return Number.isFinite(fee) && fee === 0;
    if (value === 'low') return Number.isFinite(fee) && fee <= 0.5;
    return Number.isFinite(fee) && fee > 0.5;
  }
  if (filter.id === 'dca') return Boolean(row?.fundMeta?.supportsDca || row?.fundMeta?.dcaDiscount) === (value === 'supported');
  return true;
}

export function matchesMarketFilters(row, filters = []) {
  return filters.every((filter) => matchesFilter(row, filter));
}
