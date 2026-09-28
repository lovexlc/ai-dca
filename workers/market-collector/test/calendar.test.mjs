import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOLIDAY_RANGES,
  isTradingDay,
  isMarketHoliday,
  matchHolidayRange,
  holidayLabel,
  classifySession,
  buildSkipRecord,
} from '../src/calendar.js';
import { isTradingDay as isTradingDayReexport, classifySession as classifySessionReexport } from '../src/collect.js';

const D = (s) => new Date(`${s}T12:00:00+08:00`); // noon Shanghai, deterministic

test('2026 国庆 10/1–10/7 每天都是休市日', () => {
  assert.ok(HOLIDAY_RANGES[2026].some(([s, e]) => s === '2026-10-01' && e === '2026-10-07'));
  for (let d = 1; d <= 7; d++) {
    const ds = `2026-10-0${d}`;
    assert.equal(isMarketHoliday(D(ds)), true, ds);
    assert.equal(isTradingDay(D(ds)), false, ds);
    assert.equal(holidayLabel(D(ds)), '2026-10-01~2026-10-07', ds);
  }
});

test('国庆前后交易日不受影响', () => {
  assert.equal(isTradingDay(D('2026-09-30')), true); // Wed
  assert.equal(isTradingDay(D('2026-10-08')), true); // Thu
  assert.equal(isMarketHoliday(D('2026-09-30')), false);
  assert.equal(classifySession(new Date('2026-09-30T10:00:00+08:00')), 'trading');
});

test('周末仍为非交易日（与节假日无关）', () => {
  assert.equal(isTradingDay(D('2026-10-10')), false); // Sat
  assert.equal(isTradingDay(D('2026-10-11')), false); // Sun
  assert.equal(isMarketHoliday(D('2026-10-10')), false);
});

test('休市日盘中 classifySession 为 off_hours（采集门禁）', () => {
  assert.equal(classifySession(new Date('2026-10-01T10:00:00+08:00')), 'off_hours');
  assert.equal(classifySession(new Date('2026-10-05T14:00:00+08:00')), 'off_hours');
});

test('正常交易日盘中为 trading（行为不变）', () => {
  assert.equal(classifySession(new Date('2026-09-30T10:00:00+08:00')), 'trading');
  assert.equal(classifySession(new Date('2026-09-30T14:00:00+08:00')), 'trading');
  assert.equal(classifySession(new Date('2026-09-30T12:00:00+08:00')), 'lunch');
});

test('matchHolidayRange 返回命中区间，未命中返回 null', () => {
  assert.deepEqual(matchHolidayRange('2026-10-03'), ['2026-10-01', '2026-10-07']);
  assert.equal(matchHolidayRange('2026-10-08'), null);
  assert.equal(matchHolidayRange('not-a-date'), null);
});

test('buildSkipRecord 休市日 reason=market-holiday 且可观测', () => {
  const rec = buildSkipRecord(new Date('2026-10-02T10:00:00+08:00'));
  assert.equal(rec.reason, 'market-holiday');
  assert.equal(rec.holiday, '2026-10-01~2026-10-07');
  assert.equal(rec.date, '2026-10-02');
  assert.equal(rec.session, 'off_hours');
  assert.ok(rec.at);
  assert.doesNotThrow(() => JSON.stringify(rec));
});

test('buildSkipRecord 非节假日非交易时段 reason=off-hours', () => {
  const rec = buildSkipRecord(new Date('2026-10-10T10:00:00+08:00')); // Sat
  assert.equal(rec.reason, 'off-hours');
  assert.equal(rec.holiday, null);
});

test('collect.js 重新导出的日历函数与 calendar.js 一致', () => {
  assert.equal(isTradingDayReexport(D('2026-10-01')), isTradingDay(D('2026-10-01')));
  assert.equal(
    classifySessionReexport(new Date('2026-09-30T10:00:00+08:00')),
    classifySession(new Date('2026-09-30T10:00:00+08:00')),
  );
});
