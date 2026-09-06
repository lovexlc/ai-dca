import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MOBILE_BOTTOM_NAV_ITEMS, resolveMobileBottomNavItems } from '../src/components/mobile-bottom-nav-config.js';

test('mobile bottom nav keeps cn core tabs order', () => {
  assert.deepEqual(
    MOBILE_BOTTOM_NAV_ITEMS.map((item) => item.key),
    ['markets', 'holdings', 'tradePlans', 'fundSwitch', 'notify'],
  );
});

test('mobile bottom nav filters hidden tabs by visible list', () => {
  const items = resolveMobileBottomNavItems(['markets', 'tradePlans', 'notify']);
  assert.deepEqual(items.map((item) => item.key), ['markets', 'tradePlans', 'notify']);
});

test('mobile bottom nav ignores unknown visible tab keys', () => {
  const items = resolveMobileBottomNavItems(['unknown', 'holdings']);
  assert.deepEqual(items.map((item) => item.key), ['holdings']);
});
