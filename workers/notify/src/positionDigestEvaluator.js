import { deliverNotification } from './deliveryEngine.js';
import {
  buildNotificationDetailAction,
  buildNotificationEventId
} from './notificationRuleEvaluation.js';

export const POSITION_DEBOUNCE_MS = 24 * 60 * 60 * 1000;
export const CASH_HIGH_PCT = 30;

function formatPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

async function evaluateAccountAllocationDigest(env, positionDigest, options = {}) {
  const { clientId = '', settings = {}, readState, writeState } = options;
  const prev = (typeof readState === 'function' ? (await readState()) : null) || {};
  const next = { ...prev };
  const now = Date.now();
  const delivered = [];
  const events = [];
  const skipped = [];

  env.__notifySettings = settings;
  env.__notifyCurrentClientId = clientId;

  const notifyEnabled = positionDigest.notifyEnabled !== false;
  const direction = String(positionDigest.direction || 'balanced').trim();
  const investmentPct = Number(positionDigest.investmentPct) || 0;
  const cashPct = Number(positionDigest.cashPct) || 0;
  const thresholdPct = Math.max(Number(positionDigest.rebalanceThresholdPct) || 0, 0);
  const explicitMaxDeviation = Number(positionDigest.maxDeviationPct);
  const maxDeviationPct = Number.isFinite(explicitMaxDeviation)
    ? Math.abs(explicitMaxDeviation)
    : Math.max(
      Math.abs(Number(positionDigest.investmentDeviationPct) || 0),
      Math.abs(Number(positionDigest.cashDeviationPct) || 0)
    );
  const rebalanceNeeded = Boolean(positionDigest.rebalanceNeeded) && maxDeviationPct >= thresholdPct;
  const state = prev._rebalance || {};
  const prevActive = Boolean(state.lastPushedActive);
  const prevDirection = String(state.lastPushedDirection || '').trim();
  const prevAt = Number(state.lastPushedAt) || 0;

  if (!notifyEnabled) {
    if (prevActive) {
      next._rebalance = { ...state, lastPushedActive: false, lastClearedAt: now };
    }
    skipped.push({ symbol: '__account__', reason: 'notification-disabled' });
  } else if (!rebalanceNeeded || direction === 'balanced') {
    if (prevActive) {
      next._rebalance = {
        ...state,
        lastPushedActive: false,
        lastClearedAt: now,
        lastInvestmentPct: investmentPct,
        lastCashPct: cashPct
      };
    }
    skipped.push({ symbol: '__account__', reason: 'within-target', investmentPct, cashPct, maxDeviationPct });
  } else if (prevActive && prevDirection === direction && now - prevAt < POSITION_DEBOUNCE_MS) {
    skipped.push({ symbol: '__account__', reason: 'debounced-rebalance', direction, maxDeviationPct });
  } else {
    const investmentHigh = direction === 'investment_high';
    const title = investmentHigh
      ? `投资占比偏高：${formatPct(investmentPct)}%`
      : `现金占比偏高：${formatPct(cashPct)}%`;
    const body = investmentHigh
      ? `投资占比 ${formatPct(investmentPct)}%，目标 ${formatPct(positionDigest.targetInvestmentPct)}%，偏离 ${formatPct(maxDeviationPct)} 个百分点。`
      : `现金占比 ${formatPct(cashPct)}%，目标 ${formatPct(positionDigest.targetCashPct)}%，偏离 ${formatPct(maxDeviationPct)} 个百分点。`;
    const action = buildNotificationDetailAction(env, 'holdings', 'account-allocation', {
      trigger: 'rebalance-needed',
      direction
    });
    const notification = {
      eventId: buildNotificationEventId(`account:allocation:${direction}`, 'rebalance', new Date(now)),
      eventType: 'rebalance-needed',
      ruleId: 'account:allocation:rebalance',
      title,
      body,
      body_md: [
        `**${title}**`,
        '',
        `- 投资占比：**${formatPct(investmentPct)}%**（目标 ${formatPct(positionDigest.targetInvestmentPct)}%）`,
        `- 现金占比：**${formatPct(cashPct)}%**（目标 ${formatPct(positionDigest.targetCashPct)}%）`,
        `- 触发阈值：${formatPct(thresholdPct)} 个百分点`,
      ].join('\n'),
      summary: title,
      symbol: '__account__',
      detailUrl: action.detailUrl,
      url: action.url,
      links: action.links,
      target: action.target,
      params: action.params,
    };
    try {
      const result = await deliverNotification(env, notification);
      const event = { id: notification.eventId, eventType: notification.eventType, ruleId: notification.ruleId, title: notification.title, body: notification.body, body_md: notification.body_md, summary: notification.summary, symbol: notification.symbol, detailUrl: notification.detailUrl, links: notification.links, target: notification.target, params: notification.params, status: result?.status || 'failed', channels: result?.results || [], createdAt: new Date(now).toISOString(), reason: 'position-sync' };
      delivered.push({ symbol: '__account__', direction, investmentPct, cashPct, maxDeviationPct, results: result?.results || [], event });
      events.push(event);
      next._rebalance = {
        lastPushedActive: true,
        lastPushedAt: now,
        lastPushedDirection: direction,
        lastPushedMaxDeviationPct: maxDeviationPct,
        lastInvestmentPct: investmentPct,
        lastCashPct: cashPct
      };
    } catch (error) {
      skipped.push({ symbol: '__account__', reason: 'delivery-error', detail: error instanceof Error ? error.message : String(error) });
    }
  }

  if (typeof writeState === 'function' && (delivered.length || JSON.stringify(prev) !== JSON.stringify(next))) {
    await writeState(next);
  }

  return { delivered, skipped, events };
}

export async function evaluatePositionDigest(env, positionDigest, options = {}) {
  const { clientId = '', settings = {}, readState, writeState } = options;
  if (!positionDigest || typeof positionDigest !== 'object') return { skipped: 'no-digest' };
  if (Number(positionDigest.version) >= 2) {
    return evaluateAccountAllocationDigest(env, positionDigest, options);
  }
  const rows = Array.isArray(positionDigest.rows) ? positionDigest.rows : [];
  const cashWeightPct = Number(positionDigest.cashWeightPct);

  const prev = (typeof readState === 'function' ? (await readState()) : null) || {};
  const next = { ...prev };
  const now = Date.now();
  const delivered = [];
  const events = [];
  const skipped = [];

  env.__notifySettings = settings;
  env.__notifyCurrentClientId = clientId;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const symbol = String(row.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    const exceedsCap = Boolean(row.exceedsCap);
    const weightPct = Number(row.weightPct) || 0;
    const state = prev[symbol] || {};
    const prevExceeds = Boolean(state.lastPushedExceedsCap);
    const prevAt = Number(state.lastPushedAt) || 0;

    if (!exceedsCap) {
      if (prevExceeds) next[symbol] = { lastPushedExceedsCap: false, lastPushedAt: prevAt, lastPushedWeightPct: weightPct };
      skipped.push({ symbol, reason: 'within-cap', weightPct });
      continue;
    }
    if (prevExceeds && now - prevAt < POSITION_DEBOUNCE_MS) {
      skipped.push({ symbol, reason: 'debounced-still-exceeding', weightPct });
      continue;
    }

    const title = `${symbol} 超仓：${weightPct.toFixed(2)}%`;
    const body = `${symbol} 当前仓位 ${weightPct.toFixed(2)}%，超出个股 50% 上限 → 点此查看持仓明细。`;
    const body_md = [
      `**${symbol} 超仓报警**`,
      '',
      `- 当前仓位：**${weightPct.toFixed(2)}%** (上限 50%)`,
      '- 建议：逐步减仓或做 T 限仓。',
    ].join('\n');
    const action = buildNotificationDetailAction(env, 'holdings', `position:${symbol}`, {
      code: symbol,
      trigger: 'position-cap'
    });
    const notification = {
      eventId: buildNotificationEventId(`position:${symbol}:exceeds`, 'cap-cross', new Date(now)),
      eventType: 'position-cap',
      ruleId: `position:${symbol}:exceeds-cap`,
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
      delivered.push({ symbol, weightPct, results: result?.results || [] });
      next[symbol] = { lastPushedExceedsCap: true, lastPushedAt: now, lastPushedWeightPct: weightPct };
    } catch (error) {
      skipped.push({ symbol, reason: 'delivery-error', detail: error instanceof Error ? error.message : String(error) });
    }
  }

  if (Number.isFinite(cashWeightPct) && cashWeightPct >= CASH_HIGH_PCT) {
    const cashState = prev._cash || {};
    const cashPrevHigh = Boolean(cashState.lastPushedHigh);
    const cashPrevAt = Number(cashState.lastPushedAt) || 0;
    if (!cashPrevHigh || now - cashPrevAt >= POSITION_DEBOUNCE_MS) {
      const title = `现金仓位偏高：${cashWeightPct.toFixed(2)}%`;
      const body = `现金占比 ${cashWeightPct.toFixed(2)}%（≥ ${CASH_HIGH_PCT}%）→ 点此查看策略详情。`;
      const action = buildNotificationDetailAction(env, 'tradePlans', 'position:cash', {
        trigger: 'cash-high'
      });
      const notification = {
        eventId: buildNotificationEventId('position:cash:high', 'cross', new Date(now)),
        eventType: 'cash-high',
        ruleId: 'position:cash:high',
        title,
        body,
        body_md: `**现金偏高**\n\n- 现金占比：**${cashWeightPct.toFixed(2)}%**\n- 建议：金字塔加仓宽基。`,
        summary: title,
        detailUrl: action.detailUrl,
        url: action.url,
        links: action.links,
        target: action.target,
        params: action.params,
      };
      try {
        const result = await deliverNotification(env, notification);
        delivered.push({ symbol: '__cash__', cashWeightPct, results: result?.results || [] });
        next._cash = { lastPushedHigh: true, lastPushedAt: now, lastPushedCashWeightPct: cashWeightPct };
      } catch (error) {
        skipped.push({ symbol: '__cash__', reason: 'delivery-error', detail: error instanceof Error ? error.message : String(error) });
      }
    } else {
      skipped.push({ symbol: '__cash__', reason: 'debounced-cash-high', cashWeightPct });
    }
  } else if (Number.isFinite(cashWeightPct)) {
    if (prev._cash?.lastPushedHigh) next._cash = { lastPushedHigh: false, lastPushedAt: prev._cash.lastPushedAt || 0, lastPushedCashWeightPct: cashWeightPct };
  }

  if (typeof writeState === 'function' && (delivered.length || JSON.stringify(prev) !== JSON.stringify(next))) {
    await writeState(next);
  }

  return { delivered, skipped };
}
