import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMarketRefreshTime, parseMarketRefreshTimestamp } from '../src/pages/markets/marketRefreshTime.js';

test('market refresh time formats source timestamps in Shanghai time', () => {
  assert.equal(formatMarketRefreshTime('2026-09-14T09:30:00+08:00'), '09-14 09:30:00');
  assert.equal(formatMarketRefreshTime('2026-09-14 09:30:00'), '09-14 09:30:00');
  assert.equal(parseMarketRefreshTimestamp('2026-09-14T09:30:00+08:00')?.toISOString(), '2026-09-14T01:30:00.000Z');
});

test('market refresh time safely handles missing or invalid timestamps', () => {
  assert.equal(formatMarketRefreshTime(''), '');
  assert.equal(formatMarketRefreshTime('not-a-date'), '');
  assert.equal(parseMarketRefreshTimestamp('not-a-date'), null);
});
