// 行情数据源封装。所有 fetch 统一返回归一化 schema，失败报 throw。
//
// 所有外部 URL 都拆成 base + path，避免被上游平台误伤为可压缩引用。

import { fetchCnnFearGreed } from './newsFetchers.js';

const UA = 'Mozilla/5.0 (compatible; ai-dca-markets/1.0)';
const COMMON_HEADERS = { 'user-agent': UA, accept: '*/*' };

const YAHOO_HOST = 'https://' + 'query1.finance.yahoo.com';
const YAHOO_SEARCH_HOST = 'https://' + 'query2.finance.yahoo.com';
const CBOE_HOST = 'https://' + 'www.cboe.com';
const FRED_HOST = 'https://' + 'fred.stlouisfed.org';
const MULTPL_HOST = 'https://' + 'www.multpl.com';
const STOCKANALYSIS_HOST = 'https://' + 'stockanalysis.com';
const MACROTRENDS_HOST = 'https://' + 'www.macrotrends.net';
const EM_SEARCH_HOST = 'https://' + 'searchapi.eastmoney.com';
const XUEQIU_STOCK_HOST = 'https://' + 'stock.xueqiu.com';
const XUEQIU_WEB_HOST = 'https://' + 'xueqiu.com';
const SINA_CN_HOST = 'https://' + 'quotes.sina.cn';
const TENCENT_QUOTE_HOST = 'https://' + 'qt.gtimg.cn';
const FINNHUB_HOST = 'https://' + 'finnhub.io';
const DANJUAN_FUNDS_HOST = 'https://' + 'danjuanfunds.com';
const XUEQIU_QUOTE_TIMEOUT_MS = 6000;
const XUEQIU_BATCH_QUOTE_TIMEOUT_MS = 4500;
const XUEQIU_ORDER_BOOK_TIMEOUT_MS = 1200;
const XUEQIU_KLINE_TIMEOUT_MS = 9000;
const SINA_KLINE_TIMEOUT_MS = 8000;
const TENCENT_QUOTE_TIMEOUT_MS = 4500;
const XUEQIU_ENDPOINT_TIMEOUT_MS = 6000;

// 轻量级并发限流。与index.js 里的版本语义一致，这里独立定义避免跨文件依赖。
async function mapLimit(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  const n = Math.max(1, Math.min(limit | 0 || 1, list.length));
  let cursor = 0;
  async function runner() {
    while (true) {
      const idx = cursor++;
      if (idx >= list.length) return;
      try {
        out[idx] = await worker(list[idx], idx);
      } catch (err) {
        out[idx] = { __error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  const runners = [];
  for (let i = 0; i < n; i += 1) runners.push(runner());
  await Promise.all(runners);
  return out;
}
function round(value, precision = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
}

function toIso(unixSeconds) {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return '';
  return new Date(unixSeconds * 1000).toISOString();
}

function buildUrl(base, path, params = {}) {
  const u = new URL(path, base);
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function fetchWithTimeout(url, init = {}, { timeoutMs = 6000, label = 'fetch' } = {}) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return fetch(url, init);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const originalSignal = init?.signal;
  const abortFromOriginal = () => controller.abort();
  try {
    if (originalSignal) {
      if (originalSignal.aborted) controller.abort();
      else originalSignal.addEventListener('abort', abortFromOriginal, { once: true });
    }
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new Error(`${label} timeout ${ms}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
    if (originalSignal) originalSignal.removeEventListener('abort', abortFromOriginal);
  }
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#x2002;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDateIso(dateText) {
  const raw = String(dateText || '').trim();
  if (!raw) return '';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? Date.parse(raw + 'T00:00:00Z')
    : Date.parse(raw + ' UTC');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function normalizeIndicatorQuote({
  symbol,
  name,
  price,
  previousClose = null,
  asOf = '',
  source,
  meta = '',
  extra = {},
  historicalPercentile = null,
}) {
  const value = round(price, 4);
  const previous = previousClose == null ? null : round(previousClose, 4);
  const change = value != null && previous != null ? round(value - previous, 4) : null;
  const changePercent = previous ? round(((value - previous) / previous) * 100, 4) : null;
  return {
    symbol,
    name,
    market: 'us',
    price: value,
    previousClose: previous,
    change,
    changePercent,
    volume: null,
    currency: '',
    exchangeTimezone: 'America/New_York',
    marketState: '',
    asOf: asOf || new Date().toISOString(),
    source,
    meta,
    historicalPercentile,
    ...extra
  };
}


// 计算当前值在历史序列中的百分位（0-100）。
// historicalValues: 数字数组（不要求排序）。
function computePercentile(value, historicalValues) {
  const n = Number(value);
  const arr = (historicalValues || []).filter((v) => Number.isFinite(Number(v))).map(Number);
  if (!Number.isFinite(n) || arr.length < 2) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  // 用"小于当前值的样本占比"作为百分位定义
  const lower = sorted.filter((v) => v < n).length;
  return round((lower / sorted.length) * 100, 2);
}

function parseSimpleCsvSeries(text, seriesId) {
  const rows = String(text || '').split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const values = [];
  for (const line of rows) {
    if (line.startsWith('observation_date')) continue;
    const parts = line.split(',');
    const date = String(parts[0] || '').trim();
    const rawValue = String(parts[1] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || rawValue === '.') continue;
    const value = Number(rawValue);
    if (Number.isFinite(value)) values.push({ date, value });
  }
  if (!values.length) throw new Error('fred series empty ' + seriesId);
  return values;
}

async function fetchFredSeriesQuote(seriesId, name) {
  const url = buildUrl(FRED_HOST, '/graph/fredgraph.csv', { id: seriesId });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 21600 } });
  if (!res.ok) throw new Error('fred ' + seriesId + ' HTTP ' + res.status);
  const rows = parseSimpleCsvSeries(await res.text(), seriesId);
  const latest = rows[rows.length - 1];
  const previous = rows.length > 1 ? rows[rows.length - 2] : null;
  return normalizeIndicatorQuote({
    symbol: seriesId,
    name,
    price: latest.value,
    previousClose: previous?.value ?? null,
    asOf: toDateIso(latest.date),
    source: 'fred',
    meta: 'FRED · monthly',
    extra: { observationDate: latest.date },
    historicalPercentile: computePercentile(latest.value, rows.map((r) => r.value))
  });
}

async function fetchCboePutCallRatio() {
  const url = buildUrl(CBOE_HOST, '/markets/us/options/market-statistics/daily');
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error('cboe put/call HTTP ' + res.status);
  const text = stripHtml(await res.text());
  const match = text.match(/TOTAL\s+PUT\/CALL\s+RATIO\s+(-?\d+(?:\.\d+)?)/i);
  if (!match) throw new Error('cboe put/call ratio missing');
  return normalizeIndicatorQuote({
    symbol: 'CBOE_PCR',
    name: 'Put/Call Ratio',
    price: Number(match[1]),
    source: 'cboe-daily-market-statistics',
    meta: 'Cboe · daily'
  });
}

function parseMultplRows(html) {
  const rows = [];
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let match;
  while ((match = rowRe.exec(String(html || ''))) !== null) {
    const dateText = stripHtml(match[1]);
    const valueText = stripHtml(match[2]);
    const valueMatch = valueText.match(/-?\d+(?:\.\d+)?/);
    if (!dateText || !valueMatch) continue;
    const value = Number(valueMatch[0]);
    if (Number.isFinite(value)) rows.push({ dateText, value });
  }
  return rows;
}

async function fetchSp500PeRatio() {
  const url = buildUrl(MULTPL_HOST, '/s-p-500-pe-ratio/table/by-month');
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 21600 } });
  if (!res.ok) throw new Error('multpl sp500 pe HTTP ' + res.status);
  const rows = parseMultplRows(await res.text());
  if (!rows.length) throw new Error('multpl sp500 pe empty');
  const latest = rows[0];
  const previous = rows[1] || null;
  return normalizeIndicatorQuote({
    symbol: 'SP500_PE',
    name: 'S&P 500 P/E Ratio',
    price: latest.value,
    previousClose: previous?.value ?? null,
    asOf: toDateIso(latest.dateText),
    source: 'multpl-sp500-pe',
    meta: 'Multpl · monthly',
    extra: { observationDate: latest.dateText },
    historicalPercentile: computePercentile(latest.value, rows.map((r) => r.value))
  });
}



async function fetchStockAnalysisPe(symbol) {
  const url = buildUrl(STOCKANALYSIS_HOST, '/etf/' + symbol.toLowerCase() + '/');
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 21600 } });
  if (!res.ok) throw new Error('stockanalysis ' + symbol + ' HTTP ' + res.status);
  const text = await res.text();
  // Try several common page patterns for ETF P/E ratio.
  const peMatch = text.match(/P\/E\s*Ratio<\/[^>]+>\s*<[^>]+>\s*([\d.]+)/i)
    || text.match(/data-field=["']peRatio["'][^>]*>([\d.]+)/i)
    || text.match(/P\s*\/\s*E\s*Ratio[^\d]{0,40}([\d.]+)/i);
  if (!peMatch) throw new Error('stockanalysis ' + symbol + ' pe ratio missing');
  return Number(peMatch[1]);
}

function parseMacrotrendsRows(html) {
  // Macrotrends historical table: rows like <tr><td>2026-06-30</td><td>40.51</td></tr>
  const rows = [];
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let match;
  while ((match = rowRe.exec(String(html || ''))) !== null) {
    const dateText = stripHtml(match[1]);
    const valueText = stripHtml(match[2]);
    const valueMatch = valueText.match(/-?\d+(?:\.\d+)?/);
    if (!dateText || !valueMatch) continue;
    const value = Number(valueMatch[0]);
    if (Number.isFinite(value)) rows.push({ dateText, value });
  }
  return rows;
}

async function fetchMacrotrendsQqqPeHistory() {
  const url = buildUrl(MACROTRENDS_HOST, '/stocks/charts/QQQ/invesco-qqq/pe-ratio');
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 21600 } });
  if (!res.ok) throw new Error('macrotrends qqq pe HTTP ' + res.status);
  const rows = parseMacrotrendsRows(await res.text());
  if (!rows.length) throw new Error('macrotrends qqq pe empty');
  return rows;
}

async function fetchQqqPeRatio() {
  // Prefer live PE from StockAnalysis; fall back to the latest Macrotrends row.
  let currentPe;
  let currentSource = 'stockanalysis';
  let observationDate = '';
  try {
    currentPe = await fetchStockAnalysisPe('QQQ');
  } catch {
    currentPe = null;
  }

  const history = await fetchMacrotrendsQqqPeHistory();
  if (currentPe == null || !Number.isFinite(currentPe)) {
    const latest = history[0];
    currentPe = latest.value;
    currentSource = 'macrotrends';
    observationDate = latest.dateText || '';
  }

  const previous = history.find((r) => Number.isFinite(r.value) && r.value !== currentPe) || history[1] || null;
  return normalizeIndicatorQuote({
    symbol: 'QQQ_PE',
    name: 'QQQ P/E Ratio',
    price: currentPe,
    previousClose: previous?.value ?? null,
    asOf: new Date().toISOString(),
    source: currentSource === 'stockanalysis' ? 'stockanalysis-qqq-pe' : 'macrotrends-qqq-pe',
    meta: 'StockAnalysis · daily / Macrotrends · historical',
    extra: { observationDate },
    historicalPercentile: computePercentile(currentPe, history.map((r) => r.value))
  });
}



async function fetchVixWithPercentile() {
  const raw = await fetchYahooChart('^VIX', { range: '10y', interval: '1d' });
  const ts = (raw && raw.timestamp) || [];
  const q = (raw && raw.indicators && raw.indicators.quote && raw.indicators.quote[0]) || {};
  const closes = [];
  for (let i = 0; i < ts.length; i += 1) {
    const c = q.close && q.close[i];
    if (c == null || !Number.isFinite(c)) continue;
    closes.push(c);
  }
  if (!closes.length) throw new Error('vix history empty');
  const current = closes[closes.length - 1];
  const previous = closes.length > 1 ? closes[closes.length - 2] : null;
  const meta = (raw && raw.meta) || {};
  return normalizeIndicatorQuote({
    symbol: '^VIX',
    name: 'VIX 波动率指数',
    price: current,
    previousClose: previous,
    asOf: toIso(meta.regularMarketTime || ts[ts.length - 1]),
    source: 'yahoo-vix',
    meta: 'Yahoo Finance · 10y percentile',
    extra: { historicalPercentile: computePercentile(current, closes) }
  });
}


const SPECIAL_MARKET_INDICATORS = {
  '^VIX': () => fetchVixWithPercentile(),
  CNN_FNG: () => fetchCnnFearGreed(),
  CBOE_PCR: () => fetchCboePutCallRatio(),
  CPIAUCSL: () => fetchFredSeriesQuote('CPIAUCSL', 'CPI'),
  SP500_PE: () => fetchSp500PeRatio(),
  QQQ_PE: () => fetchQqqPeRatio(),
};

export function isSpecialMarketIndicator(symbol) {
  const key = String(symbol || '').trim().toUpperCase();
  return Boolean(SPECIAL_MARKET_INDICATORS[key]);
}

export async function fetchSpecialMarketIndicatorQuote(symbol) {
  const key = String(symbol || '').trim().toUpperCase();
  const fetcher = SPECIAL_MARKET_INDICATORS[key];
  if (!fetcher) throw new Error('unknown special indicator ' + symbol);
  return fetcher();
}


function toCnSixDigits(code) {
  const lower = String(code || '').trim().toLowerCase();
  const match = lower.match(/(?:sh|sz|bj)?(\d{6})$/);
  return match ? match[1] : '';
}

function toXueqiuSymbol(code) {
  const lower = String(code || '').trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(lower)) return lower.toUpperCase();
  const digits = toCnSixDigits(lower);
  if (!digits) return '';
  const prefix = digits.startsWith('6') || digits.startsWith('5') || digits.startsWith('000')
    ? 'SH'
    : digits.startsWith('4') || digits.startsWith('8')
      ? 'BJ'
      : 'SZ';
  return prefix + digits;
}

function toTencentSymbol(code) {
  const digits = toCnSixDigits(code);
  if (!digits) return '';
  const prefix = digits.startsWith('6') || digits.startsWith('5') ? 'sh' : 'sz';
  return prefix + digits;
}

function decodeTencentBuffer(buffer) {
  try {
    return new TextDecoder('gbk').decode(buffer);
  } catch {
    return new TextDecoder().decode(buffer);
  }
}

function parseTencentTimestamp(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return '';
  const timestamp = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function parseTencentVariables(text = '') {
  const rows = [];
  const re = /v_([^=]+)="([^"]*)";?/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    rows.push({ key: match[1], fields: String(match[2] || '').split('~') });
  }
  return rows;
}

function normalizeTencentQuote(key, fields = []) {
  if (!Array.isArray(fields) || fields.length <= 5 || fields[0] === '') return null;
  const normalizedKey = String(key || '').toLowerCase();
  const code = String(fields[2] || normalizedKey.replace(/^(sh|sz|bj)/, '')).trim();
  const price = round(fields[3], 4);
  const previousClose = round(fields[4], 4);
  if (!/^\d{6}$/.test(code) || price == null || price <= 0) return null;
  const change = round(fields[31], 4) ?? (previousClose != null ? round(price - previousClose, 4) : null);
  const changePercent = round(fields[32], 4) ?? (previousClose > 0 && change != null ? round((change / previousClose) * 100, 4) : null);
  return {
    symbol: normalizedKey,
    code,
    name: String(fields[1] || normalizedKey).trim(),
    market: 'cn',
    price,
    currentPrice: price,
    close: price,
    previousClose,
    open: round(fields[5], 4),
    high: round(fields[33], 4),
    low: round(fields[34], 4),
    change,
    changePercent,
    volume: Number(fields[6]) || null,
    turnover: Number(fields[37]) || null,
    amount: Number(fields[37]) || null,
    marketCapital: Number(fields[45]) || null,
    high52w: round(fields[67], 4),
    low52w: round(fields[68], 4),
    asOf: parseTencentTimestamp(fields[30]) || new Date().toISOString(),
    exchangeTimezone: 'Asia/Shanghai',
    source: 'tencent-quote'
  };
}

export function parseTencentQuoteText(text = '') {
  const quotes = {};
  for (const row of parseTencentVariables(text)) {
    const quote = normalizeTencentQuote(row.key, row.fields);
    if (!quote) continue;
    quotes[quote.code] = quote;
    quotes[row.key] = quote;
  }
  return quotes;
}

export async function fetchTencentQuotesBatch(codes = {}, { timeoutMs = TENCENT_QUOTE_TIMEOUT_MS } = {}) {
  const requested = (Array.isArray(codes) ? codes : Object.keys(codes || {}))
    .map((code) => String(code || '').replace(/^(sh|sz|bj)/i, ''))
    .filter((code) => /^\d{6}$/.test(code));
  const uniqueCodes = [...new Set(requested)];
  if (!uniqueCodes.length) return {};
  const symbols = uniqueCodes.map(toTencentSymbol).filter(Boolean);
  const url = buildUrl(TENCENT_QUOTE_HOST, '/', { q: symbols.join(',') });
  const res = await fetchWithTimeout(url, {
    headers: {
      ...COMMON_HEADERS,
      referer: 'https://stock.gtimg.cn/',
      'accept-language': 'zh-CN,zh;q=0.9'
    },
    cache: 'no-store'
  }, {
    timeoutMs,
    label: 'tencent quotes'
  });
  if (!res.ok) throw new Error('tencent quotes HTTP ' + res.status);
  const parsed = parseTencentQuoteText(decodeTencentBuffer(await res.arrayBuffer()));
  return Object.fromEntries(uniqueCodes.map((code) => [
    code,
    parsed[code] || { code, symbol: toTencentSymbol(code), error: 'tencent quote missing ' + code }
  ]));
}

export async function fetchTencentQuote(code, options = {}) {
  const normalizedCode = String(code || '').replace(/^(sh|sz|bj)/i, '');
  if (!/^\d{6}$/.test(normalizedCode)) throw new Error('tencent invalid code: ' + code);
  const result = await fetchTencentQuotesBatch([normalizedCode], options);
  const quote = result[normalizedCode];
  if (!quote || quote.error) throw new Error(quote?.error || 'tencent quote missing ' + normalizedCode);
  return quote;
}

function xueqiuHeaders(cookie, refererSymbol = '') {
  const trimmedCookie = String(cookie || '').trim();
  if (!trimmedCookie) throw new Error('XUEQIU_COOKIE missing');
  const referer = refererSymbol ? `${XUEQIU_WEB_HOST}/S/${refererSymbol}` : `${XUEQIU_WEB_HOST}/`;
  return {
    ...COMMON_HEADERS,
    accept: 'application/json, text/plain, */*',
    cookie: trimmedCookie,
    origin: XUEQIU_WEB_HOST,
    referer,
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
  };
}

async function readXueqiuJson(res, label) {
  const text = await res.text();
  if (!text || !text.trim()) throw new Error(`${label} empty response; XUEQIU_COOKIE may be expired`);
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} invalid json: ${String((err && err.message) || err)}`);
  }
  if (data && data.error_code && Number(data.error_code) !== 0) {
    throw new Error(`${label} error_code=${data.error_code} ${data.error_description || ''}`.trim());
  }
  return data;
}

async function readXueqiuHttpError(res) {
  const text = await res.text().catch(() => '');
  if (!text.trim()) return '';
  try {
    const data = JSON.parse(text);
    const code = data && data.error_code ? String(data.error_code) : '';
    const description = data && data.error_description ? String(data.error_description).trim() : '';
    return [code, description].filter(Boolean).join(': ');
  } catch {
    return '';
  }
}

function normalizeXueqiuMarketState(quote = {}) {
  const status = String(quote.status || quote.market_status || '').toLowerCase();
  if (status === '1' || status.includes('交易') || status.includes('open')) return 'REGULAR';
  return 'CLOSED';
}

function formatShanghaiDateFromMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(n)).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

function finiteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const n = finiteNumberOrNull(value);
    if (n != null) return n;
  }
  return null;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const n = finiteNumberOrNull(value);
    if (n != null && n > 0) return n;
  }
  return null;
}

function normalizeXueqiuOrderBookPayload(data = {}) {
  const root = data && typeof data === 'object' ? data : {};
  const payload = root.data && typeof root.data === 'object' ? root.data : root;
  const quote = payload.quote && typeof payload.quote === 'object' ? payload.quote : {};
  const source = payload.pankou && typeof payload.pankou === 'object' ? payload.pankou : payload;
  const bids = Array.isArray(source.bids) ? source.bids : Array.isArray(source.bid) ? source.bid : [];
  const asks = Array.isArray(source.asks) ? source.asks : Array.isArray(source.ask) ? source.ask : [];
  const levels = [1, 2, 3].map((level) => {
    const bid = Array.isArray(bids[level - 1]) ? bids[level - 1] : null;
    const ask = Array.isArray(asks[level - 1]) ? asks[level - 1] : null;
    return {
      level,
      bidPrice: firstPositiveNumber(
        source[`bp${level}`], source[`bid${level}`], source[`bid${level}_price`], source[`bid_price${level}`],
        source[`buy${level}`], source[`buy${level}_price`], source[`buy_price${level}`], quote[`bp${level}`], quote[`bid${level}`],
        bid?.[0], bid?.price
      ),
      bidVolume: firstFiniteNumber(
        source[`bc${level}`], source[`bid${level}_volume`], source[`bid${level}_vol`], source[`bid_volume${level}`],
        source[`buy${level}_volume`], source[`buy${level}_vol`], source[`buy_volume${level}`], quote[`bc${level}`],
        bid?.[1], bid?.volume
      ),
      askPrice: firstPositiveNumber(
        source[`sp${level}`], source[`ask${level}`], source[`ask${level}_price`], source[`ask_price${level}`],
        source[`sell${level}`], source[`sell${level}_price`], source[`sell_price${level}`], quote[`sp${level}`], quote[`ask${level}`],
        ask?.[0], ask?.price
      ),
      askVolume: firstFiniteNumber(
        source[`sc${level}`], source[`ask${level}_volume`], source[`ask${level}_vol`], source[`ask_volume${level}`],
        source[`sell${level}_volume`], source[`sell${level}_vol`], source[`sell_volume${level}`], quote[`sc${level}`],
        ask?.[1], ask?.volume
      )
    };
  });
  const validLevels = levels
    .filter((item) => item.bidPrice != null || item.askPrice != null)
    .map((item) => ({
      level: item.level,
      bidPrice: item.bidPrice != null ? round(item.bidPrice, 4) : null,
      bidVolume: item.bidVolume != null ? item.bidVolume : null,
      askPrice: item.askPrice != null ? round(item.askPrice, 4) : null,
      askVolume: item.askVolume != null ? item.askVolume : null
    }));
  const bidPrice = validLevels[0]?.bidPrice ?? null;
  const askPrice = validLevels[0]?.askPrice ?? null;
  const bidVolume = validLevels[0]?.bidVolume ?? null;
  const askVolume = validLevels[0]?.askVolume ?? null;
  if (bidPrice == null && askPrice == null) return null;
  const spread = bidPrice != null && askPrice != null ? round(askPrice - bidPrice, 4) : null;
  const mid = bidPrice != null && askPrice != null ? (bidPrice + askPrice) / 2 : null;
  const spreadPercent = spread != null && mid && mid > 0 ? round((spread / mid) * 100, 4) : null;
  return {
    bidPrice,
    bidVolume: bidVolume != null ? bidVolume : null,
    askPrice,
    askVolume: askVolume != null ? askVolume : null,
    levels: validLevels,
    spread,
    spreadPercent,
    source: 'xueqiu-pankou'
  };
}

function normalizeXueqiuQuotePayload(data, code) {
  const quote = data?.data?.quote || data?.quote || data?.data || {};
  if (!quote || typeof quote !== 'object') throw new Error('xueqiu quote empty');
  const symbol = String(quote.symbol || toXueqiuSymbol(code) || code || '').trim().toUpperCase();
  const price = round(quote.current != null ? quote.current : quote.last_close, 4);
  const previousClose = round(quote.last_close, 4);
  if (price == null || price <= 0) throw new Error('xueqiu quote invalid price ' + symbol);
  const change = quote.chg != null ? round(quote.chg, 4) : (previousClose != null ? round(price - previousClose, 4) : null);
  const changePercent = quote.percent != null ? round(quote.percent, 4) : (previousClose ? round(((price - previousClose) / previousClose) * 100, 4) : null);
  const timestamp = Number(quote.timestamp || quote.time || Date.now());
  return {
    symbol: symbol.toLowerCase(),
    code: String(quote.code || toCnSixDigits(symbol) || toCnSixDigits(code) || '').trim(),
    name: quote.name || symbol,
    market: 'cn',
    price,
    previousClose,
    change,
    changePercent,
    open: round(quote.open, 4),
    high: round(quote.high, 4),
    low: round(quote.low, 4),
    volume: Number(quote.volume) || null,
    turnover: Number(quote.amount) || null,
    marketCapital: Number(quote.market_capital) || null,
    iopv: round(quote.iopv, 4),
    latestNav: round(quote.unit_nav, 4),
    accumulatedNav: round(quote.acc_unit_nav, 4),
    latestNavDate: formatShanghaiDateFromMs(quote.nav_date),
    premiumPercent: round(quote.premium_rate, 4),
    currentYearPercent: round(quote.current_year_percent, 4),
    totalShares: Number(quote.total_shares) || null,
    volumeRatio: round(quote.volume_ratio, 4),
    high52w: round(quote.high52w, 4),
    low52w: round(quote.low52w, 4),
    orderBook: normalizeXueqiuOrderBookPayload(data),
    currency: quote.currency || 'CNY',
    exchangeTimezone: 'Asia/Shanghai',
    marketState: normalizeXueqiuMarketState(quote),
    asOf: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString(),
    source: 'xueqiu-quote'
  };
}

async function fetchXueqiuOrderBook(symbol, { cookie, timeoutMs = XUEQIU_ORDER_BOOK_TIMEOUT_MS } = {}) {
  const url = buildUrl(XUEQIU_STOCK_HOST, '/v5/stock/realtime/pankou.json', { symbol });
  const res = await fetchWithTimeout(url, { headers: xueqiuHeaders(cookie, symbol), cf: { cacheTtl: 5 } }, {
    timeoutMs,
    label: 'xueqiu pankou ' + symbol
  });
  if (!res.ok) throw new Error('xueqiu pankou ' + symbol + ' HTTP ' + res.status);
  const data = await readXueqiuJson(res, 'xueqiu pankou ' + symbol);
  return normalizeXueqiuOrderBookPayload(data);
}

function normalizeXueqiuKlinePayload(data, code, intervalLabel) {
  const payload = data?.data || {};
  const columns = Array.isArray(payload.column) ? payload.column : [];
  const items = Array.isArray(payload.item) ? payload.item : Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new Error('xueqiu kline empty ' + code);
  const idx = Object.fromEntries(columns.map((name, index) => [String(name), index]));
  const get = (row, name) => row[idx[name]];
  const getAny = (row, names) => {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(idx, name)) return row[idx[name]];
    }
    return undefined;
  };
  const candles = items.map((row) => {
    const ts = Number(get(row, 'timestamp'));
    const bidPrice = firstPositiveNumber(getAny(row, [
      'bidPrice', 'bid_price', 'bid', 'bp1', 'bid1', 'bid1_price', 'bid_price1',
      'buy1', 'buy1_price', 'buy_price1'
    ]));
    const askPrice = firstPositiveNumber(getAny(row, [
      'askPrice', 'ask_price', 'ask', 'sp1', 'ask1', 'ask1_price', 'ask_price1',
      'sell1', 'sell1_price', 'sell_price1'
    ]));
    const bidVolume = firstFiniteNumber(getAny(row, [
      'bidVolume', 'bid_volume', 'bidSize', 'bc1', 'bid1_volume', 'bid_volume1',
      'buy1_volume', 'buy_volume1'
    ]));
    const askVolume = firstFiniteNumber(getAny(row, [
      'askVolume', 'ask_volume', 'askSize', 'sc1', 'ask1_volume', 'ask_volume1',
      'sell1_volume', 'sell_volume1'
    ]));
    return {
      t: Number.isFinite(ts) ? Math.floor(ts / 1000) : null,
      o: round(get(row, 'open'), 4),
      h: round(get(row, 'high'), 4),
      l: round(get(row, 'low'), 4),
      c: round(get(row, 'close'), 4),
      v: Number(get(row, 'volume')) || 0,
      bidPrice: bidPrice != null ? round(bidPrice, 4) : null,
      bidVolume: bidVolume != null ? bidVolume : null,
      askPrice: askPrice != null ? round(askPrice, 4) : null,
      askVolume: askVolume != null ? askVolume : null
    };
  }).filter((bar) => bar && Number.isFinite(bar.t) && [bar.o, bar.h, bar.l, bar.c].every((value) => Number.isFinite(value)))
    .sort((left, right) => left.t - right.t);
  if (!candles.length) throw new Error('xueqiu kline invalid candles ' + code);
  return {
    symbol: String(payload.symbol || toXueqiuSymbol(code) || code || '').trim().toLowerCase(),
    interval: intervalLabel,
    name: '',
    source: 'xueqiu-kline',
    candles
  };
}

const XUEQIU_PERIOD_MAP = { '1d': 'day', '1w': 'week', '1mo': 'month', '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '60m': '60m' };

function toSinaSymbol(code) {
  const lower = String(code || '').trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(lower)) return lower;
  const digits = toCnSixDigits(lower);
  if (!digits) return '';
  return digits.startsWith('6') || digits.startsWith('51') || digits.startsWith('56') || digits.startsWith('58')
    ? `sh${digits}`
    : `sz${digits}`;
}

function normalizeSinaKlineRows(rows = []) {
  return rows
    .map((row) => {
      const rawDay = String(row?.day || row?.date || '').trim();
      if (!rawDay) return null;
      const dateText = rawDay.includes(' ') ? rawDay.replace(' ', 'T') : `${rawDay}T00:00:00`;
      const timestamp = Date.parse(`${dateText}+08:00`);
      if (!Number.isFinite(timestamp)) return null;
      return {
        t: Math.floor(timestamp / 1000),
        o: round(row?.open, 4),
        h: round(row?.high, 4),
        l: round(row?.low, 4),
        c: round(row?.close, 4),
        v: Number(row?.volume) || 0
      };
    })
    .filter((bar) => bar && [bar.o, bar.h, bar.l, bar.c].every((value) => Number.isFinite(value)))
    .sort((left, right) => left.t - right.t);
}

const SINA_SCALE_MAP = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '1d': 240, '1w': 240, '1mo': 240 };

export async function fetchSinaKline(code, { intervalLabel = '1d', limit = 500 } = {}) {
  const symbol = toSinaSymbol(code);
  if (!symbol) throw new Error('sina bad code ' + code);
  const requestedLimit = Math.max(1, Math.min(Number(limit) || 500, 3000));
  const url = buildUrl(SINA_CN_HOST, '/cn/api/json_v2.php/CN_MarketDataService.getKLineData', {
    symbol,
    scale: SINA_SCALE_MAP[intervalLabel] || 240,
    ma: 'no',
    datalen: requestedLimit
  });
  const res = await fetchWithTimeout(url, {
    headers: { ...COMMON_HEADERS, referer: 'https://finance.sina.com.cn' },
    cf: { cacheTtl: 30 }
  }, {
    timeoutMs: SINA_KLINE_TIMEOUT_MS,
    label: 'sina kline ' + symbol
  });
  if (!res.ok) throw new Error('sina kline ' + symbol + ' HTTP ' + res.status);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) throw new Error('sina kline ' + symbol + ' invalid response');
  const candles = normalizeSinaKlineRows(rows);
  if (!candles.length) throw new Error('sina kline ' + symbol + ' empty');
  return {
    symbol,
    interval: intervalLabel,
    name: '',
    source: 'sina-kline',
    candles
  };
}

export async function fetchXueqiuQuote(code, {
  cookie,
  includeOrderBook = true,
  quoteTimeoutMs = XUEQIU_QUOTE_TIMEOUT_MS,
  orderBookTimeoutMs = XUEQIU_ORDER_BOOK_TIMEOUT_MS
} = {}) {
  const symbol = toXueqiuSymbol(code);
  if (!symbol) throw new Error('xueqiu bad code ' + code);
  const url = buildUrl(XUEQIU_STOCK_HOST, '/v5/stock/quote.json', { extend: 'detail', symbol });
  const res = await fetchWithTimeout(url, { headers: xueqiuHeaders(cookie, symbol), cf: { cacheTtl: 15 } }, {
    timeoutMs: quoteTimeoutMs,
    label: 'xueqiu quote ' + symbol
  });
  if (!res.ok) throw new Error('xueqiu quote ' + symbol + ' HTTP ' + res.status);
  const data = await readXueqiuJson(res, 'xueqiu quote ' + symbol);
  const quote = normalizeXueqiuQuotePayload(data, code);
  if (!includeOrderBook) return quote;
  const orderBook = await fetchXueqiuOrderBook(symbol, { cookie, timeoutMs: orderBookTimeoutMs }).catch(() => null);
  return orderBook ? { ...quote, orderBook } : quote;
}

export async function fetchXueqiuQuotesBatch(codes = [], {
  cookie,
  includeOrderBook = false,
  quoteTimeoutMs = XUEQIU_BATCH_QUOTE_TIMEOUT_MS,
  orderBookTimeoutMs = XUEQIU_ORDER_BOOK_TIMEOUT_MS
} = {}) {
  const out = {};
  await mapLimit(codes || [], 5, async (code) => {
    try {
      out[code] = await fetchXueqiuQuote(code, { cookie, includeOrderBook, quoteTimeoutMs, orderBookTimeoutMs });
    } catch (err) {
      out[code] = { symbol: code, error: String((err && err.message) || err) };
    }
  });
  return out;
}

export async function fetchXueqiuKline(code, { cookie, intervalLabel = '1d', limit = 500 } = {}) {
  const symbol = toXueqiuSymbol(code);
  if (!symbol) throw new Error('xueqiu bad code ' + code);
  const period = XUEQIU_PERIOD_MAP[intervalLabel] || 'day';
  const url = buildUrl(XUEQIU_STOCK_HOST, '/v5/stock/chart/kline.json', {
    symbol,
    begin: Date.now(),
    period,
    type: 'before',
    count: -Math.max(1, Math.min(Number(limit) || 500, 1000)),
    indicator: 'kline,pe,pb,ps,pcf,market_capital,agt,ggt,balance'
  });
  const res = await fetchWithTimeout(url, { headers: xueqiuHeaders(cookie, symbol), cf: { cacheTtl: 30 } }, {
    timeoutMs: XUEQIU_KLINE_TIMEOUT_MS,
    label: 'xueqiu kline ' + symbol
  });
  if (!res.ok) {
    const detail = await readXueqiuHttpError(res);
    throw new Error(`xueqiu kline ${symbol} HTTP ${res.status}${detail ? ` (${detail})` : ''}`);
  }
  const data = await readXueqiuJson(res, 'xueqiu kline ' + symbol);
  return normalizeXueqiuKlinePayload(data, code, intervalLabel);
}


async function readXueqiuEndpoint(path, params = {}, { cookie, refererSymbol = '', label = 'xueqiu endpoint' } = {}) {
  const url = buildUrl(XUEQIU_STOCK_HOST, path, params);
  const res = await fetchWithTimeout(url, { headers: xueqiuHeaders(cookie, refererSymbol), cf: { cacheTtl: 30 } }, {
    timeoutMs: XUEQIU_ENDPOINT_TIMEOUT_MS,
    label
  });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return readXueqiuJson(res, label);
}

function summarizeXueqiuPayload(data) {
  const root = data && typeof data === 'object' ? data : {};
  const payload = root.data;
  const summary = {
    topKeys: Object.keys(root).slice(0, 30),
    dataType: Array.isArray(payload) ? 'array' : (payload && typeof payload === 'object' ? 'object' : typeof payload)
  };
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    summary.dataKeys = Object.keys(payload).slice(0, 60);
    if (payload.quote && typeof payload.quote === 'object') {
      const q = payload.quote;
      summary.quoteKeys = Object.keys(q).slice(0, 120);
    }
    if (Array.isArray(payload.column)) summary.columns = payload.column;
    if (Array.isArray(payload.item)) {
      summary.itemCount = payload.item.length;
    }
    for (const key of ['items', 'list', 'data', 'indicator', 'balance', 'income', 'cash_flow']) {
      const value = payload[key];
      if (Array.isArray(value)) {
        summary[`${key}Count`] = value.length;
      } else if (value && typeof value === 'object') {
        summary[`${key}Keys`] = Object.keys(value).slice(0, 80);
      }
    }
  } else if (Array.isArray(payload)) {
    summary.itemCount = payload.length;
  }
  if (root.error_code || root.code) {
    summary.errorCode = root.error_code || root.code;
    summary.errorMessage = root.error_description || root.message || '';
  }
  return summary;
}

function pickFields(source, fields) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) out[field] = source[field];
  }
  return out;
}

function pickListFields(list, fields, limit = 5) {
  return (Array.isArray(list) ? list : [])
    .slice(0, limit)
    .map((item) => pickFields(item, fields));
}

export function sanitizeXueqiuPublicPayload(name, data) {
  const payload = data?.data && typeof data.data === 'object' ? data.data : {};
  if (name === 'quote_detail') {
    const quote = pickFields(payload.quote, [
      'symbol', 'code', 'name', 'current', 'percent', 'chg', 'open', 'high', 'low', 'volume',
      'amount', 'market_capital', 'marketCapital', 'avg_volume', 'avg_volume10', 'avg_volume_10',
      'beta', 'iopv', 'unit_nav', 'acc_unit_nav', 'nav_date', 'premium_rate',
      'current_year_percent', 'total_shares', 'volume_ratio', 'found_date', 'issue_date',
      'allTimeHigh', 'all_time_high', 'historyHigh', 'history_high', 'highest', 'highestPrice',
      'highest_price', 'maxPrice', 'max_price', 'high52w', 'high_52w'
    ]);
    return Object.keys(quote).length ? { quote } : null;
  }
  if (name === 'capital_flow') {
    const items = pickListFields(payload.items, ['timestamp', 'amount', 'main_net_inflows', 'net_inflow'], 20);
    return items.length ? { items } : null;
  }
  if (name === 'capital_history') {
    const history = pickFields(payload, ['sum3', 'sum5', 'sum10', 'sum20']);
    return Object.keys(history).length ? history : null;
  }
  if (name === 'pankou') {
    const fields = [];
    for (let level = 1; level <= 5; level += 1) fields.push(`bp${level}`, `bc${level}`, `sp${level}`, `sc${level}`);
    const pankou = pickFields(payload, fields);
    return Object.keys(pankou).length ? pankou : null;
  }
  if (name === 'finance_indicator') {
    const list = pickListFields(payload.list, ['report_name', 'asset_liab_ratio', 'operating_income_yoy', 'total_capital_turnover'], 5);
    return list.length ? { list } : null;
  }
  if (name === 'finance_balance') {
    const list = pickListFields(payload.list, ['report_name', 'total_assets', 'total_liab'], 5);
    return list.length ? { list } : null;
  }
  if (name === 'finance_income') {
    const list = pickListFields(payload.list, ['report_name', 'revenue', 'net_profit', 'total_compre_income'], 5);
    return list.length ? { list } : null;
  }
  if (name === 'finance_cash_flow') {
    const list = pickListFields(payload.list, ['report_name', 'ncf_from_oa'], 5);
    return list.length ? { list } : null;
  }
  return null;
}

export async function fetchXueqiuCnFundData(code, { cookie, includeRaw = false } = {}) {
  const symbol = toXueqiuSymbol(code);
  if (!symbol) throw new Error('xueqiu bad code ' + code);
  const endpoints = [
    ['quote_detail', '/v5/stock/quote.json', { extend: 'detail', symbol }],
    ['kline_day', '/v5/stock/chart/kline.json', { symbol, begin: Date.now(), period: 'day', type: 'before', count: -20, indicator: 'kline,pe,pb,ps,pcf,market_capital,agt,ggt,balance' }],
    ['kline_60m', '/v5/stock/chart/kline.json', { symbol, begin: Date.now(), period: '60m', type: 'before', count: -20, indicator: 'kline,pe,pb,ps,pcf,market_capital,agt,ggt,balance' }],
    ['capital_flow', '/v5/stock/capital/flow.json', { symbol }],
    ['capital_history', '/v5/stock/capital/history.json', { symbol }],
    ['f10_indicator', '/v5/stock/f10/cn/indicator.json', { symbol }],
    ['finance_indicator', '/v5/stock/finance/cn/indicator.json', { symbol, type: 'all', is_detail: true, count: 5 }],
    ['finance_balance', '/v5/stock/finance/cn/balance.json', { symbol, type: 'all', is_detail: true, count: 5 }],
    ['finance_income', '/v5/stock/finance/cn/income.json', { symbol, type: 'all', is_detail: true, count: 5 }],
    ['finance_cash_flow', '/v5/stock/finance/cn/cash_flow.json', { symbol, type: 'all', is_detail: true, count: 5 }],
    ['pankou', '/v5/stock/realtime/pankou.json', { symbol }],
    ['quotec', '/v5/stock/realtime/quotec.json', { symbol }]
  ];
  const results = {};
  await mapLimit(endpoints, 4, async ([name, path, params]) => {
    try {
      const data = await readXueqiuEndpoint(path, params, { cookie, refererSymbol: symbol, label: `xueqiu ${name} ${symbol}` });
      const publicData = sanitizeXueqiuPublicPayload(name, data);
      results[name] = {
        ok: true,
        summary: summarizeXueqiuPayload(data),
        ...(publicData ? { data: publicData } : {}),
        ...(includeRaw ? { raw: data } : {})
      };
    } catch (err) {
      results[name] = { ok: false, error: String((err && err.message) || err) };
    }
  });
  return {
    symbol,
    code: toCnSixDigits(symbol),
    generatedAt: new Date().toISOString(),
    results
  };
}

// ===================== Yahoo Finance Chart API（美股 quotes + K 线） =====================

function yahooFieldRaw(value) {
  if (value == null) return null;
  if (typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, 'raw')) {
    const raw = Number(value.raw);
    return Number.isFinite(raw) ? raw : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function yahooFieldText(value, fallback = '') {
  if (value == null) return fallback;
  if (typeof value === 'object' && value !== null) {
    const fmt = String(value.fmt || '').trim();
    if (fmt) return fmt;
    const raw = yahooFieldRaw(value);
    return raw == null ? fallback : String(raw);
  }
  const text = String(value || '').trim();
  return text || fallback;
}

function formatYahooNumber(value, { maximumFractionDigits = 2, suffix = '' } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', {
    maximumFractionDigits,
    minimumFractionDigits: Math.min(2, maximumFractionDigits)
  }) + suffix;
}

const US_MARKET_SUMMARY_PRIMARY_FUTURES = new Set(['ES=F', 'YM=F', 'NQ=F']);
const US_MARKET_SUMMARY_SPOT_INDEXES = new Set(['^GSPC', '^DJI', '^IXIC', '^RUT']);
const US_MARKET_SUMMARY_REFERENCE_ETFS = new Set(['QQQ', 'VOO']);
const US_MARKET_SUMMARY_PREFERRED_INSTRUMENTS = [
  { symbol: 'ES=F', name: 'S&P Futures' },
  { symbol: 'YM=F', name: 'Dow Futures' },
  { symbol: 'NQ=F', name: 'Nasdaq Futures' },
  { symbol: 'RTY=F', name: 'Russell 2000 Futures' },
  { symbol: 'QQQ', name: 'QQQ' },
  { symbol: 'VOO', name: 'VOO' },
  { symbol: '^VIX', name: 'VIX' },
  { symbol: 'CL=F', name: 'Crude Oil' },
  { symbol: 'GC=F', name: 'Gold' }
];
const US_MARKET_SUMMARY_PREFERRED_BY_SYMBOL = new Map(
  US_MARKET_SUMMARY_PREFERRED_INSTRUMENTS.map((item) => [item.symbol.toUpperCase(), item])
);
const YAHOO_MARKET_SUMMARY_REGION_BY_MARKET = new Map([
  ['US', 'US'],
  ['ASIA', 'US'],
  ['EUROPE', 'US'],
  ['CURRENCIES', 'US'],
  ['CRYPTOCURRENCIES', 'US'],
  ['RATES', 'US'],
  ['COMMODITIES', 'US']
]);
const MARKET_SUMMARY_TITLES = new Map([
  ['US', 'US Markets'],
  ['ASIA', 'Asia Markets'],
  ['EUROPE', 'Europe Markets'],
  ['CURRENCIES', 'Currencies'],
  ['CRYPTOCURRENCIES', 'Cryptocurrencies'],
  ['RATES', 'Rates'],
  ['COMMODITIES', 'Commodities']
]);

function marketSummaryTitle(region) {
  const normalized = String(region || '').trim().toUpperCase();
  return MARKET_SUMMARY_TITLES.get(normalized) || (normalized ? normalized + ' Markets' : 'US Markets');
}

function marketSummarySymbol(item) {
  return String(item?.symbol || '').trim().toUpperCase();
}

export function shouldPreferUsFuturesMarketSummary(items = []) {
  return shouldFetchPreferredUsMarketSummary(items);
}

export function shouldFetchPreferredUsMarketSummary(items = []) {
  const symbols = new Set((Array.isArray(items) ? items : []).map(marketSummarySymbol).filter(Boolean));
  const hasAllPrimaryFutures = Array.from(US_MARKET_SUMMARY_PRIMARY_FUTURES).every((symbol) => symbols.has(symbol));
  const hasSpotIndex = Array.from(US_MARKET_SUMMARY_SPOT_INDEXES).some((symbol) => symbols.has(symbol));
  const missingReferenceEtf = Array.from(US_MARKET_SUMMARY_REFERENCE_ETFS).some((symbol) => !symbols.has(symbol));
  return (hasSpotIndex && !hasAllPrimaryFutures) || (hasAllPrimaryFutures && missingReferenceEtf);
}

function preferredUsMarketSummaryItem(item) {
  const config = US_MARKET_SUMMARY_PREFERRED_BY_SYMBOL.get(marketSummarySymbol(item));
  return config ? { ...item, symbol: config.symbol, name: config.name } : item;
}

function orderPreferredUsMarketSummaryItems(items = []) {
  const bySymbol = new Map(
    (Array.isArray(items) ? items : [])
      .map(preferredUsMarketSummaryItem)
      .filter((item) => item?.symbol && item.price != null)
      .map((item) => [marketSummarySymbol(item), item])
  );
  return US_MARKET_SUMMARY_PREFERRED_INSTRUMENTS
    .map((config) => bySymbol.get(config.symbol.toUpperCase()))
    .filter(Boolean);
}

function hasAllPrimaryUsMarketSummaryFutures(items = []) {
  const symbols = new Set((Array.isArray(items) ? items : []).map(marketSummarySymbol).filter(Boolean));
  return Array.from(US_MARKET_SUMMARY_PRIMARY_FUTURES).every((symbol) => symbols.has(symbol));
}

export function normalizeYahooMarketSummary(data, { region = 'US', title = 'US Markets' } = {}) {
  const result = data?.marketSummaryResponse?.result;
  const items = (Array.isArray(result) ? result : [])
    .map((item) => {
      const symbol = String(item?.symbol || '').trim();
      const price = round(yahooFieldRaw(item?.regularMarketPrice), 4);
      const change = round(yahooFieldRaw(item?.regularMarketChange), 4);
      const changePercent = round(yahooFieldRaw(item?.regularMarketChangePercent), 4);
      const asOf = toIso(yahooFieldRaw(item?.regularMarketTime));
      const priceText = yahooFieldText(
        item?.regularMarketPrice,
        price == null ? '' : formatYahooNumber(price)
      );
      const changeText = yahooFieldText(
        item?.regularMarketChange,
        change == null ? '' : formatYahooNumber(change)
      );
      const changePercentText = yahooFieldText(
        item?.regularMarketChangePercent,
        changePercent == null ? '' : formatYahooNumber(changePercent, { maximumFractionDigits: 2, suffix: '%' })
      );
      return {
        symbol,
        name: String(item?.shortName || item?.longName || symbol).trim(),
        price,
        priceText,
        change,
        changeText,
        changePercent,
        changePercentText,
        marketState: String(item?.marketState || '').trim(),
        asOf,
        timeText: yahooFieldText(item?.regularMarketTime),
        exchangeTimezone: String(item?.exchangeTimezoneName || item?.timezone || '').trim(),
        delayMinutes: Number.isFinite(Number(item?.exchangeDataDelayedBy)) ? Number(item.exchangeDataDelayedBy) : null,
        source: String(item?.quoteSourceName || 'Yahoo Finance').trim()
      };
    })
    .filter((item) => item.symbol && item.name);
  return {
    region,
    title,
    generatedAt: new Date().toISOString(),
    items
  };
}

function normalizeYahooChartMarketSummaryItem(raw, config) {
  const quote = normalizeYahooQuote(raw, config.name);
  const symbol = String(quote.symbol || config.symbol || '').trim();
  const priceText = quote.price == null ? '' : formatYahooNumber(quote.price);
  const changeText = quote.change == null ? '' : formatYahooNumber(quote.change);
  const changePercentText = quote.changePercent == null
    ? ''
    : formatYahooNumber(quote.changePercent, { maximumFractionDigits: 2, suffix: '%' });
  return {
    symbol,
    name: config.name,
    price: quote.price,
    priceText,
    change: quote.change,
    changeText,
    changePercent: quote.changePercent,
    changePercentText,
    marketState: quote.marketState,
    asOf: quote.asOf,
    timeText: '',
    exchangeTimezone: quote.exchangeTimezone,
    delayMinutes: null,
    source: 'Yahoo Finance',
    sparkline: normalizeYahooSparkline(raw, { maxPoints: 80 }),
    sparklineRange: '1d',
    sparklineInterval: '15m'
  };
}

async function fetchPreferredUsMarketSummaryItems() {
  try {
    const url = buildUrl(YAHOO_HOST, '/v7/finance/quote', {
      symbols: US_MARKET_SUMMARY_PREFERRED_INSTRUMENTS.map((item) => item.symbol).join(','),
      fields: 'shortName,regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketTime,marketState,exchangeTimezoneName,exchangeDataDelayedBy,quoteSourceName',
      formatted: 'true',
      lang: 'en-US',
      region: 'US'
    });
    const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 30 } });
    if (!res.ok) throw new Error('yahoo preferred market summary quote HTTP ' + res.status);
    const data = await res.json().catch(() => ({}));
    const quoteItems = orderPreferredUsMarketSummaryItems(normalizeYahooMarketSummary({
      marketSummaryResponse: { result: data?.quoteResponse?.result || [] }
    }, {
      region: 'US',
      title: 'US Markets'
    }).items);
    if (hasAllPrimaryUsMarketSummaryFutures(quoteItems)) return quoteItems;
  } catch {
    // Fall back to chart quotes below. The route can still return the base Yahoo summary if both fail.
  }

  const rows = await mapLimit(US_MARKET_SUMMARY_PREFERRED_INSTRUMENTS, 4, async (config) => {
    const raw = await fetchYahooChart(config.symbol, { range: '1d', interval: '15m' });
    return normalizeYahooChartMarketSummaryItem(raw, config);
  });
  return orderPreferredUsMarketSummaryItems(
    rows.filter((item) => item && !item.__error && item.symbol && item.price != null)
  );
}

function mergePreferredUsMarketSummaryItems(payload, preferredItems) {
  const preferred = Array.isArray(preferredItems) ? preferredItems : [];
  if (!hasAllPrimaryUsMarketSummaryFutures(preferred)) return payload;

  const usedSymbols = new Set(preferred.map(marketSummarySymbol).filter(Boolean));
  const extras = (Array.isArray(payload?.items) ? payload.items : [])
    .filter((item) => {
      const symbol = marketSummarySymbol(item);
      return symbol && !usedSymbols.has(symbol) && !US_MARKET_SUMMARY_SPOT_INDEXES.has(symbol);
    });
  return {
    ...payload,
    items: [...preferred, ...extras]
  };
}

export async function fetchYahooMarketSummary({ market = 'US', region = 'US', yahooRegion = '', lang = 'en-US', title = '' } = {}) {
  const normalizedMarket = String(market || 'US').trim().toUpperCase() || 'US';
  const normalizedRegion = String(region || normalizedMarket).trim().toUpperCase() || normalizedMarket;
  const normalizedYahooRegion = String(yahooRegion || YAHOO_MARKET_SUMMARY_REGION_BY_MARKET.get(normalizedMarket) || normalizedRegion).trim().toUpperCase() || normalizedRegion;
  const url = buildUrl(YAHOO_HOST, '/v6/finance/quote/marketSummary', {
    fields: 'shortName,regularMarketPrice,regularMarketChange,regularMarketChangePercent',
    formatted: 'true',
    lang: lang || 'en-US',
    market: normalizedMarket,
    region: normalizedYahooRegion
  });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 60 } });
  if (!res.ok) throw new Error('yahoo market summary HTTP ' + res.status);
  const data = await res.json().catch(() => ({}));
  const payload = normalizeYahooMarketSummary(data, {
    region: normalizedRegion,
    title: title || marketSummaryTitle(normalizedRegion)
  });
  if (!payload.items.length) throw new Error('yahoo market summary empty');
  if (normalizedRegion === 'US' && normalizedMarket === 'US' && shouldPreferUsFuturesMarketSummary(payload.items)) {
    const preferredItems = await fetchPreferredUsMarketSummaryItems();
    return mergePreferredUsMarketSummaryItems(payload, preferredItems);
  }
  return payload;
}

export async function fetchYahooChart(symbol, { range = '1d', interval = '1m' } = {}) {
  const url = buildUrl(YAHOO_HOST, '/v8/finance/chart/' + encodeURIComponent(symbol), {
    range,
    interval,
    includePrePost: 'false'
  });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 30 } });
  if (!res.ok) throw new Error('yahoo ' + symbol + ' HTTP ' + res.status);
  const data = await res.json();
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result) {
    const err = data && data.chart && data.chart.error;
    throw new Error('yahoo ' + symbol + ' ' + ((err && err.code) || 'no-result'));
  }
  return result;
}

export function normalizeYahooSparkline(raw, { maxPoints = 80 } = {}) {
  const q = (raw && raw.indicators && raw.indicators.quote && raw.indicators.quote[0]) || {};
  const closes = Array.isArray(q.close) ? q.close : [];
  const points = closes
    .filter((value) => value != null)
    .map((value) => round(value, 4))
    .filter((value) => value != null && Number.isFinite(value));
  const limit = Math.max(2, Number(maxPoints) || 80);
  return points.length > limit ? points.slice(-limit) : points;
}

export async function fetchYahooSparkline(symbol, { range = '1d', interval = '15m', maxPoints = 80 } = {}) {
  const raw = await fetchYahooChart(symbol, { range, interval });
  return normalizeYahooSparkline(raw, { maxPoints });
}

export function normalizeYahooQuote(raw, fallbackName = '') {
  const meta = (raw && raw.meta) || {};
  const price = round(meta.regularMarketPrice != null ? meta.regularMarketPrice : meta.previousClose, 4);
  const previousClose = round(meta.chartPreviousClose != null ? meta.chartPreviousClose : meta.previousClose, 4);
  const change = price !== null && previousClose !== null ? round(price - previousClose, 4) : null;
  const changePercent = previousClose ? round(((price - previousClose) / previousClose) * 100, 4) : null;
  return {
    symbol: meta.symbol || '',
    name: fallbackName || meta.shortName || meta.longName || meta.symbol || '',
    market: 'us',
    price,
    previousClose,
    change,
    changePercent,
    open: round(meta.regularMarketOpen, 4),
    high: round(meta.regularMarketDayHigh, 4),
    low: round(meta.regularMarketDayLow, 4),
    volume: Number(meta.regularMarketVolume) || null,
    currency: meta.currency || 'USD',
    exchangeTimezone: meta.exchangeTimezoneName || meta.timezone || 'America/New_York',
    marketState: meta.marketState || '',
    asOf: toIso(meta.regularMarketTime)
  };
}

export function normalizeYahooKline(raw, intervalLabel) {
  const ts = (raw && raw.timestamp) || [];
  const q = (raw && raw.indicators && raw.indicators.quote && raw.indicators.quote[0]) || {};
  const candles = [];
  for (let i = 0; i < ts.length; i += 1) {
    const c = q.close && q.close[i];
    if (c == null || !Number.isFinite(c)) continue;
    candles.push({
      t: ts[i],
      o: round(q.open && q.open[i], 4),
      h: round(q.high && q.high[i], 4),
      l: round(q.low && q.low[i], 4),
      c: round(c, 4),
      v: Number(q.volume && q.volume[i]) || 0
    });
  }
  return {
    symbol: (raw && raw.meta && raw.meta.symbol) || '',
    interval: intervalLabel,
    candles
  };
}

export async function fetchYahooQuotesBatch(symbols, opts = {}) {
  const out = {};
  // 上游 Yahoo chart 单 symbol 一调；symbols 可能是几十个。限并发 5。
  await mapLimit(symbols, 5, async (sym) => {
    try {
      const raw = await fetchYahooChart(sym, { range: '1d', interval: '5m', ...opts });
      out[sym] = normalizeYahooQuote(raw);
    } catch (err) {
      out[sym] = { symbol: sym, error: String((err && err.message) || err) };
    }
  });
  return out;
}


// Yahoo quoteSummary：三大财务报表（年度 + 季度）。只用于美股详情页的「财务」tab。
export async function fetchYahooFinancials(symbol) {
  const modules = [
    'incomeStatementHistory',
    'incomeStatementHistoryQuarterly',
    'balanceSheetHistory',
    'balanceSheetHistoryQuarterly',
    'cashflowStatementHistory',
    'cashflowStatementHistoryQuarterly'
  ].join(',');
  const url = buildUrl(YAHOO_HOST, '/v10/finance/quoteSummary/' + encodeURIComponent(symbol), { modules });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 1800 } });
  if (!res.ok) throw new Error('yahoo financials ' + symbol + ' HTTP ' + res.status);
  const data = await res.json().catch(() => ({}));
  const result = data && data.quoteSummary && data.quoteSummary.result && data.quoteSummary.result[0];
  if (!result) {
    const err = data && data.quoteSummary && data.quoteSummary.error;
    throw new Error('yahoo financials ' + symbol + ' ' + ((err && err.code) || 'no-result'));
  }
  return normalizeYahooFinancials(result, symbol);
}

function unwrapFinancialValue(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && Number.isFinite(Number(value.raw))) return Number(value.raw);
  return null;
}

function normalizeStatementRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row) => {
    const endRaw = unwrapFinancialValue(row && row.endDate);
    const fields = {};
    for (const [key, value] of Object.entries(row || {})) {
      if (key === 'maxAge' || key === 'endDate') continue;
      const n = unwrapFinancialValue(value);
      if (n != null) fields[key] = n;
    }
    return {
      period: endRaw ? new Date(endRaw * 1000).toISOString().slice(0, 10) : '',
      endDate: endRaw || null,
      fields
    };
  }).filter((row) => row.period && Object.keys(row.fields).length);
}

export function normalizeYahooFinancials(raw, symbol) {
  return {
    symbol,
    market: 'us',
    statements: {
      income: {
        annual: normalizeStatementRows(raw?.incomeStatementHistory?.incomeStatementHistory),
        quarterly: normalizeStatementRows(raw?.incomeStatementHistoryQuarterly?.incomeStatementHistory)
      },
      balance: {
        annual: normalizeStatementRows(raw?.balanceSheetHistory?.balanceSheetStatements),
        quarterly: normalizeStatementRows(raw?.balanceSheetHistoryQuarterly?.balanceSheetStatements)
      },
      cashflow: {
        annual: normalizeStatementRows(raw?.cashflowStatementHistory?.cashflowStatements),
        quarterly: normalizeStatementRows(raw?.cashflowStatementHistoryQuarterly?.cashflowStatements)
      }
    }
  };
}

export async function searchYahooSymbols(query, { limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = buildUrl(YAHOO_SEARCH_HOST, '/v1/finance/search', {
    q,
    quotesCount: Math.max(1, Math.min(Number(limit) || 8, 12)),
    newsCount: 0
  });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error('yahoo search HTTP ' + res.status);
  const data = await res.json().catch(() => ({}));
  const rows = Array.isArray(data && data.quotes) ? data.quotes : [];
  const allowed = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX']);
  return rows
    .filter((row) => row && row.symbol && (!row.quoteType || allowed.has(row.quoteType)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 8, 12)))
    .map((row) => ({
      symbol: String(row.symbol || '').toUpperCase(),
      name: row.shortname || row.longname || row.symbol || '',
      market: 'us',
      exchange: row.exchDisp || row.exchange || '',
      type: row.quoteType || row.typeDisp || '',
      industry: row.industryDisp || row.industry || '',
      sector: row.sectorDisp || row.sector || ''
    }));
}

// ===================== 东方财富搜索（仅用于 A 股搜索候选） =====================

export async function searchEastmoneySymbols(query, { limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const maxCount = Math.max(1, Math.min(Number(limit) || 8, 12));
  const url = buildUrl(EM_SEARCH_HOST, '/api/suggest/get', {
    input: q,
    type: 14,
    token: 'D43BF722C8E33BDC906FB84D85E326E8',
    count: Math.max(maxCount, 12)
  });
  const res = await fetch(url, {
    headers: { ...COMMON_HEADERS, referer: 'https://quote.eastmoney.com/' },
    cf: { cacheTtl: 300 }
  });
  if (!res.ok) throw new Error('eastmoney search HTTP ' + res.status);
  const data = await res.json().catch(() => ({}));
  const rows = (((data || {}).QuotationCodeTable || {}).Data) || [];
  const normalized = Array.isArray(rows) ? rows : [];
  return normalized
    .filter((row) => {
      const code = String(row?.Code || '').trim();
      if (!/^\d{6}$/.test(code)) return false;
      const text = [row.Classify, row.SecurityType, row.SecurityTypeName, row.SecurityTypeName2, row.QuoteType, row.TypeName]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return row.Classify === 'AStock'
        || row.SecurityType === '1'
        || text.includes('stock')
        || text.includes('基金')
        || text.includes('fund')
        || text.includes('lof')
        || text.includes('etf')
        || text.includes('qdii');
    })
    .slice(0, maxCount)
    .map((row) => {
      const code = String(row.Code || '').trim();
      const mkt = String(row.MktNum || row.MarketType || '').trim();
      const typeText = [row.Classify, row.SecurityTypeName, row.SecurityTypeName2, row.QuoteType, row.TypeName]
        .map((value) => String(value || ''))
        .join(' ');
      const isFund = /基金|fund|lof|etf|qdii/i.test(typeText);
      const isExchangeTradedFund = /etf|lof|场内|封闭/i.test(typeText) || ['0', '1', '2'].includes(mkt);
      const isOtcFund = isFund && !isExchangeTradedFund;
      const prefix = mkt === '1' ? 'sh' : mkt === '0' ? 'sz' : mkt === '2' ? 'bj' : code.startsWith('6') ? 'sh' : code.startsWith('4') || code.startsWith('8') ? 'bj' : 'sz';
      return {
        symbol: isOtcFund ? code : prefix + code,
        code,
        name: row.Name || code,
        market: 'cn',
        exchange: isOtcFund ? '场外基金' : (row.SecurityTypeName || (prefix === 'sh' ? '沪A' : prefix === 'bj' ? '北交所' : '深A')),
        type: row.Classify || row.SecurityTypeName || '',
        assetType: isOtcFund ? 'otc_fund' : isFund ? 'exchange_fund' : 'stock',
        pinyin: row.PinYin || ''
      };
    });
}

// ===================== 蛋卷基金（场外基金净值） =====================

export async function fetchDanjuanFundMeta(code) {
  const fundCode = String(code || '').replace(/^(sh|sz|bj)/i, '');
  if (!/^\d{6}$/.test(fundCode)) throw new Error('danjuan invalid fund code: ' + code);
  const url = DANJUAN_FUNDS_HOST + '/djapi/fund/' + fundCode;
  const res = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      referer: 'https://danjuanfunds.com/',
      'accept-language': 'zh-CN,zh;q=0.9'
    },
    cf: { cacheTtl: 86400 }
  });
  if (!res.ok) throw new Error('danjuan fund meta HTTP ' + res.status);
  const body = await res.json().catch(() => ({}));
  if (body?.result_code !== 0 && body?.result_code !== '0') {
    throw new Error('danjuan fund meta error: ' + JSON.stringify(body?.result_code));
  }
  const d = body?.data || {};
  return {
    code: String(d.fd_code || fundCode).trim(),
    symbol: String(d.fd_code || fundCode).trim(),
    name: String(d.fd_name || '').trim(),
    fullName: String(d.fd_full_name || '').trim(),
    fundType: String(d.type_desc || '').trim(),
    fundTypeCode: d.fd_type ?? d.type ?? null,
    totalShare: String(d.totshare || '').trim(),
    source: 'danjuan'
  };
}

export async function fetchDanjuanFundDetail(code) {
  const fundCode = String(code || '').replace(/^(sh|sz|bj)/i, '');
  if (!/^\d{6}$/.test(fundCode)) throw new Error('danjuan invalid fund code: ' + code);
  const url = DANJUAN_FUNDS_HOST + '/djapi/fund/detail/' + fundCode;
  const res = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      referer: 'https://danjuanfunds.com/',
      'accept-language': 'zh-CN,zh;q=0.9'
    },
    cf: { cacheTtl: 86400 }
  });
  if (!res.ok) throw new Error('danjuan fund detail HTTP ' + res.status);
  const body = await res.json().catch(() => ({}));
  if (body?.result_code !== 0 && body?.result_code !== '0') {
    throw new Error('danjuan fund detail error: ' + JSON.stringify(body?.result_code));
  }
  const d = body?.data || {};
  const position = d.fund_position || {};
  return {
    code: fundCode,
    assetTotal: round(Number(position.asset_tot), 2),
    assetValue: round(Number(position.asset_val), 2),
    stockPercent: round(Number(position.stock_percent), 2),
    cashPercent: round(Number(position.cash_percent), 2),
    source: 'danjuan'
  };
}


export async function fetchDanjuanFundNav(code, { includeDetail = true } = {}) {
  const fundCode = String(code || '').replace(/^(sh|sz|bj)/i, '');
  if (!/^\d{6}$/.test(fundCode)) throw new Error('danjuan invalid fund code: ' + code);
  // /djapi/fund/derived/ 返回 unit_nav + nav_grtd（日涨跌幅），/detail/ 不含净值
  const url = DANJUAN_FUNDS_HOST + '/djapi/fund/derived/' + fundCode;
  const res = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      referer: 'https://danjuanfunds.com/',
      'accept-language': 'zh-CN,zh;q=0.9'
    },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('danjuan fund derived HTTP ' + res.status);
  const body = await res.json().catch(() => ({}));
  if (body?.result_code !== 0 && body?.result_code !== '0') {
    throw new Error('danjuan fund derived error: ' + JSON.stringify(body?.result_code));
  }
  const d = body?.data || {};
  const nav = Number(d.unit_nav);
  const changePercent = Number(d.nav_grtd);
  // 从净值和涨跌幅反算前日净值
  const prevNav = Number.isFinite(nav) && Number.isFinite(changePercent) && changePercent !== -100
    ? round(nav / (1 + changePercent / 100), 4) : null;
  const change = Number.isFinite(nav) && Number.isFinite(prevNav)
    ? round(nav - prevNav, 4) : null;

  // 详情不是净值的必要数据。场内实时降级链路关闭它，避免每个报价再多打一条上游请求。
  let assetTotal = null;
  if (includeDetail) {
    try {
      const detail = await fetchDanjuanFundDetail(fundCode);
      assetTotal = detail.assetTotal;
    } catch {
      // 详情接口失败不影响主流程
    }
  }

  const updatedAt = Number(d.updated_at) || 0;
  const asOf = updatedAt > 0
    ? new Date(updatedAt < 1e12 ? updatedAt * 1000 : updatedAt).toISOString()
    : new Date().toISOString();

  return {
    code: fundCode,
    symbol: fundCode,
    name: '',
    price: null,
    currentPrice: null,
    close: null,
    previousClose: Number.isFinite(prevNav) ? prevNav : null,
    change: Number.isFinite(change) ? change : null,
    changePercent: Number.isFinite(changePercent) ? changePercent : null,
    latestNav: Number.isFinite(nav) ? nav : null,
    latestNavDate: String(d.end_date || '').trim(),
    iopv: null,
    marketState: '',
    asOf,
    source: 'danjuan',
    fallback: 'danjuan',
    primaryError: '',
    fundTypeCode: d.fd_type ?? null,
    updatedAt: Number(d.updated_at) || 0,
    ytdReturn: round(Number(d.nav_grlty), 4),
    return1w: round(Number(d.nav_grl1w), 4),
    return1m: round(Number(d.nav_grl1m), 4),
    return3m: round(Number(d.nav_grl3m), 4),
    return6m: round(Number(d.nav_grl6m), 4),
    return1y: round(Number(d.nav_grl1y), 4),
    returnBase: round(Number(d.nav_grbase), 4),
    fundSize: assetTotal,
  };
}

// ===================== Finnhub（美股基本面 + 新闻） =====================

export async function fetchFinnhubQuote(symbol, { token }) {
  const url = buildUrl(FINNHUB_HOST, '/api/v1/quote', { symbol, token });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 30 } });
  if (!res.ok) throw new Error('finnhub quote ' + symbol + ' HTTP ' + res.status);
  return res.json();
}

export async function fetchFinnhubProfile(symbol, { token }) {
  const url = buildUrl(FINNHUB_HOST, '/api/v1/stock/profile2', { symbol, token });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 86400 } });
  if (!res.ok) throw new Error('finnhub profile ' + symbol + ' HTTP ' + res.status);
  return res.json();
}

export async function fetchFinnhubCompanyNews(symbol, { token, from, to }) {
  const f = from || new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  const t = to || new Date().toISOString().slice(0, 10);
  const url = buildUrl(FINNHUB_HOST, '/api/v1/company-news', { symbol, from: f, to: t, token });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error('finnhub news ' + symbol + ' HTTP ' + res.status);
  return res.json();
}

export async function fetchFinnhubMarketNews({ token, category = 'general' }) {
  const url = buildUrl(FINNHUB_HOST, '/api/v1/news', { category, token });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error('finnhub market news HTTP ' + res.status);
  return res.json();
}

// Finnhub 财报日历：默认拉 [today, today+14d] 区间。结构 { earningsCalendar: [...] }。
export async function fetchFinnhubEarningsCalendar({ token, from, to }) {
  const f = from || new Date().toISOString().slice(0, 10);
  const t = to || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const url = buildUrl(FINNHUB_HOST, '/api/v1/calendar/earnings', { from: f, to: t, token });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 1800 } });
  if (!res.ok) throw new Error('finnhub earnings calendar HTTP ' + res.status);
  return res.json();
}
