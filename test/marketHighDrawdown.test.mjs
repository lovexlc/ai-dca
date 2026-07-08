import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCloseHighDrawdown, resolveHighDrawdown } from '../src/pages/markets/marketHighDrawdown.js';

test('market high drawdown prefers row daily kline high over quote high aliases', () => {
  const drawdown = resolveHighDrawdown({
    symbol: '513100',
    market: 'cn',
    fundKind: 'exchange',
    price: 2.158,
    high52w: 5.464,
    highPoint: { high: 2.577, highDate: '2026-06-03', source: 'daily-kline-365d' }
  });

  assert.equal(drawdown.high, 2.577);
  assert.equal(drawdown.highDate, '2026-06-03');
  assert.equal(drawdown.highSource, 'daily-kline-365d');
  assert.equal(drawdown.current, 2.158);
  assert.equal(Number(drawdown.drawdownPct.toFixed(1)), 16.3);
});

test('market high drawdown still supports mapped daily kline high', () => {
  const drawdown = resolveHighDrawdown(
    { symbol: '513100', market: 'cn', fundKind: 'exchange', price: 2.158, high52w: 5.464 },
    { '513100': { high: 2.577, highDate: '2026-06-03', source: 'daily-kline-365d' } }
  );

  assert.equal(drawdown.high, 2.577);
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

test('market high drawdown waits for daily kline high on CN exchange funds', () => {
  assert.equal(resolveHighDrawdown({ symbol: '513100', market: 'cn', fundKind: 'exchange', price: 2.158, high52w: 5.464 }), null);
});

test('market high drawdown ignores intraday high', () => {
  assert.equal(resolveHighDrawdown({ symbol: '513100', price: 2, high: 2.4 }), null);
});

test('market close high drawdown uses close high point instead of intraday high point', () => {
  const row = {
    symbol: '513100',
    market: 'cn',
    fundKind: 'exchange',
    price: 2,
    highPoint: { high: 2.8, highDate: '2026-06-03', source: 'daily-kline-365d' },
    closeHighPoint: { high: 2.5, highDate: '2026-06-04', source: 'daily-close-kline-365d' }
  };

  const drawdown = resolveCloseHighDrawdown(row);

  assert.equal(drawdown.high, 2.5);
  assert.equal(drawdown.highDate, '2026-06-04');
  assert.equal(drawdown.highSource, 'daily-close-kline-365d');
  assert.equal(drawdown.drawdownPct, 20);
});

test('market close high drawdown waits for close high cache on CN exchange funds', () => {
  assert.equal(resolveCloseHighDrawdown({ symbol: '513100', market: 'cn', fundKind: 'exchange', price: 2, highPoint: { high: 2.8 } }), null);
});
