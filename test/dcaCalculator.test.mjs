// node --test test/dcaCalculator.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterBuyDates,
  calculateDcaBacktest,
  buildDcaChartData,
  DCA_FREQUENCIES,
  DCA_TIMEFRAMES
} from '../src/app/dcaCalculator.js';

function toCandles(arr) {
  // arr: [{ date: 'YYYY-MM-DD', close: number }]
  return arr.map((c) => ({ t: Math.floor(new Date(c.date).getTime() / 1000), c: c.close }));
}

test('DCA_FREQUENCIES 锁定表', () => {
  assert.deepEqual(DCA_FREQUENCIES.map((f) => f.value), ['weekly', 'biweekly', 'monthly']);
  assert.equal(DCA_FREQUENCIES.find((f) => f.value === 'weekly').days, 7);
  assert.equal(DCA_FREQUENCIES.find((f) => f.value === 'monthly').days, 30);
});

test('DCA_TIMEFRAMES 三个范围', () => {
  assert.deepEqual(DCA_TIMEFRAMES.map((t) => t.value), ['1d', '1w', '1mo']);
});

test('filterBuyDates 首笔起 每 7 天一笔', () => {
  const candles = [
    { ts: new Date('2026-01-01').getTime() },
    { ts: new Date('2026-01-05').getTime() }, // 4d
    { ts: new Date('2026-01-08').getTime() }, // 7d 从首笔起
    { ts: new Date('2026-01-12').getTime() }, // 4d 从上一笔
    { ts: new Date('2026-01-16').getTime() }, // 8d 从上一笔Ⓣ take
  ];
  const buys = filterBuyDates(candles, 7);
  assert.equal(buys.length, 3);
});

test('calculateDcaBacktest 空 candles 返回不报错', () => {
  const r = calculateDcaBacktest({ rawCandles: [], amount: 100, frequencyDays: 7 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_candles');
});

test('calculateDcaBacktest 纯上涨场景 总回报 > 0', () => {
  // 6 期月 K，价格 100->150。按 30 天一笔，遇 Feb→Mar 只隔 28 天会跳过，最终刚好 5 笔。
  const candles = toCandles([
    { date: '2026-01-01', close: 100 },
    { date: '2026-02-01', close: 110 },
    { date: '2026-03-01', close: 120 },
    { date: '2026-04-01', close: 130 },
    { date: '2026-05-01', close: 140 },
    { date: '2026-06-01', close: 150 }
  ]);
  const r = calculateDcaBacktest({ rawCandles: candles, amount: 100, frequencyDays: 30 });
  assert.equal(r.ok, true);
  assert.equal(r.summary.periods, 5);
  assert.equal(r.summary.totalInvested, 500);
  assert.ok(r.summary.profit > 0);
  assert.ok(r.summary.returnPct > 0);
});

test('calculateDcaBacktest 最后一笔 marketValue 与 summary.finalValue 一致', () => {
  const candles = toCandles([
    { date: '2026-01-01', close: 100 },
    { date: '2026-02-01', close: 200 }
  ]);
  const r = calculateDcaBacktest({ rawCandles: candles, amount: 100, frequencyDays: 30 });
  assert.equal(r.rows.length, 2);
  // 第一笔股数 = 1、第二笔 0.5、总 1.5、最后价格 200 -> 300
  assert.equal(r.summary.totalShares, 1.5);
  assert.equal(r.summary.finalValue, 300);
  assert.equal(r.summary.totalInvested, 200);
  assert.equal(r.summary.profit, 100);
});

test('buildDcaChartData 给每个 candle 一行且市值推进', () => {
  const candles = toCandles([
    { date: '2026-01-01', close: 100 },
    { date: '2026-01-15', close: 110 },
    { date: '2026-02-01', close: 200 }
  ]);
  const r = calculateDcaBacktest({ rawCandles: candles, amount: 100, frequencyDays: 30 });
  const chart = buildDcaChartData(r.rows, r.candles);
  assert.equal(chart.length, 3);
  assert.equal(chart[0].invested, 100);
  // 中间那一点 不买，报告累计仍为 100，股价 110，市值 110
  assert.equal(chart[1].invested, 100);
  assert.equal(chart[1].marketValue, 110);
  // 末个购买后 股数 1.5，市值 1.5*200=300
  assert.equal(chart[2].marketValue, 300);
});
