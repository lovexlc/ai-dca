/**
 * Holdings ledger core: lot-level BUY / SELL transactions + per-code aggregation
 * + portfolio-level summary. Mirrors the Excel model the user already uses:
 *   - 每笔交易单单独一行（BUY/SELL）
 *   - 按基金代码聚合 → 总份额 / 平均成本 / 总收益 / 当日收益
 *   - 平均成本 = 所有 BUY 的 shares 加权均值，卖出不影响 avgCost
 *   - 总份额 = Σ BUY.shares − Σ SELL.shares（客态全部卖光则 0）
 *   - 总收益仅算未实现（mark-to-market），不包含卖出已实现盈亏
 *   - 当日收益 = (latestNav − previousNav) × totalShares
 */

const FUND_CODE_PATTERN = /^\d{6}$/;
const EXCHANGE_PREFIXES = ['15', '50', '51', '52', '56', '58', '53', '54'];

export const TRANSACTION_TYPES = ['BUY', 'SELL'];
export const FUND_KINDS = ['otc', 'exchange'];

export function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

/** Pad leading zeros so Excel's stripped codes (e.g. 21000, 18738) come back as 6-digit. */
export function normalizeFundCode(code = '') {
  const raw = String(code ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    return raw;
  }
  if (digits.length === 6) {
    return digits;
  }
  if (digits.length < 6) {
    return digits.padStart(6, '0');
  }
  return digits.slice(-6);
}

export function isValidFundCode(code = '') {
  return FUND_CODE_PATTERN.test(normalizeFundCode(code));
}

/** Guess kind from code: 5xx/15x/56x/58x/... are on-exchange (ETF/场内); everything else default 场外. */
export function detectFundKind(code = '') {
  const normalized = normalizeFundCode(code);
  if (!FUND_CODE_PATTERN.test(normalized)) {
    return 'otc';
  }
  const prefix = normalized.slice(0, 2);
  if (EXCHANGE_PREFIXES.includes(prefix)) {
    return 'exchange';
  }
  return 'otc';
}

export function normalizeFundKind(value = '', code = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'exchange' || raw === 'otc') {
    return raw;
  }
  return detectFundKind(code);
}

export function normalizeTransactionType(value = '') {
  const raw = String(value || '').trim().toUpperCase();
  return TRANSACTION_TYPES.includes(raw) ? raw : 'BUY';
}

export function normalizeFundName(name = '') {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

export function normalizeIsoDate(value = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  // Accept YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, or timestamp-parseable strings.
  const directMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (directMatch) {
    const [, y, m, d] = directMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp)) {
    const dateObj = new Date(timestamp);
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

function parsePositiveDecimal(value, precision = 4) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const normalized = typeof value === 'string'
    ? value.replace(/[,\s¥$]/g, '')
    : value;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return round(num, precision);
}

export function buildTransactionId(prefix = 'tx') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyTransaction(overrides = {}) {
  return {
    id: buildTransactionId('tx'),
    code: '',
    name: '',
    kind: 'otc',
    type: 'BUY',
    date: '',
    price: '',
    shares: '',
    note: '',
    ...overrides
  };
}

export function normalizeTransaction(tx = {}, { idPrefix = 'tx' } = {}) {
  const code = normalizeFundCode(tx?.code || '');
  const kind = normalizeFundKind(tx?.kind, code);
  return {
    id: String(tx?.id || '').trim() || buildTransactionId(idPrefix),
    code,
    name: normalizeFundName(tx?.name || ''),
    kind,
    type: normalizeTransactionType(tx?.type),
    date: normalizeIsoDate(tx?.date),
    price: parsePositiveDecimal(tx?.price, 4),
    shares: parsePositiveDecimal(tx?.shares, 4),
    note: String(tx?.note || '').trim()
  };
}

export function hasMeaningfulTransaction(tx = {}) {
  return Boolean(
    String(tx?.code || '').trim()
      || String(tx?.name || '').trim()
      || String(tx?.date || '').trim()
      || Number(tx?.price) > 0
      || Number(tx?.shares) > 0
      || String(tx?.note || '').trim()
  );
}

export function sanitizeTransactions(list = [], { filterInvalid = false, idPrefix = 'tx' } = {}) {
  const normalized = (Array.isArray(list) ? list : []).map((tx) => normalizeTransaction(tx, { idPrefix }));
  if (!filterInvalid) {
    return normalized;
  }
  return normalized.filter((tx) => Object.keys(getTransactionErrors(tx)).length === 0);
}

export function getTransactionErrors(tx = {}, { ignoreBlank = false } = {}) {
  const meaningful = hasMeaningfulTransaction(tx);
  if (ignoreBlank && !meaningful) {
    return {};
  }
  const normalized = normalizeTransaction(tx);
  const errors = {};
  if (!normalized.code) {
    errors.code = '基金代码必填。';
  } else if (!FUND_CODE_PATTERN.test(normalized.code)) {
    errors.code = '基金代码必须为 6 位数字。';
  }
  if (!TRANSACTION_TYPES.includes(normalized.type)) {
    errors.type = '交易类型只允许 BUY / SELL。';
  }
  if (!(normalized.price > 0)) {
    errors.price = '交易价格必须大于 0。';
  }
  if (!(normalized.shares > 0)) {
    errors.shares = '交易份额必须大于 0。';
  }
  return errors;
}

export function summarizeTransactionErrors(errors = {}) {
  return Object.values(errors).filter(Boolean).join(' ');
}

export function getLedgerCodeList(transactions = []) {
  const codeSet = new Set();
  for (const tx of Array.isArray(transactions) ? transactions : []) {
    const code = normalizeFundCode(tx?.code || '');
    if (FUND_CODE_PATTERN.test(code)) {
      codeSet.add(code);
    }
  }
  return [...codeSet].sort();
}

/** Metrics per lot/row, matching the Excel "成交流水" sheet columns. */
export function buildLotMetrics(tx = {}, snapshot = null) {
  const normalized = normalizeTransaction(tx);
  const latestNav = round(Number(snapshot?.latestNav) || 0, 4);
  const previousNav = round(Number(snapshot?.previousNav) || 0, 4);
  const hasLatestNav = latestNav > 0;
  const hasPreviousNav = previousNav > 0;
  const cost = round(normalized.price * normalized.shares, 2);

  if (normalized.type === 'SELL') {
    const proceeds = round(normalized.price * normalized.shares, 2);
    return {
      tx: normalized,
      isSell: true,
      isBuy: false,
      displayShares: normalized.shares,
      costBasis: cost,
      proceeds,
      marketValue: 0,
      totalProfit: 0,
      totalReturnRate: 0,
      todayProfit: 0,
      todayReturnRate: 0,
      hasLatestNav,
      hasPreviousNav,
      latestNav,
      previousNav,
      latestNavDate: String(snapshot?.latestNavDate || ''),
      previousNavDate: String(snapshot?.previousNavDate || '')
    };
  }

  const marketValue = hasLatestNav ? round(latestNav * normalized.shares, 2) : 0;
  const totalProfit = hasLatestNav ? round((latestNav - normalized.price) * normalized.shares, 2) : 0;
  const totalReturnRate = hasLatestNav && cost > 0 ? round((totalProfit / cost) * 100, 2) : 0;
  const todayProfit = hasLatestNav && hasPreviousNav
    ? round((latestNav - previousNav) * normalized.shares, 2)
    : 0;
  const previousValue = hasPreviousNav ? previousNav * normalized.shares : 0;
  const todayReturnRate = hasLatestNav && hasPreviousNav && previousValue > 0
    ? round((todayProfit / previousValue) * 100, 2)
    : 0;

  return {
    tx: normalized,
    isSell: false,
    isBuy: true,
    displayShares: normalized.shares,
    costBasis: cost,
    proceeds: 0,
    marketValue,
    totalProfit,
    totalReturnRate,
    todayProfit,
    todayReturnRate,
    hasLatestNav,
    hasPreviousNav,
    latestNav,
    previousNav,
    latestNavDate: String(snapshot?.latestNavDate || ''),
    previousNavDate: String(snapshot?.previousNavDate || '')
  };
}

/** Group transactions by fund code and produce the Excel "基金汇总" sheet shape. */
export function aggregateByCode(transactions = [], snapshotsByCode = {}) {
  const normalizedTxs = sanitizeTransactions(transactions, { filterInvalid: false });
  const map = new Map();

  for (const tx of normalizedTxs) {
    if (!tx.code) continue;
    if (!map.has(tx.code)) {
      map.set(tx.code, {
        code: tx.code,
        name: tx.name,
        kind: tx.kind,
        transactions: [],
        buyShares: 0,
        buyAmount: 0,
        sellShares: 0,
        sellAmount: 0,
        firstBuyDate: '',
        lastTxDate: ''
      });
    }
    const bucket = map.get(tx.code);
    bucket.transactions.push(tx);
    if (tx.name && !bucket.name) {
      bucket.name = tx.name;
    }
    if (tx.kind) {
      bucket.kind = tx.kind;
    }
    if (tx.type === 'BUY') {
      bucket.buyShares = round(bucket.buyShares + tx.shares, 4);
      bucket.buyAmount = round(bucket.buyAmount + tx.price * tx.shares, 2);
      if (tx.date && (!bucket.firstBuyDate || tx.date < bucket.firstBuyDate)) {
        bucket.firstBuyDate = tx.date;
      }
    } else if (tx.type === 'SELL') {
      bucket.sellShares = round(bucket.sellShares + tx.shares, 4);
      bucket.sellAmount = round(bucket.sellAmount + tx.price * tx.shares, 2);
    }
    if (tx.date && tx.date > bucket.lastTxDate) {
      bucket.lastTxDate = tx.date;
    }
  }

  const aggregates = [];
  for (const bucket of map.values()) {
    const snapshot = snapshotsByCode?.[bucket.code] || null;
    const latestNav = round(Number(snapshot?.latestNav) || 0, 4);
    const previousNav = round(Number(snapshot?.previousNav) || 0, 4);
    const hasLatestNav = latestNav > 0;
    const hasPreviousNav = previousNav > 0;

    const totalShares = round(bucket.buyShares - bucket.sellShares, 4);
    // Weighted avg cost across BUYs (sells do not change avg cost).
    const avgCost = bucket.buyShares > 0 ? round(bucket.buyAmount / bucket.buyShares, 4) : 0;
    // 总成本 = 当前未卖出份额 × 加权均价（= open cost）；卖光后=0
    const totalCost = totalShares > 0 ? round(totalShares * avgCost, 2) : 0;
    const marketValue = hasLatestNav && totalShares > 0 ? round(totalShares * latestNav, 2) : 0;
    const totalProfit = hasLatestNav && totalShares > 0 ? round(marketValue - totalCost, 2) : 0;
    const totalReturnRate = totalCost > 0 ? round((totalProfit / totalCost) * 100, 2) : 0;
    const todayProfit = hasLatestNav && hasPreviousNav && totalShares > 0
      ? round((latestNav - previousNav) * totalShares, 2)
      : 0;
    const previousValue = hasPreviousNav && totalShares > 0 ? previousNav * totalShares : 0;
    const todayReturnRate = previousValue > 0
      ? round((todayProfit / previousValue) * 100, 2)
      : 0;

    aggregates.push({
      code: bucket.code,
      name: bucket.name || snapshot?.name || '',
      kind: bucket.kind,
      transactions: bucket.transactions,
      buyShares: bucket.buyShares,
      sellShares: bucket.sellShares,
      totalShares,
      avgCost,
      totalCost,
      latestNav,
      previousNav,
      latestNavDate: String(snapshot?.latestNavDate || ''),
      previousNavDate: String(snapshot?.previousNavDate || ''),
      marketValue,
      totalProfit,
      totalReturnRate,
      todayProfit,
      todayReturnRate,
      previousValue: round(previousValue, 2),
      hasPosition: totalShares > 0,
      hasLatestNav,
      hasPreviousNav,
      snapshotError: String(snapshot?.error || ''),
      firstBuyDate: bucket.firstBuyDate,
      lastTxDate: bucket.lastTxDate,
      snapshotUpdatedAt: String(snapshot?.updatedAt || '')
    });
  }

  aggregates.sort((a, b) => {
    if (a.hasPosition !== b.hasPosition) return a.hasPosition ? -1 : 1;
    if (b.marketValue !== a.marketValue) return b.marketValue - a.marketValue;
    return a.code.localeCompare(b.code);
  });

  return aggregates;
}

/** Portfolio-level summary card numbers matching the Excel "投资组合概览". */
export function summarizePortfolio(aggregates = []) {
  const summary = {
    assetCount: 0,
    recordedCodeCount: (Array.isArray(aggregates) ? aggregates : []).length,
    totalCost: 0,
    marketValue: 0,
    totalProfit: 0,
    totalReturnRate: 0,
    todayProfit: 0,
    todayReturnRate: 0,
    previousMarketValue: 0,
    pricedCount: 0,
    todayReadyCount: 0,
    latestNavDate: '',
    latestSnapshotAt: '',
    failedCodes: []
  };

  for (const agg of Array.isArray(aggregates) ? aggregates : []) {
    if (agg.snapshotError && agg.hasPosition) {
      summary.failedCodes.push(agg.code);
    }
    if (!agg.hasPosition) {
      // 已卖光的仓位不计入组合总市值/总成本/当日收益。
      continue;
    }
    summary.assetCount += 1;
    summary.totalCost = round(summary.totalCost + agg.totalCost, 2);
    if (agg.hasLatestNav) {
      summary.pricedCount += 1;
      summary.marketValue = round(summary.marketValue + agg.marketValue, 2);
      if (agg.snapshotUpdatedAt && agg.snapshotUpdatedAt > summary.latestSnapshotAt) {
        summary.latestSnapshotAt = agg.snapshotUpdatedAt;
      }
      if (agg.latestNavDate && agg.latestNavDate > summary.latestNavDate) {
        summary.latestNavDate = agg.latestNavDate;
      }
    }
    if (agg.hasLatestNav && agg.hasPreviousNav) {
      summary.todayReadyCount += 1;
      summary.todayProfit = round(summary.todayProfit + agg.todayProfit, 2);
      summary.previousMarketValue = round(summary.previousMarketValue + agg.previousValue, 2);
    }
  }

  summary.totalProfit = round(summary.marketValue - summary.totalCost, 2);
  summary.totalReturnRate = summary.totalCost > 0
    ? round((summary.totalProfit / summary.totalCost) * 100, 2)
    : 0;
  summary.todayReturnRate = summary.previousMarketValue > 0
    ? round((summary.todayProfit / summary.previousMarketValue) * 100, 2)
    : 0;

  return summary;
}

/** Flatten transactions into display-ready rows joined with snapshots. */
export function buildLedgerRows(transactions = [], snapshotsByCode = {}) {
  const normalizedTxs = sanitizeTransactions(transactions, { filterInvalid: false });
  const rows = normalizedTxs.map((tx) => {
    const snapshot = snapshotsByCode?.[tx.code] || null;
    return {
      tx,
      metrics: buildLotMetrics(tx, snapshot),
      snapshot
    };
  });
  rows.sort((a, b) => {
    const da = a.tx.date || '';
    const db = b.tx.date || '';
    if (da !== db) return db.localeCompare(da);
    return a.tx.code.localeCompare(b.tx.code);
  });
  return rows;
}
