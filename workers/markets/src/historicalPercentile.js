import {
  CN_ETF_WATCHLIST_DEFAULTS,
  CN_OTC_WATCHLIST_DEFAULTS,
  US_INDICATOR_WATCHLIST_DEFAULTS,
} from './defaults.js';
import {
  computeHistoricalPercentile,
  kvAppendHistoricalValue,
  kvGetHistoricalValues,
  marketDateString
} from './storage.js';

const NAV_HISTORY_SOURCE = 'nav-history';

const ALL_HISTORICAL_SYMBOLS = new Set([
  ...CN_ETF_WATCHLIST_DEFAULTS,
  ...CN_OTC_WATCHLIST_DEFAULTS,
  ...US_INDICATOR_WATCHLIST_DEFAULTS,
]);

function normalizeHistoricalSymbol(symbol, market) {
  const raw = String(symbol || '').trim();
  if (market === 'cn') return raw.replace(/^(sh|sz|bj)/i, '');
  return raw;
}

function shiftMonth(year, month, delta) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function monthKey({ year, month }) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function listMonthKeys(toDate, lookbackMonths = 61) {
  const [year, month] = String(toDate || '').slice(0, 7).split('-').map(Number);
  if (!year || !month) return [];
  const keys = [];
  for (let i = lookbackMonths - 1; i >= 0; i--) {
    keys.push(monthKey(shiftMonth(year, month, -i)));
  }
  return keys;
}

function isNavHistoryPayload(payload, month) {
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload))
    && payload.version === 1
    && payload.month === month
    && Array.isArray(payload.items);
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isValidNavHistoryEnvelope(raw, key, month) {
  if (!raw || typeof raw !== 'object' || raw.version !== 2
    || raw.key !== key || raw.source !== NAV_HISTORY_SOURCE
    || !isNavHistoryPayload(raw.payload, month)) return false;
  const fetchedAt = timestamp(raw.fetchedAt);
  const validUntil = timestamp(raw.validUntil);
  const staleUntil = timestamp(raw.staleUntil);
  return Number.isFinite(fetchedAt)
    && Number.isFinite(validUntil)
    && Number.isFinite(staleUntil)
    && staleUntil >= validUntil
    && Date.now() <= staleUntil;
}

function unwrapNavHistoryPayload(raw, key, month) {
  if (isValidNavHistoryEnvelope(raw, key, month)) return raw.payload;

  // Keep reads compatible with values written before NAV_HISTORY_KV adopted
  // cache envelopes. New writes still use the validated envelope format.
  return isNavHistoryPayload(raw, month) ? raw : null;
}

async function readNavHistoryRows(env, code, asOfDate) {
  if (!env.NAV_HISTORY_KV || !/^\d{6}$/.test(code)) return [];
  const months = listMonthKeys(asOfDate);
  const rows = [];
  await Promise.all(months.map(async (month) => {
    const key = `navhist:v1:${code}:${month}`;
    const raw = await env.NAV_HISTORY_KV.get(key, { type: 'json' }).catch(() => null);
    const payload = unwrapNavHistoryPayload(raw, key, month);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    for (const item of items) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || '')) && Number(item.nav) > 0 && Number.isFinite(Number(item.nav))) {
        rows.push({ date: item.date, value: Number(item.nav) });
      }
    }
  }));
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return rows;
}

export async function attachHistoricalPercentile(env, quote, market) {
  if (!quote || quote.error || !quote.symbol) return quote;
  const historySymbol = normalizeHistoricalSymbol(quote.symbol, market);
  if (!ALL_HISTORICAL_SYMBOLS.has(historySymbol)) return quote;
  // 如果 fetcher 已经提供了历史水位，优先使用 fetcher 的结果（源站历史更完整）
  if (quote.historicalPercentile != null) return quote;

  const value = market === 'cn' && quote.latestNav != null ? quote.latestNav : quote.price;
  if (!Number.isFinite(Number(value))) return quote;

  const date = marketDateString(market);
  if (market === 'cn') {
    const navHistory = await readNavHistoryRows(env, historySymbol, date);
    const navPercentile = computeHistoricalPercentile(value, navHistory, { asOfDate: date });
    if (navPercentile != null) return { ...quote, historicalPercentile: navPercentile };
    // CN fund historical water level is defined on published NAV. If the
    // canonical NAV history binding is unavailable, do not silently mix it
    // with the generic local price history fallback.
    if (!env.NAV_HISTORY_KV) return quote;
  }

  await kvAppendHistoricalValue(env, historySymbol, { date, value: Number(value) });
  const history = await kvGetHistoricalValues(env, historySymbol);
  const percentile = computeHistoricalPercentile(value, history, { asOfDate: date });
  if (percentile == null) return quote;
  return { ...quote, historicalPercentile: percentile };
}

export const __internals = {
  isNavHistoryPayload,
  listMonthKeys,
  readNavHistoryRows,
  unwrapNavHistoryPayload
};
