import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const shellSource = fs.readFileSync(path.resolve(testDir, '../src/pages/holdings/HoldingsOverviewShell.jsx'), 'utf8');
const rulesSource = fs.readFileSync(path.resolve(testDir, '../src/pages/NotifyRulesCard.jsx'), 'utf8');

test('holdings overview no longer renders the daily return notification banner', () => {
  assert.doesNotMatch(shellSource, /每日收益通知/);
  assert.doesNotMatch(shellSource, /dailyReturnNotifyRule/);
  assert.doesNotMatch(shellSource, /loadHoldingsNotifyRule|saveHoldingsNotifyRule/);
  assert.doesNotMatch(shellSource, /buildHoldingsNotifyDigest/);
});

test('daily return notification remains managed from notification rules', () => {
  assert.match(rulesSource, /持仓每日收益/);
  assert.match(rulesSource, /onToggleHoldingsRule/);
});
