import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeWeightedReturn } from '../workers/notify/src/holdingsNotificationContent.js';

test('notify holdings no longer trusts same-day source update; requires latestNavDate to reach expected', async () => {
  // digest 未携带 kind 且 env=null 时按 bucket(otc) 处理，期望最新净值日 = 当日(2026-06-03)。
  // latestNavDate 仍是 T-1(2026-06-02)，即便 sourceUpdatedAt 是今天，也不再判 ready。
  const result = await computeWeightedReturn([{
    code: '021000',
    weight: 1
  }], {
    '021000': {
      code: '021000',
      latestNav: 2.3925,
      previousNav: 2.3806,
      latestNavDate: '2026-06-02',
      sourceUpdatedAt: '2026-06-03T11:27:47.960Z'
    }
  }, '2026-06-03', 'otc', null);

  assert.equal(result.ready, false);
  assert.equal(result.contributors.length, 0);
});

test('notify holdings does not trust digest kind without source freshness', async () => {
  const result = await computeWeightedReturn([{
    code: '021000',
    weight: 1
  }], {
    '021000': {
      code: '021000',
      latestNav: 2.3925,
      previousNav: 2.3806,
      latestNavDate: '2026-06-02'
    }
  }, '2026-06-03', 'otc', null);

  assert.equal(result.ready, false);
  assert.equal(result.contributors.length, 0);
});

test('notify holdings is ready when otc latestNavDate reaches expected date', async () => {
  // latestNavDate 达到当日预期(2026-06-03) → ready，且产出 contributor。
  const result = await computeWeightedReturn([{
    code: '021000',
    weight: 1,
    kind: 'qdii'
  }], {
    '021000': {
      code: '021000',
      latestNav: 2.3925,
      previousNav: 2.3806,
      latestNavDate: '2026-06-03'
    }
  }, '2026-06-03', 'otc', null);

  assert.equal(result.ready, true);
  assert.equal(result.contributors.length, 1);
  assert.equal(result.contributors[0].code, '021000');
});

test('notify holdings trusts explicit qdii kind from digest without metadata env', async () => {
  const result = await computeWeightedReturn([{
    code: '021000',
    weight: 1,
    kind: 'qdii'
  }], {
    '021000': {
      code: '021000',
      latestNav: 2.3925,
      previousNav: 2.3806,
      latestNavDate: '2026-06-02'
    }
  }, '2026-06-03', 'otc', null);

  assert.equal(result.ready, true);
  assert.equal(result.contributors.length, 1);
  assert.equal(result.contributors[0].kind, 'qdii');
});

test('notify holdings exchange return uses market price fields instead of fund NAV', async () => {
  const result = await computeWeightedReturn([{
    code: '513100',
    weight: 1
  }], {
    '513100': {
      code: '513100',
      price: 2.365,
      currentPrice: 2.365,
      previousClose: 2.273,
      latestNav: 2.065,
      previousNav: 2.001,
      latestNavDate: '2026-06-05',
      quoteDate: '2026-06-05'
    }
  }, '2026-06-05', 'exchange', null);

  assert.equal(result.ready, true);
  assert.equal(result.contributors.length, 1);
  assert.equal(result.contributors[0].valueType, 'price');
  assert.equal(result.contributors[0].currentValue, 2.365);
  assert.equal(result.contributors[0].previousValue, 2.273);
  assert.equal(Number(result.contributors[0].ratio.toFixed(6)), Number(((2.365 / 2.273) - 1).toFixed(6)));
});
