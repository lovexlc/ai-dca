import {
  FUND_SWITCH_STRATEGIES,
  buildFundSwitchPositionMetrics,
  deriveFundSwitchComparison as deriveFundSwitchComparisonFromCore,
  getFundSwitchRowAmount,
  replayFundSwitchRows,
  round,
  sanitizeFundSwitchComparison,
  sanitizeFundSwitchRows
} from './fundSwitchCore.js';

export { FUND_SWITCH_STRATEGIES };

function createBlankComparison() {
  return {
    strategy: 'trace',
    sourcePositions: [],
    targetPositions: [],
    sourceCode: '',
    sourceSellShares: 0,
    sourceCurrentPrice: 0,
    targetCode: '',
    targetBuyShares: 0,
    targetCurrentPrice: 0,
    switchCost: 0,
    extraCash: 0,
    feeTradeCount: 0,
    priceOverrides: {}
  };
}

function createBlankRow(id = `switch-${Date.now()}`) {
  return sanitizeFundSwitchRows([
    {
      id,
      date: '',
      code: '',
      type: '买入',
      buyPrice: 0,
      sellPrice: 0,
      shares: 0,
      amount: 0
    }
  ])[0];
}

export const defaultFundSwitchState = {
  fileName: '',
  recognizedRecords: 0,
  resultConfirmed: false,
  feePerTrade: 0,
  comparison: createBlankComparison(),
  rows: [createBlankRow('switch-empty-1')]
};

export function createDefaultFundSwitchState() {
  return {
    fileName: '',
    recognizedRecords: 0,
    resultConfirmed: false,
    feePerTrade: 0,
    comparison: createBlankComparison(),
    rows: [createBlankRow('switch-empty-1')]
  };
}

function toPositiveNumber(value) {
  return Math.max(Number(value) || 0, 0);
}

export function createEmptyFundSwitchRow() {
  return createBlankRow();
}

export function deriveFundSwitchComparison(rows, comparison = {}, strategyOverride) {
  return deriveFundSwitchComparisonFromCore(rows, comparison, strategyOverride);
}

export function buildFundSwitchSummary(state, { getCurrentPrice } = {}) {
  const comparison = sanitizeFundSwitchComparison(state?.comparison);
  const feePerTrade = round(toPositiveNumber(state?.feePerTrade), 2);
  const rows = sanitizeFundSwitchRows(
    Array.isArray(state?.rows) && state.rows.length ? state.rows : defaultFundSwitchState.rows
  );
  const validRows = sanitizeFundSwitchRows(rows, { filterInvalid: true });
  const processedAmount = round(validRows.reduce((sum, row) => sum + getFundSwitchRowAmount(row), 0), 2);
  const sellAmount = round(validRows.reduce((sum, row) => sum + (row.type === '卖出' ? getFundSwitchRowAmount(row) : 0), 0), 2);
  const buyAmount = round(validRows.reduce((sum, row) => sum + (row.type === '买入' ? getFundSwitchRowAmount(row) : 0), 0), 2);
  const estimatedYield = round(sellAmount - buyAmount, 2);
  const sourcePositions = buildFundSwitchPositionMetrics(comparison.sourcePositions, 'source', comparison, getCurrentPrice);
  const targetPositions = buildFundSwitchPositionMetrics(comparison.targetPositions, 'target', comparison, getCurrentPrice);
  const stayValue = round(sourcePositions.reduce((sum, position) => sum + position.marketValue, 0), 2);
  const switchedValue = round(targetPositions.reduce((sum, position) => sum + position.marketValue, 0), 2);
  const feeTotal = round(feePerTrade * comparison.feeTradeCount, 2);
  const switchedPositionProfit = round(switchedValue - comparison.switchCost - feeTotal, 2);
  const switchAdvantage = round(switchedValue - stayValue - comparison.extraCash - feeTotal, 2);
  const missingPriceCodes = [...new Set(
    [...sourcePositions, ...targetPositions]
      .filter((position) => position.currentPrice <= 0)
      .map((position) => position.code)
  )];
  const resolvedComparison = sanitizeFundSwitchComparison({
    ...comparison,
    sourceCurrentPrice: sourcePositions.length === 1 ? sourcePositions[0].currentPrice : 0,
    targetCurrentPrice: targetPositions.length === 1 ? targetPositions[0].currentPrice : 0
  });
  const replay = replayFundSwitchRows(validRows);

  return {
    rows,
    validRows,
    comparison: resolvedComparison,
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
    recordCount: rows.length,
    validRecordCount: validRows.length,
    sourcePositions,
    targetPositions,
    missingPriceCodes,
    strategy: resolvedComparison.strategy,
    switchEvents: replay.switchEvents,
    currentLots: replay.currentLots
  };
}

export function readFundSwitchState() {
  if (typeof window === 'undefined') {
    return createDefaultFundSwitchState();
  }

  try {
    window.localStorage.removeItem('aiDcaFundSwitchState');
  } catch (_error) {
    return createDefaultFundSwitchState();
  }

  return createDefaultFundSwitchState();
}

export function persistFundSwitchState(state, computed = buildFundSwitchSummary(state)) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem('aiDcaFundSwitchState');
  } catch (_error) {
    // This page intentionally does not persist user-uploaded data in the browser.
  }
}
