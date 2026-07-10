import { compileNotifyRules } from './rules.js';
import {
  MAX_RECENT_EVENTS,
  buildChannelRemovalEvent,
  deliverNotification,
  updateDeliveryFailures
} from './deliveryEngine.js';
import {
  buildNotificationDetailAction,
  buildDcaNotification,
  buildNotificationEventId,
  buildPlanNotification,
  evaluatePlanRule,
  loadLatestMarketMap,
  resolveDcaWindow
} from './notificationRuleEvaluation.js';
import { evaluateMarketAlertRules, evaluateHoldingAlertRules } from './alertRuleEvaluation.js';
export { evaluatePositionDigest } from './positionDigestEvaluator.js';

const DEFAULT_TIMEZONE = 'Asia/Shanghai';

function appendEvent(recentEvents = [], event) {
  return [event, ...recentEvents].slice(0, MAX_RECENT_EVENTS);
}

function getDeliveryFailures(state = {}) {
  return typeof state?.deliveryFailures === 'object' && state.deliveryFailures ? state.deliveryFailures : {};
}

function isConfirmedDeliveryResult(result = {}) {
  const channel = String(result?.channel || '').trim();
  const status = String(result?.status || '').trim();
  return status === 'delivered' || (channel === 'pc' && status === 'queued');
}

function splitMarketAlertRulesByVenue(rules = []) {
  return (Array.isArray(rules) ? rules : []).reduce((groups, rule) => {
    const kind = String(rule?.fundKind || '').trim().toLowerCase();
    const venue = kind === 'otc' || kind === 'qdii' ? 'otc' : 'exchange';
    groups[venue].push(rule);
    return groups;
  }, { exchange: [], otc: [] });
}

// PR 2b尾巴：worker 侧 VIX 跨阈值检测 + 24h 同级防抖。
// 客户端在 sync payload 中附带 vix: { value, level, levelLabel, thresholds }。
// 这里仅在「区间变动」时推送；same-level + 24h 内不重推。
export const VIX_LEVEL_RANK = Object.freeze({
  calm: 0,
  watch: 1,
  buy_index: 2,
  buy_all: 3,
  heavy_buy: 4,
});

export const VIX_SAME_LEVEL_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

function vixLevelLabel(level) {
  switch (String(level || '').trim()) {
    case 'watch': return '关注（≥25）';
    case 'buy_index': return '买指数（≥30）';
    case 'buy_all': return '全面买入（≥40）';
    case 'heavy_buy': return '重仓加码（≥50）';
    default: return '平静（<25）';
  }
}

export async function evaluateVixSignal(env, vixDigest, options = {}) {
  const { clientId = '', settings = {}, readState, writeState } = options;
  if (!vixDigest || typeof vixDigest !== 'object') return { skipped: 'no-digest' };
  const value = Number(vixDigest.value);
  const level = String(vixDigest.level || 'calm').trim();
  if (!Number.isFinite(value)) return { skipped: 'invalid-value' };
  if (!Object.prototype.hasOwnProperty.call(VIX_LEVEL_RANK, level)) {
    return { skipped: 'unknown-level', level };
  }

  const prev = (typeof readState === 'function' ? (await readState()) : null) || {};
  const prevPushedLevel = String(prev.lastPushedLevel || '').trim();
  const prevPushedAt = Number(prev.lastPushedAt) || 0;
  const now = Date.now();

  if (prevPushedLevel === level) {
    if (now - prevPushedAt < VIX_SAME_LEVEL_DEBOUNCE_MS) {
      return { skipped: 'debounced-same-level', level, value, prevLevel: prevPushedLevel };
    }
    return { skipped: 'same-level', level, value, prevLevel: prevPushedLevel };
  }

  env.__notifySettings = settings;
  env.__notifyCurrentClientId = clientId;
  const direction = (VIX_LEVEL_RANK[level] ?? 0) > (VIX_LEVEL_RANK[prevPushedLevel] ?? -1) ? '↑' : '↓';
  const fromLabel = vixLevelLabel(prevPushedLevel || 'calm');
  const toLabel = vixLevelLabel(level);
  const title = `VIX ${direction} ${toLabel}`;
  const body = `当前 VIX ${value.toFixed(2)}，${fromLabel} → ${toLabel} → 点此查看策略详情。`;
  const body_md = [
    '**VIX 跨阈值提醒**',
    '',
    `- 当前值：**${value.toFixed(2)}**`,
    `- 区间变动：${fromLabel} → **${toLabel}**`,
    '- 操作：参考策略按对应层级买入。',
  ].join('\n');
  const action = buildNotificationDetailAction(env, 'tradePlans', 'vix-signal', {
    trigger: 'vix-signal',
    code: 'VIX'
  });
  const notification = {
    eventId: buildNotificationEventId(`vix:level:${level}`, `cross:${prevPushedLevel || 'calm'}->${level}`, new Date(now)),
    eventType: 'vix-signal',
    ruleId: `vix:level:${level}`,
    title,
    body,
    body_md,
    summary: title,
    symbol: 'VIX',
    detailUrl: action.detailUrl,
    url: action.url,
    links: action.links,
    target: action.target,
    params: action.params,
  };

  let delivery = null;
  try {
    delivery = await deliverNotification(env, notification);
  } catch (error) {
    return { skipped: 'delivery-error', detail: error instanceof Error ? error.message : String(error) };
  }

  if (typeof writeState === 'function') {
    await writeState({
      lastPushedLevel: level,
      lastPushedAt: now,
      lastPushedValue: value,
      lastSeenLevel: level,
      lastSeenValue: value,
      lastSeenAt: now,
    });
  }

  return {
    delivered: true,
    level,
    prevLevel: prevPushedLevel,
    value,
    results: delivery?.results || [],
  };
}

// PR 1.5尾巴：worker 侧 sell_layer 提醒。
// 客户端传 sellPlans: [{ id, symbol, holdingCost, holdingShares, gainTriggers:[15,25,35], sellRatios:[33,33,34], currentPrice }]。
// 判定：gainPct = (currentPrice - holdingCost) / holdingCost * 100；
// 递升匹配 gainTriggers 中已越线的最高档。仅在「跨档」时推；same-tier 且 24h 内不重推。
export const SELL_TIER_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

function pickSellTier(gainPct, gainTriggers) {
  if (!Array.isArray(gainTriggers) || !Number.isFinite(gainPct)) return -1;
  let tier = -1;
  for (let i = 0; i < gainTriggers.length; i += 1) {
    const t = Number(gainTriggers[i]);
    if (Number.isFinite(t) && gainPct >= t) tier = i;
  }
  return tier;
}

export async function evaluateSellPlanSignals(env, sellPlans, options = {}) {
  const { clientId = '', settings = {}, readState, writeState } = options;
  if (!Array.isArray(sellPlans) || !sellPlans.length) return { skipped: 'no-plans' };

  const prev = (typeof readState === 'function' ? (await readState()) : null) || {};
  const next = { ...prev };
  const now = Date.now();
  const delivered = [];
  const skipped = [];

  for (const plan of sellPlans) {
    if (!plan || typeof plan !== 'object') continue;
    const id = String(plan.id || '').trim();
    const symbol = String(plan.symbol || '').trim().toUpperCase();
    const holdingCost = Number(plan.holdingCost);
    const currentPrice = Number(plan.currentPrice);
    if (!id || !symbol) { skipped.push({ id, reason: 'missing-id-or-symbol' }); continue; }
    if (!Number.isFinite(holdingCost) || holdingCost <= 0) { skipped.push({ id, reason: 'invalid-cost' }); continue; }
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) { skipped.push({ id, reason: 'no-price' }); continue; }

    const gainPct = ((currentPrice - holdingCost) / holdingCost) * 100;
    const tier = pickSellTier(gainPct, plan.gainTriggers);
    if (tier < 0) { skipped.push({ id, reason: 'below-first-trigger', gainPct }); continue; }

    const state = prev[id] || {};
    const prevTier = Number.isFinite(Number(state.lastPushedTier)) ? Number(state.lastPushedTier) : -1;
    const prevAt = Number(state.lastPushedAt) || 0;
    if (prevTier === tier && now - prevAt < SELL_TIER_DEBOUNCE_MS) {
      skipped.push({ id, reason: 'debounced-same-tier', tier, gainPct });
      continue;
    }
    if (prevTier >= tier) {
      skipped.push({ id, reason: 'not-crossing-up', tier, prevTier, gainPct });
      continue;
    }

    const triggerPct = Number(plan.gainTriggers?.[tier]) || 0;
    const ratioPct = Number(plan.sellRatios?.[tier]) || 0;
    const sharesToSell = Number.isFinite(Number(plan.holdingShares))
      ? Math.floor((Number(plan.holdingShares) * ratioPct) / 100)
      : null;
    const title = `${symbol} 盈利↑ 卖 ${ratioPct.toFixed(0)}%（第 ${tier + 1} 档）`;
    const body = `${symbol} 当前 ${currentPrice.toFixed(2)}，盈利 ${gainPct.toFixed(2)}% 越线 ${triggerPct.toFixed(0)}%；计划卖出 ${ratioPct.toFixed(0)}%${sharesToSell ? `（约 ${sharesToSell} 股）` : ''} → 点此查看卖出策略。`;
    const body_md = [
      `**${symbol} 卖出信号—第 ${tier + 1} 档触发**`,
      '',
      `- 成本：${holdingCost.toFixed(2)}`,
      `- 当前价：**${currentPrice.toFixed(2)}**`,
      `- 盈利：**${gainPct.toFixed(2)}%** (越线 ${triggerPct.toFixed(0)}%)`,
      `- 计划卖出比例：**${ratioPct.toFixed(0)}%**${sharesToSell ? `（约 ${sharesToSell} 股）` : ''}`,
    ].join('\n');
    const action = buildNotificationDetailAction(env, 'tradePlans', `sell:${id}`, {
      code: symbol,
      trigger: 'sell-signal'
    });

    env.__notifySettings = settings;
    env.__notifyCurrentClientId = clientId;
    const notification = {
      eventId: buildNotificationEventId(`sell:${id}:tier:${tier}`, `cross:${prevTier}->${tier}`, new Date(now)),
      eventType: 'sell-signal',
      ruleId: `sell:plan:${id}:tier:${tier}`,
      title,
      body,
      body_md,
      summary: title,
      symbol,
      detailUrl: action.detailUrl,
      url: action.url,
      links: action.links,
      target: action.target,
      params: action.params,
    };
    try {
      const result = await deliverNotification(env, notification);
      delivered.push({ id, symbol, tier, gainPct, results: result?.results || [] });
      next[id] = { lastPushedTier: tier, lastPushedAt: now, lastPushedGainPct: gainPct };
    } catch (error) {
      skipped.push({ id, reason: 'delivery-error', detail: error instanceof Error ? error.message : String(error) });
    }
  }

  if (typeof writeState === 'function' && delivered.length) {
    await writeState(next);
  }

  return { delivered, skipped };
}

export async function runNotificationCycle(env, payload = {}, storedState = {}, { reason = 'scheduled', testPayload = null, targetChannels = null } = {}) {
  const nextState = {
    ruleStates: typeof storedState?.ruleStates === 'object' && storedState.ruleStates ? storedState.ruleStates : {},
    deliveryFailures: getDeliveryFailures(storedState),
    deliveryAcks: typeof storedState?.deliveryAcks === 'object' && storedState.deliveryAcks ? storedState.deliveryAcks : {},
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
      limitGcmRegistrations: 1,
      targetChannels
    });
    const failureUpdate = updateDeliveryFailures(nextState.deliveryFailures, delivery.results, new Date().toISOString());
    nextState.deliveryFailures = failureUpdate.nextFailures;
    const event = {
      id: String(testPayload.eventId || '').trim() || `test-${Date.now()}`,
      eventType: String(testPayload.eventType || 'test').trim() || 'test',
      ruleId: String(testPayload.ruleId || 'test'),
      title: testPayload.title,
      body: testPayload.body,
      body_md: String(testPayload.body_md || ''),
      summary: String(testPayload.summary || '测试通知'),
      symbol: String(testPayload.symbol || '').trim(),
      strategyName: String(testPayload.strategyName || '').trim(),
      triggerCondition: String(testPayload.triggerCondition || '').trim(),
      purchaseAmount: String(testPayload.purchaseAmount || '').trim(),
      detailUrl: String(testPayload.detailUrl || testPayload.url || '').trim(),
      links: testPayload.links || null,
      target: String(testPayload.target || '').trim(),
      params: testPayload.params || null,
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
        deliveredCount: delivery.results.filter(isConfirmedDeliveryResult).length,
        events: [event, ...removalEvents]
      },
      settingsRemovals
    };
  }

  const compiled = compileNotifyRules(payload);
  const latestMarketMap = compiled.planRules.length ? await loadLatestMarketMap(env, compiled.planRules) : {};
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
        body_md: notification.body_md || '',
        summary: notification.summary,
        symbol: notification.symbol,
        strategyName: notification.strategyName,
        triggerCondition: notification.triggerCondition,
        purchaseAmount: notification.purchaseAmount,
        detailUrl: notification.detailUrl,
        links: notification.links || null,
        target: notification.target || '',
        params: notification.params || null,
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
      body_md: notification.body_md || '',
      summary: notification.summary,
      symbol: notification.symbol,
      strategyName: notification.strategyName,
      triggerCondition: notification.triggerCondition,
      purchaseAmount: notification.purchaseAmount,
      detailUrl: notification.detailUrl,
      links: notification.links || null,
      target: notification.target || '',
      params: notification.params || null,
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

  if (compiled.marketAlertRules?.length) {
    const groupedMarketAlerts = splitMarketAlertRulesByVenue(compiled.marketAlertRules);
    for (const [venue, venueRules] of Object.entries(groupedMarketAlerts)) {
      if (!venueRules.length) continue;
      const marketAlertStateKey = `${env.__notifyCurrentClientId}:market-alerts:${venue}`;
      const marketAlertResult = await evaluateMarketAlertRules(env, venueRules, {
        clientId: env.__notifyCurrentClientId,
        settings: env.__notifySettings,
        readState: async () => nextState.ruleStates[marketAlertStateKey] || {},
        writeState: async (data) => { nextState.ruleStates[marketAlertStateKey] = data; },
        now
      });

      for (const item of marketAlertResult.delivered || []) {
        const action = buildNotificationDetailAction(env, 'markets', '', {
          code: item.symbol,
          trigger: 'market-alert',
          ruleId: item.ruleId
        });
        const event = {
          id: `market-alert:${item.symbol}:${now.toISOString()}`,
          eventType: 'market-alert',
          ruleId: item.ruleId,
          title: `${item.symbol} 市场预警`,
          body: `触发值: ${item.actualValue.toFixed(2)}%`,
          body_md: '',
          summary: `${item.symbol} 市场预警`,
          symbol: item.symbol,
          strategyName: '',
          triggerCondition: '',
          purchaseAmount: '',
          detailUrl: action.detailUrl,
          links: action.links,
          target: action.target,
          params: action.params,
          status: 'delivered',
          channels: item.results,
          createdAt: now.toISOString(),
          reason
        };
        events.push(event);
        recentEvents = appendEvent(recentEvents, event);
      }
    }
  }

  if (compiled.holdingAlertRules?.length) {
    const holdingAlertStateKey = `${env.__notifyCurrentClientId}:holding-alerts`;
    const holdingAlertResult = await evaluateHoldingAlertRules(env, compiled.holdingAlertRules, {
      clientId: env.__notifyCurrentClientId,
      settings: env.__notifySettings,
      readState: async () => nextState.ruleStates[holdingAlertStateKey] || {},
      writeState: async (data) => { nextState.ruleStates[holdingAlertStateKey] = data; }
    });

    for (const item of holdingAlertResult.delivered || []) {
      const action = buildNotificationDetailAction(env, 'holdings', '', {
        code: item.symbol,
        trigger: 'holding-alert',
        ruleId: item.ruleId
      });
      const event = {
        id: `holding-alert:${item.symbol}:${now.toISOString()}`,
        eventType: 'holding-alert',
        ruleId: item.ruleId,
        title: `${item.symbol} 持仓预警`,
        body: `触发值: ${item.actualValue.toFixed(2)}%`,
        body_md: '',
        summary: `${item.symbol} 持仓预警`,
        symbol: item.symbol,
        strategyName: '',
        triggerCondition: '',
        purchaseAmount: '',
        detailUrl: action.detailUrl,
        links: action.links,
        target: action.target,
        params: action.params,
        status: 'delivered',
        channels: item.results,
        createdAt: now.toISOString(),
        reason
      };
      events.push(event);
      recentEvents = appendEvent(recentEvents, event);
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
