import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const readSource = (relativePath) => fs.readFileSync(path.resolve(testDir, '..', relativePath), 'utf8');

const configSource = readSource('src/pages/NotifyConfigCard.jsx');
const rulesSource = readSource('src/pages/NotifyRulesCard.jsx');
const actionsSource = readSource('src/pages/NotifySyncAndTestCard.jsx');
const historySource = readSource('src/pages/NotifyHistoryCard.jsx');
const testDialogSource = readSource('src/pages/NotifyTestDialog.jsx');

test('notification channel management exposes a status-first channel picker', () => {
  assert.match(configSource, /const channelCards = platformTabs\.map/);
  assert.match(configSource, /可用渠道/);
  assert.match(configSource, /role="tablist" aria-label="通知渠道"/);
  assert.match(configSource, /setConfigCollapsed\?\.\(false\)/);
  assert.match(configSource, /section === 'config'/);
  assert.match(configSource, /登录后配置会归属到账号/);
});

test('daily holdings return rule remains manageable while disabled', () => {
  assert.match(rulesSource, /const holdingsRuleCount = 1/);
  assert.match(rulesSource, /持仓每日收益/);
  assert.match(rulesSource, /\{holdingsEnabled \? '已开启' : '未开启'\}/);
  assert.match(rulesSource, /onToggleHoldingsRule\?\.\(event\.target\.checked\)/);
  assert.doesNotMatch(rulesSource, /\{holdingsEnabled && \(/);
  assert.match(rulesSource, /section === 'rules'/);
});

test('sync, test, and history refresh actions stay available without opening details', () => {
  const syncAction = actionsSource.indexOf('onClick={onSyncRules}');
  const actionsDisclosure = actionsSource.indexOf('{expanded ? (');
  const historyRefresh = historySource.indexOf('onClick={refreshNotifyEvents}');
  const historyDisclosure = historySource.indexOf('{expanded ? (');

  assert.ok(syncAction >= 0 && syncAction < actionsDisclosure);
  assert.ok(historyRefresh >= 0 && historyRefresh < historyDisclosure);
  assert.match(actionsSource, /发送测试/);
  assert.match(historySource, /最近：/);
});

test('test dialog auto-selects a valid rule and documents every delivery channel', () => {
  assert.match(testDialogSource, /setSelectedId\(currentRules\[0\]\?\.id \|\| ''\)/);
  assert.match(testDialogSource, /role="radiogroup" aria-label="测试规则"/);
  assert.match(testDialogSource, /Bark、Server酱³、Email 和可用的 PC 浏览器通知/);
  assert.match(testDialogSource, /event\.key === 'Escape'/);
  assert.match(testDialogSource, /event\.target === event\.currentTarget/);
});
