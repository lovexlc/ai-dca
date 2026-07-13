/**
 * 统一的净值获取模块
 * 
 * 负责处理所有与基金净值相关的操作：
 * - 单个/批量拉取最新净值
 * - KV 缓存集成
 * - 市场类型检测（A股/美股）
 * - 新鲜度判断
 */

const FUND_CODE_PATTERN = /^\d{6}$/;
export const NAV_CACHE_PREFIX = 'nav:cache:';
const DEFAULT_PUBLIC_DATA_BASE_URL = 'https://api.freebacktrack.tech';

function sanitizeCode(value) {
  const code = String(value || '').trim();
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

function stripTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function publicDataBaseUrl(env = null) {
  return stripTrailingSlash(env?.PUBLIC_DATA_BASE_URL || DEFAULT_PUBLIC_DATA_BASE_URL);
}

function shanghaiDateFromTimestamp(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return '';
  try {
    return new Date(parsed).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch (_e) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
}

function fundMetricsUrl(baseUrl, { refresh = false } = {}) {
  const params = new URLSearchParams();
  if (refresh) params.set('refresh', '1');
  const query = params.toString();
  return `${stripTrailingSlash(baseUrl || DEFAULT_PUBLIC_DATA_BASE_URL)}/api/markets/fund-metrics${query ? `?${query}` : ''}`;
}

function normalizeFundKind(value = '') {
  const kind = String(value || '').trim().toLowerCase();
  return kind === 'exchange' || kind === 'qdii' || kind === 'otc' ? kind : '';
}

function normalizeFundKindHints(codes = [], fundKinds = {}) {
  const out = {};
  for (const code of codes) {
    const c = sanitizeCode(code);
    if (!c) continue;
    const kind = normalizeFundKind(fundKinds?.[c] || fundKinds?.[code]);
    if (kind) out[c] = kind;
  }
  return out;
}

export async function fetchFundMetricsPayload(env, codes = [], { refresh = false, fundKinds = {} } = {}) {
  const list = Array.from(new Set(codes.map((c) => sanitizeCode(c)).filter(Boolean)));
  if (!list.length) return { items: [], successCount: 0, failureCount: 0, generatedAt: '', tradingSession: false };
  const kindHints = normalizeFundKindHints(list, fundKinds);
  const url = fundMetricsUrl(publicDataBaseUrl(env), { refresh });
  const init = {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ codes: list, refresh, fundKinds: kindHints }),
    cf: { cacheTtl: refresh ? 0 : 15, cacheEverything: false }
  };
  const response = env?.MARKETS && typeof env.MARKETS.fetch === 'function'
    ? await env.MARKETS.fetch(new Request(url, init))
    : await fetch(url, init);
  if (!response.ok) {
    throw new Error(`fund-metrics 请求失败：HTTP ${response.status}`);
  }
  return await response.json().catch(() => ({}));
}

async function fetchFundMetricsMap(env, codes = [], options = {}) {
  const payload = await fetchFundMetricsPayload(env, codes, options);
  const out = {};
  for (const item of Array.isArray(payload?.items) ? payload.items : []) {
    const code = sanitizeCode(item?.code || '');
    if (!code || item?.ok === false) continue;
    out[code] = item;
  }
  return out;
}

export async function fetchFundMetricsForCodes(env, codes = [], options = {}) {
  return fetchFundMetricsMap(env, codes, options);
}

function metricToLatestNav(metric) {
  const code = sanitizeCode(metric?.code || '');
  if (!code) return null;
  const nav = Number(metric?.latestNav ?? metric?.navBase ?? metric?.iopv ?? metric?.price);
  const price = Number(metric?.price ?? metric?.currentPrice ?? metric?.close);
  if (!Number.isFinite(nav) || nav <= 0) return null;
  return {
    code,
    name: String(metric?.name || '').trim(),
    nav,
    latestNavDate: String(metric?.latestNavDate || metric?.navDate || '').trim(),
    source: metric?.source || 'fund-metrics',
    price: Number.isFinite(price) && price > 0 ? price : null,
    iopv: Number(metric?.iopv) || null,
    premiumPercent: Number(metric?.premiumPercent) || null,
    fundKind: String(metric?.fundKind || '').trim(),
    fundType: String(metric?.fundType || '').trim(),
    fundTypeCode: metric?.fundTypeCode ?? null
  };
}

function metricToPrice(metric) {
  const code = sanitizeCode(metric?.code || '');
  const price = Number(metric?.price ?? metric?.currentPrice ?? metric?.close);
  if (!code || !Number.isFinite(price) || price <= 0) return null;
  return {
    code,
    name: String(metric?.name || '').trim(),
    price,
    high: Number(metric?.high) || null,
    low: Number(metric?.low) || null,
    highPoint: metric?.highPoint && typeof metric.highPoint === 'object' ? metric.highPoint : null,
    yearHigh: Number(metric?.yearHigh) || null,
    historicalPercentile: Number.isFinite(Number(metric?.historicalPercentile)) ? Number(metric.historicalPercentile) : null,
    turnover: Number(metric?.turnover ?? metric?.amount) || null,
    preClose: Number(metric?.previousClose) || 0,
    date: shanghaiDateFromTimestamp(metric?.asOf) || String(metric?.latestNavDate || metric?.navDate || '').slice(0, 10),
    time: String(metric?.asOf || '').slice(11, 19),
    source: metric?.source || 'fund-metrics',
    latestNav: Number(metric?.latestNav) || null,
    latestNavDate: String(metric?.latestNavDate || metric?.navDate || '').trim(),
    iopv: Number(metric?.iopv) || null,
    premiumPercent: Number(metric?.premiumPercent) || null,
    orderBook: metric?.orderBook && typeof metric.orderBook === 'object' ? metric.orderBook : null,
    fundKind: String(metric?.fundKind || '').trim(),
    fundType: String(metric?.fundType || '').trim(),
    fundTypeCode: metric?.fundTypeCode ?? null
  };
}

function metricToHoldingSnapshot(metric, generatedAt = nowShanghaiIso()) {
  const code = sanitizeCode(metric?.code || '');
  if (!code) return null;
  const fundKind = String(metric?.fundKind || '').trim().toLowerCase();
  const exchangeMetric = fundKind === 'exchange' || isExchangeFundCode(code);
  const price = Number(metric?.price ?? metric?.currentPrice ?? metric?.close);
  const previousPrice = Number(metric?.previousClose);
  const nav = Number(metric?.latestNav ?? metric?.navBase ?? metric?.iopv);
  const previousFundNav = Number(metric?.previousNav);
  const navDate = String(metric?.latestNavDate || metric?.navDate || '').trim();
  const asOfDate = shanghaiDateFromTimestamp(metric?.asOf || generatedAt);
  const sourceUpdatedAt = String(metric?.updatedAt || '').trim();
  const latestNav = exchangeMetric && Number.isFinite(price) && price > 0
    ? price
    : (Number.isFinite(nav) && nav > 0 ? nav : NaN);
  const previousNav = exchangeMetric && Number.isFinite(previousPrice) && previousPrice > 0
    ? previousPrice
    : (Number.isFinite(previousFundNav) && previousFundNav > 0 ? previousFundNav : NaN);
  if (!Number.isFinite(latestNav) || latestNav <= 0) return null;
  return {
    ok: true,
    code,
    name: String(metric?.name || '').trim(),
    latestNav: roundNumber(latestNav, 4),
    latestNavDate: exchangeMetric && Number.isFinite(price) && price > 0 ? asOfDate : navDate,
    previousNav: Number.isFinite(previousNav) && previousNav > 0 ? roundNumber(previousNav, 4) : 0,
    previousNavDate: '',
    updatedAt: generatedAt,
    sourceUpdatedAt,
    source: metric?.source || 'fund-metrics',
    priceSource: metric?.source || 'fund-metrics',
    fundLatestNav: Number.isFinite(nav) && nav > 0 ? roundNumber(nav, 4) : null,
    fundLatestNavDate: navDate,
    iopv: Number(metric?.iopv) || null,
    premiumPercent: Number(metric?.premiumPercent) || null,
    cachePolicy: String(metric?.cachePolicy || '').trim(),
    fundKind: String(metric?.fundKind || '').trim(),
    fundType: String(metric?.fundType || '').trim(),
    fundTypeCode: metric?.fundTypeCode ?? null
  };
}

/**
 * 拉取单个基金的最新净值（统一走 markets/fund-metrics；不再单独回退其他实时源）
 * 
 * @param {Object} env - Worker env
 * @param {string} code - 基金代码
 * @returns {Promise<Object|null>} { code, name, nav, latestNavDate } 或 null
 */
export async function fetchLatestNav(env, code) {
  const c = sanitizeCode(code);
  if (!c) return null;
  try {
    const metrics = await fetchFundMetricsMap(env, [c], { refresh: false });
    return metricToLatestNav(metrics[c]);
  } catch (_error) {
    return null;
  }
}

/**
 * 拉取多个基金的最新净值（不使用缓存）
 * 
 * 使用场景：
 * - 初始化快照时的批量拉取
 * - 不需要 KV 缓存的简单场景
 * 
 * 对于需要缓存和市场检测的场景，请使用 fetchLatestNavMapWithCache
 * 
 * @param {Object} env - Worker env
 * @param {string[]} codes - 基金代码列表
 * @returns {Promise<Object>} { code → nav data }
 */
export async function fetchLatestNavMap(env, codes = []) {
  const list = Array.from(new Set(codes.map((c) => sanitizeCode(c)).filter(Boolean)));
  const results = await Promise.all(list.map((code) => fetchLatestNav(env, code)));
  const map = {};
  for (const entry of results) {
    if (entry && entry.code) map[entry.code] = entry;
  }
  return map;
}

/**
 * 统一的净值获取方法，支持 KV 缓存
 * 
 * 核心逻辑：
 * 1. 如果提供了 KV 操作函数，优先查缓存
 * 2. 若缓存过期/不存在，从源拉取
 * 3. 将新数据写回缓存
 * 4. 支持 A 股（markets/fund-metrics）和美股（Yahoo，暂未实现）
 * 
 * @param {Object} env - Worker env
 * @param {string} code - 基金代码
 * @param {string} fundKind - 基金类型 ('exchange'|'otc'|'qdii'|'us-stock'|'us')
 * @param {Object} options
 * @param {boolean} options.forceRefresh - 强制从源拉取，忽略缓存
 * @param {string} options.todayDate - 当前日期（用于判断净值是否最新）
 * @param {Function} options.readCache - 从 KV 读缓存函数 (key, fallback) → value
 * @param {Function} options.writeCache - 写入 KV 缓存函数 (key, value) → void
 * @param {Function} options.getExpectedLatestNavDate - 获取预期净值日期的函数 (fundKind, date) → dateString
 * @returns {Promise<Object|null>} { code, name, nav, latestNavDate } 或 null
 */
export async function getLatestNavWithCache(
  env,
  code,
  fundKind = 'exchange',
  {
    forceRefresh = false,
    todayDate = '',
    readCache = null,
    writeCache = null,
    getExpectedLatestNavDate = null
  } = {}
) {
  const c = sanitizeCode(code);
  if (!c) return null;

  // 如果没提供 KV 操作函数，则跳过缓存逻辑
  const hasCacheOps = typeof readCache === 'function' && typeof writeCache === 'function';
  const key = hasCacheOps ? `nav:cache:${c}` : '';

  // 1. 先查 KV 缓存
  if (!forceRefresh && hasCacheOps) {
    try {
      const cached = await readCache(key, null);
      if (cached && cached.code === c) {
        // 判断缓存是否仍然有效
        if (getExpectedLatestNavDate && todayDate) {
          const expectedDate = getExpectedLatestNavDate(fundKind, todayDate);
          const cachedDate = String(cached.latestNavDate || '').trim();
          if (cachedDate >= expectedDate) {
            // 缓存仍然有效，直接返回
            return cached;
          }
        } else if (!getExpectedLatestNavDate || !todayDate) {
          // 如果没有提供判断函数或日期，保守地使用缓存（只要存在）
          return cached;
        }
      }
    } catch (_error) {
      // 缓存读失败，继续走源拉取
    }
  }

  // 2. 从源拉取
  let nav = null;
  if (fundKind === 'us-stock' || fundKind === 'us') {
    // 美股：从 Yahoo Finance（未来实现）
    // nav = await fetchYahooPrice(c);
    console.warn(`[nav] us-stock 暂未实现：${c}`);
    return null;
  } else {
    // A 股：统一从 markets/fund-metrics 获取，缓存仍由调用方控制。
    nav = await fetchLatestNav(env, c);
  }

  if (!nav) return null;

  // 3. 写入 KV 缓存
  if (hasCacheOps) {
    try {
      await writeCache(key, nav);
    } catch (_error) {
      console.warn(`[nav] 缓存写入失败 ${c}:`, _error);
    }
  }

  return nav;
}

/**
 * 批量获取最新净值，支持 KV 缓存
 * 
 * 与 fetchLatestNavMapWithCache 类似，但接受 fundKinds 参数，
 * 支持为不同的代码指定不同的市场类型。
 * 
 * @param {Object} env - Worker env
 * @param {string[]} codes - 基金代码列表
 * @param {string[]} fundKinds - 对应的基金类型（如果为空，默认为 'exchange'）
 * @param {Object} options
 * @param {boolean} options.forceRefresh - 强制刷新
 * @param {string} options.todayDate - 当前日期
 * @param {Function} options.readCache - 从 KV 读缓存
 * @param {Function} options.writeCache - 写入 KV 缓存
 * @param {Function} options.getExpectedLatestNavDate - 获取预期净值日期的函数
 * @returns {Promise<Object>} { code → nav data }
 */
export async function fetchLatestNavMapWithCache(
  env,
  codes = [],
  fundKinds = [],
  {
    forceRefresh = false,
    todayDate = '',
    readCache = null,
    writeCache = null,
    getExpectedLatestNavDate = null
  } = {}
) {
  const list = Array.from(new Set(codes.map((c) => sanitizeCode(c)).filter(Boolean)));
  const results = await Promise.all(
    list.map((code, idx) => {
      const kind = fundKinds[idx] || 'exchange';
      return getLatestNavWithCache(env, code, kind, {
        forceRefresh,
        todayDate,
        readCache,
        writeCache,
        getExpectedLatestNavDate
      });
    })
  );
  const map = {};
  for (const entry of results) {
    if (entry && entry.code) map[entry.code] = entry;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Holdings NAV snapshots (exchange quote + fund NAV)
// ---------------------------------------------------------------------------

const EXCHANGE_FUND_CODE_PREFIXES = ['15', '50', '51', '52', '53', '54', '56', '58'];

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function normalizeText(value = '') {
  return String(value)
    .replace(/\u3000/g, ' ')
    .replace(/[，]/g, ',')
    .replace(/[：]/g, ':')
    .replace(/[．·•]/g, '.')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDate(rawValue = '') {
  const text = normalizeText(rawValue).replace(/[一]/g, '-');
  const separated = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (separated) {
    const [, year, month, day, hour, minute, second] = separated;
    const date = [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
    if (!hour || !minute) {
      return date;
    }

    return `${date} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${(second || '00').padStart(2, '0')}`;
  }

  const compact = text.match(/(20\d{2})(\d{2})(\d{2})(?:\s?(\d{2}):?(\d{2}):?(\d{2}))?/);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    const date = `${year}-${month}-${day}`;
    if (!hour || !minute || !second) {
      return date;
    }

    return `${date} ${hour}:${minute}:${second}`;
  }

  return text;
}

export function isExchangeFundCode(code) {
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  return EXCHANGE_FUND_CODE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export async function fetchFundMetricPrices(codes = [], env = null, { refresh = false, fundKinds = {} } = {}) {
  const list = Array.from(new Set(codes.map((c) => sanitizeCode(c)).filter(Boolean)));
  if (!list.length) return {};
  const metrics = await fetchFundMetricsMap(env, list, { refresh, fundKinds });
  const map = {};
  for (const code of list) {
    const quote = metricToPrice(metrics[code]);
    if (quote) map[code] = quote;
  }
  return map;
}

function epochMsToShanghaiIso(ms) {
  const t = Number.isFinite(ms) ? ms : Date.now();
  const shifted = new Date(t + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const M = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  const H = String(shifted.getUTCHours()).padStart(2, '0');
  const m = String(shifted.getUTCMinutes()).padStart(2, '0');
  const s = String(shifted.getUTCSeconds()).padStart(2, '0');
  const ms3 = String(shifted.getUTCMilliseconds()).padStart(3, '0');
  return `${y}-${M}-${d}T${H}:${m}:${s}.${ms3}+08:00`;
}

function nowShanghaiIso() {
  return epochMsToShanghaiIso(Date.now());
}

export async function fetchFundNavSnapshot(code, generatedAt = nowShanghaiIso(), env = null, options = {}) {
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error(`${code} 净值接口请求失败：无效基金代码。`);
  }
  const metrics = await fetchFundMetricsMap(env, [normalized], { refresh: false, fundKinds: options.fundKinds || {} });
  const snapshot = metricToHoldingSnapshot(metrics[normalized], generatedAt);
  if (!snapshot) throw new Error(`${normalized} fund-metrics 暂无可用净值/价格。`);
  return snapshot;
}

export async function fetchExchangeQuoteSnapshot(code, generatedAt = nowShanghaiIso(), env = null) {
  return fetchFundNavSnapshot(code, generatedAt, env);
}

export async function fetchHoldingSnapshot(code, generatedAt = nowShanghaiIso(), env = null) {
  if (isExchangeFundCode(code)) {
    return fetchExchangeQuoteSnapshot(code, generatedAt, env);
  }
  return fetchFundNavSnapshot(code, generatedAt, env);
}

// ---------------------------------------------------------------------------
// NAV history (daily series)
// ---------------------------------------------------------------------------

function compareIsoDate(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function minIsoDate(a, b) {
  return compareIsoDate(a, b) <= 0 ? a : b;
}

function monthKeyFromIsoDate(isoDate) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || '')) ? String(isoDate).slice(0, 7) : '';
}

function firstOfMonthIso(monthKey) {
  return /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? `${monthKey}-01` : '';
}

function lastOfMonthIso(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return '';
  const [year, month] = monthKey.split('-').map((n) => Number(n));
  const dt = new Date(Date.UTC(year, month, 0));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function nextMonthKey(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return '';
  const [year, month] = monthKey.split('-').map((n) => Number(n));
  const dt = new Date(Date.UTC(year, month, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

function enumerateMonthKeys(fromDate, toDate) {
  const start = monthKeyFromIsoDate(fromDate);
  const end = monthKeyFromIsoDate(toDate);
  if (!start || !end || start > end) return [];
  const out = [];
  for (let key = start; key && key <= end; key = nextMonthKey(key)) {
    out.push(key);
    if (key === end) break;
  }
  return out;
}

function filterNavItemsByDateRange(items, fromDate, toDate) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const date = String(item?.date || '').slice(0, 10);
    const nav = Number(item?.nav);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(nav) || nav <= 0) continue;
    if (date < fromDate || date > toDate || seen.has(date)) continue;
    seen.add(date);
    out.push({ date, nav: roundNumber(nav, 4) });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function buildNavHistoryKvKey(code, monthKey) {
  return `navhist:v1:${code}:${monthKey}`;
}

function hasNavHistoryKv(env) {
  return Boolean(env?.NAV_HISTORY_KV && typeof env.NAV_HISTORY_KV.get === 'function' && typeof env.NAV_HISTORY_KV.put === 'function');
}

function isHoldingsPayloadFresh(payload = {}, ttlMs = 0) {
  const expiresAt = Date.parse(String(payload?.expiresAt || ''));
  if (Number.isFinite(expiresAt)) {
    return expiresAt > Date.now();
  }

  const generatedAt = Date.parse(String(payload?.generatedAt || ''));
  return Number.isFinite(generatedAt) ? (generatedAt + ttlMs) > Date.now() : false;
}

function isNavHistoryKvMonthFresh(payload, monthKey, today, ttlMs) {
  if (!payload || payload.version !== 1 || payload.month !== monthKey || !Array.isArray(payload.items)) return false;
  const todayMonth = monthKeyFromIsoDate(today);
  const monthEnd = lastOfMonthIso(monthKey);
  const payloadTo = String(payload.to || '');
  if (todayMonth && monthKey < todayMonth) {
    return payloadTo >= monthEnd;
  }
  return isHoldingsPayloadFresh(payload, ttlMs);
}

async function readJsonFromNavHistoryKv(env, key) {
  try {
    const payload = await env.NAV_HISTORY_KV.get(key, { type: 'json' });
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

async function putJsonToNavHistoryKv(env, key, payload) {
  try {
    await env.NAV_HISTORY_KV.put(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

async function deleteNavHistoryKvKey(env, key) {
  try {
    await env.NAV_HISTORY_KV.delete(key);
  } catch { /* ignore */ }
}

function todayShanghaiIsoDate() {
  return epochMsToShanghaiIso(Date.now()).slice(0, 10);
}

export async function fetchFundNavHistoryWithMonthlyKv(code, fromDate, toDate, env, options = {}) {
  const today = String(options.today || todayShanghaiIsoDate()).slice(0, 10);
  const ttlMs = Math.max(60_000, Number(options.ttlMs) || 0);
  const forceBypass = options.forceBypass === true;
  const generatedAt = String(options.generatedAt || nowShanghaiIso());

  if (!hasNavHistoryKv(env)) {
    const items = await fetchFundNavHistory(code, fromDate, toDate);
    return {
      items,
      cache: { source: 'live', hit: false, kv: { enabled: false } }
    };
  }

  const months = enumerateMonthKeys(fromDate, toDate);
  const cachedItems = [];
  const missingMonths = [];
  let kvHits = 0;

  for (const monthKey of months) {
    const key = buildNavHistoryKvKey(code, monthKey);
    if (forceBypass) {
      await deleteNavHistoryKvKey(env, key);
      missingMonths.push(monthKey);
      continue;
    }
    const payload = await readJsonFromNavHistoryKv(env, key);
    if (isNavHistoryKvMonthFresh(payload, monthKey, today, ttlMs)) {
      kvHits += 1;
      cachedItems.push(...filterNavItemsByDateRange(payload.items, fromDate, toDate));
    } else {
      missingMonths.push(monthKey);
    }
  }

  const fetchedItems = [];
  for (const monthKey of missingMonths) {
    const monthStart = firstOfMonthIso(monthKey);
    const monthEnd = lastOfMonthIso(monthKey);
    const fetchFrom = monthStart;
    const fetchTo = minIsoDate(monthEnd, today);
    let monthItems = [];
    if (fetchFrom <= fetchTo) {
      monthItems = await fetchFundNavHistory(code, fetchFrom, fetchTo);
    }
    const monthPayload = {
      version: 1,
      code,
      month: monthKey,
      from: fetchFrom,
      to: fetchTo,
      count: monthItems.length,
      items: monthItems,
      generatedAt,
      expiresAt: monthKey < monthKeyFromIsoDate(today)
        ? null
        : epochMsToShanghaiIso(Date.parse(generatedAt) + ttlMs),
      updatedAt: generatedAt
    };
    await putJsonToNavHistoryKv(env, buildNavHistoryKvKey(code, monthKey), monthPayload);
    fetchedItems.push(...filterNavItemsByDateRange(monthItems, fromDate, toDate));
  }

  const items = filterNavItemsByDateRange([...cachedItems, ...fetchedItems], fromDate, toDate);
  const hadLiveFetch = missingMonths.length > 0;
  return {
    items,
    cache: {
      source: hadLiveFetch ? (kvHits > 0 ? 'kv-partial' : 'kv-fill') : 'kv',
      hit: !hadLiveFetch,
      kv: {
        enabled: true,
        monthKeys: months,
        hitMonths: kvHits,
        missMonths: missingMonths.length,
        force: forceBypass
      }
    }
  };
}

export async function fetchFundNavHistory(code, fromDate, toDate) {
  return fetchDanjuanFundNavHistory(code, fromDate, toDate);
}

async function fetchDanjuanFundNavHistory(code, fromDate, toDate) {
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error('蛋卷净值历史接口请求失败：无效基金代码。');
  }

  const headers = {
    accept: 'application/json, text/plain, */*',
    referer: 'https://danjuanfunds.com/',
    'user-agent': 'Mozilla/5.0'
  };
  const items = [];
  const pageSize = 100;
  for (let page = 1; page <= 50; page++) {
    const url = new URL(`https://danjuanfunds.com/djapi/fund/nav/history/${encodeURIComponent(normalized)}`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(pageSize));

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`${normalized} 蛋卷净值历史接口请求失败：HTTP ${response.status}`);
    }
    const rawText = await response.text();
    let payload;
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch (_error) {
      throw new Error(`${normalized} 蛋卷净值历史接口返回了非 JSON 响应。`);
    }

    const rows = Array.isArray(payload?.data?.items) ? payload.data.items : [];
    if (!rows.length) break;

    let reachedBeforeRange = false;
    for (const row of rows) {
      const date = normalizeDate(row?.date || '').slice(0, 10);
      const nav = Number(row?.nav ?? row?.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (date < fromDate) {
        reachedBeforeRange = true;
        continue;
      }
      if (date > toDate || !Number.isFinite(nav) || nav <= 0) continue;
      items.push({ date, nav: roundNumber(nav, 4) });
    }

    const totalItems = Number(payload?.data?.total_items) || 0;
    if (reachedBeforeRange || (totalItems > 0 && page * pageSize >= totalItems)) break;
  }

  items.sort((a, b) => a.date.localeCompare(b.date));
  return items;
}
