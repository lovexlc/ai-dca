import { QDII_INDEX_LABELS } from '../../app/qdiiFundMeta.js';

export const OTC_QUOTA_FILTER_OPTIONS = Object.freeze([
  { value: 'buyable', label: '有额度' },
]);

export const OTC_REDEEM_7D_FILTER_OPTIONS = Object.freeze([
  { value: 'free', label: '7天卖出免费' },
  { value: 'paid', label: '7天卖出收费' },
  { value: 'unknown', label: '7天规则未知' },
]);

const EXCHANGE_INDEX_KEYS = Object.freeze([
  ...Object.keys(QDII_INDEX_LABELS),
  'other',
  'unknown',
]);

export const EXCHANGE_INDEX_FILTER_OPTIONS = Object.freeze([
  ...EXCHANGE_INDEX_KEYS.map((value) => ({
    value,
    label: QDII_INDEX_LABELS[value] || (value === 'other' ? '其他指数' : '未分类'),
  })),
]);

const EXCHANGE_INDEX_KEY_SET = new Set(EXCHANGE_INDEX_KEYS);
const REDEEM_7D_STATUSES = new Set(['free', 'paid', 'unknown']);
const QUOTA_STATUSES = new Set(['available', 'buyable', 'restricted', 'unlimited', 'suspended', 'unknown']);

function text(value) {
  return String(value ?? '').trim();
}

function numeric(value) {
  if (value == null || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').replace(/％/g, '%').replace(/%$/, '').trim());
  return Number.isFinite(number) ? number : null;
}

function normalizedLimitStatus(limit) {
  const raw = text(limit?.buyStatus || limit?.buyStatusText).toLowerCase();
  if (raw === 'open' || /正常|开放|开放申购|可申购|不限/.test(raw)) return 'open';
  if (raw === 'limit_large' || /限大额|大额限制|大额申购/.test(raw)) return 'limit_large';
  if (raw === 'limit' || /限额|限购/.test(raw)) return 'limit';
  if (raw === 'suspended' || /暂停/.test(raw)) return 'suspended';
  if (raw === 'closed' || /关闭|停止/.test(raw)) return 'closed';
  return raw;
}

/**
 * Reduce the several source-specific quota statuses to the values used by
 * both the mobile filter and the desktop column filter.
 */
export function resolveOtcQuotaStatus(row = {}) {
  const direct = text(row.quotaStatus);
  if (QUOTA_STATUSES.has(direct)) return direct;

  const limit = row?.fundLimit || row?.limit;
  if (!limit || typeof limit !== 'object') return 'unknown';
  const status = normalizedLimitStatus(limit);
  if (status === 'suspended' || status === 'closed') return 'suspended';

  const maxPurchase = numeric(limit.maxPurchasePerDay);
  if (status === 'open' && (maxPurchase == null || maxPurchase === 0)) return 'unlimited';
  if (status === 'limit' || status === 'limit_large' || maxPurchase > 0) return 'restricted';
  if (status === 'open' || text(limit.limitChannel)) return 'available';
  if (status) return 'available';
  return 'unknown';
}

function ruleText(rule) {
  if (Array.isArray(rule)) return rule.filter((item) => item != null).map(text).join(' ');
  if (rule && typeof rule === 'object') {
    return [rule.name, rule.label, rule.title, rule.period, rule.key].filter(Boolean).map(text).join(' ');
  }
  return text(rule);
}

function ruleRate(rule) {
  if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
    if (text(rule.unit) === '1') return null;
    const raw = rule.value ?? rule.rate ?? rule.feeRate ?? rule.percent;
    const parsed = numeric(raw);
    if (parsed == null) return null;
    if (text(rule.unit) === '2' || /[%％]/.test(text(raw))) return parsed;
    return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
  }
  const values = Array.isArray(rule) ? rule : [rule];
  const percentValue = values.find((value) => /[%％]/.test(text(value)));
  const raw = percentValue ?? values[values.length - 1];
  const parsed = numeric(raw);
  if (parsed == null || text(raw).includes('元')) return null;
  return /[%％]/.test(text(raw)) || Math.abs(parsed) > 1 ? parsed : parsed * 100;
}

function ruleAppliesAtSevenDays(rule) {
  const compact = ruleText(rule).replace(/\s+/g, '');
  if (!compact || !/7(?:\.0+)?天/.test(compact)) return false;

  // Explicit upper-bound rules such as “持有不足7天” describe the period
  // before day 7 and must not be mistaken for the day-7 tier.
  if (/不足|少于|小于|低于|7(?:\.0+)?天以内|7(?:\.0+)?天以下/.test(compact)) return false;

  const lowerBound = compact.match(/(\d+(?:\.\d+)?)天(?:<=|≤|<)(?:持有期限|持有)/)
    || compact.match(/(?:持有期限|持有)(?:>=|≥|不少于|大于等于|满|达到)(\d+(?:\.\d+)?)天/)
    || compact.match(/(?:^|[^\d])(\d+(?:\.\d+)?)天(?:以上|及以上|之后|以后)/);
  if (lowerBound && Number(lowerBound[1]) > 7) return false;

  const upperBound = compact.match(/(?:持有期限|持有)(?:<|≤|不满|不足|少于|小于)(\d+(?:\.\d+)?)天/);
  if (upperBound && Number(upperBound[1]) <= 7) return false;

  return Boolean(
    lowerBound
    || /7(?:\.0+)?天(?:以上|及以上|之后|以后)/.test(compact)
    || /(?:持有期限|持有)(?:>=|≥|不少于|大于等于|满|达到)7(?:\.0+)?天/.test(compact)
    || /7(?:\.0+)?天(?:<=|≤)(?:持有期限|持有)/.test(compact)
  );
}

export function resolveRedeemFee7dStatus(row = {}) {
  const direct = text(row.redeem7dStatus || row.redeemFee7dStatus);
  if (REDEEM_7D_STATUSES.has(direct)) return direct;
  if (row.redeem7dFree === true) return 'free';
  if (row.redeem7dFree === false) return 'paid';

  const rules = row?.fundFee?.redeemRules || row?.redeemRules;
  const sevenDayRules = (Array.isArray(rules) ? rules : []).filter(ruleAppliesAtSevenDays);
  if (sevenDayRules.length) {
    const rate = ruleRate(sevenDayRules[0]);
    if (rate != null) return Math.abs(rate) < 0.000001 ? 'free' : 'paid';
  }

  const scalar = row?.fundFee?.redeemFeeRate ?? row?.redeemFeeRate;
  if (numeric(scalar) === 0) return 'free';
  return 'unknown';
}

export function resolveExchangeIndexKey(row = {}) {
  const direct = text(row.indexKey || row?.fundMeta?.index_key || row?.fundMeta?.indexKey);
  if (EXCHANGE_INDEX_KEY_SET.has(direct)) return direct;
  const name = text(row.name || row.shortName || row.displayName);
  if (/纳斯达克100|纳指100|纳指ETF|纳斯达克ETF/.test(name)) return 'nasdaq100';
  if (/标普500|S&P\s*500/i.test(name)) return 'sp500';
  if (/美股50|美国50/.test(name)) return 'us50';
  if (/恒生科技|恒生互联网|香港科技|港股科技/.test(name)) return 'hstech';
  if (/恒生|港股|香港|H股/.test(name)) return 'hsi';
  if (/中概互联|海外互联网/.test(name)) return 'china_internet';
  if (/日经|日本|东证/.test(name)) return 'nikkei225';
  if (/黄金|贵金属/.test(name)) return 'gold';
  if (/原油|石油|油气/.test(name)) return 'oil';
  return name ? 'other' : 'unknown';
}

export function getAvailableExchangeIndexFilterOptions(rows = []) {
  const available = new Set();
  for (const row of Array.isArray(rows) ? rows : []) available.add(resolveExchangeIndexKey(row));
  if (!available.size) ['nasdaq100', 'sp500', 'other'].forEach((value) => available.add(value));
  return EXCHANGE_INDEX_FILTER_OPTIONS.filter((option) => available.has(option.value));
}

export function marketDetailFilterValue(row, field) {
  if (field === 'quotaStatus' || field === 'quota') return resolveOtcQuotaStatus(row);
  if (field === 'redeem7d' || field === 'redeem7dStatus') return resolveRedeemFee7dStatus(row);
  if (field === 'indexKey') return resolveExchangeIndexKey(row);
  return row?.[field];
}

export function matchesMarketDetailFilter(row, filter) {
  if (!filter) return true;
  const actual = marketDetailFilterValue(row, filter.field);
  const values = Array.isArray(filter.value) ? filter.value.map(text) : [text(filter.value)];
  if (!values.length || !values[0]) return true;
  const matchesValue = (value) => value === 'buyable'
    ? ['available', 'restricted', 'unlimited'].includes(text(actual))
    : text(actual) === value;
  if (filter.op === 'in') return values.some(matchesValue);
  if (filter.op === 'neq') return !values.some(matchesValue);
  return matchesValue(values[0]);
}

export function applyMarketDetailFilters(rows, filters = []) {
  const list = Array.isArray(rows) ? rows : [];
  const specs = Array.isArray(filters) ? filters.filter((filter) => (
    filter && ['quotaStatus', 'quota', 'redeem7d', 'redeem7dStatus', 'indexKey'].includes(String(filter.field))
  )) : [];
  return specs.length ? list.filter((row) => specs.every((filter) => matchesMarketDetailFilter(row, filter))) : list;
}
