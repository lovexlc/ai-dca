import { buildMovingAverageValues, buildNasdaqStrategyPlan, buildPeakDrawdownStrategyPlan, findLatestFiniteValue, mapReferencePrice } from '../../../src/app/strategyEngine.js';

const DEFAULT_PUBLIC_DATA_BASE_URL = 'https://tools.freebacktrack.tech';
const DEFAULT_TIMEZONE = 'Asia/Shanghai';

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

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json'
    }
  });

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

export async function loadLatestMarketMap(env) {
  const payload = await fetchJson(`${getBaseUrl(env)}/data/nasdaq_latest.json`);
  const entries = Array.isArray(payload) ? payload : [];

  return entries.reduce((map, entry) => {
    const code = String(entry?.code || '').trim();
    if (code) {
      map[code] = entry;
    }
    return map;
  }, {});
}

export function buildStageHighPrice(bars = []) {
  const values = bars
    .flatMap((bar) => [Number(bar?.high) || 0, Number(bar?.close) || 0])
    .filter((value) => Number.isFinite(value) && value > 0);

  return values.length ? Math.max(...values) : 0;
}

// nasdaq_latest.json 不可用时，从 daily-sina bars 末尾取最新有效 close 作为当前价格的兑底。
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

async function loadDailyBars(env, cache, code) {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) {
    return [];
  }

  if (cache.has(normalizedCode)) {
    return cache.get(normalizedCode);
  }

  const payload = await fetchJson(`${getBaseUrl(env)}/data/${normalizedCode}/daily-sina.json`);
  const bars = Array.isArray(payload?.bars) ? payload.bars : [];
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

  // 当 nasdaq_latest.json 拉不到 / symbol 不在里面时，回退到 daily-sina 最新 close，
  // 避免 displayCurrentPrice = 0 导致 resolveDeepestTriggeredLayer 永远返回 null。
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
