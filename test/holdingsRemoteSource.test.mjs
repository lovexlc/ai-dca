import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const hookSource = fs.readFileSync(new URL('../src/pages/holdings/useHoldingsStorageSync.js', import.meta.url), 'utf8');
const pageSource = fs.readFileSync(new URL('../src/pages/HoldingsExperience.jsx', import.meta.url), 'utf8');

test('登录态持仓页从账号 REST 和交易行接口直接 hydrate', () => {
  assert.match(hookSource, /fetchHoldingTransactionRows/);
  assert.match(hookSource, /fetchOptionalResourceData\('holdings\/allocation'/);
  assert.match(hookSource, /fetchOptionalResourceData\('trades\/ledger'/);
  assert.match(hookSource, /if \(loadCloudSession\(\)\?\.accessToken\) return;/, '登录态必须忽略 storage 事件');
});

test('远端 hydrate 完成前持仓页禁止持久化 ledger', () => {
  assert.match(pageSource, /if \(remoteMode && !remoteReady\) return;/);
  assert.match(pageSource, /persistLedgerState\(ledger\)/);
});
