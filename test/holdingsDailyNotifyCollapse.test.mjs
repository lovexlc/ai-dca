import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(testDir, '../src/pages/holdings/HoldingsOverviewShell.jsx'), 'utf8');

test('daily return notification card is collapsed by default', () => {
  assert.match(source, /const \[isDailyReturnNotifyCollapsed, setIsDailyReturnNotifyCollapsed\] = useState\(true\)/);
  assert.match(source, /aria-expanded=\{!isDailyReturnNotifyCollapsed\}/);
  assert.match(source, /setIsDailyReturnNotifyCollapsed\(\(current\) => !current\)/);
});

test('daily return notification details and actions only render while expanded', () => {
  assert.match(source, /!isDailyReturnNotifyCollapsed \? \(/);
  assert.match(source, /收盘后推送持仓组合的当日收益/);
  assert.match(source, /开启每日收益通知/);
  assert.match(source, /同步持仓/);
  assert.match(source, /ChevronDown/);
  assert.match(source, /ChevronUp/);
});
