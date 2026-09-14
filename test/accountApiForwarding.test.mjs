// 「用户相关操作」必须汇聚到账号 API 转发层：这里用源码扫描守住「不会绕过」这条边界。
// src/app/apiTransport.js 是全库唯一允许直接调用 fetch 的账号传输层（fetchWithGetRetry）。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 转发层、资源同步与迁移动作：列表加载 / 删除 / 保存 三类请求的全部入口。
const ACCOUNT_MODULES = [
  'src/app/accountApi.js',
  'src/app/holdingTransactionsApi.js',
  'src/app/accountDataMigrationActions.js',
  'src/app/resourceSync.js',
  'src/app/holdingTransactionsSync.js',
  'src/app/cloudSync.js',
  'src/app/accountManager.js',
  'src/app/syncClient.js'
];

function readSource(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('账号相关模块不会直接调用 fetch，只能走 accountApi 转发层', () => {
  for (const relativePath of ACCOUNT_MODULES) {
    assert.doesNotMatch(
      readSource(relativePath),
      /\bfetch\s*\(/,
      `${relativePath} 不得直接调用 fetch，请改用 accountApi 的 sendAccountApiRequest`
    );
  }
});

test('转发层底层统一走 apiTransport 的 fetchWithGetRetry', () => {
  const accountApi = readSource('src/app/accountApi.js');
  assert.match(accountApi, /import \{ fetchWithGetRetry \} from '\.\/apiTransport\.js'/);
  assert.match(accountApi, /await fetchWithGetRetry\(/);
  // 传输层自己才是那个真正调用 fetch 的地方。
  assert.match(readSource('src/app/apiTransport.js'), /\bfetch\s*\(/);
});

test('转发层为每个账号请求登记统一加载态', () => {
  const accountApi = readSource('src/app/accountApi.js');
  assert.match(accountApi, /import \{ describeAccountRequest, trackAccountOperation \} from '\.\/accountLoadingState\.js'/);
  assert.match(accountApi, /trackAccountOperation\(descriptor, \(\) => performRequest\(path, options\)\)/);
  assert.match(accountApi, /export function sendAccountApiRequest/);
});

test('持仓交易行与迁移动作复用转发层出口', () => {
  const holdingTransactions = readSource('src/app/holdingTransactionsApi.js');
  assert.match(holdingTransactions, /sendAccountApiRequest\(path, \{ method, token, body, headers \}\)/);
  assert.match(holdingTransactions, /await assertLegacyMigrationSettled\(session\)/);

  const migrationActions = readSource('src/app/accountDataMigrationActions.js');
  assert.match(migrationActions, /sendAccountApiRequest\(DATA_NOTICE_PATH/);
  assert.match(migrationActions, /sendAccountApiRequest\("\/migrations\/legacy\/discard"/);
});

test('统一加载态覆盖加载 / 保存 / 删除 三类操作并支持页面按钮包装', () => {
  const loadingState = readSource('src/app/accountLoadingState.js');
  assert.match(loadingState, /ACCOUNT_LOADING_KINDS = Object\.freeze\(\['load', 'save', 'delete'\]\)/);
  assert.match(loadingState, /export function describeAccountRequest/);
  assert.match(loadingState, /export async function runAccountUserAction/);
  assert.match(loadingState, /export function subscribeAccountLoading/);
});
