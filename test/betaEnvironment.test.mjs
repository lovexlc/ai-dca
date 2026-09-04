import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BETA_QUERY_KEY,
  BETA_TAB_QUERY_KEY,
  buildBetaUrl,
  isAppPagePath,
  normalizeBetaValue,
  readBetaOverride,
  readBetaTabOverride,
  resolveBetaState
} from '../src/app/betaEnvironment.js';

import {
  BETA_PAGES,
  BETA_TAB_ORDER,
  DEFAULT_BETA_TAB,
  findBetaPage,
  getBetaTabs,
  getPagesForTab,
  normalizeBetaTab
} from '../src/beta/betaScreens.js';

test('normalizeBetaValue accepts common truthy and falsy spellings', () => {
  for (const value of ['1', 'true', 'ON', ' yes ', 'y', true]) {
    assert.equal(normalizeBetaValue(value), true, String(value));
  }
  for (const value of ['0', 'false', 'OFF', ' no ', 'n', false]) {
    assert.equal(normalizeBetaValue(value), false, String(value));
  }
  for (const value of [null, undefined, '', '   ', 'maybe']) {
    assert.equal(normalizeBetaValue(value), null, String(value));
  }
});

test('isAppPagePath only matches the web app entry and pages dir', () => {
  assert.equal(isAppPagePath('/'), true);
  assert.equal(isAppPagePath('/index.html'), true);
  assert.equal(isAppPagePath('/pages/holdings/index.html'), true);
  assert.equal(isAppPagePath('/pages-v2/markets/index.html'), true);
  assert.equal(isAppPagePath('/index.html?tab=holdings'), true);
  assert.equal(isAppPagePath('/landing.html'), false);
  assert.equal(isAppPagePath('/docs/guide.html'), false);
  assert.equal(isAppPagePath('/blog/'), false);
});

test('readBetaOverride and readBetaTabOverride parse the query string', () => {
  assert.equal(readBetaOverride('?beta=1'), true);
  assert.equal(readBetaOverride('beta=0'), false);
  assert.equal(readBetaOverride('?tab=holdings'), null);
  assert.equal(readBetaOverride(''), null);
  assert.equal(readBetaTabOverride('?beta=1&btab=markets'), 'markets');
  assert.equal(readBetaTabOverride('?beta=1'), null);
});

test('resolveBetaState keeps the production app as the default', () => {
  const state = resolveBetaState({ pathname: '/index.html', search: '?tab=holdings' });
  assert.deepEqual(state, { enabled: false, appPage: true, canSwitch: true, source: 'default' });
});

test('resolveBetaState priority is query over storage over default', () => {
  assert.equal(
    resolveBetaState({ pathname: '/', search: '?beta=1', storedValue: '0' }).enabled,
    true
  );
  assert.equal(
    resolveBetaState({ pathname: '/', search: '?beta=0', storedValue: '1' }).enabled,
    false
  );
  const stored = resolveBetaState({ pathname: '/', search: '', storedValue: '1' });
  assert.equal(stored.enabled, true);
  assert.equal(stored.source, 'storage');
});

test('resolveBetaState never enables beta outside the web app pages', () => {
  const state = resolveBetaState({ pathname: '/landing.html', search: '?beta=1', storedValue: '1' });
  assert.equal(state.enabled, false);
  assert.equal(state.appPage, false);
  assert.equal(state.canSwitch, false);
  assert.equal(state.source, 'not-app-page');
});

test('buildBetaUrl toggles beta while preserving other params', () => {
  const on = buildBetaUrl({ pathname: '/index.html', search: '?tab=holdings&region=cn', enabled: true, tab: 'markets' });
  assert.match(on, /^\/index\.html\?/);
  const onParams = new URLSearchParams(on.split('?')[1]);
  assert.equal(onParams.get('tab'), 'holdings');
  assert.equal(onParams.get('region'), 'cn');
  assert.equal(onParams.get(BETA_QUERY_KEY), '1');
  assert.equal(onParams.get(BETA_TAB_QUERY_KEY), 'markets');

  const off = buildBetaUrl({ pathname: '/index.html', search: on.split('?')[1], enabled: false });
  const offParams = new URLSearchParams(off.split('?')[1]);
  assert.equal(offParams.has(BETA_QUERY_KEY), false);
  assert.equal(offParams.has(BETA_TAB_QUERY_KEY), false);
  assert.equal(offParams.get('tab'), 'holdings');
  assert.equal(offParams.get('region'), 'cn');
});

test('buildBetaUrl returns a bare pathname when no params remain', () => {
  assert.equal(buildBetaUrl({ pathname: '/index.html', search: '?beta=1', enabled: false }), '/index.html');
});

test('beta screens mirror the mini program information architecture', () => {
  assert.equal(BETA_TAB_ORDER.length, 5);
  assert.deepEqual(BETA_TAB_ORDER, ['home', 'markets', 'holdings', 'tradeplans', 'profile']);
  assert.equal(BETA_PAGES.length, 19);
  assert.equal(DEFAULT_BETA_TAB, 'home');
  assert.deepEqual(getBetaTabs().map((tab) => tab.label), ['首页', '行情', '持仓', '计划', '我的']);
});

test('every beta page keeps a unique key and a valid tab', () => {
  const keys = new Set();
  for (const page of BETA_PAGES) {
    assert.equal(keys.has(page.key), false, 'duplicate page key: ' + page.key);
    keys.add(page.key);
    if (page.tab !== null) {
      assert.equal(BETA_TAB_ORDER.includes(page.tab), true, page.key + ' has an unknown tab');
    }
  }
  for (const tab of BETA_TAB_ORDER) {
    assert.ok(getPagesForTab(tab).length > 0, tab + ' has no page');
  }
});

test('beta tab and page lookups fall back safely', () => {
  assert.equal(normalizeBetaTab('markets'), 'markets');
  assert.equal(normalizeBetaTab('nope'), DEFAULT_BETA_TAB);
  assert.equal(normalizeBetaTab(''), DEFAULT_BETA_TAB);
  assert.equal(findBetaPage('backtest-detail').label, '回测详情');
  assert.equal(findBetaPage('missing'), null);
});
