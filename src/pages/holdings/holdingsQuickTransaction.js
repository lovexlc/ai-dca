// 持仓快速记录工具 - 记住用户常用的基金和金额

const QUICK_TX_HISTORY_KEY = 'holdings:quickTxHistory';
const LAST_TX_KEY = 'holdings:lastTransaction';
const MAX_QUICK_HISTORY = 5;

/**
 * 保存最近一次交易（用于"重复上次交易"）
 * @param {Object} tx - 交易记录
 */
export function saveLastTransaction(tx) {
  if (typeof window === 'undefined' || !tx) return;
  try {
    const saved = {
      code: tx.code,
      name: tx.name,
      type: tx.type, // 'BUY' or 'SELL'
      shares: tx.shares,
      price: tx.price,
      amount: tx.amount,
      date: tx.date,
      timestamp: Date.now()
    };
    window.localStorage.setItem(LAST_TX_KEY, JSON.stringify(saved));

    // 同时添加到快速历史记录
    addToQuickHistory(tx.code, tx.name, tx.type, tx.amount);
  } catch (_error) {
    // Ignore
  }
}

/**
 * 获取最近一次交易
 * @returns {Object|null}
 */
export function getLastTransaction() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_TX_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

/**
 * 添加到快速历史（常用基金和金额）
 * @param {string} code - 基金代码
 * @param {string} name - 基金名称
 * @param {string} type - 交易类型
 * @param {number} amount - 交易金额
 */
export function addToQuickHistory(code, name, type, amount) {
  if (typeof window === 'undefined' || !code) return;
  try {
    const history = getQuickHistory();
    // 去重：移除相同 code + type 的记录
    const filtered = history.filter(item => !(item.code === code && item.type === type));
    // 添加到开头
    const updated = [
      { code, name: name || '', type, amount: Number(amount) || 0, timestamp: Date.now() },
      ...filtered
    ].slice(0, MAX_QUICK_HISTORY);
    window.localStorage.setItem(QUICK_TX_HISTORY_KEY, JSON.stringify(updated));
  } catch (_error) {
    // Ignore
  }
}

/**
 * 获取快速历史记录
 * @returns {Array}
 */
export function getQuickHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(QUICK_TX_HISTORY_KEY);
    if (!raw) return [];
    const history = JSON.parse(raw);
    return Array.isArray(history) ? history : [];
  } catch (_error) {
    return [];
  }
}

/**
 * 清空快速历史
 */
export function clearQuickHistory() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(QUICK_TX_HISTORY_KEY);
    window.localStorage.removeItem(LAST_TX_KEY);
  } catch (_error) {
    // Ignore
  }
}

/**
 * 获取定投建议（基于历史记录）
 * @returns {Array<{code: string, name: string, suggestedAmount: number}>}
 */
export function getRegularInvestmentSuggestions() {
  const history = getQuickHistory();

  // 统计每个基金的平均金额
  const stats = {};
  history.forEach(item => {
    if (item.type !== 'BUY') return;
    if (!stats[item.code]) {
      stats[item.code] = { code: item.code, name: item.name, amounts: [], count: 0 };
    }
    stats[item.code].amounts.push(item.amount);
    stats[item.code].count++;
  });

  // 计算平均金额
  return Object.values(stats)
    .filter(s => s.count >= 2) // 至少买入过 2 次
    .map(s => ({
      code: s.code,
      name: s.name,
      suggestedAmount: Math.round(s.amounts.reduce((a, b) => a + b, 0) / s.amounts.length)
    }))
    .sort((a, b) => b.suggestedAmount - a.suggestedAmount);
}
