import { round } from './accumulation.js';

const FUND_SWITCH_KEY = 'aiDcaFundSwitchState';

export const defaultFundSwitchState = {
  fileName: 'Screenshot_20231024_09.png',
  recognizedRecords: 4,
  feePerTrade: 0,
  comparison: {
    sourceCode: '159660',
    sourceSellShares: 2600,
    sourceCurrentPrice: 1.863,
    targetCode: '513100',
    targetBuyShares: 2900,
    targetCurrentPrice: 1.729,
    switchCost: 4869.1,
    extraCash: 142.3,
    feeTradeCount: 2
  },
  rows: [
    { id: 'switch-1', date: '2023-10-24', code: '000651', type: '卖出', buyPrice: 0, sellPrice: 1.245, shares: 12500 },
    { id: 'switch-2', date: '2023-10-25', code: '001230', type: '买入', buyPrice: 3.8821, sellPrice: 0, shares: 4010.5 },
    { id: 'switch-3', date: '2023-11-02', code: '510300', type: '买入', buyPrice: 0.9982, sellPrice: 0, shares: 25000 },
    { id: 'switch-4', date: '2023-11-15', code: '161725', type: '卖出', buyPrice: 0, sellPrice: 1.0234, shares: 8900 }
  ]
};

function toPositiveNumber(value) {
  return Math.max(Number(value) || 0, 0);
}

function toNonNegativeOrFallback(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(numericValue, 0) : fallback;
}

function withDerivedRowValues(row) {
  const price = row.type === '卖出' ? row.sellPrice : row.buyPrice;
  return {
    ...row,
    price,
    amount: round(price * row.shares, 2)
  };
}

function sanitizeRow(row, index) {
  const type = row?.type === '卖出' ? '卖出' : '买入';
  const legacyPrice = toPositiveNumber(row?.price);
  const buyPrice = toPositiveNumber(row?.buyPrice ?? (type === '买入' ? legacyPrice : 0));
  const sellPrice = toPositiveNumber(row?.sellPrice ?? (type === '卖出' ? legacyPrice : 0));

  return withDerivedRowValues({
    id: row?.id || `switch-${index + 1}`,
    date: row?.date || '',
    code: row?.code || '',
    type,
    buyPrice,
    sellPrice,
    shares: toPositiveNumber(row?.shares)
  });
}

function sanitizeComparison(comparison = {}) {
  const fallback = defaultFundSwitchState.comparison;

  return {
    sourceCode: String(comparison.sourceCode || '').trim() || fallback.sourceCode,
    sourceSellShares: toNonNegativeOrFallback(comparison.sourceSellShares, fallback.sourceSellShares),
    sourceCurrentPrice: toNonNegativeOrFallback(comparison.sourceCurrentPrice, fallback.sourceCurrentPrice),
    targetCode: String(comparison.targetCode || '').trim() || fallback.targetCode,
    targetBuyShares: toNonNegativeOrFallback(comparison.targetBuyShares, fallback.targetBuyShares),
    targetCurrentPrice: toNonNegativeOrFallback(comparison.targetCurrentPrice, fallback.targetCurrentPrice),
    switchCost: toNonNegativeOrFallback(comparison.switchCost, fallback.switchCost),
    extraCash: toNonNegativeOrFallback(comparison.extraCash, fallback.extraCash),
    feeTradeCount: toNonNegativeOrFallback(comparison.feeTradeCount, fallback.feeTradeCount)
  };
}

export function deriveComparisonFromRows(rows, comparison = {}) {
  const currentComparison = sanitizeComparison(comparison);
  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row, index) => sanitizeRow(row, index));
  const sellRows = normalizedRows.filter((row) => row.type === '卖出');
  const buyRows = normalizedRows.filter((row) => row.type === '买入');
  const sellAmount = sellRows.reduce((sum, row) => sum + row.amount, 0);
  const buyAmount = buyRows.reduce((sum, row) => sum + row.amount, 0);
  const firstSellCode = sellRows.find((row) => String(row.code || '').trim())?.code;
  const firstBuyCode = buyRows.find((row) => String(row.code || '').trim())?.code;

  return {
    ...currentComparison,
    sourceCode: firstSellCode || currentComparison.sourceCode,
    sourceSellShares: round(sellRows.reduce((sum, row) => sum + row.shares, 0), 2),
    targetCode: firstBuyCode || currentComparison.targetCode,
    targetBuyShares: round(buyRows.reduce((sum, row) => sum + row.shares, 0), 2),
    extraCash: round(Math.max(buyAmount - sellAmount, 0), 2),
    switchCost: round(buyAmount, 2),
    feeTradeCount: normalizedRows.length
  };
}

export function buildFundSwitchSummary(state) {
  const comparison = sanitizeComparison(state?.comparison);
  const feePerTrade = Math.max(Number(state?.feePerTrade) || 0, 0);
  const rows = (Array.isArray(state?.rows) && state.rows.length ? state.rows : defaultFundSwitchState.rows)
    .map((row, index) => sanitizeRow(row, index));

  const processedAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const sellAmount = rows.reduce((sum, row) => sum + (row.type === '卖出' ? row.amount : 0), 0);
  const buyAmount = rows.reduce((sum, row) => sum + (row.type === '买入' ? row.amount : 0), 0);
  const estimatedYield = sellAmount - buyAmount;
  const feeTotal = round(feePerTrade * comparison.feeTradeCount, 2);
  const stayValue = round(comparison.sourceSellShares * comparison.sourceCurrentPrice, 2);
  const switchedValue = round(comparison.targetBuyShares * comparison.targetCurrentPrice, 2);
  const switchedPositionProfit = round(switchedValue - comparison.switchCost - feeTotal, 2);
  const switchAdvantage = round(switchedValue - stayValue - comparison.extraCash - feeTotal, 2);

  return {
    rows,
    comparison,
    feePerTrade,
    feeTotal,
    processedAmount,
    sellAmount,
    buyAmount,
    estimatedYield,
    stayValue,
    switchedValue,
    switchedPositionProfit,
    switchAdvantage,
    recordCount: rows.length
  };
}

export function createEmptyFundSwitchRow() {
  return withDerivedRowValues({
    id: `switch-${Date.now()}`,
    date: '',
    code: '',
    type: '买入',
    buyPrice: 0,
    sellPrice: 0,
    shares: 0
  });
}

export function readFundSwitchState() {
  if (typeof window === 'undefined') {
    return defaultFundSwitchState;
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(FUND_SWITCH_KEY) || 'null');
    if (!saved) {
      return defaultFundSwitchState;
    }

    return {
      fileName: saved.fileName || defaultFundSwitchState.fileName,
      recognizedRecords: toNonNegativeOrFallback(saved.recognizedRecords, defaultFundSwitchState.recognizedRecords),
      feePerTrade: Math.max(Number(saved.feePerTrade) || defaultFundSwitchState.feePerTrade, 0),
      comparison: sanitizeComparison(saved.comparison),
      rows: (Array.isArray(saved.rows) && saved.rows.length ? saved.rows : defaultFundSwitchState.rows).map((row, index) => sanitizeRow(row, index))
    };
  } catch (_error) {
    return defaultFundSwitchState;
  }
}

export function persistFundSwitchState(state, computed = buildFundSwitchSummary(state)) {
  if (typeof window === 'undefined') {
    return;
  }

  const payload = {
    source: 'react-fund-switch',
    fileName: state.fileName || defaultFundSwitchState.fileName,
    recognizedRecords: Math.max(Number(state.recognizedRecords) || computed.recordCount, 0),
    feePerTrade: round(computed.feePerTrade, 2),
    processedAmount: round(computed.processedAmount, 2),
    sellAmount: round(computed.sellAmount, 2),
    buyAmount: round(computed.buyAmount, 2),
    estimatedYield: round(computed.estimatedYield, 2),
    feeTotal: round(computed.feeTotal, 2),
    stayValue: round(computed.stayValue, 2),
    switchedValue: round(computed.switchedValue, 2),
    switchedPositionProfit: round(computed.switchedPositionProfit, 2),
    switchAdvantage: round(computed.switchAdvantage, 2),
    comparison: {
      ...computed.comparison,
      sourceSellShares: round(computed.comparison.sourceSellShares, 2),
      sourceCurrentPrice: round(computed.comparison.sourceCurrentPrice, 4),
      targetBuyShares: round(computed.comparison.targetBuyShares, 2),
      targetCurrentPrice: round(computed.comparison.targetCurrentPrice, 4),
      switchCost: round(computed.comparison.switchCost, 2),
      extraCash: round(computed.comparison.extraCash, 2),
      feeTradeCount: Math.max(Number(computed.comparison.feeTradeCount) || 0, 0)
    },
    rows: computed.rows.map((row) => ({
      ...row,
      buyPrice: round(row.buyPrice, 4),
      sellPrice: round(row.sellPrice, 4),
      price: round(row.price, 4),
      shares: round(row.shares, 2),
      amount: round(row.amount, 2)
    })),
    updatedAt: new Date().toISOString()
  };

  window.localStorage.setItem(FUND_SWITCH_KEY, JSON.stringify(payload));
}
