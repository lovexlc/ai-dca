import assert from 'node:assert/strict';
import test from 'node:test';

import { getResourceDescriptor } from '../src/catalog.js';
import {
  applyResourcePatch,
  canonicalJson,
  itemCount,
  removeResourceItem,
  upsertResourceItem
} from '../src/patch.js';

test('canonicalJson 输出与键顺序无关', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] }), canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }));
});

test('数组资源按 id 增删改', () => {
  const descriptor = getResourceDescriptor('trades/ledger');
  const current = [{ id: 't1', amount: 100 }, { id: 't2', amount: 200 }];

  const upserted = applyResourcePatch(descriptor, current, { upsert: [{ id: 't2', amount: 250 }, { id: 't3', amount: 300 }] });
  assert.equal(upserted.changed, true);
  assert.deepEqual(upserted.data.map((item) => item.id), ['t1', 't2', 't3']);
  assert.equal(upserted.data[1].amount, 250);

  const removed = applyResourcePatch(descriptor, upserted.data, { remove: ['t1'] });
  assert.deepEqual(removed.data.map((item) => item.id), ['t2', 't3']);

  const noop = applyResourcePatch(descriptor, current, { upsert: [{ id: 't1', amount: 100 }] });
  assert.equal(noop.changed, false);
});

test('对象资源支持 set / unset', () => {
  const descriptor = getResourceDescriptor('plans/store');
  const result = applyResourcePatch(descriptor, { activePlanId: 'p1', plans: [] }, { set: { activePlanId: 'p2' }, unset: ['plans'] });
  assert.deepEqual(result.data, { activePlanId: 'p2' });
  assert.equal(result.changed, true);
});

test('条目级接口可单独 upsert / delete', () => {
  const descriptor = getResourceDescriptor('notify/market-alerts');
  const created = upsertResourceItem(descriptor, null, 'alert-1', { symbol: 'SPY', threshold: 1 });
  assert.deepEqual(created.data, [{ symbol: 'SPY', threshold: 1, id: 'alert-1' }]);

  const removed = removeResourceItem(descriptor, created.data, 'alert-1');
  assert.deepEqual(removed.data, []);
  assert.equal(removeResourceItem(descriptor, [], 'missing').changed, false);
});

test('itemCount 覆盖数组 / 对象 / 标量', () => {
  assert.equal(itemCount([1, 2, 3]), 3);
  assert.equal(itemCount({ a: 1, b: 2 }), 2);
  assert.equal(itemCount(null), 0);
  assert.equal(itemCount(true), 1);
});
