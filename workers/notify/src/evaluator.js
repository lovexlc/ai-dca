import { buildMovingAverageValues, buildNasdaqStrategyPlan, buildPeakDrawdownStrategyPlan, findLatestFiniteValue, mapReferencePrice } from '../../../src/app/strategyEngine.js';
import { compileNotifyRules } from './rules.js';
import { sendBarkNotification } from './channels/bark.js';
import { isRegistrationPairedToScope, normalizeGcmRegistrations, normalizeNotifyGroupId, resolveGcmProjectId, sendGcmNotification } from './gcm.js';

const DEFAULT_PUBLIC_DATA_BASE_URL = 'https://tools.freebacktrack.tech';
const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const MAX_RECENT_EVENTS = 30;
const MAX_CHANNEL_FAILURES = 10;

function roundPrice(value) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(3)) : 0;
}

function formatPrice(value, currency = '¥') {
  const numericValue = Number(value);
  if (!(numericValue > 0)) {
    return '--';
  }

  const prefix = currency === '$' ? '$' : '¥';
  return `${prefix}${numericValue.toFixed(3)}`;
}

function formatAmount(value, currency = '¥') {
  const numericValue = Number(value);
  if (!(numericValue > 0)) {
    return '';
  }

  const prefix = currency === '$' ? '$' : '¥';
  return `${prefix}${numericValue.toFixed(2)}`;
}

function formatPercent(value, digits = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '--';
  }

  return `${numericValue.toFixed(digits)}%`;
}

function stripTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function buildNotificationEventId(ruleId = '', context = '', now = new Date()) {
  const normalizedRuleId = String(ruleId || 'notify').trim() || 'notify';
  const normalizedContext = String(context || 'event').trim().replace(/[^a-zA-Z0-9:_-]+/g, '-');
  return `${normalizedRuleId}:${normalizedContext}:${now.getTime()}`;
}

function parseIsoTimestamp(value = '') {
  const timestamp = Date.parse(String(value || '').trim());
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function resolveGcmRegistrationPriority(registration = {}, currentClientId = '', currentGroupId = '') {
  const pairedClients = Array.isArray(registration?.pairedClients) ? registration.pairedClients : [];
  const currentClientPair = currentGroupId
    ? pairedClients.find((client) => normalizeNotifyGroupId(client?.groupId || client?.clientId) === currentGroupId) || null
    : currentClientId
      ? pairedClients.find((client) => client.clientId === currentClientId) || null
    : null;

  return Math.max(
    parseIsoTimestamp(currentClientPair?.lastSeenAt),
    parseIsoTimestamp(currentClientPair?.pairedAt),
    parseIsoTimestamp(registration?.updatedAt),
    parseIsoTimestamp(registration?.createdAt)
  );
}

function selectGcmRegistrationsForDelivery(registrations = [], { currentClientId = '', currentGroupId = '', limit = 0 } = {}) {
  if (!(limit > 0) || registrations.length <= limit) {
    return registrations;
  }

  return [...registrations]
    .sort((left, right) => {
      const priorityDiff = resolveGcmRegistrationPriority(right, currentClientId, currentGroupId) - resolveGcmRegistrationPriority(left, currentClientId, currentGroupId);
      if (priorityDiff) {
        return priorityDiff;
      }

      return String(left?.id || '').localeCompare(String(right?.id || ''));
    })
    .slice(0, limit);
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

function getBaseUrl(env) {
  return stripTrailingSlash(env.PUBLIC_DATA_BASE_URL || DEFAULT_PUBLIC_DATA_BASE_URL);
}

function buildNotificationDetailUrl(env, tab = 'tradePlans', ruleId = '') {
  const url = new URL('/index.html', `${getBaseUrl(env)}/`);
  url.searchParams.set('tab', String(tab || 'tradePlans').trim() || 'tradePlans');

  if (String(ruleId || '').trim()) {
    url.searchParams.set('ruleId', String(ruleId || '').trim());
  }

  return url.toString();
}

async function loadLatestMarketMap(env) {
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

function buildStageHighPrice(bars = []) {
  const values = bars
    .flatMap((bar) => [Number(bar?.high) || 0, Number(bar?.close) || 0])
    .filter((value) => Number.isFinite(value) && value > 0);

  return values.length ? Math.max(...values) : 0;
}

// nasdaq_latest.json 不可用时，从 daily-sina bars 末尾取最新有效 close 作为当前价格的兑底。
function getLatestBarClose(bars = []) {
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const close = Number(bars[index]?.close);
    if (Number.isFinite(close) && close > 0) {
      return close;
    }
  }
  return 0;
}

function getCurrency(entry = null) {
  return String(entry?.currency || '').trim() || '¥';
}

function toDisplayLayers(strategyPlan, ratio = 1) {
  return strategyPlan.layers.map((layer) => {
    const mappedPrice = mapReferencePrice(layer.price, ratio);
    return {
      ...layer,
      price: mappedPrice,
      shares: mappedPrice > 0 ? layer.amount / mappedPrice : 0
    };
  });
}

function resolveDeepestTriggeredLayer(layers = [], currentPrice = 0) {
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

function buildPlanNotification(rule, evaluation, env, options = {}) {
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

function buildDcaNotification(rule, localDateLabel, env, options = {}) {
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

function getLocalDateParts(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
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

function resolveDcaWindow(rule, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
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

async function deliverNotification(env, notification, options = {}) {
  const settings = typeof env.__notifySettings === 'object' && env.__notifySettings ? env.__notifySettings : {};
  const results = [];
  const barkDeviceKey = String(settings.barkDeviceKey || '').trim();
  const currentClientId = String(env.__notifyCurrentClientId || '').trim();
  const currentGroupId = normalizeNotifyGroupId(settings.notifyGroupId || currentClientId);
  const currentClientLabel = String(settings.clientLabel || '').trim();
  const barkConfigKey = currentClientId ? `bark-client:${currentClientId}` : 'bark-client:unknown';
  const limitGcmRegistrations = Math.max(Number(options.limitGcmRegistrations) || 0, 0);
  const gcmRegistrations = normalizeGcmRegistrations(settings.gcmRegistrations);
  const selectedGcmRegistrations = gcmRegistrations.filter((registration) => (
    isRegistrationPairedToScope(registration, {
      clientId: currentClientId,
      currentGroupId: currentGroupId || currentClientId
    })
  ));
  const gcmRegistrationsToDeliver = selectGcmRegistrationsForDelivery(selectedGcmRegistrations, {
    currentClientId,
    currentGroupId,
    limit: limitGcmRegistrations
  });

  try {
    results.push({
      ...(await sendBarkNotification({
        ...notification,
        deviceKey: barkDeviceKey
      })),
      configKey: barkConfigKey,
      configType: 'bark-client',
      configId: currentClientId || 'unknown',
      configLabel: currentClientLabel ? `Bark · ${currentClientLabel}` : 'Bark'
    });
  } catch (error) {
    results.push({
      channel: 'bark',
      status: 'failed',
      detail: error instanceof Error ? error.message : 'Bark 推送失败',
      configKey: barkConfigKey,
      configType: 'bark-client',
      configId: currentClientId || 'unknown',
      configLabel: currentClientLabel ? `Bark · ${currentClientLabel}` : 'Bark'
    });
  }

  if (!selectedGcmRegistrations.length) {
    results.push({
      channel: 'gcm',
      status: 'skipped',
      detail: currentGroupId ? '当前共享组还没有绑定 Android 设备' : '还没有已配对的 Android 设备',
      configKey: currentGroupId ? `gcm-group:${currentGroupId}` : 'gcm:paired',
      configType: 'gcm',
      configId: currentGroupId || currentClientId || 'paired',
      configLabel: currentGroupId ? 'Android（当前共享组）' : 'Android'
    });
  } else {
    // FCM fan-out：并发发送给该 client 全部已配对设备。
    // - Workers Paid 套餐对单次 invocation 的 subrequest 上限放到 1000，远高于 Free 的 50，
    //   并发对 fan-out 没有被打回的风险。
    // - 每条 FCM 消息互相独立，单设备失败不应阻塞其他设备 → 用 Promise.allSettled。
    // - 把 projectId 在循环外解析一次，避免每次都重新调 resolveGcmProjectId。
    const projectId = resolveGcmProjectId(settings, env);
    const baseData = {
      eventId: notification.eventId || '',
      eventType: notification.eventType || '',
      ruleId: notification.ruleId || '',
      summary: notification.summary || '',
      symbol: notification.symbol || '',
      strategyName: notification.strategyName || '',
      triggerCondition: notification.triggerCondition || '',
      purchaseAmount: notification.purchaseAmount || '',
      detailUrl: notification.detailUrl || notification.url || '',
      url: notification.url || notification.detailUrl || ''
    };
    const fcmDeliveries = await Promise.allSettled(
      gcmRegistrationsToDeliver.map((registration) =>
        sendGcmNotification({
          env,
          projectId,
          packageName: registration.packageName,
          token: registration.token,
          title: notification.title,
          body: notification.body,
          data: baseData
        })
      )
    );
    fcmDeliveries.forEach((settled, index) => {
      const registration = gcmRegistrationsToDeliver[index];
      const baseMeta = {
        configKey: `gcm-registration:${registration.id}`,
        configType: 'gcm-registration',
        configId: registration.id,
        configLabel: registration.deviceName || 'Android Device'
      };
      if (settled.status === 'fulfilled') {
        results.push({ ...settled.value, ...baseMeta });
      } else {
        const error = settled.reason;
        results.push({
          channel: 'gcm',
          status: 'failed',
          detail: error instanceof Error ? error.message : 'Android 推送失败',
          ...baseMeta
        });
      }
    });
  }

  const deliveredCount = results.filter((result) => result.status === 'delivered').length;
  const configuredCount = results.filter((result) => result.status !== 'skipped').length;

  return {
    results,
    status: deliveredCount > 0 ? 'delivered' : configuredCount > 0 ? 'failed' : 'skipped'
  };
}

async function evaluatePlanRule(rule, env, latestMarketMap, dailyCache) {
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

function appendEvent(recentEvents = [], event) {
  return [event, ...recentEvents].slice(0, MAX_RECENT_EVENTS);
}

function getDeliveryFailures(state = {}) {
  return typeof state?.deliveryFailures === 'object' && state.deliveryFailures ? state.deliveryFailures : {};
}

function buildChannelRemovalEvent(removal, nowIso) {
  const channelLabel = String(removal.configLabel || '').trim() || (removal.configType === 'bark-client'
    ? 'Bark'
    : removal.configType === 'gotify-client'
      ? `Gotify 账号 ${removal.configId || ''}`.trim()
      : 'Gotify 默认通道');

  return {
    id: `channel-removal:${removal.configKey}:${Date.now()}`,
    ruleId: `channel:${removal.configKey}`,
    title: '通知配置已自动移除',
    body: `${channelLabel} 连续推送失败 ${removal.failures} 次，已从通知配置中自动移除。`,
    summary: `${channelLabel} 已移除`,
    status: 'failed',
    channels: [{
      channel: removal.channel,
      status: 'removed',
      detail: removal.detail || '连续失败超过阈值，已自动移除'
    }],
    createdAt: nowIso,
    reason: 'auto-remove-failed-channel'
  };
}

function updateDeliveryFailures(previousFailures, results = [], nowIso) {
  const nextFailures = { ...previousFailures };
  const removals = [];
  const removalMap = new Map();

  for (const result of results) {
    const configKey = String(result?.configKey || '').trim();
    if (!configKey || result?.status === 'skipped') {
      continue;
    }

    if (result.status === 'delivered') {
      delete nextFailures[configKey];
      continue;
    }

    const previous = nextFailures[configKey] || {};
    const nextCount = Math.max(Number(previous.count) || 0, 0) + 1;
    nextFailures[configKey] = {
      configKey,
      configType: String(result.configType || previous.configType || '').trim(),
      configId: String(result.configId || previous.configId || '').trim(),
      configLabel: String(result.configLabel || previous.configLabel || '').trim(),
      channel: String(result.channel || previous.channel || '').trim(),
      count: nextCount,
      lastFailureAt: nowIso,
      detail: String(result.detail || '').trim()
    };

    if (nextCount >= MAX_CHANNEL_FAILURES && !removalMap.has(configKey)) {
      const removal = {
        configKey,
        configType: nextFailures[configKey].configType,
        configId: nextFailures[configKey].configId,
        configLabel: nextFailures[configKey].configLabel,
        channel: nextFailures[configKey].channel,
        failures: nextCount,
        detail: nextFailures[configKey].detail
      };
      removalMap.set(configKey, removal);
      removals.push(removal);
      delete nextFailures[configKey];
    }
  }

  return {
    nextFailures,
    removals
  };
}

export async function runNotificationCycle(env, payload = {}, storedState = {}, { reason = 'scheduled', testPayload = null } = {}) {
  const nextState = {
    ruleStates: typeof storedState?.ruleStates === 'object' && storedState.ruleStates ? storedState.ruleStates : {},
    deliveryFailures: getDeliveryFailures(storedState),
    lastRunAt: new Date().toISOString()
  };
  let recentEvents = Array.isArray(storedState?.recentEvents) ? storedState.recentEvents : [];
  const removalEvents = [];
  const settingsRemovals = [];

  function appendRemoval(removal) {
    if (!settingsRemovals.some((item) => item.configKey === removal.configKey)) {
      settingsRemovals.push(removal);
    }
  }

  if (testPayload) {
    const delivery = await deliverNotification(env, testPayload, {
      limitGcmRegistrations: 1
    });
    const failureUpdate = updateDeliveryFailures(nextState.deliveryFailures, delivery.results, new Date().toISOString());
    nextState.deliveryFailures = failureUpdate.nextFailures;
    const event = {
      id: String(testPayload.eventId || '').trim() || `test-${Date.now()}`,
      eventType: String(testPayload.eventType || 'test').trim() || 'test',
      ruleId: String(testPayload.ruleId || 'test'),
      title: testPayload.title,
      body: testPayload.body,
      summary: String(testPayload.summary || '测试通知'),
      symbol: String(testPayload.symbol || '').trim(),
      strategyName: String(testPayload.strategyName || '').trim(),
      triggerCondition: String(testPayload.triggerCondition || '').trim(),
      purchaseAmount: String(testPayload.purchaseAmount || '').trim(),
      detailUrl: String(testPayload.detailUrl || testPayload.url || '').trim(),
      status: delivery.status,
      channels: delivery.results,
      createdAt: new Date().toISOString(),
      reason
    };
    recentEvents = appendEvent(recentEvents, event);
    for (const removal of failureUpdate.removals) {
      appendRemoval(removal);
      const removalEvent = buildChannelRemovalEvent(removal, new Date().toISOString());
      removalEvents.push(removalEvent);
      recentEvents = appendEvent(recentEvents, removalEvent);
    }

    return {
      state: {
        ...nextState,
        recentEvents
      },
      summary: {
        triggeredCount: 0,
        deliveredCount: delivery.results.filter((result) => result.status === 'delivered').length,
        events: [event, ...removalEvents]
      },
      settingsRemovals
    };
  }

  const compiled = compileNotifyRules(payload);
  const latestMarketMap = compiled.planRules.length ? await loadLatestMarketMap(env) : {};
  const dailyCache = new Map();
  const events = [];
  const now = new Date();
  const timeZone = String(env.NOTIFY_TIMEZONE || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;

  for (const rule of compiled.planRules) {
    const previousState = nextState.ruleStates[rule.ruleId] || {};
    try {
      const evaluation = await evaluatePlanRule(rule, env, latestMarketMap, dailyCache);
      const stageOrder = Number(evaluation.deepestTriggeredLayer?.order) || 0;
      const hasNewTrigger = stageOrder > 0 && (!previousState.isInTriggeredZone || stageOrder > (Number(previousState.lastHandledStage) || 0));

      if (stageOrder <= 0) {
        nextState.ruleStates[rule.ruleId] = {
          ...previousState,
          isInTriggeredZone: false,
          currentStage: 0,
          lastEvaluatedAt: now.toISOString(),
          lastTriggerPrice: evaluation.currentPrice
        };
        continue;
      }

      nextState.ruleStates[rule.ruleId] = {
        ...previousState,
        isInTriggeredZone: true,
        currentStage: stageOrder,
        lastEvaluatedAt: now.toISOString(),
        lastTriggerPrice: evaluation.currentPrice
      };

      if (!hasNewTrigger) {
        continue;
      }

      const notification = buildPlanNotification(rule, evaluation, env, {
        eventId: buildNotificationEventId(rule.ruleId, `stage-${stageOrder}`, now)
      });
      const delivery = await deliverNotification(env, notification);
      const failureUpdate = updateDeliveryFailures(nextState.deliveryFailures, delivery.results, now.toISOString());
      nextState.deliveryFailures = failureUpdate.nextFailures;
      nextState.ruleStates[rule.ruleId] = {
        ...nextState.ruleStates[rule.ruleId],
        lastHandledStage: stageOrder,
        lastHandledAt: now.toISOString(),
        lastHandledStatus: delivery.status
      };
      const event = {
        id: notification.eventId,
        eventType: notification.eventType,
        ruleId: rule.ruleId,
        title: notification.title,
        body: notification.body,
        summary: notification.summary,
        symbol: notification.symbol,
        strategyName: notification.strategyName,
        triggerCondition: notification.triggerCondition,
        purchaseAmount: notification.purchaseAmount,
        detailUrl: notification.detailUrl,
        status: delivery.status,
        channels: delivery.results,
        createdAt: now.toISOString(),
        reason
      };
      events.push(event);
      recentEvents = appendEvent(recentEvents, event);
      for (const removal of failureUpdate.removals) {
        appendRemoval(removal);
        const removalEvent = buildChannelRemovalEvent(removal, now.toISOString());
        events.push(removalEvent);
        removalEvents.push(removalEvent);
        recentEvents = appendEvent(recentEvents, removalEvent);
      }
    } catch (error) {
      nextState.ruleStates[rule.ruleId] = {
        ...previousState,
        lastEvaluatedAt: now.toISOString(),
        lastError: error instanceof Error ? error.message : '价格策略检测失败'
      };
    }
  }

  for (const rule of compiled.dcaRules) {
    const previousState = nextState.ruleStates[rule.ruleId] || {};
    const window = resolveDcaWindow(rule, now, timeZone);
    const isFirstExecution = Boolean(rule.linkedPlanId) && !previousState.firstExecutionHandled;

    nextState.ruleStates[rule.ruleId] = {
      ...previousState,
      lastEvaluatedAt: now.toISOString(),
      currentWindowKey: window.windowKey
    };

    if (!window.due || previousState.lastHandledWindowKey === window.windowKey) {
      continue;
    }

    const notification = buildDcaNotification(rule, window.localDateLabel, env, {
      isFirstExecution,
      eventId: buildNotificationEventId(rule.ruleId, window.windowKey, now)
    });
    const delivery = await deliverNotification(env, notification);
    const failureUpdate = updateDeliveryFailures(nextState.deliveryFailures, delivery.results, now.toISOString());
    nextState.deliveryFailures = failureUpdate.nextFailures;
    nextState.ruleStates[rule.ruleId] = {
      ...nextState.ruleStates[rule.ruleId],
      lastHandledWindowKey: window.windowKey,
      lastHandledAt: now.toISOString(),
      lastHandledStatus: delivery.status,
      firstExecutionHandled: previousState.firstExecutionHandled || isFirstExecution
    };
    const event = {
      id: notification.eventId,
      eventType: notification.eventType,
      ruleId: rule.ruleId,
      title: notification.title,
      body: notification.body,
      summary: notification.summary,
      symbol: notification.symbol,
      strategyName: notification.strategyName,
      triggerCondition: notification.triggerCondition,
      purchaseAmount: notification.purchaseAmount,
      detailUrl: notification.detailUrl,
      status: delivery.status,
      channels: delivery.results,
      createdAt: now.toISOString(),
      reason
    };
    events.push(event);
    recentEvents = appendEvent(recentEvents, event);
    for (const removal of failureUpdate.removals) {
      appendRemoval(removal);
      const removalEvent = buildChannelRemovalEvent(removal, now.toISOString());
      events.push(removalEvent);
      removalEvents.push(removalEvent);
      recentEvents = appendEvent(recentEvents, removalEvent);
    }
  }

  return {
    state: {
      ...nextState,
      recentEvents
    },
    summary: {
      triggeredCount: events.length,
      deliveredCount: events.filter((event) => event.status === 'delivered').length,
      events,
      counts: compiled.summary
    },
    settingsRemovals
  };
}
