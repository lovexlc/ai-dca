import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NAV_GROUPS,
  PRIMARY_TAB_META,
  createPageLinks,
  getPrimaryTabs,
} from '../src/app/screens.js';

test('backtest is exposed as a top-level workspace route', () => {
  const links = createPageLinks();
  const tabs = getPrimaryTabs(links);
  const backtestTab = tabs.find((tab) => tab.key === 'backtest');
  const backtestGroup = NAV_GROUPS.find((group) => group.key === 'backtest');

  assert.equal(PRIMARY_TAB_META.backtest.label, '回测');
  assert.deepEqual(backtestTab, { key: 'backtest', label: '回测', href: './index.html?tab=backtest' });
  assert.equal(backtestGroup.items[0].hrefKey, 'backtest');
  assert.match(backtestGroup.items[0].description, /历史行情/);
});
