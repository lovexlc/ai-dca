import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeWorkspacePrefs } from '../src/app/workspacePrefs.js';

test('normalizeWorkspacePrefs drops scenario state and preserves homepage tab', () => {
  const prefs = normalizeWorkspacePrefs({
    version: 3,
    scenario: 'stock',
    homepageTab: 'holdings',
    updatedAt: '2026-01-01'
  });

  assert.equal(prefs.homepageTab, 'holdings');
  assert.equal(prefs.scenario, undefined);
  assert.equal('scenario' in prefs, false);
});
