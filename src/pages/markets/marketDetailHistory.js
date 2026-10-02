// 详情页历史数据（K 线 / 净值历史 / 溢价快照）的纯逻辑层：
// 请求规划（区间身份键）、settled/inflight 去重判定、净值历史状态构造、
// 以及对比标的的"是否需要请求"决策。MarketsExperience 只做调度，
// 网络与状态写入在 useMarketDetailHistory / MarketSymbolDetailPanel 中完成。
import {
  buildNavSnapshotItems,
  chartKlineCacheKeyForRange,
  chartKlineRequestForRange,
  navHistoryCacheKey,
  navHistoryQueryForRange,
} from './marketFundMetrics.js';
import { normalizeCnFundCode } from './marketDisplayUtils.js';

// ---- 请求规划：以市场、规范化代码和请求区间识别结果 ----

export function planDetailKlineRequest(market, symbol, rangeKey, customRange) {
  const request = chartKlineRequestForRange(rangeKey, customRange);
  const cacheKey = chartKlineCacheKeyForRange(symbol, rangeKey, customRange);
  const limitLabel = String(request.limit || 'default');
  return {
    market,
    symbol: String(symbol || '').trim(),
    rangeKey,
    customRange,
    request,
    cacheKey,
    inflightKey: `${cacheKey}|${limitLabel}`,
    requestKey: `${market}|${cacheKey}|${limitLabel}`,
  };
}

export function planDetailNavRequest(code, rangeKey, customRange) {
  return {
    code: normalizeCnFundCode(code),
    query: navHistoryQueryForRange(rangeKey, customRange),
    key: navHistoryCacheKey(code, rangeKey, customRange),
  };
}

// ---- 去重判定：热缓存 / 同请求在途 / 已请求过都不重复请求 ----

export function shouldRequestDetailKline({ settled = false, inflight = false, force = false } = {}) {
  if (inflight) return false;
  if (force) return true;
  return !settled;
}

export function shouldRequestDetailNavHistory({ settled = false, inflight = false, force = false } = {}) {
  if (inflight) return false;
  if (force) return true;
  return !settled;
}

// ---- 净值历史状态构造 ----
// 状态字段：loading / items / error / requestFrom / requestTo（规范化请求范围）、
// firstNavDate / lastNavDate（实际数据首尾）、source / degraded / stale。
// 两条净值快照兜底只能标记为降级数据，绝不能当作完整历史。

export function detailNavItemsMeta(items = []) {
  const list = (Array.isArray(items) ? items : [])
    .map((item) => String(item?.date || '').slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort((a, b) => a.localeCompare(b));
  return {
    count: list.length,
    firstNavDate: list[0] || '',
    lastNavDate: list[list.length - 1] || '',
  };
}

export function buildDetailNavStateFromPayload(prevState = {}, { items = [], source = 'live', stale = false } = {}, { query = {}, degraded = false, error = '' } = {}) {
  const list = Array.isArray(items) ? items : [];
  const meta = detailNavItemsMeta(list);
  return {
    loading: false,
    items: list,
    error: list.length ? '' : (String(error || '') || '暂无净值历史数据'),
    requestFrom: String(query?.from || ''),
    requestTo: String(query?.to || ''),
    firstNavDate: meta.firstNavDate,
    lastNavDate: meta.lastNavDate,
    source: degraded ? 'nav-snapshot' : String(source || 'live'),
    degraded: degraded === true,
    stale: stale === true,
  };
}

export function buildDetailNavErrorState(prevState = {}, error, { query = {} } = {}) {
  const message = error instanceof Error ? error.message : (error ? String(error) : '净值历史加载失败');
  return {
    loading: false,
    items: Array.isArray(prevState?.items) ? prevState.items : [],
    error: message,
    requestFrom: String(query?.from || prevState?.requestFrom || ''),
    requestTo: String(query?.to || prevState?.requestTo || ''),
    firstNavDate: prevState?.firstNavDate || '',
    lastNavDate: prevState?.lastNavDate || '',
    source: prevState?.source || '',
    degraded: prevState?.degraded === true,
    stale: prevState?.stale === true,
  };
}

// 拉取单只基金的净值历史，并按统一口径构造状态。
// 历史接口返回不足两条时才允许快照兜底（只标降级）；历史充足时绝不调用快照接口。
export async function loadDetailNavHistoryState({
  code,
  query,
  prevState = null,
  getNavHistory,
  getNavSnapshot,
  buildSnapshotItems = buildNavSnapshotItems,
}) {
  let payload = null;
  let loadError = null;
  try {
    payload = await getNavHistory(code, query);
  } catch (error) {
    loadError = error;
  }
  let items = Array.isArray(payload?.items) ? payload.items : [];
  let degraded = false;
  if (items.length < 2) {
    try {
      const snapshot = await getNavSnapshot(code);
      const snapshotItems = buildSnapshotItems(snapshot);
      if (snapshotItems.length > items.length) {
        items = snapshotItems;
        degraded = true;
      }
    } catch {
      // 快照兜底失败时继续使用 nav-history 的结果。
    }
  }
  if (loadError && !items.length) {
    return buildDetailNavErrorState(prevState || {}, loadError, { query });
  }
  return buildDetailNavStateFromPayload(prevState || {}, {
    items,
    source: payload?.cache?.source || 'live',
    stale: payload?.stale === true,
  }, {
    query,
    degraded,
    error: loadError ? String(loadError instanceof Error ? loadError.message : loadError) : '',
  });
}

// ---- 对比标的请求决策（“不会调用”守卫）----

// 对比 K 线：场外基金没有场内 K 线，直接短路；失败后等待显式重试，
// 不把 error 当永久终止条件（重试会清除 errorArmed）。
export function shouldFetchCompareKline({ market, symbol = '', isOtc = false, settled = false, inflight = false, errorArmed = false } = {}) {
  if (!symbol) return false;
  if (market === 'cn' && isOtc) return false;
  if (inflight) return false;
  if (errorArmed) return false;
  return !settled;
}

// 对比净值历史：溢价/净值指标需要净值；价格模式只在场外基金（价格即净值）
// 或 K 线确实不可用时才兜底，不为健康的价格模式拉无用途净值。
export function shouldFetchCompareNavHistory({
  market,
  code = '',
  param = 'price',
  isOtc = false,
  klineSettled = false,
  klineUsable = false,
  settled = false,
  inflight = false,
} = {}) {
  if (market !== 'cn' || !/^\d{6}$/.test(code)) return false;
  if (param === 'premium' && isOtc) return false; // 场外溢价本地短路为不支持
  if (inflight) return false;
  if (settled) return false;
  if (param !== 'price') return true;
  if (isOtc) return true;
  return klineSettled && !klineUsable;
}

// 对比溢价快照：按标的自身缓存；价格模式不需要；场外溢价不支持。
export function shouldFetchComparePremiumSnapshot({ market, code = '', param = 'price', isOtc = false, settled = false, inflight = false } = {}) {
  if (market !== 'cn' || !/^\d{6}$/.test(code)) return false;
  if (param === 'price') return false;
  if (param === 'premium' && isOtc) return false;
  if (inflight) return false;
  return !settled;
}
