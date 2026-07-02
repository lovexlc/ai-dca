import { kvGetJson, kvPutJson } from './storage.js';

export function quoteCacheKey(code = '') {
  return 'quote:' + String(code || '').trim();
}

export async function readFreshQuoteCache(env, code, market, { maxAgeMs = 90000 } = {}) {
  const cached = await kvGetJson(env, quoteCacheKey(code)).catch(() => null);
  if (!cached || !cached.asOf) return null;
  if (Date.now() - new Date(cached.asOf).getTime() >= maxAgeMs) return null;
  if (market === 'cn' && cached.source !== 'xueqiu-quote') return null;
  return cached;
}

export async function writeQuoteCache(env, code, quote, { ttlSeconds = 300 } = {}) {
  if (!String(code || '').trim()) return;
  if (!quote || quote.error) return;
  await kvPutJson(env, quoteCacheKey(code), quote, { ttlSeconds }).catch(() => {});
}
