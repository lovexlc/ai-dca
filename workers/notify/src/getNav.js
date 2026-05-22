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

function sanitizeCode(value) {
  const code = String(value || '').trim();
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

function stripTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

/**
 * 拉取单个基金的最新净值（从源拉取，不使用缓存）
 * 
 * @param {Object} env - Worker env
 * @param {string} code - 基金代码
 * @returns {Promise<Object|null>} { code, name, nav, latestNavDate } 或 null
 */
export async function fetchLatestNav(env, code) {
  const c = sanitizeCode(code);
  if (!c) return null;
  const baseUrl = stripTrailingSlash(env?.PUBLIC_DATA_BASE_URL || 'https://tools.freebacktrack.tech');
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
