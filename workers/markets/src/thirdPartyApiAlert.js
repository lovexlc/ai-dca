import { kvGetJson, kvPutJson } from './storage.js';

export const THIRD_PARTY_API_ERROR_WINDOW_MS = 5 * 60 * 1000;
export const THIRD_PARTY_API_ERROR_THRESHOLD = 10;
export const THIRD_PARTY_API_ERROR_KEY = 'alert:third-party-api-errors';

const STATE_TTL_SECONDS = Math.ceil(THIRD_PARTY_API_ERROR_WINDOW_MS / 1000) + 120;

export function isThirdPartyApiAlertEnabled(env = {}) {
  return String(env.MARKETS_ENV || '').trim().toLowerCase() === 'test';
}

export function isThirdPartyApiPath(path = '') {
  const normalized = String(path || '').trim();
  if (!normalized || normalized === '/health') return false;
  return normalized === '/indices'
    || normalized === '/market-summary'
    || normalized === '/sectors'
    || normalized === '/quotes'
    || normalized === '/fund-metrics'
    || normalized === '/movers'
    || normalized === '/news'
    || normalized === '/earnings'
    || normalized === '/summary'
    || normalized === '/search'
    || normalized === '/ask'
    || normalized === '/refresh'
    || normalized === '/kline-batch'
    || /^\/(?:quote|kline|profile|financials|xueqiu-fund-data)\//.test(normalized);
}

// This marker is request-scoped: handlers can return a partial 200 response
// while still reporting an upstream failure to the outer operation monitor.
export function markThirdPartyApiFailure(env, details = {}) {
  if (!env || typeof env !== 'object') return;
  env.__thirdPartyApiFailure = {
    source: String(details.source || 'markets Worker').trim(),
    error: String(details.error || 'third-party API returned partial failures').trim().slice(0, 500)
  };
}

function consumeThirdPartyApiFailure(env) {
  const failure = env?.__thirdPartyApiFailure || null;
  if (env && typeof env === 'object') delete env.__thirdPartyApiFailure;
  return failure;
}

function normalizeErrorMessage(error) {
  return String(error?.message || error || 'unknown third-party API error')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function normalizeFailureTimestamps(value, nowMs) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeTimestamp)
    .filter((timestamp) => timestamp > 0 && timestamp <= nowMs && nowMs - timestamp <= THIRD_PARTY_API_ERROR_WINDOW_MS)
    .slice(-(THIRD_PARTY_API_ERROR_THRESHOLD + 20));
}

async function readAlertState(env) {
  if (!env?.MARKETS_KV) return null;
  return await kvGetJson(env, THIRD_PARTY_API_ERROR_KEY).catch(() => null);
}

async function clearAlertState(env) {
  if (!env?.MARKETS_KV) return;
  if (typeof env.MARKETS_KV.delete === 'function') {
    await env.MARKETS_KV.delete(THIRD_PARTY_API_ERROR_KEY);
    return;
  }
  // Test doubles and older KV wrappers may not expose delete. Keep an empty
  // short-lived marker so a stale streak cannot be reused.
  await kvPutJson(env, THIRD_PARTY_API_ERROR_KEY, { failures: [] }, { ttlSeconds: STATE_TTL_SECONDS });
}

export async function resetThirdPartyApiErrorStreak(env) {
  const state = await readAlertState(env);
  if (!state || (Array.isArray(state.failures) && state.failures.length === 0)) return false;
  await clearAlertState(env).catch((error) => {
    console.warn('[markets:third-party-alert] reset failed', normalizeErrorMessage(error));
  });
  return true;
}

function resolveAdminNotifyEndpoint(env = {}) {
  return String(env.MARKETS_ADMIN_NOTIFY_ENDPOINT || env.MARKETS_ADMIN_NOTIFY_WEBHOOK || '').trim();
}

function resolveAdminNotifyToken(env = {}) {
  return String(env.MARKETS_ADMIN_NOTIFY_TOKEN || env.ADMIN_NOTIFY_TOKEN || env.ADMIN_TEST_TOKEN || '').trim();
}

async function sendAdminAlert(env, payload) {
  if (env?.NOTIFY && typeof env.NOTIFY.fetch === 'function') {
    const response = await env.NOTIFY.fetch(new Request('https://notify.internal/internal/third-party-alert', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }));
    if (!response.ok) throw new Error(`notify service binding HTTP ${response.status}`);
    return { delivered: true, transport: 'service-binding' };
  }

  const endpoint = resolveAdminNotifyEndpoint(env);
  if (!endpoint) {
    console.warn('[markets:third-party-alert] endpoint is not configured');
    return { delivered: false, reason: 'endpoint_missing' };
  }

  const headers = { 'content-type': 'application/json' };
  const token = resolveAdminNotifyToken(env);
  if (token) headers['x-admin-token'] = token;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`admin notify HTTP ${response.status}`);
  return { delivered: true };
}

export async function recordThirdPartyApiError(env, {
  endpoint = '',
  source = 'markets Worker',
  error,
  nowMs = Date.now()
} = {}) {
  if (!env?.MARKETS_KV) return { tracked: false, count: 0, alerted: false };

  const currentMs = normalizeTimestamp(nowMs) || Date.now();
  const previous = await readAlertState(env);
  const previousLastErrorAt = normalizeTimestamp(previous?.lastErrorAt);
  const withinSameStreak = previousLastErrorAt > 0
    && currentMs >= previousLastErrorAt
    && currentMs - previousLastErrorAt <= THIRD_PARTY_API_ERROR_WINDOW_MS;
  const failures = withinSameStreak
    ? normalizeFailureTimestamps(previous?.failures, currentMs)
    : [];
  failures.push(currentMs);

  const count = failures.length;
  const shouldAlert = count >= THIRD_PARTY_API_ERROR_THRESHOLD && !previous?.alertedAt;
  const state = {
    failures,
    count,
    firstErrorAt: failures[0],
    lastErrorAt: currentMs,
    lastEndpoint: String(endpoint || '').trim().slice(0, 200),
    lastSource: String(source || 'markets Worker').trim().slice(0, 100),
    lastError: normalizeErrorMessage(error),
    ...(shouldAlert
      ? { alertedAt: new Date(currentMs).toISOString() }
      : (withinSameStreak && previous?.alertedAt ? { alertedAt: previous.alertedAt } : {}))
  };

  try {
    await kvPutJson(env, THIRD_PARTY_API_ERROR_KEY, state, { ttlSeconds: STATE_TTL_SECONDS });
  } catch (storageError) {
    console.warn('[markets:third-party-alert] state write failed', normalizeErrorMessage(storageError));
    return { tracked: false, count, alerted: false, state };
  }

  if (!shouldAlert) return { tracked: true, count, alerted: false, state };

  const payload = {
    type: 'third_party_api_error_burst',
    eventType: 'admin_alert',
    eventId: `third-party-api-error-burst-${currentMs}`,
    title: '第三方 API 连续异常',
    summary: `markets Worker 在 5 分钟内连续失败 ${count} 次`,
    body: `test 环境 markets Worker 的第三方 API 请求已连续失败 ${count} 次，请检查上游接口、凭证和网络。`,
    ruleId: 'third-party-api-error-burst',
    strategyName: 'markets Worker',
    triggerCondition: '5 分钟滑动窗口内连续失败 10 次',
    endpoint: state.lastEndpoint,
    source: state.lastSource,
    reason: state.lastError,
    errorCount: count,
    windowMinutes: 5,
    generatedAt: new Date(currentMs).toISOString()
  };

  try {
    await sendAdminAlert(env, payload);
  } catch (notifyError) {
    console.warn('[markets:third-party-alert] admin notify failed', normalizeErrorMessage(notifyError));
  }

  return { tracked: true, count, alerted: true, state, payload };
}

export async function runThirdPartyApiOperation(env, {
  endpoint = '',
  operation,
  ctx = null
} = {}) {
  try {
    const response = await operation();
    const partialFailure = consumeThirdPartyApiFailure(env);
    if (response && Number(response.status) >= 500 || partialFailure) {
      const report = recordThirdPartyApiError(env, {
        endpoint,
        source: partialFailure?.source,
        error: partialFailure?.error || `HTTP ${response.status}`
      });
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(report);
      else await report;
      return response;
    }
    await resetThirdPartyApiErrorStreak(env);
    return response;
  } catch (error) {
    const report = recordThirdPartyApiError(env, { endpoint, error });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(report);
    else await report;
    throw error;
  }
}
