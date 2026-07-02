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

async function readNavHistoryRows(env, code, asOfDate) {
  if (!env.NAV_HISTORY_KV || !/^\d{6}$/.test(code)) return [];
  const months = listMonthKeys(asOfDate);
  const rows = [];
  await Promise.all(months.map(async (month) => {
    const raw = await env.NAV_HISTORY_KV.get(`navhist:v1:${code}:${month}`, { type: 'json' }).catch(() => null);
    const items = Array.isArray(raw?.items) ? raw.items : [];
    for (const item of items) {
      if (item?.date && Number.isFinite(Number(item.nav))) {
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
  }

  await kvAppendHistoricalValue(env, historySymbol, { date, value: Number(value) });
  const history = await kvGetHistoricalValues(env, historySymbol);
  const percentile = computeHistoricalPercentile(value, history, { asOfDate: date });
  if (percentile == null) return quote;
  return { ...quote, historicalPercentile: percentile };
}
