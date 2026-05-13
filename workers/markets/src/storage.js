// KV / R2 读写封装。
//
//   KV key 命名约定：
//     idx:us / idx:cn                  -> { generatedAt, indexes: [{symbol,name,price,...}] }
//     quote:<symbol>                   -> 单只实时报价 JSON，TTL 5min。
//     movers:us:gainers / movers:cn:*  -> [{symbol,name,price,change,changePercent}, ...]
//     news:us / news:cn                -> [{title,url,source,publishedAt,summary}]
//
//   R2 key 命名约定：
//     kline/<market>/<symbol>/<interval>.json   -> { symbol, interval, candles, generatedAt }
//     profile/<symbol>.json                     -> Finnhub /stock/profile2 原始

const JSON_TYPE = 'application/json; charset=utf-8';

export async function kvGetJson(env, key) {
  if (!env.MARKETS_KV) return null;
  const text = await env.MARKETS_KV.get(key, 'text');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function kvPutJson(env, key, value, { ttlSeconds } = {}) {
  if (!env.MARKETS_KV) return;
  const opts = {};
  if (Number.isFinite(ttlSeconds) && ttlSeconds > 60) opts.expirationTtl = ttlSeconds;
  await env.MARKETS_KV.put(key, JSON.stringify(value), opts);
}

export async function r2GetJson(env, key) {
  if (!env.MARKETS_R2) return null;
  const obj = await env.MARKETS_R2.get(key);
  if (!obj) return null;
  const text = await obj.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function r2PutJson(env, key, value, { contentType = JSON_TYPE } = {}) {
  if (!env.MARKETS_R2) return;
  await env.MARKETS_R2.put(key, JSON.stringify(value), {
    httpMetadata: { contentType }
  });
}

export function klineKey(market, symbol, interval) {
  return `kline/${market}/${symbol}/${interval}.json`;
}
