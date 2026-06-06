import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getXueqiuQuote, resolveQuotePeakPrice, toFinitePrice } from '../src/app/xueqiuQuote.js';

test('getXueqiuQuote reads raw quote_detail payload first', () => {
  const rawQuote = { high52w: 2.36 };
  const summaryQuote = { high52w: 2.1 };
  const payload = {
    results: {
      quote_detail: {
        raw: { data: { quote: rawQuote } },
        summary: { quote: summaryQuote }
      }
    }
  };

  assert.equal(getXueqiuQuote(payload), rawQuote);
});

test('resolveQuotePeakPrice prefers 52 week high before day high', () => {
  assert.equal(resolveQuotePeakPrice({ high: 1.9, high52w: 2.36 }), 2.36);
  assert.equal(resolveQuotePeakPrice({ high: 1.9 }, { fiftyTwoWeekHigh: 550.12 }), 550.12);
});

test('toFinitePrice rejects empty and non-positive values', () => {
  assert.equal(toFinitePrice(''), 0);
  assert.equal(toFinitePrice(-1), 0);
  assert.equal(toFinitePrice('2.345'), 2.345);
});
