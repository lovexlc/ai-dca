import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProgress,
  buildStat,
  countArray,
  countKeys,
  countSnapshots,
  countTransactions,
  createProfileScreenController,
  errorMessage
} from '../src/beta/data/profileScreenCore.js';

const NOW = 1757000000000;

const LEDGER = {
  transactions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  snapshotsByCode: { '513870': {}, '159941': {} }
};

const PAGES = [
  { key: 'home', label: '首页' },
  { key: 'markets', label: '行情' },
  { key: 'holdings', label: '持仓' },
  { key: 'backtest', label: '回测' },
  { key: 'notify', label: '提醒' }
];

function createController(overrides = {}) {
  const deps = {
    readLedger: () => LEDGER,
    readWatchlistCodes: () => ['513870', '159941', '513390'],
    readDcaPlans: () => ({ plans: [{ id: 'dca-1' }] }),
    readLayeredPlans: () => ({ plans: [] }),
    getPages: () => PAGES,
    portedKeys: ['home', 'markets', 'holdings'],
    now: () => NOW,
    ...overrides
  };
  return createProfileScreenController(deps);
}

function statOf(result, key) {
  return result.stats.find((stat) => stat.key === key);
}

// ---------- 计数 ----------

test('只有真数组 / 真对象才数得出数', () => {
  assert.equal(countArray([1, 2]), 2);
  assert.equal(countArray(null), null);
  assert.equal(countArray('ab'), null, '字符串的 length 不算');
  assert.equal(countKeys({ a: 1 }), 1);
  assert.equal(countKeys([]), null);
  assert.equal(countKeys(null), null);
});

test('账本条数与快照数各自取', () => {
  assert.equal(countTransactions(LEDGER), 3);
  assert.equal(countSnapshots(LEDGER), 2);
  assert.equal(countTransactions(null), null);
  assert.equal(countSnapshots({}), null);
});

test('异常收敛', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom');
  assert.equal(errorMessage(undefined, '账本读取失败'), '账本读取失败');
});

// ---------- 单行体检 ----------

test('体检行：正常、读失败、取值抛异常', () => {
  const ok = buildStat('k', '账本流水', LEDGER, countTransactions, '账本读取失败');
  assert.deepEqual(ok, { key: 'k', label: '账本流水', value: 3, error: '' });

  const failed = buildStat('k', '账本流水', { ok: false, error: '存储被禁' }, countTransactions, '账本读取失败');
  assert.equal(failed.value, null);
  assert.equal(failed.error, '存储被禁');

  const threw = buildStat('k', '账本流水', LEDGER, () => { throw new Error('算坏了'); }, '账本读取失败');
  assert.equal(threw.value, null);
  assert.equal(threw.error, '算坏了');
});

// ---------- 搬运进度 ----------

test('进度按页面 key 算，待搬列表拿标题', () => {
  const progress = buildProgress(PAGES, ['home', 'markets', 'holdings']);
  assert.equal(progress.ported, 3);
  assert.equal(progress.total, 5);
  assert.deepEqual(progress.pendingLabels, ['回测', '提醒']);
});

test('进度：参数缺失不崩', () => {
  assert.deepEqual(buildProgress(null, null), { ported: 0, total: 0, pendingLabels: [] });
  assert.deepEqual(buildProgress(PAGES, []), { ported: 0, total: 5, pendingLabels: ['首页', '行情', '持仓', '回测', '提醒'] });
});

// ---------- 加载器 ----------

test('缺依赖时直接报错', () => {
  assert.throws(() => createProfileScreenController({}), TypeError);
  assert.throws(
    () => createProfileScreenController({ readLedger: () => ({}), readWatchlistCodes: () => [] }),
    /readDcaPlans/
  );
});

test('五项体检全部拿到', async () => {
  const result = await createController().load();
  assert.equal(result.ok, true);
  assert.equal(result.updatedAt, NOW);
  assert.equal(result.stats.length, 5);
  assert.equal(statOf(result, 'transactions').value, 3);
  assert.equal(statOf(result, 'snapshots').value, 2);
  assert.equal(statOf(result, 'watchlist').value, 3);
  assert.equal(statOf(result, 'dca').value, 1);
  assert.equal(statOf(result, 'plans').value, 0, '空列表就是 0 而不是拿不到');
});

test('自选单挂了不拖累账本条数', async () => {
  const result = await createController({
    readWatchlistCodes: () => { throw new Error('自选单读不出来'); }
  }).load();
  assert.equal(result.ok, true);
  assert.equal(statOf(result, 'watchlist').value, null);
  assert.equal(statOf(result, 'watchlist').error, '自选单读不出来');
  assert.equal(statOf(result, 'transactions').value, 3);
});

test('账本挂了时两行一起标错，其余三行照常', async () => {
  const result = await createController({
    readLedger: () => { throw new Error('localStorage is not available'); }
  }).load();
  assert.equal(statOf(result, 'transactions').error, 'localStorage is not available');
  assert.equal(statOf(result, 'snapshots').error, 'localStorage is not available');
  assert.equal(statOf(result, 'dca').value, 1);
  assert.equal(statOf(result, 'plans').value, 0);
});

test('没给页面列表时进度归零而不报错', async () => {
  const result = await createController({ getPages: undefined, portedKeys: undefined }).load();
  assert.deepEqual(result.progress, { ported: 0, total: 0, pendingLabels: [] });
});
