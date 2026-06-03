import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeWeightedReturn } from '../workers/notify/src/holdingsNotificationContent.js';

test('notify holdings uses digest kind for QDII expected NAV date', async () => {
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
  assert.equal(result.contributors[0].code, '021000');
});
