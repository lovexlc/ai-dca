import { fetchFundMetrics, fetchKline, fetchQuote } from './marketsApi.js';
import { NASDAQ_ETFS } from './nasdaqCatalog.js';

const BENCHMARK_CODE = 'nas-daq100';
const BENCHMARK_NAME = 'NASDAQ 100 Index';
const BENCHMARK_CURRENCY = '$';
const BENCHMARK_SYMBOL = '^NDX';

const INTRADAY_TFS = new Set(['1m', '5m', '15m', '30m', '60m']);

function normalizeFundKey(value = '') {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[()（）.-]/g, '')
    .replace(/QDII/gi, '')
    .replace(/QDI/gi, '')
    .replace(/ETF/gi, '')
    .replace(/基金/g, '');
}

function buildAliases(entry = {}) {
  const aliases = new Set();
  const code = String(entry.code || '').trim();
  const name = String(entry.name || '').trim();
  if (code) {
    aliases.add(code);
    aliases.add(normalizeFundKey(code));
  }
  if (name) {
    aliases.add(name);
    aliases.add(normalizeFundKey(name));
  }
  return [...aliases].filter(Boolean);
}

async function loadCatalogEntries() {
  return NASDAQ_ETFS.map((entry) => ({
    code: String(entry?.code || '').trim(),
    name: String(entry?.name || '').trim(),
    index_key: String(entry?.index_key || 'nasdaq100').trim() || 'nasdaq100'
  })).filter((entry) => /^\d{6}$/.test(entry.code));
}

function marketKlineRef(symbol, tf) {
  return `markets://kline/${encodeURIComponent(symbol)}?tf=${encodeURIComponent(tf)}`;
}

export function latestNasdaqPriceManifestPath() {
  return 'markets://fund-metrics';
}

export function nasdaqDataPath(outputPath) {
  return String(outputPath || '').trim();
}

export function nasdaqDailyHistoryPath(fundCode = '') {
  const symbol = resolveMarketSymbol(fundCode);
  return symbol ? marketKlineRef(symbol, '1d') : '';
}

function shanghaiDateFromTimestamp(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return direct ? direct[1] : '';
  try {
    return new Date(parsed).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date(parsed).toISOString().slice(0, 10);
  }
}

function datePartsFromUnixSeconds(unixSeconds, timeZone) {
  const t = Number(unixSeconds);
  if (!Number.isFinite(t) || t <= 0) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(new Date(t * 1000)).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    if (!parts.year || !parts.month || !parts.day) return null;
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      datetime: `${parts.year}-${parts.month}-${parts.day} ${parts.hour || '00'}:${parts.minute || '00'}:${parts.second || '00'}`
    };
  } catch {
    const iso = new Date(t * 1000).toISOString();
    return { date: iso.slice(0, 10), datetime: iso.replace('T', ' ').slice(0, 19) };
  }
}

function resolveMarketSymbol(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw === BENCHMARK_CODE ? BENCHMARK_SYMBOL : raw;
}

function parseMarketKlineRef(value = '') {
  const raw = String(value || '').trim();
  if (!raw.startsWith('markets://kline/')) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'markets:' || url.hostname !== 'kline') return null;
    const symbol = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const tf = url.searchParams.get('tf') || '1d';
    return { symbol, tf };
  } catch {
    return null;
  }
}

function currentPriceFromMetric(metric = {}) {
  const candidates = [metric.currentPrice, metric.price, metric.close, metric.latestNav, metric.navBase, metric.iopv];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function normalizeMetricEntry(entry = {}, metric = null) {
  const currentPrice = currentPriceFromMetric(metric);
  const asOf = String(metric?.asOf || metric?.updatedAt || '').trim();
  const latestNavDate = String(metric?.latestNavDate || metric?.navDate || '').trim();
  const date = String(metric?.quoteDate || '').trim()
    || shanghaiDateFromTimestamp(asOf)
    || latestNavDate.slice(0, 10);
  return {
    ...entry,
    currency: '¥',
    date,
    datetime: asOf || date,
    current_price: currentPrice,
    price: currentPrice,
    previous_close: Number(metric?.previousClose ?? metric?.previousNav) || 0,
    change: Number(metric?.change) || 0,
    change_percent: Number(metric?.changePercent) || 0,
    latest_nav: Number(metric?.latestNav) || 0,
    latest_nav_date: latestNavDate,
    output_path: marketKlineRef(entry.code, '1m'),
    output_path_15m: marketKlineRef(entry.code, '15m'),
    daily_output_path: marketKlineRef(entry.code, '1d'),
    source: String(metric?.source || '').trim() || 'markets-fund-metrics'
  };
}

function normalizeBenchmarkEntry(quote = null) {
  const price = Number(quote?.price ?? quote?.currentPrice ?? quote?.close) || 0;
  const asOf = String(quote?.asOf || '').trim();
  const date = shanghaiDateFromTimestamp(asOf);
  const high52w = Number(quote?.highPoint?.high ?? quote?.yearHigh ?? quote?.high52w ?? quote?.fiftyTwoWeekHigh) || 0;
  return {
    code: BENCHMARK_CODE,
    name: BENCHMARK_NAME,
    index_key: 'nasdaq100',
    currency: BENCHMARK_CURRENCY,
    date,
    datetime: asOf || date,
    current_price: price,
    price,
    ...(high52w > 0 ? {
      high52w,
      fiftyTwoWeekHigh: high52w,
      highPoint: quote?.highPoint || { high: high52w, highDate: String(quote?.high52wDate || '').trim(), source: 'yahoo-52w' }
    } : {}),
    previous_close: Number(quote?.previousClose) || 0,
    change: Number(quote?.change) || 0,
    change_percent: Number(quote?.changePercent) || 0,
    output_path: marketKlineRef(BENCHMARK_SYMBOL, '1m'),
    output_path_15m: marketKlineRef(BENCHMARK_SYMBOL, '15m'),
    daily_output_path: marketKlineRef(BENCHMARK_SYMBOL, '1d'),
    source_symbol: BENCHMARK_SYMBOL,
    source: String(quote?.source || '').trim() || 'markets-quote'
  };
}

export async function loadLatestNasdaqPrices({ inPagesDir = false } = {}) {
  void inPagesDir;
  const entries = await loadCatalogEntries();
  const codes = entries.map((entry) => entry.code);
  const [metricsPayload, benchmarkQuote] = await Promise.all([
    fetchFundMetrics(codes),
    fetchQuote(BENCHMARK_SYMBOL)
  ]);
  const metricMap = new Map((Array.isArray(metricsPayload?.items) ? metricsPayload.items : [])
    .map((item) => [String(item?.code || '').trim(), item]));
  return [
    normalizeBenchmarkEntry(benchmarkQuote),
    ...entries.map((entry) => normalizeMetricEntry(entry, metricMap.get(entry.code) || null))
  ];
}

export function findLatestNasdaqPrice(entries = [], fundKey = '') {
  const normalizedKey = normalizeFundKey(fundKey);
  if (!normalizedKey) {
    return null;
  }

  const exactMatch = entries.find((entry) => buildAliases(entry).some((alias) => alias === fundKey || alias === normalizedKey));
  if (exactMatch) {
    return exactMatch;
  }

  const fuzzyMatches = entries.filter((entry) => buildAliases(entry).some((alias) => {
    const normalizedAlias = normalizeFundKey(alias);
    return normalizedAlias && normalizedKey.length >= 4 && (normalizedAlias.includes(normalizedKey) || normalizedKey.includes(normalizedAlias));
  }));

  return fuzzyMatches.length === 1 ? fuzzyMatches[0] : null;
}

function normalizeKlineBars(payload = {}, { daily = false } = {}) {
  const candles = Array.isArray(payload?.candles) ? payload.candles : [];
  const timeZone = payload?.market === 'cn' ? 'Asia/Shanghai' : 'America/New_York';
  return candles.map((bar) => {
    const parts = datePartsFromUnixSeconds(bar?.t, timeZone);
    if (!parts) return null;
    const close = Number(bar?.c);
    if (!Number.isFinite(close)) return null;
    return {
      date: parts.date,
      datetime: daily ? parts.date : parts.datetime,
      open: Number(bar?.o) || close,
      high: Number(bar?.h) || close,
      low: Number(bar?.l) || close,
      close,
      volume: Number(bar?.v) || 0,
      amount: Number(bar?.amount) || 0
    };
  }).filter(Boolean);
}

export async function loadNasdaqMinuteSnapshot(snapshotOrPath) {
  const parsed = typeof snapshotOrPath === 'string'
    ? parseMarketKlineRef(snapshotOrPath)
    : parseMarketKlineRef(snapshotOrPath?.output_path || '');
  const symbol = parsed?.symbol || resolveMarketSymbol(snapshotOrPath?.code || '');
  const tf = parsed?.tf || '1m';
  if (!symbol) {
    throw new Error('分钟线数据标的缺失');
  }
  const payload = await fetchKline(symbol, { timeframe: tf });
  const bars = normalizeKlineBars(payload, { daily: !INTRADAY_TFS.has(tf) });
  const latestBar = bars[bars.length - 1] || null;
  return {
    code: snapshotOrPath?.code || (symbol === BENCHMARK_SYMBOL ? BENCHMARK_CODE : symbol),
    symbol,
    source: payload?.source || 'markets-kline',
    interval: tf,
    date: latestBar?.date || '',
    bars
  };
}

export async function loadNasdaqDailySeries(fundCode = '') {
  const symbol = resolveMarketSymbol(fundCode);
  if (!symbol) {
    return [];
  }
  const payload = await fetchKline(symbol, { timeframe: '1d' });
  return normalizeKlineBars(payload, { daily: true });
}

export function formatPriceAsOf(snapshot) {
  const raw = String(snapshot?.datetime || snapshot?.date || snapshot?.asOf || '').trim();
  if (!raw) {
    return '';
  }
  return raw.replace('T', ' ').replace(/:\d{2}(?:\.\d{3}Z?)?$/, '');
}
