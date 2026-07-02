import {
  buildNotificationDetailAction,
  buildNotificationEventId,
  loadLatestMarketMap
} from './notificationRuleEvaluation.js';
import { deliverNotification } from './deliveryEngine.js';

const EXCHANGE_PREFIXES = new Set(['15', '50', '51', '52', '53', '54', '56', '58']);

function getShanghaiParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(now).reduce((map, part) => {
    map[part.type] = part.value;
    return map;
  }, {});
  return {
    weekday: parts.weekday,
    hhmm: Number(`${parts.hour || '00'}${parts.minute || '00'}`)
  };
}

function isChinaExchangeTradingSession(now = new Date()) {
  const { weekday, hhmm } = getShanghaiParts(now);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return (hhmm >= 930 && hhmm <= 1130) || (hhmm >= 1300 && hhmm <= 1500);
}

function resolveRuleFundKind(rule = {}) {
  const explicit = String(rule.fundKind || rule.kind || '').trim().toLowerCase();
  if (explicit === 'exchange' || explicit === 'otc' || explicit === 'qdii') return explicit;
  const symbol = String(rule.symbol || '').trim();
  return /^\d{6}$/.test(symbol) && EXCHANGE_PREFIXES.has(symbol.slice(0, 2)) ? 'exchange' : '';
}

function isPremiumAlert(rule = {}) {
  return rule.alertType === 'premium' || rule.alertType === 'premium-below';
}

export async function evaluateMarketAlertRules(env, rules, options = {}) {
  const { clientId = '', settings = {}, readState, writeState, now = new Date() } = options;
  if (!Array.isArray(rules) || !rules.length) return { skipped: 'no-rules' };

  const exchangeTrading = isChinaExchangeTradingSession(now);
  const runnableRules = [];
  const preSkipped = [];

  for (const rule of rules) {
    const fundKind = resolveRuleFundKind(rule);
    if (fundKind === 'exchange' && !exchangeTrading) {
      preSkipped.push({ ruleId: rule.ruleId, reason: 'exchange-market-closed' });
      continue;
    }
    if ((fundKind === 'otc' || fundKind === 'qdii') && isPremiumAlert(rule)) {
      preSkipped.push({ ruleId: rule.ruleId, reason: 'premium-unavailable-for-otc' });
      continue;
    }
    runnableRules.push({ ...rule, fundKind });
  }

  if (!runnableRules.length) return { delivered: [], skipped: preSkipped };

  const latestMarketMap = await loadLatestMarketMap(env, runnableRules.map(r => ({ symbol: r.symbol, fundKind: r.fundKind })), { forceRefresh: true });

  const prev = (typeof readState === 'function' ? (await readState()) : null) || {};
  const next = { ...prev };
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const delivered = [];
  const skipped = [...preSkipped];

  for (const rule of runnableRules) {
    const symbol = String(rule.symbol || '').trim();
    if (!symbol) continue;

    const marketEntry = latestMarketMap[symbol];
    if (!marketEntry) {
      skipped.push({ ruleId: rule.ruleId, reason: 'no-market-data' });
      continue;
    }

    const currentPrice = Number(marketEntry.current_price) || 0;
    const previousClose = Number(marketEntry.previous_close) || 0;

    if (currentPrice <= 0 || previousClose <= 0) {
      skipped.push({ ruleId: rule.ruleId, reason: 'invalid-price' });
      continue;
    }

    // 计算涨跌幅基准
    let basePrice = previousClose; // 默认是前一交易日收盘价（daily）
    if (rule.priceBase === 'alert-day' && rule.alertDayPrice) {
      basePrice = Number(rule.alertDayPrice);
    } else if (rule.priceBase === 'alert-day' && !rule.alertDayPrice) {
      // 首次触发，记录基准价格
      rule.alertDayPrice = previousClose;
      basePrice = previousClose;
    }

    const changePct = ((currentPrice - basePrice) / basePrice) * 100;
    const rawPremiumRate = Number(marketEntry.premium_rate ?? marketEntry.premiumPercent);
    const premiumRate = Number.isFinite(rawPremiumRate) ? rawPremiumRate : null;

    let triggered = false;
    let actualValue = 0;
    let valueLabel = '';

    switch (rule.alertType) {
      case 'gain':
        actualValue = changePct;
        triggered = changePct >= rule.threshold;
        valueLabel = `涨幅 ${changePct.toFixed(2)}%`;
        break;
      case 'loss':
        actualValue = -changePct;
        triggered = changePct <= -rule.threshold;
        valueLabel = `跌幅 ${Math.abs(changePct).toFixed(2)}%`;
        break;
      case 'premium':
        if (premiumRate === null) {
          skipped.push({ ruleId: rule.ruleId, reason: 'invalid-premium' });
          continue;
        }
        actualValue = premiumRate;
        triggered = premiumRate >= rule.threshold;
        valueLabel = `溢价率 ${premiumRate.toFixed(2)}%`;
        break;
      case 'premium-below':
        if (premiumRate === null) {
          skipped.push({ ruleId: rule.ruleId, reason: 'invalid-premium' });
          continue;
        }
        actualValue = premiumRate;
        triggered = premiumRate <= rule.threshold;
        valueLabel = `溢价率 ${premiumRate.toFixed(2)}%`;
        break;
    }

    if (!triggered) {
      skipped.push({ ruleId: rule.ruleId, reason: 'not-triggered', actualValue });
      continue;
    }

    const state = prev[rule.ruleId] || {};
    const prevAt = Number(state.lastPushedAt) || 0;
    const cooldownMs = (rule.cooldownHours || 24) * 60 * 60 * 1000;

    if (nowMs - prevAt < cooldownMs) {
      skipped.push({ ruleId: rule.ruleId, reason: 'debounced', actualValue });
      continue;
    }

    const typeLabel = {
      gain: '涨幅预警',
      loss: '跌幅预警',
      premium: '溢价预警',
      'premium-below': '溢价率低于预警'
    }[rule.alertType] || '市场预警';

    const title = `${symbol} ${rule.name || ''} ${typeLabel}`;
    const body = `${symbol} ${valueLabel}，已超过设定阈值 ${rule.threshold.toFixed(1)}%。当前价 ¥${currentPrice.toFixed(3)} → 点此查看行情详情。`;
    const body_md = [
      `**${symbol} ${typeLabel}**`,
      '',
      `- 基金：${rule.name || symbol}`,
      `- 当前价：**¥${currentPrice.toFixed(3)}**`,
      `- ${valueLabel}（阈值 ${rule.threshold.toFixed(1)}%）`,
      `- 昨收：¥${previousClose.toFixed(3)}`
    ].join('\n');

    const action = buildNotificationDetailAction(env, 'markets', '', {
      code: symbol,
      trigger: 'market-alert',
      ruleId: rule.ruleId
    });

    env.__notifySettings = settings;
    env.__notifyCurrentClientId = clientId;

    const notification = {
      eventId: buildNotificationEventId(rule.ruleId, `triggered:${actualValue.toFixed(2)}`, new Date(nowMs)),
      eventType: 'market-alert',
      ruleId: rule.ruleId,
      title,
      body,
      body_md,
      summary: title,
      symbol,
      detailUrl: action.detailUrl,
      url: action.url,
      links: action.links,
      target: action.target,
      params: action.params
    };

    try {
      const result = await deliverNotification(env, notification);
      delivered.push({ ruleId: rule.ruleId, symbol, actualValue, results: result?.results || [] });
      next[rule.ruleId] = { lastPushedAt: nowMs, lastPushedValue: actualValue };
    } catch (error) {
      skipped.push({ ruleId: rule.ruleId, reason: 'delivery-error', detail: error.message });
    }
  }

  if (typeof writeState === 'function' && delivered.length) {
    await writeState(next);
  }

  return { delivered, skipped };
}

export async function evaluateHoldingAlertRules(env, rules, options = {}) {
  const { clientId = '', settings = {}, readState, writeState } = options;
  if (!Array.isArray(rules) || !rules.length) return { skipped: 'no-rules' };

  const latestMarketMap = await loadLatestMarketMap(env, rules.map(r => ({ symbol: r.symbol, fundKind: r.fundKind })), { forceRefresh: true });

  const prev = (typeof readState === 'function' ? (await readState()) : null) || {};
  const next = { ...prev };
  const now = Date.now();
  const delivered = [];
  const skipped = [];

  for (const rule of rules) {
    const symbol = String(rule.symbol || '').trim();
    if (!symbol) continue;

    const marketEntry = latestMarketMap[symbol];
    if (!marketEntry) {
      skipped.push({ ruleId: rule.ruleId, reason: 'no-market-data' });
      continue;
    }

    const currentPrice = Number(marketEntry.current_price) || 0;
    const holdingCost = Number(rule.holdingCost) || 0;

    if (currentPrice <= 0 || holdingCost <= 0) {
      skipped.push({ ruleId: rule.ruleId, reason: 'invalid-price-or-cost' });
      continue;
    }

    const gainPct = ((currentPrice - holdingCost) / holdingCost) * 100;

    let triggered = false;
    let actualValue = gainPct;
    let valueLabel = '';

    switch (rule.alertType) {
      case 'gain':
        triggered = gainPct >= rule.threshold;
        valueLabel = `持仓盈利 ${gainPct.toFixed(2)}%`;
        break;
      case 'loss':
        triggered = gainPct <= -rule.threshold;
        valueLabel = `持仓亏损 ${Math.abs(gainPct).toFixed(2)}%`;
        break;
    }

    if (!triggered) {
      skipped.push({ ruleId: rule.ruleId, reason: 'not-triggered', actualValue });
      continue;
    }

    const state = prev[rule.ruleId] || {};
    const prevAt = Number(state.lastPushedAt) || 0;
    const cooldownMs = (rule.cooldownHours || 24) * 60 * 60 * 1000;

    if (now - prevAt < cooldownMs) {
      skipped.push({ ruleId: rule.ruleId, reason: 'debounced', actualValue });
      continue;
    }

    const typeLabel = rule.alertType === 'gain' ? '持仓涨幅预警' : '持仓跌幅预警';
    const title = `${symbol} ${rule.name || ''} ${typeLabel}`;
    const body = `${symbol} ${valueLabel}，已超过设定阈值 ${rule.threshold.toFixed(1)}%。当前价 ¥${currentPrice.toFixed(3)}，成本 ¥${holdingCost.toFixed(3)} → 点此查看持仓明细。`;
    const body_md = [
      `**${symbol} ${typeLabel}**`,
      '',
      `- 持仓：${rule.name || symbol}`,
      `- 当前价：**¥${currentPrice.toFixed(3)}**`,
      `- 持仓成本：¥${holdingCost.toFixed(3)}`,
      `- ${valueLabel}（阈值 ${rule.threshold.toFixed(1)}%）`
    ].join('\n');

    const action = buildNotificationDetailAction(env, 'holdings', '', {
      code: symbol,
      trigger: 'holding-alert',
      ruleId: rule.ruleId
    });

    env.__notifySettings = settings;
    env.__notifyCurrentClientId = clientId;

    const notification = {
      eventId: buildNotificationEventId(rule.ruleId, `triggered:${actualValue.toFixed(2)}`, new Date(now)),
      eventType: 'holding-alert',
      ruleId: rule.ruleId,
      title,
      body,
      body_md,
      summary: title,
      symbol,
      detailUrl: action.detailUrl,
      url: action.url,
      links: action.links,
      target: action.target,
      params: action.params
    };

    try {
      const result = await deliverNotification(env, notification);
      delivered.push({ ruleId: rule.ruleId, symbol, actualValue, results: result?.results || [] });
      next[rule.ruleId] = { lastPushedAt: now, lastPushedValue: actualValue };
    } catch (error) {
      skipped.push({ ruleId: rule.ruleId, reason: 'delivery-error', detail: error.message });
    }
  }

  if (typeof writeState === 'function' && delivered.length) {
    await writeState(next);
  }

  return { delivered, skipped };
}
