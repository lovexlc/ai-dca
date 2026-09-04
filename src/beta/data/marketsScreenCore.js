// beta 行情页状态核心：加载编排 + reducer（纯逻辑，零 import）。
//
// 与 marketsViewModel.js 一个套路：这里不 import 任何东西，外部能力全部注入，
// 所以单测既不需要 fetch / localStorage，也不需要 React。
//
// 编排本身很短，但有四处规则值得单独钉住：
//   1. 自选单为空时不发请求：空列表打一次 fund-quote 必然拿回空对象，白等一个来回。
//   2. 网关返回 ok:false 与直接抛异常走同一条失败路径，页面上只呈现一句话。
//   3. 读自选单本身也可能抛（存储被禁用/被清空），同样按失败处理，不让整页白屏。
//   4. 迟到的响应不能覆盖新响应：连点刷新时旧请求可能后到。

export const EMPTY_SUMMARY = Object.freeze({
  total: 0,
  withData: 0,
  missing: 0,
  fresh: 0,
  stale: 0,
  suspended: 0,
  marketClosed: 0
});

export const INITIAL_MARKETS_STATE = Object.freeze({
  status: 'idle',
  rows: [],
  summary: EMPTY_SUMMARY,
  error: '',
  listKind: 'otc',
  sortBy: 'changePercent',
  sortDirection: 'desc',
  updatedAt: 0,
  requestId: 0
});

const REQUIRED_DEPS = ['callAction', 'buildRows', 'getActiveWatchlistCodes', 'summarizeRows'];

const TEXT_SORT_KEYS = ['code', 'name'];

/** 把任意异常/失败信息收敛成一句可展示的话。 */
export function errorMessage(error, fallback = '行情加载失败') {
  if (typeof error === 'string') return error.trim() || fallback;
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  return fallback;
}

/** 代码列表去重 + 去空，顺序保持自选单顺序。 */
export function toCodeList(codes) {
  const list = Array.isArray(codes) ? codes : [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const code = String(list[i] == null ? '' : list[i]).trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/** 换列时的默认方向：文本列升序，数值列降序。 */
export function defaultSortDirection(by) {
  return TEXT_SORT_KEYS.indexOf(by) >= 0 ? 'asc' : 'desc';
}

function isCurrentRequest(state, action) {
  return Number(action.requestId) === Number(state.requestId);
}

export function marketsScreenReducer(state = INITIAL_MARKETS_STATE, action = {}) {
  switch (action.type) {
    case 'request':
      return {
        ...state,
        // 已经有行了就别退回骨架屏，否则每次刷新列表都会闪一下。
        status: state.rows.length ? 'refreshing' : 'loading',
        error: '',
        requestId: Number(action.requestId) || 0
      };

    case 'success': {
      if (!isCurrentRequest(state, action)) return state;
      const rows = Array.isArray(action.rows) ? action.rows : [];
      return {
        ...state,
        status: 'ready',
        rows,
        summary: action.summary || EMPTY_SUMMARY,
        listKind: action.listKind || state.listKind,
        updatedAt: Number(action.updatedAt) || 0,
        error: ''
      };
    }

    case 'failure': {
      if (!isCurrentRequest(state, action)) return state;
      // 失败不清空已有的行：宁可展示上一轮的旧数据 + 一条错误，也别整页空掉。
      return { ...state, status: 'error', error: errorMessage(action.error) };
    }

    case 'sort': {
      const by = String(action.by || '') || state.sortBy;
      if (by === state.sortBy) {
        return { ...state, sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' };
      }
      return { ...state, sortBy: by, sortDirection: defaultSortDirection(by) };
    }

    case 'reset':
      return { ...INITIAL_MARKETS_STATE };

    default:
      return state;
  }
}

/**
 * 绑定网关与视图模型，返回行情页加载器。
 *
 * @param {object} deps
 * @param {(action: string, params: object) => Promise<object>} deps.callAction 行情网关
 * @param {(options: object) => Array<object>} deps.buildRows 视图模型建行
 * @param {(watchlist: object) => Array<string>} deps.getActiveWatchlistCodes 当前自选单代码
 * @param {(rows: Array<object>) => object} deps.summarizeRows 列表头计数
 * @param {(watchlist: object) => string} [deps.getActiveListKind] 场内/场外
 * @param {() => number} [deps.now] 时间源
 */
export function createMarketsScreenController(deps = {}) {
  for (let i = 0; i < REQUIRED_DEPS.length; i += 1) {
    const name = REQUIRED_DEPS[i];
    if (typeof deps[name] !== 'function') {
      throw new TypeError('createMarketsScreenController requires a ' + name + ' function');
    }
  }

  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const getActiveListKind = typeof deps.getActiveListKind === 'function' ? deps.getActiveListKind : null;

  function failure(error, extra = {}) {
    return {
      ok: false,
      empty: false,
      rows: [],
      summary: EMPTY_SUMMARY,
      codes: [],
      listKind: 'otc',
      quotes: {},
      updatedAt: 0,
      ...extra,
      error: errorMessage(error)
    };
  }

  async function load(options = {}) {
    const watchlist = options.watchlist || null;

    let codes = [];
    let listKind = 'otc';
    try {
      codes = toCodeList(deps.getActiveWatchlistCodes(watchlist));
      if (getActiveListKind) listKind = String(getActiveListKind(watchlist) || 'otc');
    } catch (error) {
      return failure(error, { error: errorMessage(error, '自选单读取失败') });
    }

    if (!codes.length) {
      return {
        ok: true,
        empty: true,
        rows: [],
        summary: EMPTY_SUMMARY,
        codes: [],
        listKind,
        quotes: {},
        cacheHit: false,
        cacheFresh: false,
        updatedAt: now(),
        error: ''
      };
    }

    let result = null;
    try {
      result = await deps.callAction('fund-quote', { codes, refresh: Boolean(options.refresh) });
    } catch (error) {
      return failure(error, { codes, listKind });
    }

    if (!result || result.ok !== true) {
      return failure(result && result.error, { codes, listKind });
    }

    const quotes = result.quotes || {};
    let rows = [];
    try {
      rows = deps.buildRows({
        watchlist,
        codes,
        quotes,
        listKind,
        todayDate: options.todayDate || ''
      });
    } catch (error) {
      return failure(error, { codes, listKind, quotes });
    }

    const list = Array.isArray(rows) ? rows : [];
    return {
      ok: true,
      empty: false,
      rows: list,
      summary: deps.summarizeRows(list),
      codes,
      listKind,
      quotes,
      cacheHit: Boolean(result.cacheHit),
      cacheFresh: Boolean(result.cacheFresh),
      updatedAt: now(),
      error: ''
    };
  }

  return { load };
}
