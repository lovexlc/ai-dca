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

// ===================== 历史序列（用于"历史水位"百分位） =====================
//
// KV key: hist:<symbol>
// value: { values: [{ date: 'YYYY-MM-DD', value: number }], updatedAt: ISO }
//
// 日期规则：
//   - A 股/场外基金用上海日期
//   - 美股/指标用美东日期

const HISTORY_KEY_PREFIX = 'hist:';
const HISTORY_LOOKBACK_DAYS = 5 * 365; // 近 5 年
const HISTORY_TTL_SECONDS = 6 * 365 * 86400; // KV 保留约 6 年

function toShanghaiDateString(date = new Date()) {
  return new Date(date.getTime() + (date.getTimezoneOffset() + 480) * 60000)
    .toISOString().slice(0, 10);
}

function toEasternDateString(date = new Date()) {
  return new Date(date.getTime() + (date.getTimezoneOffset() + 300) * 60000)
    .toISOString().slice(0, 10);
}

export function marketDateString(market, date = new Date()) {
  return market === 'cn' ? toShanghaiDateString(date) : toEasternDateString(date);
}

export async function kvGetHistoricalValues(env, symbol) {
  const data = await kvGetJson(env, HISTORY_KEY_PREFIX + symbol);
  if (!data || !Array.isArray(data.values)) return [];
  return data.values;
}

export async function kvAppendHistoricalValue(env, symbol, { date, value }) {
  if (!env.MARKETS_KV) return;
  if (!date || !Number.isFinite(Number(value))) return;
  const prev = await kvGetJson(env, HISTORY_KEY_PREFIX + symbol) || { values: [] };
  const values = Array.isArray(prev.values) ? prev.values : [];
  const nextValues = values.filter((row) => {
    if (!row || !row.date) return false;
    const days = (new Date(date).getTime() - new Date(row.date).getTime()) / 86400000;
    return days < HISTORY_LOOKBACK_DAYS;
  });
  // 去重：同日期只保留最新
  const idx = nextValues.findIndex((row) => row.date === date);
  if (idx >= 0) nextValues[idx] = { date, value: Number(value) };
  else nextValues.push({ date, value: Number(value) });
  nextValues.sort((a, b) => a.date.localeCompare(b.date));
  await kvPutJson(env, HISTORY_KEY_PREFIX + symbol, {
    values: nextValues,
    updatedAt: new Date().toISOString()
  }, { ttlSeconds: HISTORY_TTL_SECONDS });
}

// 基于近 lookbackDays 的历史序列计算当前值的百分位（0-100）。
export function computeHistoricalPercentile(currentValue, values, { lookbackDays = HISTORY_LOOKBACK_DAYS, asOfDate } = {}) {
  const n = Number(currentValue);
  if (!Number.isFinite(n)) return null;
  const anchor = asOfDate ? new Date(asOfDate) : new Date();
  const arr = (values || [])
    .filter((row) => row && Number.isFinite(Number(row.value)) && row.date)
    .filter((row) => {
      const days = (anchor.getTime() - new Date(row.date).getTime()) / 86400000;
      return days >= 0 && days <= lookbackDays;
    })
    .map((row) => Number(row.value));
  if (arr.length < 2) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const lower = sorted.filter((v) => v < n).length;
  return Math.round((lower / sorted.length) * 10000) / 100;
}

// 计算当前回撤在已生成的历史回撤序列中的百分位。
// drawdowns 由每个交易日收盘价相对“截至当日累计最高收盘价”计算得到；
// currentValue 则使用当前实时价格，referenceHigh 使用整段历史的最高收盘价。
// 这里按业务口径统计 dd >= currentDd，即当前回撤比历史更浅或相等的交易日占比。
export function computeDrawdownPercentileFromSamples(currentValue, drawdowns, referenceHigh) {
  const current = Number(currentValue);
  const high = Number(referenceHigh);
  const arr = (Array.isArray(drawdowns) ? drawdowns : [])
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(high) || high <= 0 || arr.length < 2) return null;
  const currentDrawdown = Math.round((current / high - 1) * 100 * 1000000) / 1000000;
  if (!Number.isFinite(currentDrawdown)) return null;
  const shallowerOrEqual = arr.filter((drawdown) => drawdown >= currentDrawdown).length;
  return Math.round((shallowerOrEqual / arr.length) * 10000) / 100;
}

// 基于历史序列计算当前回撤深度在历史回撤中的百分位（0-100）。
// 每日回撤 = (当日收盘 / 截至当日累计最高 - 1) * 100
// 百分位 = 回撤 >= 当前回撤的交易日占比（即比现在回撤更浅或相等的天数占比）。
export function computeDrawdownPercentile(currentValue, values, { lookbackDays = HISTORY_LOOKBACK_DAYS, asOfDate } = {}) {
  const current = Number(currentValue);
  if (!Number.isFinite(current) || current <= 0) return null;
  const anchor = asOfDate ? new Date(asOfDate) : new Date();
  const arr = (values || [])
    .filter((row) => row && Number.isFinite(Number(row.value)) && Number(row.value) > 0 && row.date)
    .filter((row) => {
      const days = (anchor.getTime() - new Date(row.date).getTime()) / 86400000;
      return days >= 0 && days <= lookbackDays;
    })
    .map((row) => Number(row.value));
  if (arr.length < 2) return null;

  let runningMax = -Infinity;
  const drawdowns = arr.map((value) => {
    if (value > runningMax) runningMax = value;
    return (value / runningMax - 1) * 100;
  });

  const currentDrawdown = (current / runningMax - 1) * 100;
  if (!Number.isFinite(currentDrawdown)) return null;
  return computeDrawdownPercentileFromSamples(current, drawdowns, runningMax);
}
