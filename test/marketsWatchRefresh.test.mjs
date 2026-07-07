import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeRefreshQuote,
  mergeRefreshQuoteMap,
} from '../src/pages/markets/useMarketsWatchRefresh.js';

test('refresh quote merge preserves existing columns when incoming values are empty', () => {
  const previous = {
    price: 2.16,
    changePercent: -0.41,
    premiumPercent: 0.8,
    highPoint: { high: 2.5, highDate: '2026-07-01' },
    name: '纳指ETF国泰',
  };
  const incoming = {
    price: 2.17,
    changePercent: undefined,
    premiumPercent: null,
    highPoint: {},
    name: '',
  };

  assert.deepEqual(mergeRefreshQuote(previous, incoming), {
    price: 2.17,
    changePercent: -0.41,
    premiumPercent: 0.8,
    highPoint: { high: 2.5, highDate: '2026-07-01' },
    name: '纳指ETF国泰',
  });
});

test('refresh quote merge allows real falsy values to replace stale data', () => {
  const previous = {
    changePercent: 1.23,
    premiumPercent: 0.8,
    isTrading: true,
  };
  const incoming = {
    changePercent: 0,
    premiumPercent: 0,
    isTrading: false,
  };

  assert.deepEqual(mergeRefreshQuote(previous, incoming), incoming);
});

test('refresh quote map merges per symbol without dropping untouched symbols', () => {
  const previous = {
    513100: { price: 2.16, premiumPercent: 0.8 },
    159659: { price: 2.29, premiumPercent: 0.3 },
  };
  const incoming = {
    513100: { price: 2.18, premiumPercent: null },
  };

  assert.deepEqual(mergeRefreshQuoteMap(previous, incoming), {
    513100: { price: 2.18, premiumPercent: 0.8 },
    159659: { price: 2.29, premiumPercent: 0.3 },
  });
});
