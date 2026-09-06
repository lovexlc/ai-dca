import {
  changeToneClass,
  formatMarketPrice,
  formatPercent,
  formatPremiumPercent,
  formatSignedPercent,
  formatSymbolDisplay,
  formatTurnover,
  formatYearPercent,
  resolvePremiumPercent,
} from './marketDisplayUtils.js';
import { resolveCloseHighDrawdown, resolveDayHighDrawdown } from './marketHighDrawdown.js';

export const MOBILE_METRIC_MAX = 3;
export const MOBILE_PAGE_SIZE = 40;
const STORAGE_KEY = 'markets:mobileFundMetrics:v1';

function number(value) {
  if (value == null || value === '') return Number.NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function percentMetric(value) {
  const parsed = number(value);
  return {
    text: Number.isFinite(parsed) ? formatSignedPercent(parsed) : '—',
    tone: Number.isFinite(parsed) ? changeToneClass(parsed) : 'text-[var(--market-text-subtle)]',
  };
}

function drawdownMetric(value) {
  const parsed = number(value);
  return {
    text: Number.isFinite(parsed) ? formatSignedPercent(parsed, 2) : '—',
    tone: Number.isFinite(parsed) && parsed < -0.05 ? 'text-[var(--market-fall)]' : 'text-[var(--market-text-muted)]',
  };
}

function limitMetric(row) {
  const limit = row?.fundLimit;
  if (!limit) return { text: '—', tone: 'text-[var(--market-text-subtle)]' };
  const status = String(limit.buyStatus || limit.buyStatusText || '').toLowerCase();
  if (/暂停|关闭|suspend|closed/.test(status)) return { text: '暂停申购', tone: 'text-red-600' };
  const amount = number(limit.maxPurchasePerDay);
  if (Number.isFinite(amount) && amount > 0) {
    const text = amount >= 10000 ? `${(amount / 10000).toFixed(amount % 10000 ? 1 : 0)}万` : String(amount);
    return { text: `限额 ${text}元`, tone: 'text-amber-700' };
  }
  return { text: '开放申购', tone: 'text-emerald-700' };
}

export const MOBILE_METRIC_CATALOG = [
  { id: 'price', label: '最新价/净值', shortLabel: '最新', resolve: (row) => ({ text: formatMarketPrice(row.price, row), tone: 'text-[var(--market-text-strong)]' }) },
  { id: 'changePercent', label: '日涨跌幅', shortLabel: '涨跌', resolve: (row) => ({ text: formatPercent(row.changePercent), tone: Number.isFinite(number(row.changePercent)) ? changeToneClass(number(row.changePercent)) : 'text-[var(--market-text-subtle)]' }) },
  { id: 'premium', label: '溢价率', shortLabel: '溢价', etfOnly: true, resolve: (row) => ({ text: formatPremiumPercent(row), tone: changeToneClass(resolvePremiumPercent(row)) }) },
  { id: 'limit', label: '申购状态', shortLabel: '申购', otcOnly: true, resolve: limitMetric },
  { id: 'turnover', label: '成交额', shortLabel: '成交额', etfOnly: true, resolve: (row) => ({ text: formatTurnover(row.turnover ?? row.amount), tone: 'text-[var(--market-text-strong)]' }) },
  { id: 'currentYearPercent', label: '今年以来', shortLabel: '今年', resolve: (row) => ({ text: formatYearPercent(row), tone: changeToneClass(number(row.ytdReturn ?? row.currentYearPercent)) }) },
  { id: 'return1w', label: '近1周', shortLabel: '近1周', resolve: (row) => percentMetric(row.return1w) },
  { id: 'return1m', label: '近1月', shortLabel: '近1月', resolve: (row) => percentMetric(row.return1m) },
  { id: 'return3m', label: '近3月', shortLabel: '近3月', resolve: (row) => percentMetric(row.return3m) },
  { id: 'return6m', label: '近6月', shortLabel: '近6月', resolve: (row) => percentMetric(row.return6m) },
  { id: 'return1y', label: '近1年', shortLabel: '近1年', resolve: (row) => percentMetric(row.return1y) },
  { id: 'historicalPercentile', label: '历史水位', shortLabel: '水位', resolve: (row) => ({ text: Number.isFinite(number(row.historicalPercentile)) ? `${number(row.historicalPercentile).toFixed(2)}%` : '—', tone: 'text-[var(--market-text-strong)]' }) },
  { id: 'highDrawdown', label: '日高下跌', shortLabel: '日高', resolve: (row) => drawdownMetric(resolveDayHighDrawdown(row)?.drawdownPct) },
  { id: 'closeHighDrawdown', label: '回撤深度', shortLabel: '回撤', resolve: (row) => drawdownMetric(resolveCloseHighDrawdown(row)?.drawdownPct) },
];

const METRIC_BY_ID = Object.fromEntries(MOBILE_METRIC_CATALOG.map((item) => [item.id, item]));
export const MOBILE_SORT_OPTIONS = [
  { id: 'heldRank', label: '持仓优先', desc: true },
  { id: 'changePercent', label: '涨跌幅', desc: true },
  { id: 'price', label: '最新价', desc: true },
  { id: 'premium', label: '溢价率', desc: true },
  { id: 'turnover', label: '成交额', desc: true },
  { id: 'currentYearPercent', label: '今年以来', desc: true },
  { id: 'return1m', label: '近1月', desc: true },
  { id: 'return3m', label: '近3月', desc: true },
  { id: 'return1y', label: '近1年', desc: true },
  { id: 'limit', label: '限额', desc: true },
  { id: 'name', label: '名称', desc: false },
  { id: 'symbol', label: '代码', desc: false },
];

export function isOtcFundRow(row, isOtcList = false) {
  if (isOtcList) return true;
  const text = String(row?.fundKind || row?.kind || row?.assetType || row?.exchange || '').toLowerCase();
  return text.includes('otc') || text.includes('场外');
}

export function catalogForMode(isOtc) {
  return MOBILE_METRIC_CATALOG.filter((item) => !(isOtc && item.etfOnly) && !(!isOtc && item.otcOnly));
}

export function defaultMobileMetrics(isOtc) {
  return [...(isOtc ? ['price', 'changePercent', 'limit'] : ['price', 'changePercent', 'premium'])];
}

export function defaultMobileExpanded(isOtc) {
  return isOtc
    ? ['return1m', 'return3m', 'return1y', 'currentYearPercent', 'limit']
    : ['return1m', 'return3m', 'return1y', 'highDrawdown', 'historicalPercentile', 'turnover'];
}

function normalizeMetricIds(ids, isOtc) {
  const allowed = new Set(catalogForMode(isOtc).map((item) => item.id));
  const next = Array.from(new Set(Array.isArray(ids) ? ids : [])).filter((id) => allowed.has(id)).slice(0, MOBILE_METRIC_MAX);
  return next.length ? next : defaultMobileMetrics(isOtc);
}

export function readMobileMetricsConfig(isOtc) {
  if (typeof window === 'undefined') return defaultMobileMetrics(isOtc);
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    return normalizeMetricIds(parsed[isOtc ? 'otc' : 'etf'], isOtc);
  } catch {
    return defaultMobileMetrics(isOtc);
  }
}

export function writeMobileMetricsConfig(isOtc, ids) {
  if (typeof window === 'undefined') return;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    parsed[isOtc ? 'otc' : 'etf'] = normalizeMetricIds(ids, isOtc);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Metrics preferences are optional.
  }
}

export function resolveMetricDisplay(metricId, row) {
  const definition = METRIC_BY_ID[metricId];
  const value = definition?.resolve(row) || { text: '—', tone: 'text-[var(--market-text-subtle)]' };
  return { id: metricId, label: definition?.shortLabel || definition?.label || metricId, text: value.text ?? '—', tone: value.tone || 'text-[var(--market-text-strong)]' };
}

export function buildIdentityLine(row, isOtc) {
  if (isOtc) {
    const date = String(row?.latestNavDate || '').trim();
    return ['场外基金', date ? `净值日 ${date.slice(5)}` : '净值'].join(' · ');
  }
  const parts = ['场内ETF'];
  if (/纳指|纳斯达克/i.test(row?.name || '')) parts.push('纳指100');
  else if (/标普|S&P/i.test(row?.name || '')) parts.push('标普500');
  else if (row?.exchange) parts.push(String(row.exchange));
  return parts.join(' · ');
}

export function formatRowCode(row) {
  return formatSymbolDisplay(row?.symbol || row?.code || '');
}

function sortValue(row, id) {
  if (id === 'heldRank') return row?.isHeld ? 1 : 0;
  if (id === 'premium') return number(resolvePremiumPercent(row));
  if (id === 'limit') return number(row?.fundLimit?.maxPurchasePerDay);
  if (id === 'currentYearPercent') return number(row?.ytdReturn ?? row?.currentYearPercent);
  if (id === 'name' || id === 'symbol') return String(row?.[id] || '');
  return number(row?.[id]);
}

export function queryMobileFundPage(rows, { sorting = { id: 'heldRank', desc: true }, limit = MOBILE_PAGE_SIZE, cursor = null, heldOnly = false, query = '' } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (heldOnly && !row?.isHeld) return false;
    if (!needle) return true;
    return `${row?.symbol || ''} ${row?.code || ''} ${row?.name || ''}`.toLowerCase().includes(needle);
  });
  const id = sorting?.id || 'heldRank';
  const desc = sorting?.desc !== false;
  const sorted = filtered.map((row, index) => ({ row, index })).sort((left, right) => {
    const a = sortValue(left.row, id);
    const b = sortValue(right.row, id);
    let result = 0;
    if (typeof a === 'string' || typeof b === 'string') result = String(a).localeCompare(String(b), 'zh-CN');
    else if (Number.isFinite(a) && Number.isFinite(b)) result = a - b;
    else if (Number.isFinite(a)) result = 1;
    else if (Number.isFinite(b)) result = -1;
    if (result === 0 && id !== 'heldRank') result = Number(left.row?.isHeld) - Number(right.row?.isHeld);
    if (result === 0) result = right.index - left.index;
    return desc ? -result : result;
  }).map((item) => item.row);
  const offset = Math.max(0, Number(cursor) || 0);
  const size = Math.max(1, Number(limit) || MOBILE_PAGE_SIZE);
  const items = sorted.slice(offset, offset + size);
  return { items, total: sorted.length, nextCursor: offset + items.length < sorted.length ? String(offset + items.length) : null };
}
