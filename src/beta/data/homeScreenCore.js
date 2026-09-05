// beta 首页核心：把三段不同源的数据拼成首页（纯逻辑，零 import）。
//
// 首页在小程序里是「一眼看完」的页：账户概览 + 自选涨跌 + 大盘。
// 这三段来自三个不同的源，任何一段挂掉都不应该让另两段跟着空。
//
// 四条钉住的规则：
//   1. 三段独立降级：每段各自 try/catch、各自带状态与提示，
//      一段失败只影响那一张卡片，其余照常渲染。首页没有致命失败。
//   2. 涨跌榜只排有数据的行：停牌、拿不到快照的不参与排名，
//      而不是当 0% 挤在榜中间。
//   3. 空自选单 / 空持仓是引导态，不是错误态。
//   4. home-overview 网页端还没接线（网关返回 unsupported）：
//      标成 unsupported 静默处理，不在首页刷一条红色报错。

export const MOVER_LIMIT = 3;
export const HOLDING_LIMIT = 3;

export const INITIAL_HOME_STATE = Object.freeze({
  status: 'idle',
  holdings: Object.freeze({ status: 'idle', summary: null, rows: [], error: '' }),
  markets: Object.freeze({ status: 'idle', gainers: [], losers: [], summary: null, error: '' }),
  overview: Object.freeze({ status: 'idle', indices: [], error: '' }),
  error: '',
  updatedAt: 0,
  requestId: 0
});

const REQUIRED_DEPS = ['loadHoldings', 'loadMarkets', 'callAction'];

const OVERVIEW_LIST_KEYS = ['indices', 'items', 'list', 'rows', 'data'];
const OVERVIEW_CHANGE_KEYS = ['changePercent', 'changePct', 'change_percent', 'percent'];
const OVERVIEW_PRICE_KEYS = ['price', 'current', 'close', 'last', 'lastPrice'];

/**
 * null / undefined / 空串一律当「没数据」而不是 0。
 * Number(null) === 0，直接用 Number 会把拿不到涨跌幅的行当 0% 送上榜。
 */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickNumberField(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (let i = 0; i < keys.length; i += 1) {
    const num = toNumber(source[keys[i]]);
    if (num !== null) return num;
  }
  return null;
}

export function errorMessage(error, fallback = '首页加载失败') {
  if (typeof error === 'string') return error.trim() || fallback;
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  return fallback;
}

export function directionOf(value) {
  const num = toNumber(value);
  if (num === null || num === 0) return 'flat';
  return num > 0 ? 'up' : 'down';
}

/** 只有拿到真涨跌幅的行才能上榜。 */
export function isRankable(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.missing || row.suspended) return false;
  return toNumber(row.changePercent) !== null;
}

/** 领涨 / 领跌各取前几名；全平时两边都空。 */
export function pickMovers(rows, limit = MOVER_LIMIT) {
  const list = Array.isArray(rows) ? rows.filter(isRankable) : [];
  const gainers = list
    .filter((row) => Number(row.changePercent) > 0)
    .sort((a, b) => Number(b.changePercent) - Number(a.changePercent))
    .slice(0, limit);
  const losers = list
    .filter((row) => Number(row.changePercent) < 0)
    .sort((a, b) => Number(a.changePercent) - Number(b.changePercent))
    .slice(0, limit);
  return { gainers, losers };
}

/** 首页只展示市值最大的几只。 */
export function topHoldings(rows, limit = HOLDING_LIMIT) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  list.sort((a, b) => Number((b && b.marketValue) || 0) - Number((a && a.marketValue) || 0));
  return list.slice(0, limit);
}

export function buildHoldingsSection(result) {
  if (!result || typeof result !== 'object') {
    return { status: 'error', summary: null, rows: [], error: '持仓加载失败' };
  }
  if (result.ok !== true) {
    return {
      status: 'error',
      summary: result.summary || null,
      rows: [],
      error: errorMessage(result.error, '持仓加载失败')
    };
  }
  if (result.empty) {
    return { status: 'empty', summary: result.summary || null, rows: [], error: '' };
  }
  return {
    status: 'ready',
    summary: result.summary || null,
    rows: topHoldings(result.rows),
    // 行情降级的提示要带到首页，否则用户不知道数字是估的。
    error: result.error ? errorMessage(result.error, '') : ''
  };
}

export function buildMarketsSection(result) {
  if (!result || typeof result !== 'object') {
    return { status: 'error', gainers: [], losers: [], summary: null, error: '行情加载失败' };
  }
  if (result.ok !== true) {
    return {
      status: 'error',
      gainers: [],
      losers: [],
      summary: result.summary || null,
      error: errorMessage(result.error, '行情加载失败')
    };
  }
  if (result.empty) {
    return { status: 'empty', gainers: [], losers: [], summary: result.summary || null, error: '' };
  }
  const movers = pickMovers(result.rows);
  return {
    status: 'ready',
    gainers: movers.gainers,
    losers: movers.losers,
    summary: result.summary || null,
    error: ''
  };
}

/**
 * 大盘概览的返回体形状尚未固定（worker 端还没接线），
 * 这里宽容地接：数组、常见列表字段、或者 quotes 映射都能认。
 * 认不出来就返回空数组，不猜字段。
 */
export function normalizeOverviewItems(payload) {
  let raw = null;
  if (Array.isArray(payload)) {
    raw = payload;
  } else if (payload && typeof payload === 'object') {
    for (let i = 0; i < OVERVIEW_LIST_KEYS.length; i += 1) {
      const candidate = payload[OVERVIEW_LIST_KEYS[i]];
      if (Array.isArray(candidate)) {
        raw = candidate;
        break;
      }
    }
    if (!raw && payload.quotes && typeof payload.quotes === 'object') {
      raw = Object.keys(payload.quotes).map((code) => {
        const item = payload.quotes[code] || {};
        return { code, ...item };
      });
    }
  }
  if (!Array.isArray(raw)) return [];

  const items = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const code = String(item.code || item.symbol || '').trim();
    const name = String(item.name || item.title || '').trim() || code;
    if (!name) continue;
    const changePercent = pickNumberField(item, OVERVIEW_CHANGE_KEYS);
    items.push({
      code,
      name,
      price: pickNumberField(item, OVERVIEW_PRICE_KEYS),
      changePercent,
      direction: directionOf(changePercent)
    });
  }
  return items;
}

export function buildOverviewSection(result) {
  if (!result || typeof result !== 'object') {
    return { status: 'error', indices: [], error: '大盘概览加载失败' };
  }
  // 网关明确告诉我们这个 action 还没接线：不当错误，只静默隐藏。
  if (result.unsupported) {
    return { status: 'unsupported', indices: [], error: errorMessage(result.error, '大盘概览尚未接线') };
  }
  if (result.ok !== true) {
    return { status: 'error', indices: [], error: errorMessage(result.error, '大盘概览加载失败') };
  }
  const indices = normalizeOverviewItems(result);
  return { status: indices.length ? 'ready' : 'empty', indices, error: '' };
}

function isCurrentRequest(state, action) {
  return Number(action.requestId) === Number(state.requestId);
}

export function homeScreenReducer(state = INITIAL_HOME_STATE, action = {}) {
  switch (action.type) {
    case 'request':
      return {
        ...state,
        status: state.updatedAt ? 'refreshing' : 'loading',
        error: '',
        requestId: Number(action.requestId) || 0
      };

    case 'success': {
      if (!isCurrentRequest(state, action)) return state;
      return {
        ...state,
        status: 'ready',
        holdings: action.holdings || state.holdings,
        markets: action.markets || state.markets,
        overview: action.overview || state.overview,
        updatedAt: Number(action.updatedAt) || 0,
        error: ''
      };
    }

    case 'failure': {
      if (!isCurrentRequest(state, action)) return state;
      // 保留上一轮的三段内容，只在顶上多一句。
      return { ...state, status: 'error', error: errorMessage(action.error) };
    }

    case 'reset':
      return { ...INITIAL_HOME_STATE };

    default:
      return state;
  }
}

async function settle(run) {
  try {
    return await run();
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * @param {object} deps
 * @param {(options: object) => Promise<object>} deps.loadHoldings 持仓加载器
 * @param {(options: object) => Promise<object>} deps.loadMarkets 自选行情加载器
 * @param {(action: string, params: object) => Promise<object>} deps.callAction 行情网关
 * @param {() => number} [deps.now]
 */
export function createHomeScreenController(deps = {}) {
  for (let i = 0; i < REQUIRED_DEPS.length; i += 1) {
    const name = REQUIRED_DEPS[i];
    if (typeof deps[name] !== 'function') {
      throw new TypeError('createHomeScreenController requires a ' + name + ' function');
    }
  }

  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();

  async function load(options = {}) {
    const refresh = Boolean(options.refresh);
    // 三段并行，且各自吃掉自己的异常：一段挂掉不影响其余两段。
    const results = await Promise.all([
      settle(() => deps.loadHoldings({ refresh })),
      settle(() => deps.loadMarkets({ refresh })),
      settle(() => deps.callAction('home-overview', { region: options.region || 'CN', refresh }))
    ]);

    return {
      ok: true,
      holdings: buildHoldingsSection(results[0]),
      markets: buildMarketsSection(results[1]),
      overview: buildOverviewSection(results[2]),
      updatedAt: now()
    };
  }

  return { load };
}
