// beta「我的」tab 核心：本地数据体检 + 搬运进度（纯逻辑，零 import）。
//
// 这个 tab 在小程序里是设置页。网页版 beta 目前只做三件有用的事：
//   1. 告诉用户 beta 读的是哪几份本地数据、各有多少条 —— 数字对不上时
//      第一反应是「我的账本是不是没同步」，这里能一眼确认
//   2. 说清 beta 只读不写：正式版的账本、自选单、计划都不会被 beta 改
//   3. 一键退回正式版
//
// 四份数据各自 try/catch：自选单读不出来不该让账本条数也变成「—」。
// 每项拿不到就给 null（页面打「—」），而不是显示 0 让人以为数据丢了。

export const INITIAL_PROFILE_STATE = Object.freeze({
  status: 'idle',
  stats: [],
  progress: Object.freeze({ ported: 0, total: 0, pendingLabels: [] }),
  error: '',
  updatedAt: 0
});

const REQUIRED_DEPS = ['readLedger', 'readWatchlistCodes', 'readDcaPlans', 'readLayeredPlans'];

export function errorMessage(error, fallback = '读取失败') {
  if (typeof error === 'string') return error.trim() || fallback;
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  return fallback;
}

/** 只有真数组才数得出数，其余一律算「拿不到」。 */
export function countArray(value) {
  return Array.isArray(value) ? value.length : null;
}

export function countKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).length;
}

export function countTransactions(ledger) {
  if (!ledger || typeof ledger !== 'object') return null;
  return countArray(ledger.transactions);
}

export function countSnapshots(ledger) {
  if (!ledger || typeof ledger !== 'object') return null;
  return countKeys(ledger.snapshotsByCode);
}

/**
 * 把一份「读取结果 + 取值方式」变成一行体检数据。
 * settle 失败时给的是 {ok:false, error}，这里统一识别。
 */
export function buildStat(key, label, result, read, fallbackError) {
  if (result && typeof result === 'object' && result.ok === false) {
    return { key, label, value: null, error: errorMessage(result.error, fallbackError) };
  }
  let value = null;
  try {
    value = read(result);
  } catch (error) {
    return { key, label, value: null, error: errorMessage(error, fallbackError) };
  }
  return { key, label, value, error: '' };
}

/** 搬运进度：已接真实数据的页面数 / 全部页面数。 */
export function buildProgress(pages, portedKeys) {
  const list = Array.isArray(pages) ? pages.filter((page) => page && typeof page === 'object') : [];
  const ported = Array.isArray(portedKeys) ? portedKeys.map((key) => String(key)) : [];
  const done = list.filter((page) => ported.indexOf(String(page.key)) !== -1);
  const pending = list.filter((page) => ported.indexOf(String(page.key)) === -1);
  return {
    ported: done.length,
    total: list.length,
    pendingLabels: pending.map((page) => String(page.label || page.key))
  };
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
 * @param {() => object} deps.readLedger 账本快照
 * @param {() => Array} deps.readWatchlistCodes 自选单代码
 * @param {() => ({plans: Array})} deps.readDcaPlans 定投存储
 * @param {() => ({plans: Array})} deps.readLayeredPlans 加仓存储
 * @param {() => Array} [deps.getPages] 全部 beta 页面
 * @param {Array<string>} [deps.portedKeys] 已接真实数据的页面 key
 * @param {() => number} [deps.now]
 */
export function createProfileScreenController(deps = {}) {
  for (let i = 0; i < REQUIRED_DEPS.length; i += 1) {
    const name = REQUIRED_DEPS[i];
    if (typeof deps[name] !== 'function') {
      throw new TypeError('createProfileScreenController requires a ' + name + ' function');
    }
  }

  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();

  async function load() {
    const results = await Promise.all([
      settle(() => deps.readLedger()),
      settle(() => deps.readWatchlistCodes()),
      settle(() => deps.readDcaPlans()),
      settle(() => deps.readLayeredPlans())
    ]);

    const stats = [
      buildStat('transactions', '账本流水', results[0], countTransactions, '账本读取失败'),
      buildStat('snapshots', '净值快照', results[0], countSnapshots, '账本读取失败'),
      buildStat('watchlist', '自选基金', results[1], countArray, '自选单读取失败'),
      buildStat('dca', '定投计划', results[2], (value) => countArray(value && value.plans), '定投计划读取失败'),
      buildStat('plans', '加仓计划', results[3], (value) => countArray(value && value.plans), '加仓计划读取失败')
    ];

    const pages = typeof deps.getPages === 'function' ? deps.getPages() : [];

    return {
      ok: true,
      stats,
      progress: buildProgress(pages, deps.portedKeys),
      updatedAt: now()
    };
  }

  return { load };
}
