// beta 行情明细核心：单只基金的报价 + 指标 + 日线区间（纯逻辑）。
//
// 三个数据源并发拉，且三个都允许单独挂：
//   fund-quote   → 现价、涨跌幅、今日高低
//   fund-detail  → 净值、净值日、溢价等指标
//   fund-history → 日线（区间涨跌、高低点、近5/20/60 日）
// 任意一个挂了剩下的照常显示，只在顶上多一句提示。
//
// 另外会把本地账本里这只基金的持仓带上来，复用持仓核心的 buildPositions，
// 保证与持仓 tab、持仓明细页的均价与盈亏完全一致。

import { buildPositions, round } from './holdingsScreenCore.js';
import { normalizeFundCode } from './marketActions.js';

const REQUIRED_DEPS = ['callAction', 'readLedger'];

const NAME_KEYS = ['name', 'fundName', 'shortName', 'secName'];
const PRICE_KEYS = ['price', 'currentPrice', 'close', 'lastPrice', 'now'];
const CHANGE_KEYS = ['changePercent', 'changePct', 'changeRate', 'percent'];
const OPEN_KEYS = ['open', 'openPrice'];
const HIGH_KEYS = ['high', 'highPrice'];
const LOW_KEYS = ['low', 'lowPrice'];
const PREV_CLOSE_KEYS = ['prevClose', 'preClose', 'previousClose', 'yesterdayClose'];
const VOLUME_KEYS = ['volume', 'vol', 'turnoverVolume'];
const NAV_KEYS = ['latestNav', 'nav', 'unitNav', 'navBase'];
const NAV_DATE_KEYS = ['navDate', 'latestNavDate', 'navUpdatedAt'];
const PREMIUM_KEYS = ['premium', 'premiumRate', 'premiumPercent'];
const SCALE_KEYS = ['scale', 'fundScale', 'netAsset'];
const DATE_KEYS = ['date', 'day', 'tradeDate', 'time'];
const CLOSE_KEYS = ['close', 'closePrice', 'nav', 'price'];
const LIST_KEYS = ['candles', 'items', 'rows', 'list', 'data', 'klines'];

export const EMPTY_SERIES_STATS = Object.freeze({
  count: 0,
  startDate: '',
  endDate: '',
  startClose: null,
  lastClose: null,
  changePercent: null,
  high: null,
  highDate: '',
  low: null,
  lowDate: '',
  fromHighPercent: null,
  d5: null,
  d20: null,
  d60: null
});

export const INITIAL_MARKET_DETAIL_STATE = Object.freeze({
  status: 'idle',
  code: '',
  name: '',
  quote: null,
  metrics: null,
  rows: [],
  stats: EMPTY_SERIES_STATS,
  holding: null,
  hasData: false,
  errors: Object.freeze({ quote: '', detail: '', history: '', ledger: '' }),
  error: '',
  updatedAt: 0
});

export function errorMessage(error, fallback = '行情加载失败') {
  if (typeof error === 'string') return error.trim() || fallback;
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  return fallback;
}

// 新约定：「没数据」与「0」必须分开，不合法返回 null。
export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pick(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (let i = 0; i < keys.length; i += 1) {
    const value = toNumber(source[keys[i]]);
    if (value !== null) return value;
  }
  return null;
}

// 价格类字段：0 等于没报价，不能当真值。
function pickPositive(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (let i = 0; i < keys.length; i += 1) {
    const value = toNumber(source[keys[i]]);
    if (value !== null && value > 0) return value;
  }
  return null;
}

function pickText(source, keys) {
  if (!source || typeof source !== 'object') return '';
  for (let i = 0; i < keys.length; i += 1) {
    const value = source[keys[i]];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) {
      // 毫秒时间戳归一成日期，否则页面上会出现一串数字。
      if (value >= 1e11) return new Date(value).toISOString().slice(0, 10);
      return String(value);
    }
  }
  return '';
}

export function percentChange(from, to) {
  const base = toNumber(from);
  const target = toNumber(to);
  if (base === null || target === null || base === 0) return null;
  return round(((target - base) / base) * 100, 2);
}

export function normalizeQuote(quote) {
  if (!quote || typeof quote !== 'object') return null;
  return {
    name: pickText(quote, NAME_KEYS),
    price: pickPositive(quote, PRICE_KEYS),
    changePercent: pick(quote, CHANGE_KEYS),
    open: pickPositive(quote, OPEN_KEYS),
    high: pickPositive(quote, HIGH_KEYS),
    low: pickPositive(quote, LOW_KEYS),
    prevClose: pickPositive(quote, PREV_CLOSE_KEYS),
    volume: pick(quote, VOLUME_KEYS)
  };
}

export function normalizeMetrics(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    name: pickText(item, NAME_KEYS),
    nav: pickPositive(item, NAV_KEYS),
    navDate: pickText(item, NAV_DATE_KEYS),
    premium: pick(item, PREMIUM_KEYS),
    scale: pick(item, SCALE_KEYS)
  };
}

function readList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (let i = 0; i < LIST_KEYS.length; i += 1) {
    const value = payload[LIST_KEYS[i]];
    if (Array.isArray(value)) return value;
  }
  return [];
}

// 有的端点返回数组形 K 线：[date, open, high, low, close, volume]。
function asCandleObject(item) {
  if (!Array.isArray(item)) return item;
  return {
    date: item[0],
    open: item[1],
    high: item[2],
    low: item[3],
    close: item[4],
    volume: item[5]
  };
}

function compareByDate(a, b) {
  if (a.date === b.date) return 0;
  if (!a.date) return -1;
  if (!b.date) return 1;
  return a.date < b.date ? -1 : 1;
}

/** 把 K 线载荷归一成按日期升序的 {date, open, high, low, close, volume}。 */
export function buildSeries(payload) {
  const list = readList(payload);
  const rows = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = asCandleObject(list[i]);
    if (!item || typeof item !== 'object') continue;
    const close = pickPositive(item, CLOSE_KEYS);
    if (close === null) continue;
    rows.push({
      date: pickText(item, DATE_KEYS),
      close,
      open: pickPositive(item, OPEN_KEYS),
      high: pickPositive(item, HIGH_KEYS),
      low: pickPositive(item, LOW_KEYS),
      volume: pick(item, VOLUME_KEYS)
    });
  }
  rows.sort(compareByDate);
  return rows;
}

// 「近 N 日」需要 N+1 个点（要一个基准），不够就返回 null 而不是押一个数字上去。
function windowChange(rows, size) {
  if (rows.length < size + 1) return null;
  const base = rows[rows.length - 1 - size].close;
  return percentChange(base, rows[rows.length - 1].close);
}

export function summarizeSeries(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { ...EMPTY_SERIES_STATS };

  const first = list[0];
  const last = list[list.length - 1];
  let high = first.close;
  let highDate = first.date;
  let low = first.close;
  let lowDate = first.date;

  for (let i = 1; i < list.length; i += 1) {
    const row = list[i];
    if (row.close > high) {
      high = row.close;
      highDate = row.date;
    }
    if (row.close < low) {
      low = row.close;
      lowDate = row.date;
    }
  }

  return {
    count: list.length,
    startDate: first.date,
    endDate: last.date,
    startClose: first.close,
    lastClose: last.close,
    changePercent: percentChange(first.close, last.close),
    high,
    highDate,
    low,
    lowDate,
    fromHighPercent: percentChange(high, last.close),
    d5: windowChange(list, 5),
    d20: windowChange(list, 20),
    d60: windowChange(list, 60)
  };
}

/** 账本里这只基金的持仓，价格优先用现价，其次净值，最后才是成本价。 */
export function buildHolding(position, price) {
  if (!position) return null;
  const shares = round(position.shares, 4);
  const cost = round(position.cost, 2);
  const usable = toNumber(price);
  const valuation = usable !== null && usable > 0 ? usable : position.avgCost;
  const marketValue = round(shares * valuation, 2);
  const profit = round(marketValue - cost, 2);
  return {
    shares,
    avgCost: round(position.avgCost, 4),
    cost,
    marketValue,
    profit,
    profitPercent: cost > 0 ? round((profit / cost) * 100, 2) : null,
    realized: round(position.realized, 2),
    txCount: position.txCount,
    cleared: shares <= 0
  };
}

function failure(code, message) {
  return {
    ok: false,
    code,
    name: '',
    quote: null,
    metrics: null,
    rows: [],
    stats: { ...EMPTY_SERIES_STATS },
    holding: null,
    hasData: false,
    errors: { quote: '', detail: '', history: '', ledger: '' },
    error: message,
    updatedAt: 0
  };
}

async function safeCall(callAction, action, params, fallback) {
  try {
    const result = await callAction(action, params);
    if (result && result.ok === true) return { payload: result, error: '' };
    return { payload: null, error: errorMessage(result && result.error, fallback) };
  } catch (error) {
    return { payload: null, error: errorMessage(error, fallback) };
  }
}

/**
 * @param {object} deps
 * @param {(action: string, params: object) => Promise<object>} deps.callAction
 * @param {() => object} deps.readLedger
 * @param {() => number} [deps.now]
 */
export function createMarketDetailController(deps = {}) {
  for (let i = 0; i < REQUIRED_DEPS.length; i += 1) {
    const name = REQUIRED_DEPS[i];
    if (typeof deps[name] !== 'function') {
      throw new TypeError('createMarketDetailController requires a ' + name + ' function');
    }
  }

  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();

  async function load(options = {}) {
    const code = normalizeFundCode(options.code);
    if (!code) return failure('', '基金代码不识别');

    const refresh = Boolean(options.refresh);
    const limit = toNumber(options.limit) && toNumber(options.limit) > 0 ? Number(options.limit) : 250;

    const [quoteCall, detailCall, historyCall] = await Promise.all([
      safeCall(deps.callAction, 'fund-quote', { codes: [code], refresh }, '行情拉取失败'),
      safeCall(deps.callAction, 'fund-detail', { code, refresh }, '指标拉取失败'),
      safeCall(
        deps.callAction,
        'fund-history',
        { code, timeframe: options.timeframe || '1d', limit },
        '日线拉取失败'
      )
    ]);

    const quotes = (quoteCall.payload && quoteCall.payload.quotes) || {};
    const quote = normalizeQuote(quotes[code]);
    const metrics = normalizeMetrics(detailCall.payload && detailCall.payload.item);
    const rows = buildSeries(historyCall.payload);
    const stats = summarizeSeries(rows);

    let ledgerError = '';
    let position = null;
    try {
      const ledger = deps.readLedger() || {};
      const built = buildPositions(ledger.transactions);
      for (let i = 0; i < built.positions.length; i += 1) {
        if (built.positions[i].code === code) {
          position = built.positions[i];
          break;
        }
      }
    } catch (error) {
      ledgerError = errorMessage(error, '账本读取失败');
    }

    const price = (quote && quote.price) || (metrics && metrics.nav) || stats.lastClose;
    const holding = buildHolding(position, price);

    const errors = {
      quote: quoteCall.error,
      detail: detailCall.error,
      history: historyCall.error,
      ledger: ledgerError
    };

    return {
      ok: true,
      code,
      name: (quote && quote.name) || (metrics && metrics.name) || (position && position.name) || code,
      quote,
      metrics,
      rows,
      stats,
      holding,
      hasData: Boolean((quote && quote.price) || rows.length || metrics),
      errors,
      error: errors.quote || errors.history || errors.detail || errors.ledger,
      updatedAt: now()
    };
  }

  return { load };
}
