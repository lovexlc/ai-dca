import { fetchXueqiuCnFundData } from './fetchers.js';
import { errorJson, json, requireMarketsAdminRequest } from './marketRuntime.js';
import { classifySymbol } from './symbols.js';
import { kvGetJson, kvPutJson } from './storage.js';

export async function handleXueqiuFundData(env, request, rawSymbol, params) {
  const { market, code } = classifySymbol(rawSymbol);
  if (market !== 'cn') return errorJson('only cn symbols are supported', 400);
  if (!env.XUEQIU_COOKIE) return errorJson('XUEQIU_COOKIE missing', 500);
  const includeRaw = params.get('raw') === '1';
  if (includeRaw) {
    const unauthorized = requireMarketsAdminRequest(request, env);
    if (unauthorized) return unauthorized;
  }
  const forceRefresh = params.get('refresh') === '1';
  const cacheKey = 'xueqiu-fund-data:' + code + ':' + (includeRaw ? 'raw' : 'summary');
  if (!forceRefresh) {
    const cached = await kvGetJson(env, cacheKey);
    if (cached && cached.results) return json({ ...cached, cached: true });
  }
  const payload = await fetchXueqiuCnFundData(code, { cookie: env.XUEQIU_COOKIE, includeRaw });
  await kvPutJson(env, cacheKey, payload, { ttlSeconds: includeRaw ? 300 : 1800 });
  return json({ ...payload, cached: false });
}
