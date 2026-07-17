import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tradePlansSource = readFileSync(new URL('../src/pages/TradePlansExperience.jsx', import.meta.url), 'utf8');
const notifySource = readFileSync(new URL('../src/pages/NotifyExperience.jsx', import.meta.url), 'utf8');

test('通知状态接口只由通知管理页负责读取', () => {
  assert.doesNotMatch(tradePlansSource, /loadNotifyStatus|\/api\/notify\/status/);
  assert.match(notifySource, /loadNotifyStatus\(/);
});
