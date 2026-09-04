// beta 行情数据层：小程序 tidbMarket 云函数的 action 契约（纯逻辑，不含网络）。
//
// 小程序侧是 wx.cloud.callFunction({ name:'tidbMarket', data:{ action, ... } })，
// 网页端没有 wx.cloud，请求最终要落到 markets worker。本文件只负责：
//   1. action 名与历史别名的归一化（对齐 cloudfunctions/tidbMarket/index.js）
//   2. 基金代码归一化（对齐 index.js::normalizeCode）
//   3. 场内 ETF 白名单与 etf_quotes 缓存新鲜度（对齐 tidbMarket/cache.js）
//   4. 统一的成功/失败返回形状（对齐 index.js::fail）

export const MARKET_ACTIONS = Object.freeze([
  'ping',
  'fund-list',
  'fund-detail',
  'fund-history',
  'fund-intraday',
  'fund-quote',
  'home-overview',
  'home-series',
  'premium-history',
  'fund-limit-overview'
]);

// 小程序端历史上长短写法都用过，两种都要认。
export const ACTION_ALIASES = Object.freeze({
  list: 'fund-list',
  detail: 'fund-detail',
  history: 'fund-history'
});

const ACTION_SET = new Set(MARKET_ACTIONS);

export function normalizeAction(action) {
  const raw = String(action || '').trim().toLowerCase();
  if (!raw) return null;
  if (ACTION_SET.has(raw)) return raw;
  const alias = ACTION_ALIASES[raw];
  return alias && ACTION_SET.has(alias) ? alias : null;
}

export function isMarketAction(action) {
  return normalizeAction(action) !== null;
}

// 对齐 cloudfunctions/tidbMarket/index.js::normalizeCode：
// 去掉 sh/sz/bj 前缀后必须是 6 位数字，否则视为非法。
export function normalizeFundCode(code) {
  const raw = String(code || '').trim().replace(/^(sh|sz|bj)/i, '');
  return /^\d{6}$/.test(raw) ? raw : null;
}

export function normalizeFundCodes(codes) {
  const list = Array.isArray(codes) ? codes : [codes];
  const seen = new Set();
  for (const item of list) {
    const code = normalizeFundCode(item);
    if (code) seen.add(code);
  }
  return Array.from(seen);
}

// 21 只场内 ETF —— 与 cloudfunctions/tidbMarket/cache.js::EXCHANGE_CODES 保持同步。
export const EXCHANGE_CODES = Object.freeze([
  '513870', '513390', '513300', '513110', '513100', '159941', '159696', '159660',
  '159659', '159632', '159513', '159509', '159501', '159577', '161128', '161130',
  '513500', '513650', '159612', '159655', '513850'
]);

const EXCHANGE_CODE_SET = new Set(EXCHANGE_CODES);

export function isExchangeCode(code) {
  const normalized = normalizeFundCode(code);
  return normalized !== null && EXCHANGE_CODE_SET.has(normalized);
}

// 缓存新鲜度阈值，对齐 cache.js::QUOTE_STALE_MS：update_time 距今超过 90s 即回源。
export const QUOTE_STALE_MS = 90000;

export function isQuoteFresh(updateTime, now = Date.now()) {
  const stamp = Number(updateTime);
  if (!Number.isFinite(stamp) || stamp <= 0) return false;
  const age = Number(now) - stamp;
  return age >= 0 && age <= QUOTE_STALE_MS;
}

// 缓存分层判定：fresh 且命中全部代码才走缓存，否则回源。
export function resolveQuoteTier({
  updateTime = 0,
  cachedCodes = [],
  requestedCodes = [],
  now = Date.now()
} = {}) {
  const wanted = normalizeFundCodes(requestedCodes);
  if (!wanted.length) return { tier: 'empty', missing: [], useCache: false };
  if (!isQuoteFresh(updateTime, now)) return { tier: 'stale', missing: wanted, useCache: false };
  const available = new Set(normalizeFundCodes(cachedCodes));
  const missing = wanted.filter((code) => !available.has(code));
  if (missing.length) return { tier: 'partial', missing, useCache: true };
  return { tier: 'fresh', missing: [], useCache: true };
}

export function actionFailure(message, extra = {}) {
  return { ok: false, error: String(message || 'unknown error'), ...extra };
}

export function actionSuccess(data = {}) {
  return { ok: true, ...data };
}
