import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage 内存 shim —— 在导入业务模块前 install。
function installStorage(seed = {}) {
  const memory = new Map(Object.entries(seed));
  const storage = {
    getItem(k) { return memory.has(k) ? memory.get(k) : null; },
    setItem(k, v) { memory.set(k, String(v)); },
    removeItem(k) { memory.delete(k); },
    clear() { memory.clear(); }
  };
  globalThis.window = {
    localStorage: storage,
    addEventListener() {},
    removeEventListener() {}
  };
  return memory;
}

async function freshImport() {
  // 因为各业务模块都是顶层 import 一次性 evaluate，本测试用 cache-bust 让每个 case 拿到全新实例
  return await import(`../src/app/notifySync.js?cb=${Date.now()}${Math.random()}`);
}

test('buildNotifySyncPayload: 空 localStorage 仍返回 plans/dca/sellPlans/positionDigest/vix/syncedAt 顶层键', async () => {
  installStorage();
  const mod = await freshImport();
  const payload = mod.buildNotifySyncPayload();
  assert.ok(payload && typeof payload === 'object');
  for (const key of ['plans', 'dca', 'dcaList', 'sellPlans', 'positionDigest', 'syncedAt']) {
    assert.ok(Object.prototype.hasOwnProperty.call(payload, key), `payload 缺少 ${key}`);
  }
  assert.ok('vix' in payload, 'payload 缺少 vix');
  assert.deepEqual(payload.sellPlans, []);
  assert.equal(payload.positionDigest, null);
  assert.equal(payload.vix, null);
  assert.equal(payload.dca, null);
  assert.deepEqual(payload.dcaList, []);
  assert.ok(typeof payload.syncedAt === 'string' && payload.syncedAt.length > 0);
});

test('buildNotifySyncPayload: 多个定投计划进入 dcaList，同时保留 active dca 兼容字段', async () => {
  installStorage({
    aiDcaDcaStore: JSON.stringify({
      source: 'react-dca-store',
      version: 1,
      activeDcaId: 'dca-spy-monthly',
      plans: [
        {
          id: 'dca-qqq-weekly',
          name: 'QQQ 每周定投',
          symbol: 'QQQ',
          frequency: '每周',
          executionDay: 2,
          recurringInvestment: 300,
          termMonths: 12,
          isConfigured: true,
          createdAt: '2026-05-10T00:00:00.000Z',
          updatedAt: '2026-05-10T00:00:00.000Z'
        },
        {
          id: 'dca-spy-monthly',
          name: 'SPY 每月定投',
          symbol: 'SPY',
          frequency: '每月',
          executionDay: 8,
          recurringInvestment: 500,
          termMonths: 24,
          isConfigured: true,
          createdAt: '2026-05-11T00:00:00.000Z',
          updatedAt: '2026-05-11T00:00:00.000Z'
        }
      ]
    })
  });

  const mod = await freshImport();
  const payload = mod.buildNotifySyncPayload();
  assert.equal(payload.dcaList.length, 2);
  assert.deepEqual(payload.dcaList.map((dca) => dca.id), ['dca-qqq-weekly', 'dca-spy-monthly']);
  assert.equal(payload.dca.id, 'dca-spy-monthly');
  assert.equal(payload.dca.name, 'SPY 每月定投');
});

test('buildNotifySyncPayload: sellPlans 取自 aiDcaSellPlanStore 并仅含精简字段', async () => {
  const sellPlan = {
    id: 'sp-1',
    name: 'NVDA 减仓',
    symbol: 'NVDA',
    holdingCost: 100,
    holdingShares: 50,
    gainTriggers: [15, 25, 35],
    sellRatios: [0.33, 0.33, 0.34],
    trailingStopPct: 8,
    isConfigured: true,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    // 故意混入额外字段，应被 strip 掉
    secretField: 'should-not-leak'
  };
  installStorage({
    aiDcaSellPlanStore: JSON.stringify([sellPlan])
  });
  const mod = await freshImport();
  const payload = mod.buildNotifySyncPayload();
  assert.equal(payload.sellPlans.length, 1);
  const out = payload.sellPlans[0];
  assert.equal(out.symbol, 'NVDA');
  assert.equal(out.holdingCost, 100);
  assert.deepEqual(out.gainTriggers, [15, 25, 35]);
  assert.equal(out.updatedAt, '2026-05-10T00:00:00.000Z');
  assert.ok(!('trailingStopPct' in out), '不应泄露 trailingStopPct');
  assert.ok(!('secretField' in out), '不应泄露 secretField');
  assert.ok(!('isConfigured' in out), '不应泄露 isConfigured');
});

test('buildNotifySyncPayload: vix 取自 aiDcaVixState 并加 level/thresholds', async () => {
  installStorage({
    aiDcaVixState: JSON.stringify({ value: 32.5, cachedAt: '2026-05-18T12:00:00.000Z' })
  });
  const mod = await freshImport();
  const payload = mod.buildNotifySyncPayload();
  assert.ok(payload.vix, 'vix 不应为 null');
  assert.equal(payload.vix.value, 32.5);
  assert.equal(payload.vix.level, 'buyIndex');
  assert.equal(payload.vix.cachedAt, '2026-05-18T12:00:00.000Z');
  assert.equal(payload.vix.thresholds.watch, 25);
  assert.equal(payload.vix.thresholds.heavyBuy, 50);
});

test('buildNotifySyncPayload: positionDigest 在 totalAssets<=0 时为 null', async () => {
  installStorage({
    aiDcaPositionSnapshot: JSON.stringify({ totalAssets: 0, prices: { NVDA: 120 } })
  });
  const mod = await freshImport();
  const payload = mod.buildNotifySyncPayload();
  assert.equal(payload.positionDigest, null);
});

test('mergeNotifyStatusIntoClientConfig: 刷新后用云端 Server酱³ 状态恢复 UID', async () => {
  const memory = installStorage({
    aiDcaNotifyClientConfig: JSON.stringify({
      barkDeviceKey: '',
      serverChan3Uid: '',
      serverChan3SendKey: '',
      notifyClientId: 'web:client-1',
      notifyClientLabel: 'Web 控制台',
      notifyClientSecret: 'secret-1'
    })
  });
  const mod = await freshImport();

  const merged = mod.mergeNotifyStatusIntoClientConfig({
    configured: {
      serverChan3: true
    },
    setup: {
      clientId: 'web:client-1',
      clientLabel: 'Web 控制台',
      serverChan3: {
        uid: 'uid-123',
        sendKeyMasked: 'sendke...abcd',
        configured: true
      }
    }
  });

  assert.equal(merged.serverChan3Uid, 'uid-123');
  assert.equal(merged.serverChan3SendKey, '');

  const stored = JSON.parse(memory.get('aiDcaNotifyClientConfig'));
  assert.equal(stored.serverChan3Uid, 'uid-123');
  assert.equal(stored.serverChan3SendKey, '');
  assert.equal(stored.notifyClientId, 'web:client-1');
  assert.equal(stored.notifyClientSecret, 'secret-1');
});
