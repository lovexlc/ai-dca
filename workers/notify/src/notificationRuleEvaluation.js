import { buildMovingAverageValues, buildNasdaqStrategyPlan, buildPeakDrawdownStrategyPlan, findLatestFiniteValue, mapReferencePrice } from '../../../src/app/strategyEngine.js';
import { fetchFundNavHistoryWithMonthlyKv } from './getNav.js';

const DEFAULT_PUBLIC_DATA_BASE_URL = 'https://api.freebacktrack.tech';
const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_MARKETS_API_BASE = 'https://api.freebacktrack.tech/api/markets';
const BENCHMARK_SYMBOL_MAP = {
  'nas-daq100': '^NDX'
};
const EXCHANGE_PREFIXES = new Set(['15', '50', '51', '52', '53', '54', '56', '58']);

export function roundPrice(value) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(3)) : 0;
}

export function formatPrice(value, currency = '¥') {
  const numericValue = Number(value);
  if (!(numericValue > 0)) {
    return '--';
  }

  const prefix = currency === '$' ? '$' : '¥';
  return `${prefix}${numericValue.toFixed(3)}`;
}

export function formatAmount(value, currency = '¥') {
  const numericValue = Number(value);
  if (!(numericValue > 0)) {
    return '';
  }

  const prefix = currency === '$' ? '$' : '¥';
  return `${prefix}${numericValue.toFixed(2)}`;
}

export function formatPercent(value, digits = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '--';
  }

  return `${numericValue.toFixed(digits)}%`;
}

function stripTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

export function buildNotificationEventId(ruleId = '', context = '', now = new Date()) {
  const normalizedRuleId = String(ruleId || 'notify').trim() || 'notify';
  const normalizedContext = String(context || 'event').trim().replace(/[^a-zA-Z0-9:_-]+/g, '-');
  return `${normalizedRuleId}:${normalizedContext}:${now.getTime()}`;
}

function marketsUrl(path = '') {
  return `${DEFAULT_MARKETS_API_BASE}${String(path || '').startsWith('/') ? path : `/${path}`}`;
}

async function fetchMarketsJson(env, path, init = {}) {
  const url = marketsUrl(path);
  const request = new Request(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.headers || {})
    }
  });
  const response = env?.MARKETS && typeof env.MARKETS.fetch === 'function'
    ? await env.MARKETS.fetch(request)
    : await fetch(request);

  if (!response.ok) {
    throw new Error(`请求 ${url} 失败：状态 ${response.status}`);
  }

  return response.json();
}

export function getBaseUrl(env) {
  return stripTrailingSlash(env.PUBLIC_DATA_BASE_URL || DEFAULT_PUBLIC_DATA_BASE_URL);
}

export function buildNotificationDetailUrl(env, tab = 'tradePlans', ruleId = '') {
  const url = new URL('/index.html', `${getBaseUrl(env)}/`);
  url.searchParams.set('tab', String(tab || 'tradePlans').trim() || 'tradePlans');

  if (String(ruleId || '').trim()) {
    url.searchParams.set('ruleId', String(ruleId || '').trim());
  }

  return url.toString();
}

function resolveMarketSymbol(symbol = '') {
  const raw = String(symbol || '').trim();
  return BENCHMARK_SYMBOL_MAP[raw] || raw;
}

function isSixDigitFundCode(symbol = '') {
  return /^\d{6}$/.test(String(symbol || '').trim());
}

function isExchangeFundCode(symbol = '') {
  const code = String(symbol || '').trim();
  return isSixDigitFundCode(code) && EXCHANGE_PREFIXES.has(code.slice(0, 2));
}

function normalizeQuoteEntry(symbol, item = {}) {
  const rawSymbol = String(symbol || '').trim();
  const price = Number(item?.price ?? item?.currentPrice ?? item?.close ?? item?.latestNav ?? item?.navBase ?? item?.iopv) || 0;
  const currency = String(item?.currency || '').trim() || (isSixDigitFundCode(rawSymbol) ? '¥' : '$');
  return {
    code: rawSymbol,
    symbol: rawSymbol,
    name: String(item?.name || rawSymbol).trim(),
    currency,
    current_price: price,
    price,
    previous_close: Number(item?.previousClose ?? item?.previousNav) || 0,
    change: Number(item?.change) || 0,
    change_percent: Number(item?.changePercent) || 0,
    date: String(item?.quoteDate || item?.latestNavDate || '').trim(),
    datetime: String(item?.asOf || item?.updatedAt || '').trim(),
    source: String(item?.source || '').trim() || 'markets'
  };
}

export async function loadLatestMarketMap(env, rulesOrSymbols = []) {
  const symbols = new Set();
  for (const item of Array.isArray(rulesOrSymbols) ? rulesOrSymbols : []) {
    if (typeof item === 'string') {
      if (item.trim()) symbols.add(item.trim());
      continue;
    }
    if (item?.symbol) symbols.add(String(item.symbol).trim());
    if (item?.referenceSymbol) symbols.add(String(item.referenceSymbol).trim());
  }
  const list = [...symbols].filter(Boolean);
  if (!list.length) return {};

  const fundCodes = list.filter(isSixDigitFundCode);
  const quoteSymbols = list.filter((symbol) => !isSixDigitFundCode(symbol));
  const map = {};

  if (fundCodes.length) {
    const payload = await fetchMarketsJson(env, '/fund-metrics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codes: fundCodes })
    });
    for (const item of Array.isArray(payload?.items) ? payload.items : []) {
      const code = String(item?.code || '').trim();
      if (code && item?.ok !== false) map[code] = normalizeQuoteEntry(code, item);
    }
  }

  if (quoteSymbols.length) {
    const resolved = quoteSymbols.map(resolveMarketSymbol);
    const payload = await fetchMarketsJson(env, `/quotes?symbols=${encodeURIComponent(resolved.join(','))}`);
    const quotes = payload?.quotes && typeof payload.quotes === 'object' ? payload.quotes : {};
    quoteSymbols.forEach((original, index) => {
      const key = resolved[index];
      const item = quotes[key] || quotes[original] || null;
      if (item && !item.error) map[original] = normalizeQuoteEntry(original, item);
    });
  }

  return map;
}

export function buildStageHighPrice(bars = []) {
  const values = bars
    .flatMap((bar) => [Number(bar?.high) || 0, Number(bar?.close) || 0])
    .filter((value) => Number.isFinite(value) && value > 0);

  return values.length ? Math.max(...values) : 0;
}

export function getLatestBarClose(bars = []) {
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const close = Number(bars[index]?.close);
    if (Number.isFinite(close) && close > 0) {
      return close;
    }
  }
  return 0;
}

export function getCurrency(entry = null) {
  return String(entry?.currency || '').trim() || '¥';
}

export function toDisplayLayers(strategyPlan, ratio = 1) {
  return strategyPlan.layers.map((layer) => {
    const mappedPrice = mapReferencePrice(layer.price, ratio);
    return {
      ...layer,
      price: mappedPrice,
      shares: mappedPrice > 0 ? layer.amount / mappedPrice : 0
    };
  });
}

export function resolveDeepestTriggeredLayer(layers = [], currentPrice = 0) {
  const completed = layers.filter((layer) => currentPrice > 0 && currentPrice <= layer.price);
  return completed.length ? completed[completed.length - 1] : null;
}

function shiftIsoDateDays(isoDate, deltaDays) {
  const parts = String(isoDate || '').split('-').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return '';
  const ref = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  ref.setUTCDate(ref.getUTCDate() + deltaDays);
  return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}-${String(ref.getUTCDate()).padStart(2, '0')}`;
}

function todayShanghaiIsoDate() {
  try {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

function marketCandleToDailyBar(candle = {}, timeZone = 'America/New_York') {
  const t = Number(candle?.t);
  const close = Number(candle?.c);
  if (!Number.isFinite(t) || !Number.isFinite(close) || close <= 0) return null;
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(t * 1000));
  return {
    date,
    open: Number(candle?.o) || close,
    high: Number(candle?.h) || close,
    low: Number(candle?.l) || close,
    close,
    volume: Number(candle?.v) || 0
  };
}

async function loadDanjuanDailyBars(env, cache, code) {
  const today = todayShanghaiIsoDate();
  const from = shiftIsoDateDays(today, -900);
  const cacheKey = `danjuan:${code}:${from}:${today}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const result = await fetchFundNavHistoryWithMonthlyKv(code, from, today, env, { today, ttlMs: 24 * 60 * 60 * 1000 });
  const bars = (Array.isArray(result?.items) ? result.items : []).map((item) => {
    const nav = Number(item?.nav);
    if (!item?.date || !Number.isFinite(nav) || nav <= 0) return null;
    return { date: item.date, open: nav, high: nav, low: nav, close: nav, volume: 0 };
  }).filter(Boolean);
  cache.set(cacheKey, bars);
  return bars;
}

async function loadDailyBars(env, cache, code) {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) {
    return [];
  }

  if (cache.has(normalizedCode)) {
    return cache.get(normalizedCode);
  }

  if (isSixDigitFundCode(normalizedCode) && !isExchangeFundCode(normalizedCode)) {
    const bars = await loadDanjuanDailyBars(env, cache, normalizedCode);
    cache.set(normalizedCode, bars);
    return bars;
  }

  const symbol = resolveMarketSymbol(normalizedCode);
  const payload = await fetchMarketsJson(env, `/kline/${encodeURIComponent(symbol)}?tf=1d`);
  const timeZone = payload?.market === 'cn' ? 'Asia/Shanghai' : 'America/New_York';
  const bars = (Array.isArray(payload?.candles) ? payload.candles : [])
    .map((candle) => marketCandleToDailyBar(candle, timeZone))
    .filter(Boolean);
  cache.set(normalizedCode, bars);
  return bars;
}

export function buildPlanNotification(rule, evaluation, env, options = {}) {
  const layer = evaluation.deepestTriggeredLayer;
  const displayName = rule.planName || `${rule.symbol} 建仓计划`;
  const currency = String(evaluation.currency || '¥').trim() || '¥';
  const stageHighPrice = Number(evaluation.stageHighPrice) || 0;
  const currentPrice = Number(evaluation.currentPrice) || 0;
  const fallbackDrawdown = Math.max(Number(layer?.drawdown) || 0, 0);
  const actualDrawdown = stageHighPrice > 0 && currentPrice > 0 && currentPrice < stageHighPrice
    ? (1 - currentPrice / stageHighPrice) * 100
    : fallbackDrawdown;
  const drawdownLabel = formatPercent(actualDrawdown || fallbackDrawdown, 1);
  const stageOrder = Math.max(Number(layer?.order) || 0, 1);
  const purchaseAmount = formatAmount(layer?.amount, currency);
  const currentPriceLabel = formatPrice(currentPrice, currency);
  const triggerPriceLabel = formatPrice(layer?.price, currency);
  const triggerCondition = `${rule.symbol} 已下跌 ${drawdownLabel}，当前价 ${currentPriceLabel}，触发第 ${stageOrder} 档买入（触发价 ${triggerPriceLabel}）`;

  return {
    eventId: String(options.eventId || '').trim() || buildNotificationEventId(rule.ruleId, `stage-${stageOrder}`),
    eventType: 'plan-trigger',
    ruleId: rule.ruleId,
    symbol: rule.symbol,
    strategyName: displayName,
    triggerCondition,
    purchaseAmount,
    detailUrl: buildNotificationDetailUrl(env, 'tradePlans', rule.ruleId),
    title: '交易计划提醒',
    body: `已触发「${displayName}」的购买条件${purchaseAmount ? `，建议买入 ${purchaseAmount}` : ''}。请到网站查看更详细的策略说明。`,
    summary: `${displayName} 触发第 ${stageOrder} 档买入`
  };
}

export function buildDcaNotification(rule, localDateLabel, env, options = {}) {
  const isFirstExecution = Boolean(options.isFirstExecution);
  const strategyName = rule.linkedPlanName || `${rule.symbol} 定投计划`;
  const purchaseAmount = formatAmount(
    isFirstExecution ? rule.firstExecutionAmount : rule.recurringInvestment,
    '¥'
  );
  const triggerCondition = isFirstExecution
    ? `已到达您设定的${rule.frequency}定投日（${localDateLabel}），首次执行将按「${strategyName}」的首档金额提醒`
    : `已到达您设定的${rule.frequency}定投日（${localDateLabel}）`;

  return {
    eventId: String(options.eventId || '').trim() || buildNotificationEventId(rule.ruleId, localDateLabel),
    eventType: 'dca-schedule',
    ruleId: rule.ruleId,
    symbol: rule.symbol,
    strategyName,
    triggerCondition,
    purchaseAmount,
    detailUrl: buildNotificationDetailUrl(env, 'dca', rule.ruleId),
    title: '定投计划提醒',
    body: `${strategyName} 已进入本期执行窗口${purchaseAmount ? `，建议投入 ${purchaseAmount}` : ''}。请到网站查看更详细的策略说明。`,
    summary: `${strategyName} 定投执行日`
  };
}

export function getLocalDateParts(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  });
  const parts = formatter.formatToParts(date).reduce((map, part) => {
    map[part.type] = part.value;
    return map;
  }, {});

  return {
    year: Number(parts.year) || 0,
    month: Number(parts.month) || 0,
    day: Number(parts.day) || 0,
    weekday: String(parts.weekday || '')
  };
}

function resolveWeekdayNumber(weekday = '') {
  switch (weekday) {
    case 'Mon':
      return 1;
    case 'Tue':
      return 2;
    case 'Wed':
      return 3;
    case 'Thu':
      return 4;
    case 'Fri':
      return 5;
    case 'Sat':
      return 6;
    case 'Sun':
      return 7;
    default:
      return 0;
  }
}

export function resolveDcaWindow(rule, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = getLocalDateParts(now, timeZone);
  const localDateLabel = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const executionDay = Math.max(Number(rule.executionDay) || 1, 1);

  switch (rule.frequency) {
    case '每日':
      return {
        due: true,
        windowKey: localDateLabel,
        localDateLabel
      };
    case '每周': {
      const due = resolveWeekdayNumber(parts.weekday) === Math.min(executionDay, 7);
      return {
        due,
        windowKey: localDateLabel,
        localDateLabel
      };
    }
    case '每季': {
      const quarter = Math.floor((Math.max(parts.month, 1) - 1) / 3) + 1;
      // cron 只在工作日执行；若执行日落在周末，使用 day >= executionDay 让随后的工作日补上。
      // 季度内重复触发已由调用方 lastHandledWindowKey === windowKey 阻止。
      const daysInMonth = new Date(Date.UTC(parts.year, Math.max(parts.month, 1), 0)).getUTCDate();
      const targetDay = Math.min(Math.max(executionDay, 1), daysInMonth);
      const due = [1, 4, 7, 10].includes(parts.month) && parts.day >= targetDay;
      return {
        due,
        windowKey: `${parts.year}-Q${quarter}`,
        localDateLabel
      };
    }
    case '每月':
    default: {
      // cron 只在工作日执行；若执行日落在周末，使用 day >= executionDay 让随后的工作日补上。
      // 同月重复触发已由调用方 lastHandledWindowKey === windowKey 阻止；
      // 同时 clamp 到当月最大天数，避免 2 月 30/31 日永远不到。
      const daysInMonth = new Date(Date.UTC(parts.year, Math.max(parts.month, 1), 0)).getUTCDate();
      const targetDay = Math.min(Math.max(executionDay, 1), daysInMonth);
      return {
        due: parts.day >= targetDay,
        windowKey: `${parts.year}-${String(parts.month).padStart(2, '0')}`,
        localDateLabel
      };
    }
  }
}

export async function evaluatePlanRule(rule, env, latestMarketMap, dailyCache) {
  const selectedEntry = latestMarketMap[rule.symbol] || null;
  const benchmarkEntry = latestMarketMap[rule.referenceSymbol] || selectedEntry || null;
  const benchmarkBars = await loadDailyBars(env, dailyCache, rule.referenceSymbol);

  const fallbackBenchmarkClose = getLatestBarClose(benchmarkBars);
  let currentFundPrice = Number(selectedEntry?.current_price) || 0;
  let currentBenchmarkPrice = Number(benchmarkEntry?.current_price) || 0;
  if (!(currentBenchmarkPrice > 0)) {
    currentBenchmarkPrice = fallbackBenchmarkClose;
  }
  if (!(currentFundPrice > 0)) {
    if (rule.symbol === rule.referenceSymbol) {
      currentFundPrice = currentBenchmarkPrice;
    } else {
      const selectedBars = await loadDailyBars(env, dailyCache, rule.symbol);
      currentFundPrice = getLatestBarClose(selectedBars);
    }
  }
  if (!(currentBenchmarkPrice > 0)) {
    currentBenchmarkPrice = currentFundPrice;
  }
  const dailyMa120 = findLatestFiniteValue(
    buildMovingAverageValues(benchmarkBars, 120, { allowPartial: benchmarkBars.length > 0 && benchmarkBars.length < 120 })
  );
  const dailyMa200 = findLatestFiniteValue(
    buildMovingAverageValues(benchmarkBars, 200, { allowPartial: benchmarkBars.length > 0 && benchmarkBars.length < 200 })
  );
  const stageHighPrice = buildStageHighPrice(benchmarkBars);
  const strategyTriggerPrice = Number.isFinite(dailyMa120)
    ? dailyMa120
    : Number.isFinite(dailyMa200)
      ? dailyMa200
      : currentBenchmarkPrice > 0
        ? currentBenchmarkPrice
        : Number(rule.basePrice) || 0;
  const riskControlPrice = Number.isFinite(dailyMa200)
    ? dailyMa200
    : strategyTriggerPrice > 0
      ? strategyTriggerPrice * 0.85
      : Number(rule.riskControlPrice) || 0;
  const strategyPlan = rule.selectedStrategy === 'peak-drawdown'
    ? buildPeakDrawdownStrategyPlan({
        totalBudget: rule.totalBudget,
        cashReservePct: rule.cashReservePct,
        peakPrice: stageHighPrice,
        fallbackPrice: currentBenchmarkPrice || Number(rule.basePrice) || 0
      })
    : buildNasdaqStrategyPlan({
        totalBudget: rule.totalBudget,
        cashReservePct: rule.cashReservePct,
        ma120: strategyTriggerPrice,
        ma200: riskControlPrice,
        fallbackPrice: currentBenchmarkPrice || Number(rule.basePrice) || 0
      });
  const shouldMapPrices = rule.symbol !== rule.referenceSymbol && currentFundPrice > 0 && currentBenchmarkPrice > 0;
  const strategyPriceRatio = shouldMapPrices ? currentFundPrice / currentBenchmarkPrice : 1;
  const displayLayers = toDisplayLayers(strategyPlan, strategyPriceRatio);
  const displayCurrentPrice = shouldMapPrices ? currentFundPrice : currentBenchmarkPrice;
  const deepestTriggeredLayer = resolveDeepestTriggeredLayer(displayLayers, displayCurrentPrice);

  return {
    currency: getCurrency(shouldMapPrices ? selectedEntry : benchmarkEntry),
    currentPrice: roundPrice(displayCurrentPrice),
    deepestTriggeredLayer,
    nextTriggerLayer: displayLayers.find((layer) => displayCurrentPrice > layer.price) || null,
    triggerPrice: roundPrice(mapReferencePrice(strategyTriggerPrice, strategyPriceRatio)),
    riskControlPrice: roundPrice(mapReferencePrice(riskControlPrice, strategyPriceRatio)),
    stageHighPrice: roundPrice(mapReferencePrice(stageHighPrice, strategyPriceRatio))
  };
}
