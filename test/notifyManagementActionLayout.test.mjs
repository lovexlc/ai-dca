import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const syncSource = fs.readFileSync(path.resolve(testDir, '../src/pages/NotifySyncAndTestCard.jsx'), 'utf8');
const historySource = fs.readFileSync(path.resolve(testDir, '../src/pages/NotifyHistoryCard.jsx'), 'utf8');

test('quick actions are integrated into the expanded card instead of floating in the collapsed header', () => {
  const expandedIndex = syncSource.indexOf('{expanded ? (');
  const syncActionIndex = syncSource.indexOf('onClick={onSyncRules}');
  const testActionIndex = syncSource.indexOf('onClick={onOpenTestDialog}');

  assert.ok(expandedIndex >= 0);
  assert.ok(syncActionIndex > expandedIndex);
  assert.ok(testActionIndex > expandedIndex);
  assert.match(syncSource, /同步通知规则/);
  assert.match(syncSource, /发送送达测试/);
  assert.match(syncSource, /aria-label="展开或收起快捷操作"/);
});

test('history refresh is a compact control inside the expanded history panel', () => {
  const expandedIndex = historySource.indexOf('{expanded ? (');
  const refreshActionIndex = historySource.indexOf('onClick={refreshNotifyEvents}');

  assert.ok(expandedIndex >= 0);
  assert.ok(refreshActionIndex > expandedIndex);
  assert.match(historySource, /查看业务通知的送达结果与渠道明细/);
  assert.match(historySource, /aria-label="展开或收起送达记录"/);
  assert.doesNotMatch(historySource, /刷新记录/);
});
