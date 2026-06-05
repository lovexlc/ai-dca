import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeWeightedReturn } from '../workers/notify/src/holdingsNotificationContent.js';

test('notify holdings no longer trusts same-day source update; requires latestNavDate to reach expected', async () => {
  // digest 谎称 qdii，但 env=null 时按 bucket(otc) 处理，期望最新净值日 = 当日(2026-06-03)。
  // latestNavDate 仍是 T-1(2026-06-02)，即便 sourceUpdatedAt 是今天，也不再判 ready。
  const result = await computeWeightedReturn([{
    code: '021000',
    weight: 1,
    kind: 'qdii'
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
