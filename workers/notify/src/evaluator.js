import { buildMovingAverageValues, buildNasdaqStrategyPlan, buildPeakDrawdownStrategyPlan, findLatestFiniteValue, mapReferencePrice } from '../../../src/app/strategyEngine.js';
import { compileNotifyRules } from './rules.js';
import { sendBarkNotification } from './channels/bark.js';
import { sendGotifyNotification } from './channels/gotify.js';

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

function stripTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
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

function buildPlanNotification(rule, evaluation) {
  const layer = evaluation.deepestTriggeredLayer;
  const displayName = rule.planName || `${rule.symbol} 建仓计划`;
  const currency = evaluation.currency;
  const layerLabel = layer ? `第 ${layer.order} 档` : '建仓区';
  const triggerPrice = layer ? formatPrice(layer.price, currency) : '--';

  return {
    ruleId: rule.ruleId,
    title: '交易计划提醒',
    body: `${displayName} 已进入${layerLabel}，参考买入价 ${triggerPrice}，按计划分批执行。`,
    summary: `${displayName} ${layerLabel}`
  };
}

function buildDcaNotification(rule, localDateLabel) {
  const amountText = Number(rule.recurringInvestment) > 0 ? `，计划金额 ¥${Number(rule.recurringInvestment).toFixed(2)}` : '';
  return {
    ruleId: rule.ruleId,
    title: '定投计划提醒',
    body: `${rule.symbol} 今天是定投执行日（${localDateLabel}）${amountText}。`,
    summary: `${rule.symbol} 定投执行日`
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
      const due = [1, 4, 7, 10].includes(parts.month) && parts.day === executionDay;
      return {
        due,
        windowKey: `${parts.year}-Q${quarter}`,
        localDateLabel
      };
    }
    case '每月':
    default:
      return {
        due: parts.day === executionDay,
        windowKey: `${parts.year}-${String(parts.month).padStart(2, '0')}`,
        localDateLabel
      };
  }
}

async function deliverNotification(env, notification) {
  const settings = typeof env.__notifySettings === 'object' && env.__notifySettings ? env.__notifySettings : {};
  const results = [];
  const gotifyClients = Array.isArray(settings.gotifyClients) ? settings.gotifyClients : [];
  const barkDeviceKey = String(settings.barkDeviceKey || env.BARK_DEVICE_KEY || '').trim();

  try {
    results.push({
      ...(await sendBarkNotification({
        ...notification,
        deviceKey: barkDeviceKey
      })),
      configKey: 'bark:default',
      configType: 'bark',
      configId: 'default',
      configLabel: 'Bark'
    });
  } catch (error) {
    results.push({
      channel: 'bark',
      status: 'failed',
      detail: error instanceof Error ? error.message : 'Bark 推送失败',
      configKey: 'bark:default',
      configType: 'bark',
      configId: 'default',
      configLabel: 'Bark'
    });
  }

  if (gotifyClients.length) {
    for (const client of gotifyClients) {
      try {
        results.push({
          ...(await sendGotifyNotification({
            ...notification,
            baseUrl: client.baseUrl,
            token: client.token
          })),
          configKey: `gotify-client:${client.id}`,
          configType: 'gotify-client',
          configId: client.id,
          configLabel: client.username || client.id
        });
      } catch (error) {
        results.push({
          channel: 'gotify',
          status: 'failed',
          detail: error instanceof Error ? error.message : 'Gotify 推送失败',
          configKey: `gotify-client:${client.id}`,
          configType: 'gotify-client',
          configId: client.id,
          configLabel: client.username || client.id
        });
      }
    }
  } else {
    try {
      results.push({
        ...(await sendGotifyNotification({
          ...notification,
          baseUrl: settings.gotifyBaseUrl || env.GOTIFY_BASE_URL || '',
          token: settings.gotifyToken || env.GOTIFY_TOKEN || ''
        })),
        configKey: 'gotify:default',
        configType: 'gotify-legacy',
        configId: 'default',
        configLabel: 'Gotify 默认通道'
      });
    } catch (error) {
      results.push({
        channel: 'gotify',
        status: 'failed',
        detail: error instanceof Error ? error.message : 'Gotify 推送失败',
        configKey: 'gotify:default',
        configType: 'gotify-legacy',
        configId: 'default',
        configLabel: 'Gotify 默认通道'
      });
    }
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

  const currentFundPrice = Number(selectedEntry?.current_price) || 0;
  const currentBenchmarkPrice = Number(benchmarkEntry?.current_price) || currentFundPrice;
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
  const channelLabel = String(removal.configLabel || '').trim() || (removal.configType === 'bark'
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
    const delivery = await deliverNotification(env, testPayload);
    const failureUpdate = updateDeliveryFailures(nextState.deliveryFailures, delivery.results, new Date().toISOString());
    nextState.deliveryFailures = failureUpdate.nextFailures;
    const event = {
      id: `test-${Date.now()}`,
      ruleId: 'test',
      title: testPayload.title,
      body: testPayload.body,
      summary: '测试通知',
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

      const notification = buildPlanNotification(rule, evaluation);
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
        id: `${rule.ruleId}:${Date.now()}`,
        ruleId: rule.ruleId,
        title: notification.title,
        body: notification.body,
        summary: notification.summary,
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

    nextState.ruleStates[rule.ruleId] = {
      ...previousState,
      lastEvaluatedAt: now.toISOString(),
      currentWindowKey: window.windowKey
    };

    if (!window.due || previousState.lastHandledWindowKey === window.windowKey) {
      continue;
    }

    const notification = buildDcaNotification(rule, window.localDateLabel);
    const delivery = await deliverNotification(env, notification);
    const failureUpdate = updateDeliveryFailures(nextState.deliveryFailures, delivery.results, now.toISOString());
    nextState.deliveryFailures = failureUpdate.nextFailures;
    nextState.ruleStates[rule.ruleId] = {
      ...nextState.ruleStates[rule.ruleId],
      lastHandledWindowKey: window.windowKey,
      lastHandledAt: now.toISOString(),
      lastHandledStatus: delivery.status
    };
    const event = {
      id: `${rule.ruleId}:${Date.now()}`,
      ruleId: rule.ruleId,
      title: notification.title,
      body: notification.body,
      summary: notification.summary,
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
