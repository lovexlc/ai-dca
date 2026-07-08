import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarketListFetchPolicy,
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

test('list history metrics policy ignores hidden trend when no history metric columns are visible', () => {
  assert.equal(shouldFetchListHistoryMetricsForVisibility(hiddenHistoryVisibility(), { hideTrendColumn: false }), false);
  assert.equal(shouldFetchListHistoryMetricsForVisibility({ ...hiddenHistoryVisibility(), trend: true }, { hideTrendColumn: false }), true);
  assert.equal(shouldFetchListHistoryMetricsForVisibility({ ...hiddenHistoryVisibility(), trend: true }, { hideTrendColumn: true }), false);
});
