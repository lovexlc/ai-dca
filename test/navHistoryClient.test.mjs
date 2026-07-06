import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __internals } from '../src/app/navHistoryClient.js';

test('nav history cache can slice a wider cached range to the requested range', () => {
  const items = [
    { date: '2026-01-01', nav: 1.01 },
    { date: '2026-01-02', nav: 1.02 },
    { date: '2026-01-03', nav: 1.03 },
    { date: '2026-01-04', nav: 1.04 }
  ];

  assert.deepEqual(
    __internals.sliceNavItemsByRange(items, '2026-01-02', '2026-01-03'),
    [
      { date: '2026-01-02', nav: 1.02 },
      { date: '2026-01-03', nav: 1.03 }
    ]
  );
});

test('nav history cache coverage requires matching code and enclosing dates', () => {
  const record = {
    code: '513100',
    from: '2026-01-01',
    to: '2026-12-31',
    items: [{ date: '2026-07-01', nav: 1.2 }]
  };

  assert.equal(__internals.recordCoversRange(record, '513100', '2026-03-01', '2026-06-01'), true);
  assert.equal(__internals.recordCoversRange(record, '159513', '2026-03-01', '2026-06-01'), false);
  assert.equal(__internals.recordCoversRange(record, '513100', '2025-12-31', '2026-06-01'), false);
  assert.equal(__internals.recordCoversRange(record, '513100', '2026-03-01', '2027-01-01'), false);
});

test('nav history cache picks the narrowest covering record, then newest storedAt', () => {
  const records = [
    {
      code: '513100',
      from: '2025-01-01',
      to: '2026-12-31',
      storedAt: 30,
      items: [{ date: '2026-06-01', nav: 1 }]
    },
    {
      code: '513100',
      from: '2026-01-01',
      to: '2026-12-31',
      storedAt: 10,
      items: [{ date: '2026-06-01', nav: 2 }]
    },
    {
      code: '513100',
      from: '2026-01-01',
      to: '2026-12-31',
      storedAt: 20,
      items: [{ date: '2026-06-01', nav: 3 }]
    }
  ];

  const picked = __internals.pickBestCoveringRecord(records, {
    code: '513100',
    from: '2026-03-01',
    to: '2026-06-01'
  });

  assert.equal(picked.items[0].nav, 3);
});
