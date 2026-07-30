import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NAV_GROUPS,
  NAV_UTILITY_ITEMS,
  PRIMARY_TAB_META,
  createPageLinks,
  getPrimaryTabs,
} from '../src/app/screens.js';

test('backtest remains a top-level workspace route under the strategy navigation group', () => {
  const links = createPageLinks();
  const tabs = getPrimaryTabs(links);
  const backtestTab = tabs.find((tab) => tab.key === 'backtest');
  const strategyGroup = NAV_GROUPS.find((group) => group.key === 'strategy');
  const backtestItem = strategyGroup.items.find((item) => item.key === 'backtest');

  assert.equal(PRIMARY_TAB_META.backtest.label, '回测');
  assert.deepEqual(backtestTab, { key: 'backtest', label: '回测', href: './index.html?tab=backtest' });
  assert.deepEqual(strategyGroup.items.map((item) => item.key), ['tradePlans', 'fundSwitch', 'backtest']);
  assert.equal(backtestItem.hrefKey, 'backtest');
  assert.match(backtestItem.description, /历史行情/);
  assert.equal(NAV_GROUPS.some((group) => group.key === 'backtest'), false);
});

test('trade plan modes stay inside the trade plan workspace and reminders stay in utilities', () => {
  const strategyGroup = NAV_GROUPS.find((group) => group.key === 'strategy');
  const utilityNotify = NAV_UTILITY_ITEMS.find((item) => item.key === 'notify');

  assert.equal(strategyGroup.items.some((item) => ['planHome', 'dca', 'sell'].includes(item.key)), false);
  assert.equal(utilityNotify.hrefKey, 'notify');
  assert.equal(NAV_GROUPS.some((group) => group.key === 'notify'), false);
});
