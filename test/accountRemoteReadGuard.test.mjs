import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearAccountRuntimeStore,
  installAccountRemoteReadGuard,
  readAccountRuntimeStorageRaw,
  setAccountRuntimeStorageRaw
} from '../src/app/accountRuntimeStore.js';

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }

  clear() {
    this.values.clear();
  }
}

test('登录态账号业务数据读取只使用远端运行时数据，不读取持久 localStorage', () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage, Storage: MemoryStorage };

  const staleLedger = JSON.stringify({ transactions: [{ id: 'stale-local' }] });
  const stalePlan = JSON.stringify({ symbol: 'STALE' });
  storage.setItem('aiDcaFundHoldingsLedger', staleLedger);
  storage.setItem('aiDcaPlanState', stalePlan);
  storage.setItem('ui:local-only', 'keep-me');
  storage.setItem('aiDcaCloudSyncSession', JSON.stringify({
    userId: 'user-remote',
    username: 'remote-user',
    accessToken: 'token-remote'
  }));

  assert.equal(installAccountRemoteReadGuard(), true);
  assert.equal(storage.getItem('aiDcaFundHoldingsLedger'), null, '远端 hydrate 前不能显示旧持仓');
  assert.equal(storage.getItem('aiDcaPlanState'), null, '其他账号业务资源同样不能回退到本地');
  assert.equal(storage.getItem('ui:local-only'), 'keep-me', '纯 UI 本地偏好不受账号数据门禁影响');

  const remoteLedger = JSON.stringify({ transactions: [{ id: 'remote-row' }] });
  setAccountRuntimeStorageRaw('aiDcaFundHoldingsLedger', remoteLedger);
  assert.equal(storage.getItem('aiDcaFundHoldingsLedger'), remoteLedger);
  assert.equal(readAccountRuntimeStorageRaw('aiDcaFundHoldingsLedger'), remoteLedger);

  storage.setItem('aiDcaPlanState', JSON.stringify({ symbol: 'REMOTE-EDIT' }));
  assert.equal(storage.getItem('aiDcaPlanState'), JSON.stringify({ symbol: 'REMOTE-EDIT' }), '登录态用户编辑先进入运行时数据，再由同步器上传');

  clearAccountRuntimeStore();
  assert.equal(storage.getItem('aiDcaFundHoldingsLedger'), null, '运行时清空后也不能暴露持久旧值');

  storage.removeItem('aiDcaCloudSyncSession');
  assert.equal(storage.getItem('aiDcaFundHoldingsLedger'), staleLedger, '退出账号后恢复未登录本地模式');

  delete globalThis.window;
});
