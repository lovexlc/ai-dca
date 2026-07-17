import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backfillOtcTransactionNav,
  getOtcNavBackfillRequest
} from '../src/pages/holdings/otcTransactionNavBackfill.js';

test('历史场外买入按交易日之前最近公布净值回填并推导份额', () => {
  const transactions = [{
    id: 'old-buy',
    code: '000001',
    name: '测试基金',
    kind: 'otc',
    type: 'BUY',
    date: '2024-01-07',
    price: 0,
    shares: 1,
    amount: 1000
  }];
  const result = backfillOtcTransactionNav(transactions, {
    '000001': [
      { date: '2024-01-05', nav: 1.2345 },
      { date: '2024-01-08', nav: 1.3 }
    ]
  });

  assert.equal(result.changed, true);
  assert.equal(result.filledCount, 1);
  assert.equal(result.transactions[0].price, 1.2345);
  assert.equal(result.transactions[0].shares, 810.0446);
  assert.equal(result.transactions[0].amount, 1000);
});

test('历史净值回填请求覆盖最早待确认交易日期，并按代码去重', () => {
  const result = getOtcNavBackfillRequest([
    { code: '000001', kind: 'otc', type: 'BUY', date: '2022-03-01', price: 0, amount: 100 },
    { code: '000001', kind: 'otc', type: 'BUY', date: '2023-04-01', price: 0, amount: 200 },
    { code: '159915', kind: 'exchange', type: 'BUY', date: '2020-01-01', price: 0, amount: 300 }
  ], { todayDate: '2026-07-17' });

  assert.deepEqual(result.codes, ['000001']);
  assert.equal(result.from, '2022-03-01');
  assert.equal(result.to, '2026-07-17');
  assert.equal(result.pending.length, 2);
});

test('已有成交净值不被历史序列覆盖', () => {
  const transactions = [{
    id: 'confirmed-buy',
    code: '000001',
    kind: 'otc',
    type: 'BUY',
    date: '2024-01-07',
    price: 1.1111,
    shares: 900,
    amount: 1000
  }];
  const result = backfillOtcTransactionNav(transactions, {
    '000001': [{ date: '2024-01-05', nav: 1.2345 }]
  });

  assert.equal(result.changed, false);
  assert.strictEqual(result.transactions, transactions);
});
