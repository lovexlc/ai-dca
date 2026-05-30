import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeSnapshotNavForDate } from '../src/app/income/dailyFundBreakdownData.js';
import { singleDayFundPnl } from '../src/app/portfolioSeries.js';

test('当日收益明细使用持仓总览 snapshot 补齐最新可用净值', () => {
  const tx = [{
    id: 'buy-1',
    type: 'BUY',
    code: '019172',
    name: '摩根纳斯达克100(QDII)人民币A',
    kind: 'otc',
    date: '2026-05-20',
    shares: 100,
    price: 1
  }];
  const navByCode = {
    '019172': [
      { date: '2026-05-27', nav: 1 },
      { date: '2026-05-28', nav: 1.02 }
    ]
  };
  const snapshotsByCode = {
    '019172': {
      code: '019172',
      name: '摩根纳斯达克100(QDII)人民币A',
      latestNav: 1.02,
      latestNavDate: '2026-05-28',
      previousNav: 1,
      previousNavDate: '2026-05-27'
    }
  };
  const txMetaByCode = new Map([
    ['019172', { kind: 'otc', name: '摩根纳斯达克100(QDII)人民币A' }]
  ]);

  const withoutSnapshot = singleDayFundPnl({ tx, navByCode, date: '2026-05-29' });
  assert.equal(withoutSnapshot[0].pnl, null);

  const merged = mergeSnapshotNavForDate(navByCode, snapshotsByCode, txMetaByCode, '2026-05-29');
  const withSnapshot = singleDayFundPnl({ tx, navByCode: merged, date: '2026-05-29' });
  assert.equal(Math.round(withSnapshot[0].pnl * 100), 200);
  assert.equal(withSnapshot[0].navDate, '2026-05-29');
});

test('当 snapshot 未达到预期最新日期时不伪造当日收益', () => {
  const navByCode = {
    '510300': [
      { date: '2026-05-27', nav: 4 },
      { date: '2026-05-28', nav: 4.1 }
    ]
  };
  const snapshotsByCode = {
    '510300': {
      code: '510300',
      name: '沪深300ETF',
      latestNav: 4.1,
      latestNavDate: '2026-05-28',
      previousNav: 4,
      previousNavDate: '2026-05-27'
    }
  };
  const txMetaByCode = new Map([
    ['510300', { kind: 'exchange', name: '沪深300ETF' }]
  ]);

  const merged = mergeSnapshotNavForDate(navByCode, snapshotsByCode, txMetaByCode, '2026-05-29');
  assert.deepEqual(merged['510300'], navByCode['510300']);
});
