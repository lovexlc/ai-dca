import {
  LIST_QUERY_DEFAULT_LIMIT,
  orderByToSorting,
  queryListRows,
  sortingToOrderBy,
} from '../../app/listQuery.js';
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
import {
  formatSwitchLimitAmount,
  shouldShowAppTag,
  switchLimitLabelFor,
} from '../switchStrategyHelpers.js';

export const MOBILE_METRIC_MAX = 3;
export const MOBILE_PAGE_SIZE = LIST_QUERY_DEFAULT_LIMIT;
const STORAGE_KEY = 'markets:mobileFundMetrics:v1';

function formatDrawdown(value) {
  const n = Number(value);
  return Number.isFinite(n) ? formatSignedPercent(n, 2) : '—';
}

function drawdownTone(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'text-[var(--market-text-subtle)]';
  return n < -0.05 ? 'text-[var(--market-fall)]' : 'text-[var(--market-text-muted)]';
}

function formatLimitMetric(row) {
  const limit = row?.fundLimit;
  const appTag = shouldShowAppTag(row?.fundMeta, limit);
  if (!limit && !appTag) return { text: '—', tone: 'text-[var(--market-text-subtle)]' };
  if (limit?.buyStatus === 'suspended' || limit?.buyStatus === 'closed') {
    return {
      text: switchLimitLabelFor(limit.buyStatus),
      tone: 'text-red-600',
    };
  }
  const amount = Number(limit?.maxPurchasePerDay);
  if (Number.isFinite(amount) && amount > 0) {
    return {
      text: `限额 ${formatSwitchLimitAmount(amount)}元`.replace(/\s+/g, ' '),
      tone: 'text-amber-700',
    };
  }
  if (limit?.buyStatus === 'open' || !limit?.buyStatus) {
    return { text: appTag ? '开放申购 · App' : '开放申购', tone: 'text-emerald-700' };
  }
  return {
    text: switchLimitLabelFor(limit.buyStatus) || '—',
    tone: 'text-[var(--market-text-muted)]',
  };
}

function percentMetric(value) {
  const n = Number(value);
  return {
    text: Number.isFinite(n) ? formatSignedPercent(n) : '—',
    tone: Number.isFinite(n) ? changeToneClass(n) : 'text-[var(--market-text-subtle)]',
  };
}

/** 手机端可选指标目录（与桌面列 id 对齐，便于配置兼容）。 */
export const MOBILE_METRIC_CATALOG = [
  {
    id: 'price',
    label: '最新价/净值',
    shortLabel: '最新',
    resolve: (row) => ({
      text: formatMarketPrice(row.price, row),
      tone: 'text-[var(--market-text-strong)]',
    }),
  },
  {
    id: 'changePercent',
    label: '日涨跌幅',
    shortLabel: '涨跌',
    resolve: (row) => {
      const n = Number(row.changePercent);
      return {
        text: formatPercent(row.changePercent),
        tone: !Number.isFinite(n) || Math.abs(n) < 0.0001
          ? 'text-[var(--market-text-muted)]'
          : n > 0
            ? 'text-[var(--market-rise)]'
            : 'text-[var(--market-fall)]',
      };
    },
  },
  {
    id: 'limit',
    label: '申购状态',
    shortLabel: '申购',
    otcOnly: true,
    resolve: (row) => formatLimitMetric(row),
  },
  {
    id: 'premium',
    label: '溢价率',
    shortLabel: '溢价',
    etfOnly: true,
    resolve: (row) => {
      const n = resolvePremiumPercent(row);
      return {
        text: formatPremiumPercent(row),
        tone: changeToneClass(n),
      };
    },
  },
  {
    id: 'highDrawdown',
    label: '日高下跌',
    shortLabel: '日高',
    resolve: (row) => {
      const d = resolveDayHighDrawdown(row);
      const n = Number(d?.drawdownPct);
      return { text: formatDrawdown(n), tone: drawdownTone(n) };
    },
  },
  {
    id: 'closeHighDrawdown',
    label: '回撤深度',
    shortLabel: '回撤深度',
    resolve: (row) => {
      const d = resolveCloseHighDrawdown(row);
      const n = Number(d?.drawdownPct);
      return { text: formatDrawdown(n), tone: drawdownTone(n) };
    },
  },
  {
    id: 'drawdownPercentile',
    label: '回撤百分位',
    shortLabel: '回撤百分位',
    resolve: (row) => {
      const n = Number(row.drawdownPercentile);
      return {
        text: Number.isFinite(n) ? `${n.toFixed(1)}%` : '—',
        tone: Number.isFinite(n) ? 'text-[var(--market-text-strong)]' : 'text-[var(--market-text-subtle)]',
      };
    },
  },
  {
    id: 'historicalPercentile',
    label: '历史水位',
    shortLabel: '水位',
    resolve: (row) => {
      const n = Number(row.historicalPercentile);
      return {
        text: Number.isFinite(n) ? `${n.toFixed(2)}%` : '—',
        tone: Number.isFinite(n) ? 'text-[var(--market-text-strong)]' : 'text-[var(--market-text-subtle)]',
      };
    },
  },
  {
    id: 'turnover',
    label: '成交额',
    shortLabel: '成交额',
    etfOnly: true,
    resolve: (row) => ({
      text: formatTurnover(row.turnover ?? row.amount),
      tone: 'text-[var(--market-text-strong)]',
    }),
  },
  {
    id: 'currentYearPercent',
    label: '今年以来',
    shortLabel: '今年',
    resolve: (row) => {
      const n = Number(row.ytdReturn ?? row.currentYearPercent);
      return {
        text: formatYearPercent(row),
        tone: Number.isFinite(n) ? changeToneClass(n) : 'text-[var(--market-text-subtle)]',
      };
    },
  },
  {
    id: 'return1m',
    label: '近1月',
    shortLabel: '近1月',
    resolve: (row) => percentMetric(row.return1m),
  },
  {
    id: 'return3m',
    label: '近3月',
    shortLabel: '近3月',
    resolve: (row) => percentMetric(row.return3m),
  },
  {
    id: 'return1y',
    label: '近1年',
    shortLabel: '近1年',
    resolve: (row) => percentMetric(row.return1y),
  },
  {
    id: 'return1w',
    label: '近1周',
    shortLabel: '近1周',
    resolve: (row) => percentMetric(row.return1w),
  },
  {
    id: 'return6m',
    label: '近6月',
    shortLabel: '近6月',
    resolve: (row) => percentMetric(row.return6m),
  },
];

export const MOBILE_METRIC_BY_ID = Object.fromEntries(
  MOBILE_METRIC_CATALOG.map((item) => [item.id, item])
);

export const DEFAULT_MOBILE_METRICS_OTC = ['price', 'changePercent', 'limit'];
export const DEFAULT_MOBILE_METRICS_ETF = ['price', 'changePercent', 'premium'];
export const DEFAULT_MOBILE_EXPANDED_OTC = [
  'return1m',
  'return3m',
  'return1y',
  'currentYearPercent',
  'limit',
];
export const DEFAULT_MOBILE_EXPANDED_ETF = [
  'return1m',
  'return3m',
  'return1y',
  'highDrawdown',
  'historicalPercentile',
  'turnover',
];

export function isOtcFundRow(row, isOtcList = false) {
  if (isOtcList) return true;
  const kind = String(row?.fundKind || row?.kind || '').toLowerCase();
  if (kind === 'otc') return true;
  const text = String(row?.assetType || row?.exchange || row?.type || '').toLowerCase();
  return text.includes('otc') || text.includes('场外');
}

export function catalogForMode(isOtc) {
  return MOBILE_METRIC_CATALOG.filter((item) => {
    if (isOtc && item.etfOnly) return false;
    if (!isOtc && item.otcOnly) return false;
    return true;
  });
}

function normalizeMetricIds(ids, isOtc, fallback) {
  const allowed = new Set(catalogForMode(isOtc).map((item) => item.id));
  const next = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!allowed.has(id) || next.includes(id)) continue;
    next.push(id);
    if (next.length >= MOBILE_METRIC_MAX) break;
  }
  if (next.length) return next;
  return (fallback || []).filter((id) => allowed.has(id)).slice(0, MOBILE_METRIC_MAX);
}

export function defaultMobileMetrics(isOtc) {
  return isOtc ? [...DEFAULT_MOBILE_METRICS_OTC] : [...DEFAULT_MOBILE_METRICS_ETF];
}

export function defaultMobileExpanded(isOtc) {
  return isOtc ? [...DEFAULT_MOBILE_EXPANDED_OTC] : [...DEFAULT_MOBILE_EXPANDED_ETF];
}

export function readMobileMetricsConfig(isOtc) {
  const fallback = defaultMobileMetrics(isOtc);
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const key = isOtc ? 'otc' : 'etf';
    return normalizeMetricIds(parsed?.[key], isOtc, fallback);
  } catch {
    return fallback;
  }
}

export function writeMobileMetricsConfig(isOtc, ids) {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const key = isOtc ? 'otc' : 'etf';
    const next = {
      ...parsed,
      [key]: normalizeMetricIds(ids, isOtc, defaultMobileMetrics(isOtc)),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function resolveMetricDisplay(metricId, row) {
  const def = MOBILE_METRIC_BY_ID[metricId];
  if (!def) return { label: metricId, text: '—', tone: 'text-[var(--market-text-subtle)]' };
  const value = def.resolve(row) || { text: '—', tone: 'text-[var(--market-text-subtle)]' };
  return {
    id: metricId,
    label: def.shortLabel || def.label,
    fullLabel: def.label,
    text: value.text ?? '—',
    tone: value.tone || 'text-[var(--market-text-strong)]',
  };
}

export function buildIdentityLine(row, isOtc) {
  if (isOtc) {
    const parts = ['场外基金'];
    const share = row?.fundMeta?.share_class || row?.fundMeta?.shareClass;
    const currency = row?.fundMeta?.currency || row?.currency;
    if (share || currency) {
      const shareText = [currency === 'USD' ? '美元' : currency === 'CNY' ? '人民币' : '', share]
        .filter(Boolean)
        .join('');
      if (shareText) parts.push(shareText);
    }
    const navDate = String(row?.latestNavDate || '').trim();
    if (navDate) parts.push(`净值日 ${navDate.slice(5)}`);
    else parts.push('净值');
    return parts.join(' · ');
  }
  const parts = ['场内ETF'];
  if (row?.meta && !String(row.meta).includes('场外')) {
    // keep lightweight; meta may already be empty for ETF
  }
  const indexKey = row?.fundMeta?.index_key || row?.indexKey;
  if (indexKey === 'nasdaq100' || /纳指|纳斯达克/i.test(row?.name || '')) parts.push('纳指100');
  else if (indexKey === 'sp500' || /标普|S&P/i.test(row?.name || '')) parts.push('标普500');
  else if (row?.exchange) parts.push(String(row.exchange));
  const asOf = String(row?.asOf || row?.lastUpdated || '').trim();
  if (asOf) {
    try {
      const d = new Date(asOf);
      if (!Number.isNaN(d.getTime())) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        parts.push(`更新 ${hh}:${mm}`);
      }
    } catch {
      // ignore
    }
  }
  return parts.join(' · ');
}

export function formatRowCode(row) {
  return formatSymbolDisplay(row?.symbol || row?.code || '');
}

export const MOBILE_SORT_OPTIONS = [
  { id: 'heldRank', label: '持仓优先', desc: true },
  { id: 'changePercent', label: '涨跌幅', desc: true },
  { id: 'price', label: '最新价', desc: true },
  { id: 'premium', label: '溢价率', desc: true },
  { id: 'turnover', label: '成交额', desc: true },
  { id: 'volume', label: '成交量', desc: true },
  { id: 'marketCapital', label: '规模', desc: true },
  { id: 'iopv', label: 'IOPV', desc: true },
  { id: 'currentYearPercent', label: '今年以来', desc: true },
  { id: 'return1w', label: '近1周', desc: true },
  { id: 'limit', label: '限额', desc: true },
  { id: 'return1m', label: '近1月', desc: true },
  { id: 'return3m', label: '近3月', desc: true },
  { id: 'return6m', label: '近6月', desc: true },
  { id: 'return1y', label: '近1年', desc: true },
  { id: 'returnBase', label: '成立以来', desc: true },
  { id: 'historicalPercentile', label: '历史水位', desc: true },
  { id: 'highDrawdown', label: '日高下跌', desc: false },
  { id: 'closeHighDrawdown', label: '回撤深度', desc: false },
  { id: 'drawdownPercentile', label: '回撤百分位', desc: true },
  { id: 'name', label: '名称', desc: false },
  { id: 'symbol', label: '代码', desc: false },
];


export function sortMobileRows(rows, sorting) {
  // Back-compat wrapper: full ORDER BY without LIMIT (callers that only need sorted array).
  const page = queryListRows(rows, {
    orderBy: sortingToOrderBy(sorting),
    limit: Math.max(Array.isArray(rows) ? rows.length : 0, 1),
    filters: [],
  });
  return page.items;
}

/** Preferred mobile page API: ORDER BY + LIMIT + cursor. */
export function queryMobileFundPage(rows, {
  sorting,
  orderBy,
  limit = LIST_QUERY_DEFAULT_LIMIT,
  cursor = null,
  heldOnly = false,
  query = '',
} = {}) {
  const filters = [];
  if (heldOnly) filters.push({ field: 'held', op: 'eq', value: true });
  if (String(query || '').trim()) {
    filters.push({ field: 'q', op: 'contains', value: String(query).trim() });
  }
  return queryListRows(rows, {
    orderBy: orderBy || sortingToOrderBy(sorting),
    limit,
    cursor,
    filters,
  });
}

export { sortingToOrderBy, orderByToSorting, LIST_QUERY_DEFAULT_LIMIT };
