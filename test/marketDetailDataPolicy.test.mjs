import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarketListFetchPolicy,
  isCnFundCompareInstrument,
  shouldEnableComparePk,
  shouldFetchComparePkExtras,
  shouldFetchListHistoryMetricsForVisibility,
} from '../src/pages/markets/marketDetailDataPolicy.js';

const HISTORY_COLUMNS = [
  'trend',
  'highDrawdown',
  'closeHighDrawdown',
  'historicalPercentile',
  'currentYearPercent',
  'return1w',
  'return1m',
  'return3m',
  'return6m',
  'return1y',
  'returnBase',
];

function hiddenHistoryVisibility() {
  return Object.fromEntries(HISTORY_COLUMNS.map((id) => [id, false]));
}

test('market list fetch policy enables enhancements only for rendered visible columns', () => {
  assert.deepEqual(buildMarketListFetchPolicy({
    visibility: {},
    showLimitColumn: true,
    hidePremiumColumn: false,
    hideTrendColumn: true,
  }), {
    includeFundFees: true,
    includePremiumSnapshots: true,
    includeHighPointSnapshots: true,
    includeFundLimits: true,
    includeListHistoryMetrics: true,
  });
});

test('market list fetch policy disables enhancement APIs for hidden columns', () => {
  const policy = buildMarketListFetchPolicy({
    visibility: {
      feeRate: false,
      redeemFeeRate: false,
      premium: false,
      limit: false,
      ...hiddenHistoryVisibility(),
    },
    showLimitColumn: true,
    hidePremiumColumn: false,
    hideTrendColumn: false,
  });

  assert.deepEqual(policy, {
    includeFundFees: false,
    includePremiumSnapshots: false,
    includeHighPointSnapshots: false,
    includeFundLimits: false,
    includeListHistoryMetrics: false,
  });
});

test('market list fetch policy respects columns that are not rendered for the active list', () => {
  const policy = buildMarketListFetchPolicy({
    visibility: {},
    showLimitColumn: false,
    hidePremiumColumn: true,
    hideTrendColumn: true,
  });

  assert.equal(policy.includeFundLimits, false);
  assert.equal(policy.includePremiumSnapshots, false);
  assert.equal(policy.includeHighPointSnapshots, true);
});

test('market list fetch policy does not fetch history enhancements for day high drawdown only', () => {
  const policy = buildMarketListFetchPolicy({
    visibility: {
      feeRate: false,
      redeemFeeRate: false,
      premium: false,
      limit: false,
      ...hiddenHistoryVisibility(),
      highDrawdown: true,
    },
    showLimitColumn: true,
    hidePremiumColumn: false,
    hideTrendColumn: false,
  });

  assert.equal(policy.includeHighPointSnapshots, false);
  assert.equal(policy.includeListHistoryMetrics, false);
});

test('list history metrics policy ignores hidden trend when no history metric columns are visible', () => {
  assert.equal(shouldFetchListHistoryMetricsForVisibility(hiddenHistoryVisibility(), { hideTrendColumn: false }), false);
  assert.equal(shouldFetchListHistoryMetricsForVisibility({ ...hiddenHistoryVisibility(), trend: true }, { hideTrendColumn: false }), true);
  assert.equal(shouldFetchListHistoryMetricsForVisibility({ ...hiddenHistoryVisibility(), trend: true }, { hideTrendColumn: true }), false);
});

test('compare PK extras only fetch when cn market has compare symbols', () => {
  assert.deepEqual(shouldFetchComparePkExtras({ market: 'us', compareCount: 2, includeFees: true, includeLimits: true }), {
    includeFundFees: false,
    includeFundLimits: false,
  });
  assert.deepEqual(shouldFetchComparePkExtras({ market: 'cn', compareCount: 0, includeFees: true, includeLimits: true }), {
    includeFundFees: false,
    includeFundLimits: false,
  });
  assert.deepEqual(shouldFetchComparePkExtras({ market: 'cn', compareCount: 1, includeFees: true, includeLimits: false }), {
    includeFundFees: true,
    includeFundLimits: false,
  });
  assert.deepEqual(shouldFetchComparePkExtras({ market: 'cn', compareCount: 2, includeFees: true, includeLimits: true }), {
    includeFundFees: true,
    includeFundLimits: true,
  });
  assert.deepEqual(shouldFetchComparePkExtras({ market: 'CN', compareCount: 1, includeFees: false, includeLimits: true }), {
    includeFundFees: false,
    includeFundLimits: true,
  });
});

test('compare PK only enables actual CN fund comparisons and skips premium mode', () => {
  assert.equal(isCnFundCompareInstrument('sh513100'), true);
  assert.equal(isCnFundCompareInstrument('600000', { symbol: 'sh600000', source: 'xueqiu-quote' }), false);
  assert.equal(isCnFundCompareInstrument('000834', { exchange: '场外基金', assetType: 'otc_fund' }), true);

  assert.equal(shouldEnableComparePk({
    market: 'cn',
    mainSymbol: 'sh513100',
    compareSymbols: ['sh510300'],
    compareQuoteMap: { sh510300: { source: 'xueqiu-quote' } },
  }), true);
  assert.equal(shouldEnableComparePk({
    market: 'cn',
    mainSymbol: 'sh600000',
    mainQuote: { symbol: 'sh600000', source: 'xueqiu-quote' },
    compareSymbols: ['sh600001'],
    compareQuoteMap: { sh600001: { symbol: 'sh600001', source: 'xueqiu-quote' } },
  }), false);
  assert.equal(shouldEnableComparePk({
    market: 'cn',
    mainSymbol: '000834',
    compareSymbols: ['270042'],
    compareQuoteMap: { '270042': { exchange: '场外基金', assetType: 'otc_fund' } },
    isMainOtc: true,
  }), true);
  assert.equal(shouldEnableComparePk({
    market: 'cn',
    mainSymbol: 'sh513100',
    compareSymbols: ['sh510300'],
    compareQuoteMap: { sh510300: { source: 'xueqiu-quote' } },
    premiumMode: true,
  }), false);
});
