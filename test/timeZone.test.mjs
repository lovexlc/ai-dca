import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatShanghaiDate,
  formatShanghaiDateTime,
  formatShanghaiTime,
  isSameShanghaiDate
} from '../src/app/timeZone.js';

test('formats UTC timestamps as Shanghai UTC+8', () => {
  const value = '2026-07-21T16:30:45.000Z';
  assert.equal(formatShanghaiDateTime(value), '2026-07-22 00:30');
  assert.equal(formatShanghaiDateTime(value, { seconds: true }), '2026-07-22 00:30:45');
  assert.equal(formatShanghaiDate(value), '2026-07-22');
  assert.equal(formatShanghaiTime(value), '00:30');
});

test('formats epoch seconds and naive wall-clock values consistently', () => {
  assert.equal(formatShanghaiDateTime(1784622600), '2026-07-21 16:30');
  assert.equal(formatShanghaiDateTime('2026-07-21T16:30'), '2026-07-21 16:30');
});

test('compares dates in Shanghai instead of the runtime timezone', () => {
  assert.equal(isSameShanghaiDate('2026-07-21T16:30:00.000Z', '2026-07-22T00:00:00.000Z'), true);
  assert.equal(isSameShanghaiDate('2026-07-21T15:59:59.000Z', '2026-07-22T00:00:00.000Z'), false);
});
