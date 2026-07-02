import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveHighDrawdown } from '../src/pages/markets/marketHighDrawdown.js';

test('market high drawdown uses quote high aliases', () => {
  const drawdown = resolveHighDrawdown({ symbol: '513100', price: 2, high52w: 2.2, highest: 2.5, highDate: '2026-06-03' });

  assert.equal(drawdown.high, 2.5);
  assert.equal(drawdown.highDate, '2026-06-03');
  assert.equal(drawdown.current, 2);
  assert.equal(drawdown.drawdownPct, 20);
});

test('market high drawdown falls back to quote high aliases', () => {
  const drawdown = resolveHighDrawdown({ symbol: 'QQQ', currentPrice: 450, fiftyTwoWeekHigh: 500 });

  assert.equal(drawdown.high, 500);
  assert.equal(drawdown.current, 450);
  assert.equal(drawdown.drawdownPct, 10);
});

test('market high drawdown returns null without a valid high and current price', () => {
  assert.equal(resolveHighDrawdown({ symbol: '513100', price: 2 }), null);
  assert.equal(resolveHighDrawdown({ symbol: '513100', high52w: 2.5 }), null);
});

test('market high drawdown ignores intraday high', () => {
  assert.equal(resolveHighDrawdown({ symbol: '513100', price: 2, high: 2.4 }), null);
});
