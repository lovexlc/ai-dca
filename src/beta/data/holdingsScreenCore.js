// beta 持仓页核心：流水账 → 持仓 → 市值（纯逻辑，零 import）。
//
// 账本里存的是一条条交易，不是持仓。这里把它折成持仓，再配上行情算市值。
// 几条定下来的规则：
//   1. 移动加权成本：卖出按当时均价扣成本，不改剩余份额的均价。
//      卖出不影响均价，只结转一部分浮盈为已实现盈亏。
//   2. 卖超了不允许出现负份额：手工账本难免漏录买入，截断到 0 并计数。
//   3. 场内看价格、场外看净值；拿不到行情就退回账本里的快照，再退回成本价。
//      宁可展示一个标了「估值」的数，也不把整行市值弄成 0。
//   4. 未知交易类型（分红、转换等）不猜，跳过并计数交给页面提示。

export const EMPTY_HOLDINGS_SUMMARY = Object.freeze({
  positions: 0,
  marketValue: 0,
  cost: 0,
  profit: 0,
  profitPercent: null,
  dayProfit: 0,
  realized: 0,
  estimated: 0,
  missingQuote: 0,
  ignoredTransactions: 0,
  oversold: 0
});

export const INITIAL_HOLDINGS_STATE = Object.freeze({
  status: 'idle',
  rows: [],
  summary: EMPTY_HOLDINGS_SUMMARY,
  error: '',
  sortBy: 'marketValue',
  sortDirection: 'desc',
  updatedAt: 0,
  requestId: 0
});

const REQUIRED_DEPS = ['readLedger', 'callAction'];

const TEXT_SORT_KEYS = ['code', 'name'];
const PRICE_KEYS = ['price', 'currentPrice', 'close', 'lastPrice'];
const NAV_KEYS = ['latestNav', 'nav', 'navBase', 'unitNav'];
const CHANGE_KEYS = ['changePercent', 'changePct'];

/** 份额与金额都可能是字符串，统一过一道。不合法一律归 0。 */
export function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function round(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = Math.pow(10, digits);
  return Math.round(num * factor) / factor;
}

function pickNumberField(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (let i = 0; i < keys.length; i += 1) {
    const raw = source[keys[i]];
    if (raw === null || raw === undefined || raw === '') continue;
    const num = Number(raw);
    if (Number.isFinite(num) && num !== 0) return num;
  }
  return null;
}

/** 只认 BUY / SELL；其余类型不猜。 */
export function normalizeTxType(type) {
  const text = String(type == null ? '' : type).trim().toUpperCase();
  if (text === 'BUY' || text === 'SELL') return text;
  return '';
}

export function normalizeCode(value) {
  const digits = String(value == null ? '' : value).trim().replace(/\D/g, '');
  return digits.length === 6 ? digits : '';
}

/**
 * 流水账 → 持仓。按代码聚合，按日期回放。
 * @returns {{positions: Array<object>, ignored: number, oversold: number}}
 */
export function buildPositions(transactions) {
  const list = Array.isArray(transactions) ? transactions : [];
  const ordered = list.slice().sort((a, b) => {
    const left = String((a && a.date) || '');
    const right = String((b && b.date) || '');
    if (left === right) return 0;
    // 没填日期的（旧数据迁入、OCR 草稿）当最早，否则会把均价算反。
    if (!left) return -1;
    if (!right) return 1;
    return left < right ? -1 : 1;
  });

  const byCode = new Map();
  let ignored = 0;
  let oversold = 0;

  for (let i = 0; i < ordered.length; i += 1) {
    const tx = ordered[i] || {};
    const code = normalizeCode(tx.code);
    const type = normalizeTxType(tx.type);
    if (!code || !type) {
      ignored += 1;
      continue;
    }

    let position = byCode.get(code);
    if (!position) {
      position = {
        code,
        name: '',
        kind: String(tx.kind || '') || 'otc',
        shares: 0,
        cost: 0,
        realized: 0,
        buyShares: 0,
        sellShares: 0,
        txCount: 0,
        firstDate: '',
        lastDate: ''
      };
      byCode.set(code, position);
    }

    const name = String(tx.name || '').trim();
    if (name) position.name = name;
    if (tx.kind) position.kind = String(tx.kind);

    const shares = Math.abs(toNumber(tx.shares));
    const price = Math.abs(toNumber(tx.price));
    const date = String(tx.date || '').trim();

    position.txCount += 1;
    if (date) {
      if (!position.firstDate) position.firstDate = date;
      position.lastDate = date;
    }

    if (type === 'BUY') {
      position.shares += shares;
      position.cost += shares * price;
      position.buyShares += shares;
      continue;
    }

    // SELL：按当时均价扣成本，差额计入已实现盈亏。
    const avgCost = position.shares > 0 ? position.cost / position.shares : 0;
    const soldShares = Math.min(shares, position.shares);
    if (shares > position.shares + 1e-8) oversold += 1;
    position.shares -= soldShares;
    position.cost -= soldShares * avgCost;
    position.realized += soldShares * (price - avgCost);
    position.sellShares += shares;
    if (position.shares <= 1e-8) {
      position.shares = 0;
      position.cost = 0;
    }
  }

  const positions = [];
  byCode.forEach((position) => {
    positions.push({
      ...position,
      shares: round(position.shares, 4),
      cost: round(position.cost, 2),
      realized: round(position.realized, 2),
      avgCost: position.shares > 0 ? round(position.cost / position.shares, 4) : 0
    });
  });

  return { positions, ignored, oversold };
}

/**
 * 选一个估值价：场内优先价格，场外优先净值；拿不到就退快照，再退成本价。
 * @returns {{price: number, source: 'quote'|'snapshot'|'cost'|'none'}}
 */
export function pickValuation({ quote, snapshot, kind, avgCost }) {
  const preferNav = kind !== 'exchange';
  const keys = preferNav ? [NAV_KEYS, PRICE_KEYS] : [PRICE_KEYS, NAV_KEYS];

  for (let i = 0; i < keys.length; i += 1) {
    const value = pickNumberField(quote, keys[i]);
    if (value !== null) return { price: value, source: 'quote' };
  }
  for (let i = 0; i < keys.length; i += 1) {
    const value = pickNumberField(snapshot, keys[i]);
    if (value !== null) return { price: value, source: 'snapshot' };
  }
  const cost = Number(avgCost);
  if (Number.isFinite(cost) && cost > 0) return { price: cost, source: 'cost' };
  return { price: 0, source: 'none' };
}

/** 持仓 + 行情 → 可直接渲染的行。 */
export function buildHoldingRows({ positions, quotes, snapshots } = {}) {
  const list = Array.isArray(positions) ? positions : [];
  const quoteMap = quotes && typeof quotes === 'object' ? quotes : {};
  const snapshotMap = snapshots && typeof snapshots === 'object' ? snapshots : {};

  return list.map((position) => {
    const quote = quoteMap[position.code] || null;
    const snapshot = snapshotMap[position.code] || null;
    const valuation = pickValuation({
      quote,
      snapshot,
      kind: position.kind,
      avgCost: position.avgCost
    });

    const marketValue = round(position.shares * valuation.price, 2);
    const profit = round(marketValue - position.cost, 2);
    const profitPercent = position.cost > 0 ? round((profit / position.cost) * 100, 2) : null;

    const changePercent = pickNumberField(quote, CHANGE_KEYS);
    const fallbackChange = changePercent === null ? pickNumberField(snapshot, CHANGE_KEYS) : changePercent;
    let dayProfit = 0;
    if (fallbackChange !== null && marketValue) {
      const previousValue = marketValue / (1 + fallbackChange / 100);
      if (Number.isFinite(previousValue)) dayProfit = round(marketValue - previousValue, 2);
    }

    return {
      ...position,
      name: position.name || position.code,
      price: valuation.price,
      priceSource: valuation.source,
      estimated: valuation.source !== 'quote',
      marketValue,
      profit,
      profitPercent,
      changePercent: fallbackChange,
      dayProfit,
      direction: profit > 0 ? 'up' : (profit < 0 ? 'down' : 'flat')
    };
  });
}

export function summarizeHoldings(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const summary = { ...EMPTY_HOLDINGS_SUMMARY };
  summary.positions = list.length;
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    summary.marketValue += toNumber(row.marketValue);
    summary.cost += toNumber(row.cost);
    summary.dayProfit += toNumber(row.dayProfit);
    summary.realized += toNumber(row.realized);
    if (row.estimated) summary.estimated += 1;
    if (row.priceSource === 'cost' || row.priceSource === 'none') summary.missingQuote += 1;
  }
  summary.marketValue = round(summary.marketValue, 2);
  summary.cost = round(summary.cost, 2);
  summary.dayProfit = round(summary.dayProfit, 2);
  summary.realized = round(summary.realized, 2);
  summary.profit = round(summary.marketValue - summary.cost, 2);
  summary.profitPercent = summary.cost > 0 ? round((summary.profit / summary.cost) * 100, 2) : null;
  return summary;
}

export function defaultSortDirection(by) {
  return TEXT_SORT_KEYS.indexOf(by) >= 0 ? 'asc' : 'desc';
}

export function sortHoldingRows(rows, { by = 'marketValue', direction = 'desc' } = {}) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const factor = direction === 'asc' ? 1 : -1;
  const isText = TEXT_SORT_KEYS.indexOf(by) >= 0;

  list.sort((a, b) => {
    const left = a ? a[by] : null;
    const right = b ? b[by] : null;
    if (isText) {
      return String(left || '').localeCompare(String(right || ''), 'zh-CN') * factor;
    }
    const leftNull = left === null || left === undefined;
    const rightNull = right === null || right === undefined;
    // 没数据的行两个方向都沉底。
    if (leftNull && rightNull) return 0;
    if (leftNull) return 1;
    if (rightNull) return -1;
    return (Number(left) - Number(right)) * factor;
  });
  return list;
}

export function errorMessage(error, fallback = '持仓加载失败') {
  if (typeof error === 'string') return error.trim() || fallback;
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  return fallback;
}

function isCurrentRequest(state, action) {
  return Number(action.requestId) === Number(state.requestId);
}

export function holdingsScreenReducer(state = INITIAL_HOLDINGS_STATE, action = {}) {
  switch (action.type) {
    case 'request':
      return {
        ...state,
        status: state.rows.length ? 'refreshing' : 'loading',
        error: '',
        requestId: Number(action.requestId) || 0
      };

    case 'success': {
      if (!isCurrentRequest(state, action)) return state;
      return {
        ...state,
        status: 'ready',
        rows: Array.isArray(action.rows) ? action.rows : [],
        summary: action.summary || EMPTY_HOLDINGS_SUMMARY,
        updatedAt: Number(action.updatedAt) || 0,
        error: ''
      };
    }

    case 'failure': {
      if (!isCurrentRequest(state, action)) return state;
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
      return { ...INITIAL_HOLDINGS_STATE };

    default:
      return state;
  }
}

/**
 * @param {object} deps
 * @param {() => object} deps.readLedger 读本地账本
 * @param {(action: string, params: object) => Promise<object>} deps.callAction 行情网关
 * @param {() => number} [deps.now]
 */
export function createHoldingsScreenController(deps = {}) {
  for (let i = 0; i < REQUIRED_DEPS.length; i += 1) {
    const name = REQUIRED_DEPS[i];
    if (typeof deps[name] !== 'function') {
      throw new TypeError('createHoldingsScreenController requires a ' + name + ' function');
    }
  }

  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();

  function failure(error, fallback) {
    return {
      ok: false,
      empty: false,
      rows: [],
      summary: EMPTY_HOLDINGS_SUMMARY,
      quotes: {},
      updatedAt: 0,
      error: errorMessage(error, fallback)
    };
  }

  async function load(options = {}) {
    let ledger = null;
    try {
      ledger = deps.readLedger() || {};
    } catch (error) {
      return failure(error, '账本读取失败');
    }

    const built = buildPositions(ledger.transactions);
    const held = built.positions.filter((position) => position.shares > 0);

    if (!held.length) {
      return {
        ok: true,
        empty: true,
        rows: [],
        summary: { ...EMPTY_HOLDINGS_SUMMARY, ignoredTransactions: built.ignored, oversold: built.oversold },
        quotes: {},
        updatedAt: now(),
        error: ''
      };
    }

    const codes = held.map((position) => position.code);
    let quotes = {};
    let quoteError = '';
    try {
      const result = await deps.callAction('fund-quote', { codes, refresh: Boolean(options.refresh) });
      if (result && result.ok === true) {
        quotes = result.quotes || {};
      } else {
        quoteError = errorMessage(result && result.error, '行情拉取失败');
      }
    } catch (error) {
      quoteError = errorMessage(error, '行情拉取失败');
    }

    // 行情挂了不影响看持仓：退回账本快照/成本价，只在顶上提示一句。
    let rows = [];
    try {
      rows = buildHoldingRows({
        positions: held,
        quotes,
        snapshots: ledger.snapshotsByCode
      });
    } catch (error) {
      return failure(error);
    }

    const summary = summarizeHoldings(rows);
    summary.ignoredTransactions = built.ignored;
    summary.oversold = built.oversold;

    return {
      ok: true,
      empty: false,
      rows,
      summary,
      quotes,
      updatedAt: now(),
      error: quoteError
    };
  }

  return { load };
}
