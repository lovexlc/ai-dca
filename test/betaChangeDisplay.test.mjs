import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toDateStr,
  resolveLatestDataDate,
  createChangeDisplay
} from '../src/beta/data/changeDisplayCore.js';

// 2026-09-01 ~ 2026-09-04 当作交易日，2026-09-05 当作休市日。
const TRADING_DAYS = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];

function createCalendar(overrides = {}) {
  const tradingDays = new Set(overrides.tradingDays || TRADING_DAYS);
  const today = overrides.today || '2026-09-04';
  const previousTradingDay = overrides.previousTradingDay || '2026-09-03';
  return {
    isTradingDay: (date) => tradingDays.has(date),
    getToday: () => today,
    // 对齐 getExpectedLatestNavDate：场内/场外看 T，QDII 看 T-1。
    getExpectedDate: (kind, date) => (kind === 'qdii' ? previousTradingDay : date),
    normalizeKind: (value) => (value === 'exchange' || value === 'qdii' ? value : 'otc')
  };
}

function createDisplay(overrides) {
  return createChangeDisplay(createCalendar(overrides)).getDisplayChangePercent;
}

test('toDateStr normalizes the date shapes the snapshots actually carry', () => {
  assert.equal(toDateStr('2026-09-04'), '2026-09-04');
  assert.equal(toDateStr('2026/9/4'), '2026-09-04');
  assert.equal(toDateStr('2026.9.4 15:00:00'), '2026-09-04');
  assert.equal(toDateStr('2026-09-04T07:30:00Z'), '2026-09-04');
  assert.equal(toDateStr(new Date(2026, 8, 4)), '2026-09-04');
});

test('toDateStr treats unrecognized values as "no date" rather than guessing', () => {
  assert.equal(toDateStr(''), '');
  assert.equal(toDateStr(null), '');
  assert.equal(toDateStr(undefined), '');
  assert.equal(toDateStr('今天'), '');
  assert.equal(toDateStr(1757000000000), '');
  assert.equal(toDateStr(new Date('nope')), '');
});

test('exchange rows fall back through quoteDate, asOf and updatedAt', () => {
  assert.equal(resolveLatestDataDate({ quoteDate: '2026-09-04', asOf: '2026-09-01' }, 'exchange'), '2026-09-04');
  assert.equal(resolveLatestDataDate({ asOf: '2026-09-03', updatedAt: '2026-09-01' }, 'exchange'), '2026-09-03');
  assert.equal(resolveLatestDataDate({ updatedAt: '2026-09-02' }, 'exchange'), '2026-09-02');
  assert.equal(resolveLatestDataDate(null, 'exchange'), '');
});

test('otc rows only trust latestNavDate so LOF prices are never read as nav', () => {
  assert.equal(resolveLatestDataDate({ latestNavDate: '2026-09-04', quoteDate: '2026-09-04' }, 'otc'), '2026-09-04');
  assert.equal(resolveLatestDataDate({ quoteDate: '2026-09-04' }, 'otc'), '');
  assert.equal(resolveLatestDataDate({ quoteDate: '2026-09-04' }, 'lof'), '');
  assert.equal(resolveLatestDataDate({ latestNavDate: '2026-09-04' }, 'exchange'), '');
});

test('createChangeDisplay refuses to run without a calendar', () => {
  assert.throws(() => createChangeDisplay(), TypeError);
  assert.throws(() => createChangeDisplay({ isTradingDay: () => true }), /getToday/);
});

test('suspended funds render as blank, not as a flat zero', () => {
  const display = createDisplay();
  assert.deepEqual(
    display({ suspended: true, changePercent: 3.2, quoteDate: '2026-09-04' }, { kind: 'exchange' }),
    { changePercent: null, fresh: false, reason: 'suspended' }
  );
});

test('on a closed day the last known change is unambiguous and shown as is', () => {
  const display = createDisplay({ today: '2026-09-05' });
  assert.deepEqual(
    display({ changePercent: 1.5, quoteDate: '2026-09-04' }, { kind: 'exchange' }),
    { changePercent: 1.5, fresh: false, reason: 'market-closed' }
  );
  assert.deepEqual(
    display({}, { kind: 'exchange' }),
    { changePercent: 0, fresh: false, reason: 'market-closed' }
  );
});

test('a trading day with same-day quote shows the real change', () => {
  const display = createDisplay();
  assert.deepEqual(
    display({ changePercent: -0.87, quoteDate: '2026-09-04' }, { kind: 'exchange' }),
    { changePercent: -0.87, fresh: true, reason: 'fresh' }
  );
});

test('a trading day with yesterday\'s quote is zeroed instead of misread as today', () => {
  const display = createDisplay();
  assert.deepEqual(
    display({ changePercent: 2.4, quoteDate: '2026-09-03' }, { kind: 'exchange' }),
    { changePercent: 0, fresh: false, reason: 'stale' }
  );
});

test('otc uses the nav date and reports a missing date distinctly from a stale one', () => {
  const display = createDisplay();
  assert.deepEqual(
    display({ changePercent: 0.62, latestNavDate: '2026-09-04' }, { kind: 'otc' }),
    { changePercent: 0.62, fresh: true, reason: 'fresh' }
  );
  assert.deepEqual(
    display({ changePercent: 0.62, latestNavDate: '2026-09-03' }, { kind: 'otc' }),
    { changePercent: 0, fresh: false, reason: 'stale' }
  );
  assert.deepEqual(
    display({ changePercent: 0.62, quoteDate: '2026-09-04' }, { kind: 'otc' }),
    { changePercent: 0, fresh: false, reason: 'missing-date' }
  );
});

test('qdii expects T-1 nav, so today\'s date is the stale one', () => {
  const display = createDisplay();
  assert.deepEqual(
    display({ changePercent: 1.1, latestNavDate: '2026-09-03' }, { kind: 'qdii' }),
    { changePercent: 1.1, fresh: true, reason: 'fresh' }
  );
  assert.deepEqual(
    display({ changePercent: 1.1, latestNavDate: '2026-09-04' }, { kind: 'qdii' }),
    { changePercent: 0, fresh: false, reason: 'stale' }
  );
});

test('unparseable change percents degrade to zero without losing freshness', () => {
  const display = createDisplay();
  assert.deepEqual(
    display({ changePercent: '--', quoteDate: '2026-09-04' }, { kind: 'exchange' }),
    { changePercent: 0, fresh: true, reason: 'fresh' }
  );
  assert.deepEqual(
    display({ changePercent: '1.25', quoteDate: '2026-09-04' }, { kind: 'exchange' }),
    { changePercent: 1.25, fresh: true, reason: 'fresh' }
  );
});

test('an explicit todayDate overrides the injected clock', () => {
  const display = createDisplay({ today: '2026-09-05' });
  assert.deepEqual(
    display({ changePercent: 3, quoteDate: '2026-09-04' }, { kind: 'exchange', todayDate: '2026-09-04' }),
    { changePercent: 3, fresh: true, reason: 'fresh' }
  );
});

test('an unknown kind is treated as otc', () => {
  const display = createDisplay();
  assert.deepEqual(
    display({ changePercent: 1, quoteDate: '2026-09-04' }, { kind: 'lof' }),
    { changePercent: 0, fresh: false, reason: 'missing-date' }
  );
});
