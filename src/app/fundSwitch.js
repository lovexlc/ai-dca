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
    { id: 'switch-1', date: '2023-10-24', code: '000651', type: '卖出', price: 1.245, shares: 12500 },
    { id: 'switch-2', date: '2023-10-25', code: '001230', type: '买入', price: 3.8821, shares: 4010.5 },
    { id: 'switch-3', date: '2023-11-02', code: '510300', type: '买入', price: 0.9982, shares: 25000 },
    { id: 'switch-4', date: '2023-11-15', code: '161725', type: '卖出', price: 1.0234, shares: 8900 }
  ]
};

function sanitizeRow(row, index) {
  return {
    id: row?.id || `switch-${index + 1}`,
    date: row?.date || '',
    code: row?.code || '',
    type: row?.type === '卖出' ? '卖出' : '买入',
    price: Math.max(Number(row?.price) || 0, 0),
    shares: Math.max(Number(row?.shares) || 0, 0)
  };
}

function sanitizeComparison(comparison = {}) {
  const fallback = defaultFundSwitchState.comparison;

  return {
    sourceCode: comparison.sourceCode || fallback.sourceCode,
    sourceSellShares: Math.max(Number(comparison.sourceSellShares) || fallback.sourceSellShares, 0),
    sourceCurrentPrice: Math.max(Number(comparison.sourceCurrentPrice) || fallback.sourceCurrentPrice, 0),
    targetCode: comparison.targetCode || fallback.targetCode,
    targetBuyShares: Math.max(Number(comparison.targetBuyShares) || fallback.targetBuyShares, 0),
    targetCurrentPrice: Math.max(Number(comparison.targetCurrentPrice) || fallback.targetCurrentPrice, 0),
    switchCost: Math.max(Number(comparison.switchCost) || fallback.switchCost, 0),
    extraCash: Math.max(Number(comparison.extraCash) || fallback.extraCash, 0),
    feeTradeCount: Math.max(Number(comparison.feeTradeCount) || fallback.feeTradeCount, 0)
  };
}

export function buildFundSwitchSummary(state) {
  const comparison = sanitizeComparison(state?.comparison);
  const feePerTrade = Math.max(Number(state?.feePerTrade) || 0, 0);
  const rows = (Array.isArray(state?.rows) && state.rows.length ? state.rows : defaultFundSwitchState.rows)
    .map((row, index) => sanitizeRow(row, index))
    .map((row) => ({ ...row, amount: round(row.price * row.shares, 2) }));

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
  return {
    id: `switch-${Date.now()}`,
    date: '',
    code: '',
    type: '买入',
    price: 0,
    shares: 0
  };
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
      recognizedRecords: Math.max(Number(saved.recognizedRecords) || defaultFundSwitchState.recognizedRecords, 0),
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
      price: round(row.price, 4),
      shares: round(row.shares, 2),
      amount: round(row.amount, 2)
    })),
    updatedAt: new Date().toISOString()
  };

  window.localStorage.setItem(FUND_SWITCH_KEY, JSON.stringify(payload));
}
