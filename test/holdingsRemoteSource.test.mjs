import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';

// 持仓远端数据源行为测试：用可控延迟的假账号 API 真实复现
// 「空 GET 晚到与保存并行」「账号切换」「分页乱序」「pending journal 刷新恢复」。
// 断言全部基于可观察行为（UI 状态、runtime 账本、journal、请求日志），不匹配源码字符串。

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

// 必须先安装 window 再导入 app 模块：authSession 在导入时就会安装账号读取 guard。
installWindow();

const { clearAccountRuntimeStore } = await import('../src/app/accountRuntimeStore.js');
const { saveCloudSession, loadCloudSession } = await import('../src/app/authSession.js');
const { createHoldingsRemoteSource } = await import('../src/app/holdingsRemoteSource.js');
const {
  cancelScheduledHoldingTransactionPush,
  pendingHoldingTransactionJournalKey,
  pullHoldingTransactions,
  readCurrentHoldingTransactions
} = await import('../src/app/holdingTransactionsSync.js');
const {
  describeHoldingTransactionSync,
  persistDeletedHoldingTransaction,
  persistHoldingTransactionMutation
} = await import('../src/app/holdingTransactionMutations.js');
const { resetAccountLoadingState } = await import('../src/app/accountLoadingState.js');

const realFetch = globalThis.fetch;

/**
 * 可控延迟的假账号 API：
 * - 响应内容在请求到达时计算（hold 期间的新变更不会混入被挂起的响应），
 *   因此「挂起的 GET」就是修复前会覆盖 pending 新增的那类晚到空/旧快照；
 * - holdNext(match) 返回 release()，精确控制单个响应何时晚到；
 * - requestLog 记录每次请求（含列表 GET 的快照行 id），用于断言「没有发出某请求」。
 */
class FakeAccountApi {
  constructor() {
    this.rowsByToken = new Map();
    this.pageSize = 1000;
    this.requestLog = [];
    this.holds = [];
    this.failNextPuts = 0;
    this.failNextDeletes = 0;
    this.failTokens = new Set(); // 这些 token 的 PUT 一律 500（模拟 A 账号云端不可用）
    this.putConfirmIdOverride = null;
    this.migrationStatus = { status: 'no-legacy', legacy: { exists: false } };
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

  async waitForRequest(match, timeoutMs = 2000) {
    const startedAt = Date.now();
    // 只等待调用之后新出现的请求，避免匹配到历史请求
    const baseline = this.requestLog.length;
    for (;;) {
      const entry = this.requestLog.slice(baseline).find((item) => item.url.includes(match));
      if (entry) return entry;
      if (Date.now() - startedAt > timeoutMs) throw new Error(`等待请求超时：${match}`);
      await new Promise((resolve) => globalThis.setTimeout(resolve, 5));
    }
  }

  buildResponse(url, method, token, body) {
    if (url.includes('/migrations/legacy')) {
      return { status: 200, body: { ...this.migrationStatus } };
    }
    if (url.includes('/holdings/allocation')) {
      return { status: 200, body: { data: { targetInvestmentPct: 80 } } };
    }
    if (url.includes('/trades/ledger')) {
      return { status: 200, body: { data: [] } };
    }
    if (url.includes('/holdings/ledger/items?')) {
      // CN 同源构建走相对路径，补一个 base 再解析查询参数。
      const params = new URL(url, 'http://localhost').searchParams;
      const cursor = Number(params.get('cursor') || 0) || 0;
      const rows = this.rows(token);
      const limit = Math.min(Number(params.get('limit') || 500) || 500, this.pageSize);
      const page = rows.slice(cursor, cursor + limit);
      const nextCursor = cursor + limit < rows.length ? String(cursor + limit) : '';
      return {
        status: 200,
        body: { rows: page.map((row) => ({ ...row, data: { ...row.data } })), nextCursor },
        snapshotIds: page.map((row) => row.id)
      };
    }
    const itemMatch = url.match(/\/holdings\/ledger\/items\/([^/?]+)/);
    if (itemMatch) {
      const id = decodeURIComponent(itemMatch[1]);
      if (method === 'GET') {
        const row = this.findRow(token, id);
        return row
          ? { status: 200, body: { id: row.id, revision: row.revision, data: row.data } }
          : { status: 404, body: { message: 'not found' } };
      }
      if (method === 'PUT') {
        if (this.failTokens.has(token) || this.failNextPuts > 0) {
          if (!this.failTokens.has(token)) this.failNextPuts -= 1;
          return { status: 500, body: { message: '云端暂不可用' } };
        }
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
        if (this.failNextDeletes > 0) {
          this.failNextDeletes -= 1;
          return { status: 500, body: { message: '云端暂不可用' } };
        }
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
    // 响应内容在请求到达瞬间计算：挂起的响应就是发出时的旧快照。
    const response = this.buildResponse(fullUrl, method, token, body);
    this.requestLog.push({ url: fullUrl, method, token, snapshotIds: response.snapshotIds || null });

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

function loginAs(userId, username, accessToken) {
  return saveCloudSession({ userId, username, accessToken, refreshToken: '', isAdmin: false });
}

function createStateHolder() {
  const applied = [];
  const settings = [];
  const trades = [];
  let state = { transactions: [] };
  const setLedger = (update) => {
    state = typeof update === 'function' ? update(state) : (update || state);
    applied.push(state.transactions.map((tx) => String(tx.id)));
  };
  return {
    setLedger,
    setAccountSettings: (value) => settings.push(value),
    setTradeLedgerEntries: (value) => trades.push(value),
    applied,
    settings,
    trades,
    get transactions() {
      return state.transactions;
    }
  };
}

function createSource(holder) {
  return createHoldingsRemoteSource({
    setLedger: holder.setLedger,
    setAccountSettings: holder.setAccountSettings,
    setTradeLedgerEntries: holder.setTradeLedgerEntries
  });
}

describe('持仓远端数据源（可控延迟行为测试）', () => {
  let server;
  let storage;

  beforeEach(() => {
    ({ storage } = installWindow());
    server = new FakeAccountApi();
    globalThis.fetch = server.fetch;
  });

  afterEach(() => {
    cancelScheduledHoldingTransactionPush();
    clearAccountRuntimeStore();
    resetAccountLoadingState();
    globalThis.fetch = realFetch;
    delete globalThis.window;
  });

  it('空 GET 晚到与保存并行：pending 新增不被覆盖，且拿到真实云确认', async () => {
    loginAs('usr_a', 'usera', 'token_a');
    const r1 = makeTx('r1');
    server.setRows('token_a', [makeRemoteRow(r1)]);
    const holder = createStateHolder();
    const source = createSource(holder);

    // 第一次刷新完成：runtime = [r1]
    assert.equal(await source.refresh(), 'remote');
    assert.deepEqual(holder.transactions.map((tx) => tx.id), ['r1']);

    // 第二次刷新：交易行 GET 被挂起，其快照是保存前的远端（只有 r1）
    const releaseStaleGet = server.holdNext('/holdings/ledger/items?');
    const refreshPromise = source.refresh();
    await server.waitForRequest('/holdings/ledger/items?');

    // 与晚到 GET 并行：用户新增并保存 tx_new
    const txNew = makeTx('tx_new', { code: '510300' });
    const syncResult = await persistHoldingTransactionMutation(
      { transactions: [r1, txNew] },
      { kind: 'save', label: '保存交易', upsertIds: ['tx_new'], setLedger: holder.setLedger }
    );

    // 挂起的旧快照此刻才回来
    releaseStaleGet();
    assert.equal(await refreshPromise, 'remote');

    // 晚到的空/旧 GET 绝不能覆盖 pending 新增
    assert.deepEqual(
      holder.transactions.map((tx) => tx.id),
      ['r1', 'tx_new'],
      '保存的新增必须保留'
    );
    assert.deepEqual(
      readCurrentHoldingTransactions().map((tx) => tx.id),
      ['r1', 'tx_new'],
      'runtime 账本同样必须保留'
    );
    // 保存拿到真实云确认，而不是被静默吞掉
    assert.deepEqual(syncResult.pushed, ['tx_new']);
    assert.equal(syncResult.failed.length, 0);
    assert.match(describeHoldingTransactionSync(syncResult, '已保存'), /已同步至云端/);
    assert.ok(server.findRow('token_a', 'tx_new'), '保存必须上传到云端');
    // 云确认后 pending journal 清理
    assert.equal(storage.getItem(pendingHoldingTransactionJournalKey('usr_a')), null);
    // 确认被挂起的 GET 确实是不含 tx_new 的旧快照（真实复现晚到空 GET）
    const listGets = server.requestLog.filter((entry) => entry.url.includes('/holdings/ledger/items?'));
    assert.equal(listGets.length, 2);
    assert.deepEqual(listGets[1].snapshotIds, ['r1'], '挂起的 GET 必须是保存前的旧快照');
  });

  it('账号切换：旧账号的在途请求与 pending journal 绝不写入新账号', async () => {
    loginAs('usr_a', 'usera', 'token_a');
    const rA = makeTx('r_a');
    const txPending = makeTx('tx_a_pending', { code: '510300' });
    server.setRows('token_a', [makeRemoteRow(rA)]);
    const holder = createStateHolder();
    const source = createSource(holder);

    // A 的初始刷新完成
    assert.equal(await source.refresh(), 'remote');

    // A 留下一笔未确认的 pending（云端对 A 不可用）：journal 必须按 userId 隔离
    server.failTokens.add('token_a');
    const failedSave = await persistHoldingTransactionMutation(
      { transactions: [rA, txPending] },
      { kind: 'save', label: '保存交易', upsertIds: ['tx_a_pending'], setLedger: holder.setLedger }
    );
    assert.equal(failedSave.failed.length, 1);
    const journalA = JSON.parse(storage.getItem(pendingHoldingTransactionJournalKey('usr_a')));
    assert.equal(journalA.entries.tx_a_pending.kind, 'upsert', '失败的保存必须登记 journal');

    // A 的第二次刷新挂起（响应是 A 的旧快照）
    const releaseA = server.holdNext('/holdings/ledger/items?');
    const refreshA = source.refresh();
    await server.waitForRequest('/holdings/ledger/items?');

    // A→B 切换（真实路径：saveCloudSession 清空 runtime 与账号同步元数据）
    server.setRows('token_b', [makeRemoteRow(makeTx('r_b'))]);
    loginAs('usr_b', 'userb', 'token_b');
    const appliedBeforeSwitch = holder.applied.length;
    const refreshB = source.refresh();

    releaseA();
    assert.equal(await refreshA, 'stale', 'A 的晚到结果必须整体丢弃');
    assert.equal(await refreshB, 'remote');

    // 新账号只看到自己的数据；切换后的任何一次 UI 写入都不含 A 的行
    assert.deepEqual(holder.transactions.map((tx) => tx.id), ['r_b']);
    assert.deepEqual(readCurrentHoldingTransactions().map((tx) => tx.id), ['r_b']);
    for (let index = appliedBeforeSwitch; index < holder.applied.length; index += 1) {
      assert.equal(holder.applied[index].includes('r_a'), false, 'A 的行不得写进 B 的 UI');
      assert.equal(holder.applied[index].includes('tx_a_pending'), false, 'A 的 pending 不得写进 B');
    }
    // A 的 journal 原样保留（等 A 回来继续恢复），B 没有 journal，B 的云端也没有多余 PUT
    assert.equal(JSON.parse(storage.getItem(pendingHoldingTransactionJournalKey('usr_a'))).entries.tx_a_pending.kind, 'upsert');
    assert.equal(storage.getItem(pendingHoldingTransactionJournalKey('usr_b')), null);
    assert.equal(
      server.requestLog.filter((entry) => entry.method === 'PUT' && entry.token === 'token_b').length,
      0,
      'B 的云端不得收到 A 的 pending 上传'
    );
  });

  it('分页乱序：同一 id 后页胜出且不重复、并发刷新共享 pull、过期代次不应用', async () => {
    loginAs('usr_a', 'usera', 'token_a');
    const r1v1 = makeTx('r1', { price: 1 });
    const r2 = makeTx('r2', { code: '510300' });
    const r1v2 = makeTx('r1', { price: 2 });
    server.setRows('token_a', [makeRemoteRow(r1v1), makeRemoteRow(r2), makeRemoteRow(r1v2, 2)]);
    server.pageSize = 1;

    const holder = createStateHolder();
    const source = createSource(holder);

    const releasePage1 = server.holdNext('/holdings/ledger/items?');
    const refresh1 = source.refresh();
    await server.waitForRequest('/holdings/ledger/items?');
    const refresh2 = source.refresh(); // 并发刷新：与 refresh1 共享同一 pull（去重）

    releasePage1();
    assert.equal(await refresh1, 'stale', '旧刷新的过期代次结果不得应用');
    assert.equal(await refresh2, 'remote');

    // 多页乱序出现的同一 id：后页版本胜出、不重复、不丢行
    assert.deepEqual(holder.transactions.map((tx) => tx.id), ['r1', 'r2']);
    assert.equal(holder.transactions.find((tx) => tx.id === 'r1').price, 2);
    assert.deepEqual(readCurrentHoldingTransactions().map((tx) => tx.id), ['r1', 'r2']);
    // 两个并发刷新只产生一次交易行分页读取（共享 pull），allocation/trades 各两次
    const listGets = server.requestLog.filter((entry) => entry.url.includes('/holdings/ledger/items?'));
    assert.equal(listGets.length, 3, '三个分页只允许被读取一次');
    assert.equal(holder.applied.length, 1, '过期代次不应用：只有最新刷新写入 UI');
    assert.equal(holder.settings.length, 1, '过期代次的 allocation 也不得写入');
  });

  it('pending journal 刷新恢复：上传失败的保存在「刷新」后恢复并补传，远端行重新 hydrate', async () => {
    loginAs('usr_a', 'usera', 'token_a');
    const r1 = makeTx('r1');
    const txNew = makeTx('tx_new', { code: '510300' });
    server.setRows('token_a', [makeRemoteRow(r1)]);
    const holder = createStateHolder();
    const source = createSource(holder);
    assert.equal(await source.refresh(), 'remote');

    // 上传失败：PUT 500 → journal 保留 + 明确失败反馈
    server.failNextPuts = 1;
    const failedSave = await persistHoldingTransactionMutation(
      { transactions: [r1, txNew] },
      { kind: 'save', label: '保存交易', upsertIds: ['tx_new'], setLedger: holder.setLedger }
    );
    assert.equal(failedSave.failed.length, 1);
    assert.match(describeHoldingTransactionSync(failedSave, '已保存'), /云端同步失败/);
    const journalRaw = storage.getItem(pendingHoldingTransactionJournalKey('usr_a'));
    assert.ok(journalRaw, '失败保存必须登记 pending journal');
    assert.equal(JSON.parse(journalRaw).entries.tx_new.kind, 'upsert');

    // 模拟页面刷新：内存 runtime 清空；journal/同步基线/session 仍在持久层
    clearAccountRuntimeStore();

    const recovered = await pullHoldingTransactions({ session: loadCloudSession() });
    assert.deepEqual(
      recovered.transactions.map((tx) => tx.id).sort(),
      ['r1', 'tx_new'],
      'journal 行恢复，且刷新后已同步的远端行必须重新 hydrate'
    );
    assert.ok(server.findRow('token_a', 'tx_new'), '恢复后必须补传到云端');
    assert.equal(storage.getItem(pendingHoldingTransactionJournalKey('usr_a')), null, '云确认后清理 journal');

    // 再次 pull 幂等：不重复补传
    const again = await pullHoldingTransactions({ session: loadCloudSession() });
    assert.deepEqual(again.transactions.map((tx) => tx.id).sort(), ['r1', 'tx_new']);
    assert.equal(
      server.requestLog.filter((entry) => entry.method === 'PUT' && entry.url.includes('tx_new')).length,
      2,
      'tx_new 的 PUT 恰好两次：首次失败 + 恢复补传，不重复'
    );
  });

  it('删除的 journal 恢复：刷新后补删远端行，晚到的旧快照不复活已删交易', async () => {
    loginAs('usr_a', 'usera', 'token_a');
    const r1 = makeTx('r1');
    server.setRows('token_a', [makeRemoteRow(r1)]);
    const holder = createStateHolder();
    const source = createSource(holder);
    assert.equal(await source.refresh(), 'remote');

    // 删除时云端不可用：journal 记录删除意图，本地立即生效
    server.failNextDeletes = 1;
    const failedDelete = await persistDeletedHoldingTransaction({
      ledger: { transactions: [r1] },
      txId: 'r1',
      setLedger: holder.setLedger
    });
    assert.equal(failedDelete.failed.length, 1);
    assert.deepEqual(holder.transactions.map((tx) => tx.id), [], '本地删除立即生效');
    assert.equal(JSON.parse(storage.getItem(pendingHoldingTransactionJournalKey('usr_a'))).entries.r1.kind, 'delete');

    // 模拟页面刷新后恢复：删除意图补发到云端
    clearAccountRuntimeStore();
    server.failNextDeletes = 0;
    const recovered = await pullHoldingTransactions({ session: loadCloudSession() });
    assert.deepEqual(recovered.transactions.map((tx) => tx.id), [], '刷新后删除意图必须恢复并补删远端行');
    assert.equal(server.findRow('token_a', 'r1'), null, '恢复时必须补发 DELETE');
    assert.equal(storage.getItem(pendingHoldingTransactionJournalKey('usr_a')), null, '删除确认后清理 journal');

    // 晚到的旧快照仍包含 r1（另一设备回传/缓存）：tombstone 绝不复活
    server.setRows('token_a', [makeRemoteRow(r1, 3)]);
    const afterStale = await pullHoldingTransactions({ session: loadCloudSession() });
    assert.deepEqual(afterStale.transactions.map((tx) => tx.id), [], '已确认删除的行绝不复活');
    assert.deepEqual(readCurrentHoldingTransactions().map((tx) => tx.id), []);
  });
});

it('远端 hydrate 完成前持仓页禁止持久化 ledger（页面级门禁保留）', () => {
  const pageSource = fs.readFileSync(new URL('../src/pages/HoldingsExperience.jsx', import.meta.url), 'utf8');
  assert.match(pageSource, /if \(remoteMode && !remoteReady\) return;/);
  assert.match(pageSource, /persistLedgerState\(ledger\)/);
});
