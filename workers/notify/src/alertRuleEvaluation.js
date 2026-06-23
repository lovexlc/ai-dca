import {
  buildNotificationDetailUrl,
  buildNotificationEventId,
  loadLatestMarketMap
} from './notificationRuleEvaluation.js';
import { deliverNotification } from './deliveryEngine.js';

export async function evaluateMarketAlertRules(env, rules, options = {}) {
  const { clientId = '', settings = {}, readState, writeState } = options;
  if (!Array.isArray(rules) || !rules.length) return { skipped: 'no-rules' };

  const symbols = rules.map(r => r.symbol);
  const latestMarketMap = await loadLatestMarketMap(env, { planRules: rules.map(r => ({ symbol: r.symbol })) });

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
    const previousClose = Number(marketEntry.previous_close) || 0;

    if (currentPrice <= 0 || previousClose <= 0) {
      skipped.push({ ruleId: rule.ruleId, reason: 'invalid-price' });
      continue;
    }

    const changePct = ((currentPrice - previousClose) / previousClose) * 100;
    const premiumRate = Number(marketEntry.premium_rate) || 0;

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
        actualValue = premiumRate;
        triggered = premiumRate >= rule.threshold;
        valueLabel = `溢价率 ${premiumRate.toFixed(2)}%`;
        break;
      case 'discount':
        actualValue = -premiumRate;
        triggered = premiumRate <= -rule.threshold;
        valueLabel = `折价率 ${Math.abs(premiumRate).toFixed(2)}%`;
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

    const typeLabel = {
      gain: '涨幅预警',
      loss: '跌幅预警',
      premium: '溢价预警',
      discount: '折价预警'
    }[rule.alertType] || '市场预警';

    const title = `${symbol} ${rule.name || ''} ${typeLabel}`;
    const body = `${symbol} ${valueLabel}，已超过设定阈值 ${rule.threshold.toFixed(1)}%。当前价 ¥${currentPrice.toFixed(3)}。`;
    const body_md = [
      `**${symbol} ${typeLabel}**`,
      '',
      `- 基金：${rule.name || symbol}`,
      `- 当前价：**¥${currentPrice.toFixed(3)}**`,
      `- ${valueLabel}（阈值 ${rule.threshold.toFixed(1)}%）`,
      `- 昨收：¥${previousClose.toFixed(3)}`
    ].join('\n');

    const detailUrl = buildNotificationDetailUrl(env, 'markets', symbol);

    env.__notifySettings = settings;
    env.__notifyCurrentClientId = clientId;

    const notification = {
      eventId: buildNotificationEventId(rule.ruleId, `triggered:${actualValue.toFixed(2)}`, new Date(now)),
      eventType: 'market-alert',
      ruleId: rule.ruleId,
      title,
      body,
      body_md,
      summary: title,
      symbol,
      detailUrl,
      url: detailUrl
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

export async function evaluateHoldingAlertRules(env, rules, options = {}) {
  const { clientId = '', settings = {}, readState, writeState } = options;
  if (!Array.isArray(rules) || !rules.length) return { skipped: 'no-rules' };

  const symbols = rules.map(r => r.symbol);
  const latestMarketMap = await loadLatestMarketMap(env, { planRules: rules.map(r => ({ symbol: r.symbol })) });

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
    const body = `${symbol} ${valueLabel}，已超过设定阈值 ${rule.threshold.toFixed(1)}%。当前价 ¥${currentPrice.toFixed(3)}，成本 ¥${holdingCost.toFixed(3)}。`;
    const body_md = [
      `**${symbol} ${typeLabel}**`,
      '',
      `- 持仓：${rule.name || symbol}`,
      `- 当前价：**¥${currentPrice.toFixed(3)}**`,
      `- 持仓成本：¥${holdingCost.toFixed(3)}`,
      `- ${valueLabel}（阈值 ${rule.threshold.toFixed(1)}%）`
    ].join('\n');

    const detailUrl = buildNotificationDetailUrl(env, 'holdings', symbol);

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
      detailUrl,
      url: detailUrl
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
