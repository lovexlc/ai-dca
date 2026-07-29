import { CORS_HEADERS, errorJson } from './marketRuntime.js';
import { EXCHANGE_FUND_HUB_NAME } from './exchangeFundSnapshot.js';

function splitParam(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function parseOrderBy(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getHub(env) {
  if (!env?.EXCHANGE_FUND_HUB || typeof env.EXCHANGE_FUND_HUB.getByName !== 'function') return null;
  return env.EXCHANGE_FUND_HUB.getByName(EXCHANGE_FUND_HUB_NAME);
}

export async function handleExchangeFundList(env, request, url) {
  const hub = getHub(env);
  if (!hub) return errorJson('EXCHANGE_FUND_HUB binding missing', 503);
  if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
    return hub.fetch(request);
  }
  const params = url.searchParams;
  const result = await hub.getSortedSnapshot({
    symbols: splitParam(params.get('symbols')),
    heldSymbols: splitParam(params.get('heldSymbols')),
    query: params.get('q') || '',
    heldOnly: params.get('heldOnly') === '1',
    sortBy: params.get('sortBy') || '',
    order: params.get('order') || '',
    orderBy: parseOrderBy(params.get('orderBy')),
    limit: params.get('limit') || 100,
    offset: params.get('offset') || 0,
  });
  return new Response(JSON.stringify(result), { status: 200, headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' } });
}
