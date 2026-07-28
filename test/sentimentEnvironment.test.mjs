import assert from 'node:assert/strict';
import test from 'node:test';
import { isTestHostname } from '../src/app/environment.js';
import { createPageLinks, getPrimaryTabs, PRIMARY_TAB_META } from '../src/app/screens.js';

test('sentiment navigation keeps the environment hostname helper independent', () => {
  assert.equal(isTestHostname('test.freebacktrack.tech'), true);
  assert.equal(isTestHostname('test.example.com'), true);
  assert.equal(isTestHostname('api.freebacktrack.tech'), false);
  assert.equal(isTestHostname('freebacktrack.tech'), false);
});

test('sentiment tab is a normal workspace route with stable metadata', () => {
  const links = createPageLinks();
  const tab = getPrimaryTabs(links).find((item) => item.key === 'emotion');

  assert.equal('testOnly' in PRIMARY_TAB_META.emotion, false);
  assert.equal(PRIMARY_TAB_META.emotion.label, '情绪');
  assert.equal(tab.href, './index.html?tab=emotion');
});
