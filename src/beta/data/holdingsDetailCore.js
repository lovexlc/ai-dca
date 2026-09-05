// beta 持仓明细核心：单只基金的流水回放（纯逻辑，只依赖同目录的持仓核心）。
//
// 持仓 tab 回答的是「现在有多少」，明细页要回答「怎么变成这样的」：
// 每一笔买卖之后还剩多少份、均价变成多少、这一笔卖出结转了多少已实现盈亏。
//
// 规则与持仓 tab 完全一致（复用同一套 buildPositions / buildHoldingRows），
// 否则两页的数字会对不上：
//   1. 卖出按当时均价扣成本，不改剩余份额的均价
//   2. 卖超了截断到 0 并把那一行标出来（手工账本难免漏录买入）
//   3. 未知类型（分红、转换等）不猜，跳过并计数
//   4. 清仓也要能看：份额 0 只是市值为 0，流水与已实现盈亏照常显示

import {
  buildHoldingRows,
  buildPositions,
  normalizeCode,
  normalizeTxType,
  round,
  toNumber
} from './holdingsScreenCore.js';

export const EMPTY_DETAIL_STATS = Object.freeze({
  txCount: 0,
  buys: 0,
  sells: 0,
  buyShares: 0,
  sellShares: 0,
  buyAmount: 0,
  sellAmount: 0,
  realized: 0,
  shares: 0,
  cost: 0,
  avgCost: 0,
  firstDate: '',
  lastDate: '',
  ignored: 0
});

export const INITIAL_DETAIL_STATE = Object.freeze({
  status: 'idle',
  code: '',
  name: '',
  kind: '',
  row: null,
  rows: [],
  stats: EMPTY_DETAIL_STATS,
  cleared: false,
  empty: false,
  error: '',
  updatedAt: 0
});

const REQUIRED_DEPS = ['readLedger', 'callAction'];

export function errorMessage(error, fallback = '明细加载失败') {
  if (typeof error === 'string') return error.trim() || fallback;
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  return fallback;
}

// 没填日期的（旧数据迁入、OCR 草稿）当最早，否则均价会算反。
function compareByDate(a, b) {
  const left = String((a && a.date) || '');
  const right = String((b && b.date) || '');
  if (left === right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left < right ? -1 : 1;
}

/**
 * 单只基金的流水回放。
 * @returns {{rows: Array<object>, stats: object, name: string, kind: string}}
 */
export function buildTimeline(transactions, code) {
  const target = normalizeCode(code);
  const stats = { ...EMPTY_DETAIL_STATS };
  if (!target) return { rows: [], stats, name: '', kind: '' };

  const list = Array.isArray(transactions) ? transactions : [];
  const mine = [];
  let name = '';
  let kind = '';

  for (let i = 0; i < list.length; i += 1) {
    const tx = list[i] || {};
    if (normalizeCode(tx.code) !== target) continue;
    const txName = String(tx.name || '').trim();
    if (txName) name = txName;
    if (tx.kind) kind = String(tx.kind);
    if (!normalizeTxType(tx.type)) {
      stats.ignored += 1;
      continue;
    }
    mine.push(tx);
  }

  mine.sort(compareByDate);

  let shares = 0;
  let cost = 0;
  let realized = 0;
  const rows = [];

  for (let i = 0; i < mine.length; i += 1) {
    const tx = mine[i];
    const type = normalizeTxType(tx.type);
    const txShares = Math.abs(toNumber(tx.shares));
    const price = Math.abs(toNumber(tx.price));
    const date = String(tx.date || '').trim();
    let rowRealized = null;
    let oversold = false;

    if (type === 'BUY') {
      shares += txShares;
      cost += txShares * price;
      stats.buys += 1;
      stats.buyShares += txShares;
      stats.buyAmount += txShares * price;
    } else {
      const avgCost = shares > 0 ? cost / shares : 0;
      const sold = Math.min(txShares, shares);
      if (txShares > shares + 1e-8) oversold = true;
      shares -= sold;
      cost -= sold * avgCost;
      rowRealized = round(sold * (price - avgCost), 2);
      realized += sold * (price - avgCost);
      stats.sells += 1;
      stats.sellShares += txShares;
      stats.sellAmount += txShares * price;
      if (shares <= 1e-8) {
        shares = 0;
        cost = 0;
      }
    }

    stats.txCount += 1;
    if (date) {
      if (!stats.firstDate) stats.firstDate = date;
      stats.lastDate = date;
    }

    rows.push({
      id: String(tx.id || '') || (target + '-' + i),
      date,
      type,
      shares: round(txShares, 4),
      price: round(price, 4),
      amount: round(txShares * price, 2),
      realized: rowRealized,
      sharesAfter: round(shares, 4),
      avgCostAfter: shares > 0 ? round(cost / shares, 4) : 0,
      oversold
    });
  }

  stats.buyShares = round(stats.buyShares, 4);
  stats.sellShares = round(stats.sellShares, 4);
  stats.buyAmount = round(stats.buyAmount, 2);
  stats.sellAmount = round(stats.sellAmount, 2);
  stats.realized = round(realized, 2);
  stats.shares = round(shares, 4);
  stats.cost = round(cost, 2);
  stats.avgCost = shares > 0 ? round(cost / shares, 4) : 0;

  return { rows, stats, name, kind };
}

function failure(code, error, fallback) {
  return {
    ok: false,
    empty: false,
    code,
    name: '',
    kind: '',
    row: null,
    rows: [],
    stats: { ...EMPTY_DETAIL_STATS },
    cleared: false,
    updatedAt: 0,
    error: errorMessage(error, fallback)
  };
}

/**
 * @param {object} deps
 * @param {() => object} deps.readLedger 读本地账本
 * @param {(action: string, params: object) => Promise<object>} deps.callAction 行情网关
 * @param {() => number} [deps.now]
 */
export function createHoldingsDetailController(deps = {}) {
  for (let i = 0; i < REQUIRED_DEPS.length; i += 1) {
    const name = REQUIRED_DEPS[i];
    if (typeof deps[name] !== 'function') {
      throw new TypeError('createHoldingsDetailController requires a ' + name + ' function');
    }
  }

  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();

  async function load(options = {}) {
    const code = normalizeCode(options.code);
    if (!code) return failure('', '基金代码不识别');

    let ledger = null;
    try {
      ledger = deps.readLedger() || {};
    } catch (error) {
      return failure(code, error, '账本读取失败');
    }

    const timeline = buildTimeline(ledger.transactions, code);

    if (!timeline.stats.txCount) {
      return {
        ok: true,
        empty: true,
        code,
        name: timeline.name || code,
        kind: timeline.kind || '',
        row: null,
        rows: [],
        stats: timeline.stats,
        cleared: false,
        updatedAt: now(),
        error: ''
      };
    }

    const built = buildPositions(ledger.transactions);
    let position = null;
    for (let i = 0; i < built.positions.length; i += 1) {
      if (built.positions[i].code === code) {
        position = built.positions[i];
        break;
      }
    }

    // 行情挂了不影响看流水：退回账本快照 / 成本价，只在顶上提示一句。
    let quotes = {};
    let quoteError = '';
    try {
      const result = await deps.callAction('fund-quote', {
        codes: [code],
        refresh: Boolean(options.refresh)
      });
      if (result && result.ok === true) {
        quotes = result.quotes || {};
      } else {
        quoteError = errorMessage(result && result.error, '行情拉取失败');
      }
    } catch (error) {
      quoteError = errorMessage(error, '行情拉取失败');
    }

    let rows = [];
    try {
      rows = position
        ? buildHoldingRows({
            positions: [position],
            quotes,
            snapshots: ledger.snapshotsByCode
          })
        : [];
    } catch (error) {
      return failure(code, error);
    }

    return {
      ok: true,
      empty: false,
      code,
      name: timeline.name || (position && position.name) || code,
      kind: timeline.kind || (position && position.kind) || 'otc',
      row: rows[0] || null,
      rows: timeline.rows,
      stats: timeline.stats,
      cleared: Boolean(position) && position.shares <= 0,
      updatedAt: now(),
      error: quoteError
    };
  }

  return { load };
}
