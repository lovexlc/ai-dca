// 持仓快速记录工具 - 记住用户常用的基金和金额

import { detectFundKind, normalizeFundCode } from '../../app/holdingsLedgerCore.js';

const QUICK_TX_HISTORY_KEY = 'holdings:quickTxHistory';
const LAST_TX_KEY = 'holdings:lastTransaction';
const MAX_QUICK_HISTORY = 5;

function normalizeQuickKind(kind, code, name) {
  const raw = String(kind || '').trim().toLowerCase();
  if (raw === 'exchange' || raw === 'qdii') return raw;
  return detectFundKind(code, name);
}

function numberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function decimalString(value) {
  const num = numberOrZero(value);
  return num > 0 ? String(num) : '';
}

/**
 * 保存最近一次交易（用于"重复上次交易"）
 * @param {Object} tx - 交易记录
 */
export function saveLastTransaction(tx) {
  if (typeof window === 'undefined' || !tx) return;
  try {
    const code = normalizeFundCode(tx.code || '');
    const name = tx.name || '';
    const kind = normalizeQuickKind(tx.kind, code, name);
    const saved = {
      code,
      name,
      type: tx.type, // 'BUY' or 'SELL'
      kind,
      shares: tx.shares,
      price: tx.price,
      amount: tx.amount,
      date: tx.date,
      timestamp: Date.now()
    };
    window.localStorage.setItem(LAST_TX_KEY, JSON.stringify(saved));

    // 同时添加到快速历史记录
    addToQuickHistory(code, name, tx.type, tx.amount, {
      kind,
      shares: tx.shares,
      price: tx.price
    });
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
 * @param {Object} meta - 交易类型、份额和成交价等补充信息
 */
export function addToQuickHistory(code, name, type, amount, meta = {}) {
  if (typeof window === 'undefined' || !code) return;
  try {
    const normalizedCode = normalizeFundCode(code);
    const normalizedName = name || '';
    const kind = normalizeQuickKind(meta.kind, normalizedCode, normalizedName);
    const history = getQuickHistory();
    // 添加到开头
    const updated = [
      {
        code: normalizedCode,
        name: normalizedName,
        type,
        kind,
        amount: numberOrZero(amount),
        shares: numberOrZero(meta.shares),
        price: numberOrZero(meta.price),
        timestamp: Date.now()
      },
      ...history
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
    const code = normalizeFundCode(item.code || '');
    const name = item.name || '';
    const kind = normalizeQuickKind(item.kind, code, name);
    if (!stats[code]) {
      stats[code] = { code, name, kind, amounts: [], shares: [], prices: [], count: 0 };
    }
    stats[code].amounts.push(numberOrZero(item.amount));
    stats[code].shares.push(numberOrZero(item.shares));
    stats[code].prices.push(numberOrZero(item.price));
    stats[code].count++;
  });

  // 计算平均金额
  return Object.values(stats)
    .filter(s => s.count >= 2) // 至少买入过 2 次
    .map(s => {
      const suggestedAmount = Math.round(s.amounts.reduce((a, b) => a + b, 0) / s.amounts.length);
      const positiveShares = s.shares.filter((value) => value > 0);
      const positivePrices = s.prices.filter((value) => value > 0);
      const suggestedShares = positiveShares.length
        ? Number((positiveShares.reduce((a, b) => a + b, 0) / positiveShares.length).toFixed(4))
        : 0;
      const suggestedPrice = positivePrices.length
        ? Number((positivePrices.reduce((a, b) => a + b, 0) / positivePrices.length).toFixed(4))
        : 0;
      if (s.kind === 'exchange' && !(suggestedShares > 0)) return null;
      return {
        code: s.code,
        name: s.name,
        kind: s.kind,
        suggestedAmount,
        suggestedShares,
        suggestedPrice
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.suggestedAmount - a.suggestedAmount);
}

export function buildQuickTransactionDraft(source = {}) {
  const code = normalizeFundCode(source.code || '');
  const name = source.name || '';
  const kind = normalizeQuickKind(source.kind, code, name);
  const type = String(source.type || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  const amount = numberOrZero(source.suggestedAmount ?? source.amount);
  const rawShares = numberOrZero(source.suggestedShares ?? source.shares);
  const price = numberOrZero(source.suggestedPrice ?? source.price);
  const derivedShares = rawShares > 0 ? rawShares : (kind === 'exchange' && amount > 0 && price > 0 ? amount / price : 0);

  return {
    code,
    name,
    type,
    kind,
    amount: type === 'BUY' && kind !== 'exchange' ? decimalString(amount) : '',
    shares: type === 'BUY' && kind !== 'exchange' ? '' : decimalString(Number(derivedShares.toFixed(4))),
    price: type === 'BUY' && kind !== 'exchange' ? '' : decimalString(price),
  };
}
