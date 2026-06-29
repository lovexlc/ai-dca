import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMarketActionDraft } from '../src/app/marketActionDraft.js';
import { normalizeWorkspacePrefs } from '../src/app/workspacePrefs.js';

test('buildMarketActionDraft normalizes a valid markets detail action', () => {
  const draft = buildMarketActionDraft({
    action: 'holding-buy',
    symbol: '513100',
    name: '纳指 ETF',
    market: 'cn',
    kind: 'exchange',
    price: '1.234',
  });

  assert.equal(draft.action, 'holding-buy');
  assert.equal(draft.symbol, '513100');
  assert.equal(draft.kind, 'exchange');
  assert.equal(draft.price, 1.234);
  assert.equal(draft.source, 'markets-detail');
  assert.ok(draft.createdAt);
});

test('buildMarketActionDraft rejects missing symbol or unsupported action', () => {
  assert.equal(buildMarketActionDraft({ action: 'holding-buy' }), null);
  assert.equal(buildMarketActionDraft({ action: 'unknown', symbol: '513100' }), null);
});

test('normalizeWorkspacePrefs migrates old homepage preference to markets', () => {
  const prefs = normalizeWorkspacePrefs({ version: 2, homepageTab: 'holdings', scenario: 'stock' });

  assert.equal(prefs.version, 3);
  assert.equal(prefs.homepageTab, 'markets');
});
