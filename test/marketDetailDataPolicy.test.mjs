import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarketListFetchPolicy,
  buildMarketSortFetchPolicy,
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

test('market sorting fetch policy loads only the list enhancements required by the selected fields', () => {
  assert.deepEqual(buildMarketSortFetchPolicy({
    sorting: [
      { id: 'return1y', desc: true },
      { id: 'feeRate', desc: false },
    ],
    showLimitColumn: true,
    hidePremiumColumn: false,
  }), {
    includeFundFees: true,
    includePremiumSnapshots: false,
    includeHighPointSnapshots: false,
    includeFundLimits: false,
    includeListHistoryMetrics: true,
  });
});

test('market sorting fetch policy hydrates premium, high-point, and limit fields when sorted', () => {
  assert.deepEqual(buildMarketSortFetchPolicy({
    sorting: [
      { id: 'premium', desc: true },
      { id: 'highDrawdown', desc: false },
    ],
    showLimitColumn: true,
  }), {
    includeFundFees: false,
    includePremiumSnapshots: true,
    includeHighPointSnapshots: false,
    includeFundLimits: false,
    includeListHistoryMetrics: false,
  });

  assert.deepEqual(buildMarketSortFetchPolicy({
    sorting: [
      { id: 'closeHighDrawdown', desc: false },
    ],
    showLimitColumn: true,
  }), {
    includeFundFees: false,
    includePremiumSnapshots: false,
    includeHighPointSnapshots: true,
    includeFundLimits: false,
    includeListHistoryMetrics: false,
  });

  assert.equal(buildMarketSortFetchPolicy({
    sorting: [{ id: 'limit', desc: true }],
    showLimitColumn: true,
  }).includeFundLimits, true);
});
