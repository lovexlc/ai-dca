/**
 * The only notify -> markets HTTP boundary.
 *
 * Keep request construction here so route modules do not know whether the
 * markets Worker is reached through a Service Binding or a local/public URL.
 */
import {
  fetchMarketsJson,
  fetchMarketsResponse
} from '../../shared/src/marketsServiceClient.js';

function uniqueValues(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));
}

export async function requestMarketsForNotify(env, path, init = {}) {
  return fetchMarketsResponse(env, path, init);
}

export async function fetchMarketsJsonForNotify(env, path, init = {}) {
  return fetchMarketsJson(env, path, init);
}

export async function getQuotesForNotify(env, symbols = []) {
  const list = uniqueValues(symbols);
  if (!list.length) return { quotes: {} };
  return fetchMarketsJsonForNotify(env, `/quotes?symbols=${encodeURIComponent(list.join(','))}`);
}

export async function getFundMetricsForNotify(env, codes = [], { refresh = false, fundKinds = {} } = {}) {
  const list = uniqueValues(codes);
  if (!list.length) return { items: [], successCount: 0, failureCount: 0 };
  return fetchMarketsJsonForNotify(env, `/fund-metrics${refresh ? '?refresh=1' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      codes: list,
      ...(refresh ? { refresh: true } : {}),
      ...(fundKinds && Object.keys(fundKinds).length ? { fundKinds } : {})
    })
  });
}

export async function getKlineForNotify(env, symbol, {
  timeframe = '1d',
  limit = '',
  session = '',
  includeR2 = false,
  forceLive = false
} = {}) {
  const code = String(symbol || '').trim();
  if (!code) return { candles: [] };
  const params = new URLSearchParams({ tf: String(timeframe || '1d') });
  if (limit) params.set('limit', String(limit));
  if (session) params.set('session', String(session));
  if (includeR2) params.set('includeR2', '1');
  if (forceLive) params.set('live', '1');
  return fetchMarketsJsonForNotify(env, `/kline/${encodeURIComponent(code)}?${params.toString()}`);
}
