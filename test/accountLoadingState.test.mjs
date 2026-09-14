// 统一加载态：所有账号请求（列表加载 / 保存 / 删除）都应在 accountApi 转发层自动登记、并在结束后清空。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeAccountRequest,
  getAccountLoadingSnapshot,
  resetAccountLoadingState,
  runAccountUserAction,
  subscribeAccountLoading
} from '../src/app/accountLoadingState.js';
import {
  deleteAccountResource,
  fetchAccountManifest,
  putAccountResource
} from '../src/app/accountApi.js';
import { fetchHoldingTransactionRows } from '../src/app/holdingTransactionsApi.js';

const SESSION = { accessToken: 'test-token', username: 'alice' };
const SETTLED_MIGRATION = { status: 'imported', legacy: { exists: true } };

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

async function withMockFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    calls.push({ url, method });
    return handler(url, method, init);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
    resetAccountLoadingState();
  }
}

// 每个资源请求前都会先查一次迁移门禁，这里统一放行。
function migrationAware(handler) {
  return async (url, method, init) => {
    if (url.endsWith('/migrations/legacy')) return jsonResponse(SETTLED_MIGRATION);
    return handler(url, method, init);
  };
}

test('describeAccountRequest 按方法与路径给出统一的加载态描述', () => {
  assert.deepEqual(describeAccountRequest({ method: 'GET', path: '/trades/ledger' }), {
    kind: 'load',
    resource: 'trades/ledger',
    label: '正在加载交易流水'
  });
  assert.deepEqual(describeAccountRequest({ method: 'DELETE', path: '/holdings/ledger/items/tx-1' }), {
    kind: 'delete',
    resource: 'holdings/ledger',
    label: '正在删除持仓交易行'
  });
  assert.deepEqual(describeAccountRequest({ method: 'PUT', path: '/markets/watchlist' }), {
    kind: 'save',
    resource: 'markets/watchlist',
    label: '正在保存自选清单'
  });
  assert.deepEqual(describeAccountRequest({ method: 'PATCH', path: '/dca/store' }), {
    kind: 'save',
    resource: 'dca/store',
    label: '正在保存定投计划'
  });
  // 非资源路径也要有可读文案，不能退化成空字符串。
  assert.equal(describeAccountRequest({ method: 'GET', path: '/manifest' }).label, '正在加载账号同步清单');
  assert.equal(describeAccountRequest({ method: 'GET', path: '/bundle?resources=a,b' }).label, '正在加载账号数据');
  assert.equal(describeAccountRequest({ method: 'PUT', path: '/user/data-notice' }).label, '正在保存数据处理选择');
  assert.equal(describeAccountRequest({ method: 'GET', path: '/unknown/thing' }).label, '正在加载账号数据');
});

test('列表加载请求会登记 load 加载态，结束后自动清空', async () => {
  let duringManifest = null;
  await withMockFetch(
    migrationAware(async (url) => {
      if (!url.endsWith('/manifest')) throw new Error(`unexpected url: ${url}`);
      duringManifest = getAccountLoadingSnapshot();
      return jsonResponse({ resources: [] });
    }),
    async (calls) => {
      await fetchAccountManifest(SESSION);
      assert.deepEqual(
        calls.map((call) => call.url),
        ['/api/account/v1/migrations/legacy', '/api/account/v1/manifest']
      );
    }
  );

  assert.equal(duringManifest.busy, true);
  assert.equal(duringManifest.loading, true);
  assert.equal(duringManifest.counts.load, 1);
  assert.equal(duringManifest.counts.total, 1);
  assert.equal(duringManifest.label, '正在加载账号同步清单');
  assert.equal(getAccountLoadingSnapshot().busy, false);
  assert.equal(getAccountLoadingSnapshot().label, '');
});

test('删除请求会登记 delete 加载态与资源名', async () => {
  const deletingSnapshots = [];
  const unsubscribe = subscribeAccountLoading((snapshot) => {
    if (snapshot.deleting) deletingSnapshots.push(snapshot);
  });

  await withMockFetch(
    migrationAware(async (url, method) => {
      assert.equal(method, 'DELETE');
      assert.equal(url, '/api/account/v1/trades/ledger');
      return jsonResponse({ deleted: true, revision: 8 });
    }),
    async () => {
      await deleteAccountResource('trades/ledger', SESSION);
    }
  );
  unsubscribe();

  assert.equal(deletingSnapshots.length, 1);
  assert.equal(deletingSnapshots[0].kind, 'delete');
  assert.equal(deletingSnapshots[0].label, '正在删除交易流水');
  assert.deepEqual([...deletingSnapshots[0].resources], ['trades/ledger']);
  assert.equal(getAccountLoadingSnapshot().deleting, false);
});

test('保存失败时统一加载态也会结束', async () => {
  await withMockFetch(
    migrationAware(async () => jsonResponse({ error: 'SERVER_ERROR', message: '服务器开小差' }, 500)),
    async () => {
      await assert.rejects(
        () => putAccountResource('markets/watchlist', { data: { items: [] }, baseRevision: 3 }, SESSION),
        (error) => error.status === 500 && error.message === '服务器开小差'
      );
    }
  );

  assert.equal(getAccountLoadingSnapshot().busy, false);
  assert.equal(getAccountLoadingSnapshot().saving, false);
});

test('持仓交易行接口复用转发层：GET 瞬时失败会重试一次并登记加载态', async () => {
  let itemAttempts = 0;
  let duringItems = null;

  const result = await withMockFetch(
    migrationAware(async (url) => {
      if (!url.includes('/holdings/ledger/items')) throw new Error(`unexpected url: ${url}`);
      itemAttempts += 1;
      duringItems = getAccountLoadingSnapshot();
      // 第一次在拿到 HTTP 响应前就挂了，fetchWithGetRetry 应重试。
      if (itemAttempts === 1) throw new TypeError('Failed to fetch');
      return jsonResponse({ rows: [{ id: 'tx-1' }], nextCursor: '' });
    }),
    async (calls) => {
      const rows = await fetchHoldingTransactionRows({ limit: 10 }, SESSION);
      assert.equal(calls[0].url, '/api/account/v1/migrations/legacy');
      assert.ok(calls[1].url.startsWith('/api/account/v1/holdings/ledger/items?'));
      return rows;
    }
  );

  assert.equal(itemAttempts, 2);
  assert.deepEqual(result.rows, [{ id: 'tx-1' }]);
  assert.equal(duringItems.label, '正在加载持仓交易行');
  assert.deepEqual([...duringItems.resources], ['holdings/ledger']);
  assert.equal(duringItems.counts.load, 1);
  assert.equal(getAccountLoadingSnapshot().busy, false);
});

test('runAccountUserAction 把页面按钮操作整体标记为用户操作', async () => {
  let nestedScopes = [];

  await withMockFetch(
    migrationAware(async () => {
      nestedScopes = getAccountLoadingSnapshot().operations.map((operation) => operation.scope);
      return jsonResponse({ deleted: true });
    }),
    async () => {
      await runAccountUserAction({ kind: 'delete', resource: 'trades/ledger', label: '正在删除交易流水' }, async () => {
        const outer = getAccountLoadingSnapshot();
        assert.equal(outer.userBusy, true);
        assert.equal(outer.deleting, true);
        assert.equal(outer.label, '正在删除交易流水');
        await deleteAccountResource('trades/ledger', SESSION);
      });
    }
  );

  // 用户操作期间发出的请求也算用户操作，不会被当成后台同步。
  assert.deepEqual(nestedScopes, ['user', 'user']);
  assert.equal(getAccountLoadingSnapshot().busy, false);
  assert.equal(getAccountLoadingSnapshot().userBusy, false);
});

test('后台轮询请求不会被标记为用户操作', async () => {
  let duringPull = null;
  await withMockFetch(
    migrationAware(async () => {
      duringPull = getAccountLoadingSnapshot();
      return jsonResponse({ resources: [] });
    }),
    async () => {
      await fetchAccountManifest(SESSION);
    }
  );

  assert.equal(duringPull.busy, true);
  assert.equal(duringPull.userBusy, false);
  assert.equal(duringPull.backgroundBusy, true);
});

test('取消订阅后不再收到加载态通知', async () => {
  let notifications = 0;
  const unsubscribe = subscribeAccountLoading(() => {
    notifications += 1;
  });

  await withMockFetch(
    migrationAware(async () => jsonResponse({ resources: [] })),
    async () => {
      await fetchAccountManifest(SESSION);
    }
  );
  const whileSubscribed = notifications;
  unsubscribe();

  await withMockFetch(
    migrationAware(async () => jsonResponse({ resources: [] })),
    async () => {
      await fetchAccountManifest(SESSION);
    }
  );

  assert.ok(whileSubscribed >= 4);
  assert.equal(notifications, whileSubscribed);
});
