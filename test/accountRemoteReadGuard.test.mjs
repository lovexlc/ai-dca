import assert from 'node:assert/strict';
import test from 'node:test';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  clearAccountRuntimeStore,
  installAccountRemoteReadGuard,
  readAccountRuntimeStorageRaw,
  setAccountRuntimeStorageRaw
} from '../src/app/accountRuntimeStore.js';
import { saveCloudSession, loadCloudSession } from '../src/app/authSession.js';
import {
  cancelScheduledHoldingTransactionPush,
  pendingHoldingTransactionJournalKey,
  pullHoldingTransactions,
  readCurrentHoldingTransactions
} from '../src/app/holdingTransactionsSync.js';
import {
  describeHoldingTransactionSync,
  persistDeletedHoldingTransaction,
  persistHoldingTransactionMutation
} from '../src/app/holdingTransactionMutations.js';
import { resetAccountLoadingState } from '../src/app/accountLoadingState.js';

// 全文件共享同一 Storage 原型：read guard 只在首个 window 上安装一次，
// 之后所有测试窗口都复用同一个被 patch 的原型。
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

function installWindow() {
  const listeners = new Map();
  const storage = new MemoryStorage();
  globalThis.window = {
    localStorage: storage,
    Storage: MemoryStorage,
    location: { origin: 'http://localhost', hostname: 'localhost', pathname: '/', search: '', hash: '', protocol: 'http:' },
    navigator: { userAgent: 'node-test' },
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    setInterval: (...args) => globalThis.setInterval(...args),
    clearInterval: (...args) => globalThis.clearInterval(...args),
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      listeners.get(name)?.delete(fn);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) ?? []) fn(event);
      return true;
    }
  };
  return { storage };
}

test('登录后账号业务读取和写入只走远端运行时镜像，不读取或覆盖持久 localStorage', () => {
  const { storage } = installWindow();

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
  assert.equal(storage.getItem('aiDcaPlanState'), null, '其他账号业务资源也不能回退到持久本地值');
  assert.equal(storage.getItem('ui:local-only'), 'keep-me', '纯本地 UI 数据不受影响');

  const remoteLedger = JSON.stringify({ transactions: [{ id: 'remote-row' }] });
  setAccountRuntimeStorageRaw('aiDcaFundHoldingsLedger', remoteLedger);
  assert.equal(storage.getItem('aiDcaFundHoldingsLedger'), remoteLedger);
  assert.equal(readAccountRuntimeStorageRaw('aiDcaFundHoldingsLedger'), remoteLedger);

  storage.setItem('aiDcaPlanState', JSON.stringify({ symbol: 'RUNTIME-EDIT' }));
  assert.equal(storage.getItem('aiDcaPlanState'), JSON.stringify({ symbol: 'RUNTIME-EDIT' }));
  assert.equal(storage.values.get('aiDcaPlanState'), stalePlan, '登录态业务写入不能污染持久 localStorage');

  clearAccountRuntimeStore();
  assert.equal(storage.getItem('aiDcaFundHoldingsLedger'), null, '运行时镜像清空后也不能暴露旧本地持仓');

  storage.removeItem('aiDcaCloudSyncSession');
  assert.equal(storage.getItem('aiDcaFundHoldingsLedger'), staleLedger, '退出登录后可恢复未登录本地模式');

  delete globalThis.window;
});

// ---------------------------------------------------------------------------
// 可控延迟的假账号 API：迁移检查可注入 401，PUT 响应可挂起以复现 15 秒超时。
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

class FakeAccountApi {
  constructor() {
    this.rowsByToken = new Map();
    this.requestLog = [];
    this.holds = [];
    this.failMigrationStatus = 0; // >0 时迁移检查返回该状态码（模拟 D1 session 未同步的 401）
    this.putConfirmIdOverride = null;
  }

  rows(token) {
    return this.rowsByToken.get(token) || [];
  }

  setRows(token, rows) {
    this.rowsByToken.set(token, rows.slice());
  }

  findRow(token, id) {
    return this.rows(token).find((row) => row.id === id) || null;
  }

  holdNext(match) {
    let release;
    const promise = new Promise((resolve) => {
      release = resolve;
    });
    this.holds.push({ match: String(match), promise });
    return release;
  }

  buildResponse(url, method, token, body) {
    if (url.includes('/migrations/legacy')) {
      if (this.failMigrationStatus > 0) {
        return { status: this.failMigrationStatus, body: { message: '登录会话尚未同步到云端' } };
      }
      return { status: 200, body: { status: 'no-legacy', legacy: { exists: false } } };
    }
    if (url.includes('/holdings/allocation')) return { status: 200, body: { data: {} } };
    if (url.includes('/trades/ledger')) return { status: 200, body: { data: [] } };
    if (url.includes('/holdings/ledger/items?')) {
      const rows = this.rows(token);
      return { status: 200, body: { rows: rows.map((row) => ({ ...row, data: { ...row.data } })), nextCursor: '' } };
    }
    const itemMatch = url.match(/\/holdings\/ledger\/items\/([^/?]+)/);
    if (itemMatch) {
      const id = decodeURIComponent(itemMatch[1]);
      if (method === 'PUT') {
        const rows = this.rows(token);
        const index = rows.findIndex((row) => row.id === id);
        const baseRevision = index >= 0 ? rows[index].revision : Number(body?.baseRevision || 0);
        const revision = baseRevision + 1;
        const row = { id, revision, contentHash: `hash-${id}-${revision}`, data: body?.data || {} };
        if (index >= 0) rows[index] = row;
        else rows.push(row);
        this.rowsByToken.set(token, rows);
        const confirmId = this.putConfirmIdOverride === null ? id : this.putConfirmIdOverride;
        return {
          status: 200,
          body: { transaction: { id: confirmId, revision, contentHash: row.contentHash }, rowRevision: revision }
        };
      }
      if (method === 'DELETE') {
        const rows = this.rows(token);
        const index = rows.findIndex((row) => row.id === id);
        if (index < 0) return { status: 404, body: { message: 'not found' } };
        const revision = rows[index].revision + 1;
        rows.splice(index, 1);
        this.rowsByToken.set(token, rows);
        return { status: 200, body: { transaction: { id, revision }, rowRevision: revision } };
      }
    }
    return { status: 404, body: { message: `unexpected ${method} ${url}` } };
  }

  fetch = async (url, init = {}) => {
    const fullUrl = String(url);
    const method = String(init?.method || 'GET').toUpperCase();
    const auth = String(init?.headers?.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    let body = null;
    if (init?.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = null;
      }
    }
    const response = this.buildResponse(fullUrl, method, token, body);
    this.requestLog.push({ url: fullUrl, method, token });

    const holdIndex = this.holds.findIndex((hold) => fullUrl.includes(hold.match));
    if (holdIndex >= 0) {
      const hold = this.holds.splice(holdIndex, 1)[0];
      await new Promise((resolve, reject) => {
        hold.promise.then(resolve);
        if (init?.signal) {
          if (init.signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }
      });
    }
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' }
    });
  };
}

function makeTx(id, overrides = {}) {
  return {
    id,
    code: '159659',
    name: '测试基金',
    kind: 'exchange',
    type: 'BUY',
    date: '2026-09-30',
    price: 1.234,
    shares: 100,
    amount: 123.4,
    costPrice: 0,
    switchPairId: '',
    note: '',
    tags: ['exchange'],
    ...overrides
  };
}

function makeRemoteRow(tx, revision = 1) {
  return { id: tx.id, revision, contentHash: `hash-${tx.id}-${revision}`, data: { ...tx } };
}

function journalEntries(storage, userId) {
  const raw = storage.getItem(pendingHoldingTransactionJournalKey(userId));
  return raw ? JSON.parse(raw).entries : {};
}

describe('持仓同步读写保护（行为测试）', () => {
  let server;
  let storage;

  beforeEach(() => {
    ({ storage } = installWindow());
    server = new FakeAccountApi();
    globalThis.fetch = server.fetch;
    saveCloudSession({ userId: 'usr_guard', username: 'guarduser', accessToken: 'token_guard', refreshToken: '', isAdmin: false });
  });

  afterEach(() => {
    cancelScheduledHoldingTransactionPush();
    clearAccountRuntimeStore();
    resetAccountLoadingState();
    globalThis.fetch = realFetch;
    delete globalThis.window;
  });

  it('PUT 前迁移检查 401：绝不发出 PUT，失败明确上报且 pending 意图保留', async () => {
    server.failMigrationStatus = 401; // D1 session 尚未同步到云端
    const tx1 = makeTx('tx1');
    const holderApplied = [];

    const result = await persistHoldingTransactionMutation(
      { transactions: [tx1] },
      {
        kind: 'save',
        label: '保存交易',
        upsertIds: ['tx1'],
        setLedger: (next) => holderApplied.push(next.transactions.map((tx) => tx.id))
      }
    );

    assert.equal(result.cloudAttempted, true);
    assert.deepEqual(result.pushed, [], '迁移门禁未通过时不得有云确认');
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].message, /登录会话尚未同步到云端/);
    assert.equal(
      server.requestLog.filter((entry) => entry.url.includes('/holdings/ledger/items')).length,
      0,
      '迁移 401 时绝不能发出任何交易行上传'
    );
    assert.match(describeHoldingTransactionSync(result, '已保存'), /云端同步失败/);
    assert.equal(journalEntries(storage, 'usr_guard').tx1.kind, 'upsert', 'pending 意图必须保留待重试');
    assert.deepEqual(holderApplied.at(-1), ['tx1'], '本地保存不受迁移门禁影响');
  });

  it('本地缺失的 upsert id：报告未完成，而不是静默 continue 后声称已同步', async () => {
    const present = makeTx('tx_present');
    const result = await persistHoldingTransactionMutation(
      { transactions: [present] },
      { kind: 'save', label: '保存交易', upsertIds: ['tx_present', 'tx_missing'], setLedger: () => {} }
    );

    assert.deepEqual(result.pushed, ['tx_present'], '存在的行正常上传');
    const missing = result.failed.find((item) => item.id === 'tx_missing');
    assert.ok(missing, '缺失 id 必须进入 failed 列表');
    assert.match(missing.message, /缺少该交易行，云端同步未完成/);
    const text = describeHoldingTransactionSync(result, '已保存');
    assert.match(text, /云端同步失败/);
    assert.equal(/已同步至云端/.test(text), false, '绝不能声称已同步');
    assert.equal(journalEntries(storage, 'usr_guard').tx_missing, undefined, '缺失行不得误登记 journal');
  });

  it('云端 2xx 但未确认同一 id：按未完成上报，journal 保留', async () => {
    server.putConfirmIdOverride = 'someone_else';
    const tx1 = makeTx('tx1');
    const result = await persistHoldingTransactionMutation(
      { transactions: [tx1] },
      { kind: 'save', label: '保存交易', upsertIds: ['tx1'], setLedger: () => {} }
    );

    assert.deepEqual(result.pushed, []);
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].message, /未确认该交易行/);
    assert.match(describeHoldingTransactionSync(result, '已保存'), /云端同步失败/);
    assert.equal(journalEntries(storage, 'usr_guard').tx1.kind, 'upsert', '未确认的行必须留在 journal');
  });

  it('PUT 超时（15 秒上限的缩小版）：标记超时失败，本地保存与 journal 保留', async () => {
    const txSlow = makeTx('tx_slow');
    server.holdNext('/holdings/ledger/items/tx_slow'); // PUT 响应被网络挂起
    const holderApplied = [];

    const result = await persistHoldingTransactionMutation(
      { transactions: [txSlow] },
      {
        kind: 'save',
        label: '保存交易',
        upsertIds: ['tx_slow'],
        setLedger: (next) => holderApplied.push(next.transactions.map((tx) => tx.id)),
        timeoutMs: 60
      }
    );

    assert.equal(result.timedOut, true, '超时必须被明确标记');
    assert.equal(result.pushed.length, 0);
    assert.match(result.failed[0].message, /云端同步超时/);
    assert.match(describeHoldingTransactionSync(result, '已保存'), /云端同步超时/);
    assert.deepEqual(holderApplied.at(-1), ['tx_slow'], '本地已保存，不能因云端超时丢账');
    assert.equal(journalEntries(storage, 'usr_guard').tx_slow.kind, 'upsert', '超时的上传意图保留待重试');
  });

  it('删除 tombstone：已确认删除的行，晚到的远端旧快照绝不复活', async () => {
    const r1 = makeTx('r1');
    server.setRows('token_guard', [makeRemoteRow(r1)]);
    const session = loadCloudSession();

    const pulled = await pullHoldingTransactions({ session });
    assert.deepEqual(pulled.transactions.map((tx) => tx.id), ['r1']);

    const deletion = await persistDeletedHoldingTransaction({
      ledger: { transactions: [r1] },
      txId: 'r1',
      setLedger: () => {}
    });
    assert.deepEqual(deletion.deleted, ['r1'], '删除必须获得云确认');
    assert.equal(server.findRow('token_guard', 'r1'), null);
    assert.equal(journalEntries(storage, 'usr_guard').r1, undefined, '确认后清理 journal');

    // 模拟晚到的旧快照/另一端回传：同一 id 的远端行再次出现
    server.setRows('token_guard', [makeRemoteRow(r1, 5)]);
    const afterStale = await pullHoldingTransactions({ session });
    assert.deepEqual(afterStale.transactions.map((tx) => tx.id), [], '已删除的行绝不复活');
    assert.deepEqual(readCurrentHoldingTransactions().map((tx) => tx.id), []);
  });
});
