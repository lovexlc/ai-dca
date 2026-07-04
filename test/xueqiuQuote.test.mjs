import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getXueqiuQuote, resolveQuotePeakPrice, toFinitePrice } from '../src/app/xueqiuQuote.js';

test('getXueqiuQuote reads public quote_detail data before legacy raw payload', () => {
  const publicQuote = { high52w: 2.58 };
  const rawQuote = { high52w: 2.36 };
  const payload = {
    results: {
      quote_detail: {
        data: { quote: publicQuote },
        raw: { data: { quote: rawQuote } }
      }
    }
  };

  assert.equal(getXueqiuQuote(payload), publicQuote);
});

test('resolveQuotePeakPrice prefers 52 week high before day high', () => {
  assert.equal(resolveQuotePeakPrice({ high: 1.9, high52w: 2.36 }), 2.36);
  assert.equal(resolveQuotePeakPrice({ high: 1.9 }, { fiftyTwoWeekHigh: 550.12 }), 550.12);
});

test('resolveQuotePeakPrice prefers xueqiu historical high aliases before 52 week and day high', () => {
  assert.equal(resolveQuotePeakPrice({ high: 1.9, high52w: 2.36, highest: 2.58 }), 2.58);
  assert.equal(resolveQuotePeakPrice({ high: 1.9, high52w: 2.36, history_high: '2.61' }), 2.61);
});

test('toFinitePrice rejects empty and non-positive values', () => {
  assert.equal(toFinitePrice(''), 0);
  assert.equal(toFinitePrice(-1), 0);
  assert.equal(toFinitePrice('2.345'), 2.345);
});
