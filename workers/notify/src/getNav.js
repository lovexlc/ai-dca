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
const DEFAULT_PUBLIC_DATA_BASE_URL = 'https://tools.freebacktrack.tech';

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

function xueqiuFundDataUrl(baseUrl, code, { refresh = false, raw = true } = {}) {
  const params = new URLSearchParams();
  if (refresh) params.set('refresh', '1');
  if (raw) params.set('raw', '1');
  const query = params.toString();
  return `${stripTrailingSlash(baseUrl || DEFAULT_PUBLIC_DATA_BASE_URL)}/api/markets/xueqiu-fund-data/${encodeURIComponent(code)}${query ? `?${query}` : ''}`;
}

function extractXueqiuQuoteFromFundData(payload) {
  return payload?.results?.quote_detail?.raw?.data?.quote || payload?.results?.quote_detail?.summary?.quote || null;
}

async function fetchXueqiuQuoteSnapshot(code, { refresh = false, env = null } = {}) {
  const c = sanitizeCode(code);
  if (!c) return null;
  try {
    const response = await fetch(xueqiuFundDataUrl(publicDataBaseUrl(env), c, { refresh, raw: true }), {
      headers: { accept: 'application/json' },
      cf: { cacheTtl: 15, cacheEverything: false }
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const quote = extractXueqiuQuoteFromFundData(payload);
    if (!quote) return null;
    const price = Number(quote.current);
    const nav = Number(quote.unit_nav);
    if (!Number.isFinite(price) || price <= 0) return null;
    return {
      code: c,
      name: String(quote.name || '').trim(),
      price,
      preClose: Number(quote.last_close) || 0,
      open: Number(quote.open) || 0,
      high: Number(quote.high) || 0,
      low: Number(quote.low) || 0,
      date: String(quote.nav_date || quote.timestamp || '').trim(),
      time: String(quote.time || '').trim(),
      source: 'xueqiu-quote',
      latestNav: Number.isFinite(nav) && nav > 0 ? nav : price,
      latestNavDate: String(quote.nav_date || '').trim(),
      iopv: Number(quote.iopv) || null,
      premiumPercent: Number(quote.premium_rate) || null
    };
  } catch (_error) {
    return null;
  }
}

/**
 * 拉取单个基金的最新净值（优先雪球实时 quote，失败再回退到 latest-nav.json；不使用缓存）
 * 
 * @param {Object} env - Worker env
 * @param {string} code - 基金代码
 * @returns {Promise<Object|null>} { code, name, nav, latestNavDate } 或 null
 */
export async function fetchLatestNav(env, code) {
  const c = sanitizeCode(code);
  if (!c) return null;
  const xueqiu = await fetchXueqiuQuoteSnapshot(c, { refresh: false, env });
  if (xueqiu) {
    return {
      code: c,
      name: xueqiu.name,
      nav: xueqiu.latestNav,
      latestNavDate: xueqiu.latestNavDate,
      source: xueqiu.source,
      price: xueqiu.price,
      iopv: xueqiu.iopv,
      premiumPercent: xueqiu.premiumPercent
    };
  }

  const baseUrl = publicDataBaseUrl(env);
  try {
    const response = await fetch(`${baseUrl}/data/${c}/latest-nav.json`, {
      headers: { accept: 'application/json' },
      // 一天内 NAV 不会变化太多次；缓存 10 分钟即可。
      cf: { cacheTtl: 600, cacheEverything: true }
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const nav = Number(payload?.latestNav);
    if (!Number.isFinite(nav) || nav <= 0) return null;
    return {
      code: c,
      name: String(payload?.name || '').trim(),
      nav,
      latestNavDate: String(payload?.latestNavDate || '').trim()
    };
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
 * 4. 支持 A 股（latest-nav.json）和美股（Yahoo，暂未实现）
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
    // A 股：从 latest-nav.json
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

function shiftIsoDateDays(isoDate, deltaDays) {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const parts = isoDate.split('-').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return '';
  const ref = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  ref.setUTCDate(ref.getUTCDate() + deltaDays);
  const y = ref.getUTCFullYear();
  const m = String(ref.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ref.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isExchangeFundCode(code) {
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  return EXCHANGE_FUND_CODE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function resolveExchangeMarket(code) {
  return String(code || '').startsWith('15') ? '0' : '1';
}

function sinaSymbol(code) {
  const c = sanitizeCode(code);
  if (!c) return '';
  // 沪市 ETF 主要是 5 / 6 / 9 开头；深市 ETF 主要是 1 / 0 / 3 开头。
  return /^[569]/.test(c) ? `sh${c}` : `sz${c}`;
}

export async function fetchSinaPrices(codes = []) {
  const list = Array.from(new Set(codes.map((c) => sanitizeCode(c)).filter(Boolean)));
  if (!list.length) return {};

  const xueqiuResults = await Promise.all(list.map((code) => fetchXueqiuQuoteSnapshot(code, { refresh: false })));
  const map = {};
  for (const item of xueqiuResults) {
    if (!item || !item.code) continue;
    map[item.code] = item;
  }

  const missing = list.filter((code) => !map[code]);
  if (!missing.length) return map;

  const symbols = Array.from(new Set(missing.map((c) => sinaSymbol(c)).filter(Boolean)));
  if (!symbols.length) return map;
  const url = 'https://' + 'hq.sinajs.cn/list=' + symbols.join(',');
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Referer: 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0 (compatible; ai-dca-notify/1.0)'
    },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) {
    throw new Error(`新浪行情请求失败：状态 ${response.status}`);
  }
  // 新浪原文是 GB18030，但数字、逗号、引号、等号、英文字母均为 ASCII；
  // 这里只消费数字字段，中文名称乱码不影响解析。
  const text = await response.text();
  const re = /var\s+hq_str_(sh|sz)(\d{6})="([^"]*)";?/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const code = match[2];
    const fields = String(match[3] || '').split(',');
    if (fields.length < 4) continue;
    const price = Number(fields[3]);
    if (!Number.isFinite(price) || price <= 0) continue;
    map[code] = {
      code,
      price,
      preClose: Number(fields[2]) || 0,
      open: Number(fields[1]) || 0,
      high: Number(fields[4]) || 0,
      low: Number(fields[5]) || 0,
      date: String(fields[30] || '').trim(),
      time: String(fields[31] || '').trim(),
      source: 'sina-close-price'
    };
  }
  return map;
}

async function fetchSinaExchangeQuoteSnapshot(code, generatedAt = nowShanghaiIso()) {
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error(`${code} 新浪行情请求失败：无效基金代码。`);
  }
  const priceMap = await fetchSinaPrices([normalized]);
  const quote = priceMap[normalized];
  const latestPrice = Number(quote?.price);
  const previousPrice = Number(quote?.preClose);
  if (!Number.isFinite(latestPrice) || latestPrice <= 0) {
    throw new Error(`${normalized} 新浪行情暂无最新交易价。`);
  }
  if (!Number.isFinite(previousPrice) || previousPrice <= 0) {
    throw new Error(`${normalized} 新浪行情缺少昨收价。`);
  }
  const latestDate = normalizeDate(quote?.date || '') || epochMsToShanghaiIso(Date.parse(generatedAt)).slice(0, 10);
  return {
    ok: true,
    code: normalized,
    name: '',
    latestNav: roundNumber(latestPrice, 4),
    latestNavDate: latestDate,
    previousNav: roundNumber(previousPrice, 4),
    previousNavDate: latestDate ? shiftIsoDateDays(latestDate, -1) : '',
    updatedAt: generatedAt,
    source: 'sina-close-price',
    priceSource: 'sina-close-price',
    time: String(quote?.time || '').trim()
  };
}

function formatShanghaiDateFromEpochSec(seconds) {
  const ms = Number(seconds) > 0 ? Number(seconds) * 1000 : Date.now();
  const shifted = new Date(ms + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

export async function fetchFundNavSnapshot(code, generatedAt = nowShanghaiIso()) {
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error(`${code} 净值接口请求失败：无效基金代码。`);
  }

  const url = new URL('https://api.fund.eastmoney.com/f10/lsjz');
  url.searchParams.set('fundCode', normalized);
  url.searchParams.set('pageIndex', '1');
  url.searchParams.set('pageSize', '6');

  const response = await fetch(url.toString(), {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: 'https://fundf10.eastmoney.com/',
      'user-agent': 'Mozilla/5.0'
    }
  });

  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      throw new Error(`${normalized} 净值接口返回了非 JSON 响应。`);
    }
  }

  if (!response.ok) {
    throw new Error(`${normalized} 净值接口请求失败：HTTP ${response.status}`);
  }

  if (Number(payload?.ErrCode || 0) !== 0) {
    throw new Error(payload?.ErrMsg || `${normalized} 净值接口返回错误。`);
  }

  const rows = Array.isArray(payload?.Data?.LSJZList) ? payload.Data.LSJZList : [];
  const latestIndex = rows.findIndex((row) => Number(row?.DWJZ) > 0);
  if (latestIndex < 0) {
    throw new Error(`${normalized} 暂未查询到最新净值。`);
  }

  const latestRow = rows[latestIndex];
  const previousRow = rows.slice(latestIndex + 1).find((row) => Number(row?.DWJZ) > 0);
  if (!previousRow) {
    throw new Error(`${normalized} 暂未查询到上一交易日净值。`);
  }

  return {
    ok: true,
    code: normalized,
    name: '',
    latestNav: roundNumber(Number(latestRow?.DWJZ) || 0, 4),
    latestNavDate: normalizeDate(latestRow?.FSRQ || ''),
    previousNav: roundNumber(Number(previousRow?.DWJZ) || 0, 4),
    previousNavDate: normalizeDate(previousRow?.FSRQ || ''),
    updatedAt: generatedAt
  };
}

async function fetchEastmoneyExchangeQuoteSnapshot(code, generatedAt = nowShanghaiIso()) {
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error(`${code} 东财场内行情请求失败：无效基金代码。`);
  }

  const market = resolveExchangeMarket(normalized);
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/get');
  url.searchParams.set('secid', `${market}.${normalized}`);
  url.searchParams.set('fields', 'f43,f60,f86,f57,f58,f1');
  url.searchParams.set('_', String(Date.now()));

  const response = await fetch(url.toString(), {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: 'https://quote.eastmoney.com/',
      'user-agent': 'Mozilla/5.0'
    }
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`${normalized} 东财场内行情请求失败：HTTP ${response.status}`);
  }

  let payload = {};
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      throw new Error(`${normalized} 东财场内行情接口返回了非 JSON 响应。`);
    }
  }

  const data = payload?.data;
  if (!data || typeof data !== 'object') {
    throw new Error(`${normalized} 东财暂未查询到场内实时行情。`);
  }

  const scale = Math.max(Math.min(Number(data.f1) || 3, 6), 0);
  const divisor = Math.pow(10, scale);
  const latestRaw = Number(data.f43);
  const previousRaw = Number(data.f60);
  if (!(latestRaw > 0)) {
    throw new Error(`${normalized} 东财场内行情暂无最新交易价。`);
  }
  if (!(previousRaw > 0)) {
    throw new Error(`${normalized} 东财场内行情缺少昨收价。`);
  }

  const latestPrice = roundNumber(latestRaw / divisor, 4);
  const previousPrice = roundNumber(previousRaw / divisor, 4);
  const latestDate = formatShanghaiDateFromEpochSec(data.f86);
  const previousDate = shiftIsoDateDays(latestDate, -1);
  const name = String(data.f58 || '').trim();

  return {
    ok: true,
    code: normalized,
    name,
    latestNav: latestPrice,
    latestNavDate: latestDate,
    previousNav: previousPrice,
    previousNavDate: previousDate,
    updatedAt: generatedAt,
    source: 'eastmoney-exchange-quote',
    priceSource: 'eastmoney-exchange-quote'
  };
}

export async function fetchExchangeQuoteSnapshot(code, generatedAt = nowShanghaiIso()) {
  try {
    return await fetchSinaExchangeQuoteSnapshot(code, generatedAt);
  } catch (sinaError) {
    try {
      const fallback = await fetchEastmoneyExchangeQuoteSnapshot(code, generatedAt);
      return {
        ...fallback,
        source: fallback.source || 'eastmoney-exchange-quote',
        priceSource: fallback.priceSource || 'eastmoney-exchange-quote',
        fallbackFrom: 'sina-close-price',
        fallbackReason: sinaError instanceof Error ? sinaError.message : String(sinaError || '')
      };
    } catch (eastmoneyError) {
      const eastmoneyMessage = eastmoneyError instanceof Error ? eastmoneyError.message : String(eastmoneyError || '');
      const sinaMessage = sinaError instanceof Error ? sinaError.message : String(sinaError || '');
      throw new Error(`${String(code || '').trim()} 场内行情请求失败：新浪 ${sinaMessage}; 东财 ${eastmoneyMessage}`);
    }
  }
}

export async function fetchHoldingSnapshot(code, generatedAt = nowShanghaiIso()) {
  if (isExchangeFundCode(code)) {
    return fetchExchangeQuoteSnapshot(code, generatedAt);
  }
  return fetchFundNavSnapshot(code, generatedAt);
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
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error('净值历史接口请求失败：无效基金代码。');
  }
  const headers = {
    accept: 'application/json, text/plain, */*',
    referer: 'https://fundf10.eastmoney.com/jjjz_' + encodeURIComponent(normalized) + '.html',
    'user-agent': 'Mozilla/5.0'
  };
  const items = [];
  const pageSize = 40;
  let pageIndex = 1;
  for (let p = 0; p < 50; p++) {
    const url = new URL('https://api.fund.eastmoney.com/f10/lsjz');
    url.searchParams.set('fundCode', normalized);
    url.searchParams.set('pageIndex', String(pageIndex));
    url.searchParams.set('pageSize', String(pageSize));
    url.searchParams.set('startDate', fromDate);
    url.searchParams.set('endDate', toDate);

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`${normalized} 净值历史接口请求失败：HTTP ${response.status}`);
    }
    const rawText = await response.text();
    let payload;
    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch (_error) {
      throw new Error(`${normalized} 净值历史接口返回了非 JSON 响应。`);
    }
    if (Number(payload?.ErrCode || 0) !== 0) {
      throw new Error(payload?.ErrMsg || `${normalized} 净值历史接口返回错误。`);
    }
    const rows = Array.isArray(payload?.Data?.LSJZList) ? payload.Data.LSJZList : [];
    for (const row of rows) {
      const nav = Number(row?.DWJZ);
      const date = normalizeDate(row?.FSRQ || '');
      if (!date || !Number.isFinite(nav) || nav <= 0) continue;
      items.push({ date, nav: roundNumber(nav, 4) });
    }
    const total = Number(payload?.TotalCount) || 0;
    if (pageIndex * pageSize >= total) break;
    if (!rows.length) break;
    pageIndex++;
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  return items;
}
