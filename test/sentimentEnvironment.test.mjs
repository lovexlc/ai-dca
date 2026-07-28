import assert from 'node:assert/strict';
import test from 'node:test';
import { isTestHostname } from '../src/app/environment.js';
import { createPageLinks, getPrimaryTabs, PRIMARY_TAB_META } from '../src/app/screens.js';

test('test-only sentiment navigation is identified by the test hostname', () => {
  assert.equal(isTestHostname('test.freebacktrack.tech'), true);
  assert.equal(isTestHostname('test.example.com'), true);
  assert.equal(isTestHostname('api.freebacktrack.tech'), false);
  assert.equal(isTestHostname('freebacktrack.tech'), false);
});

test('sentiment tab has a stable workspace link and metadata', () => {
  const links = createPageLinks();
  const tab = getPrimaryTabs(links).find((item) => item.key === 'emotion');

  assert.equal(PRIMARY_TAB_META.emotion.testOnly, true);
  assert.equal(PRIMARY_TAB_META.emotion.label, '情绪');
  assert.equal(tab.href, './index.html?tab=emotion');
});
