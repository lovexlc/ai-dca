import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INITIAL_PLANS_STATE,
  buildDcaSection,
  buildLayeredSection,
  createPlansScreenController,
  errorMessage,
  normalizeDcaPlan,
  normalizeLayeredPlan,
  plansScreenReducer,
  strategyLabel
} from '../src/beta/data/plansScreenCore.js';

const NOW = 1757000000000;

const DCA_PLAN = {
  id: 'dca-1',
  name: '纳指每月',
  symbol: '513100',
  frequency: '每月',
  executionDay: 8,
  termMonths: 12,
  targetReturn: 30,
  recurringInvestment: 800,
  nextExecutionAmount: 640,
  totalInvestment: 11100,
  executionCount: 12,
  cadenceLabel: '每月 8 日执行',
  smartDcaMode: 'pyramid',
  poolBalance: 320,
  linkedPlanId: 'plan-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z'
};

const LAYERED_PLAN = {
  id: 'plan-1',
  name: '纳指分批建仓',
  symbol: '513100',
  totalBudget: 12000,
  cashReservePct: 30,
  basePrice: 1.5,
  selectedStrategy: 'peak-drawdown',
  layerWeights: [40, 35, 25],
  triggerDrops: [0, 8, 16],
  investableCapital: 8400,
  reserveCapital: 3600,
  averageCost: 1.38,
  updatedAt: '2026-02-01T00:00:00.000Z'
};

function createController(overrides = {}) {
  const calls = { dca: 0, layered: 0 };
  const deps = {
    readDcaPlans: () => {
      calls.dca += 1;
      return { plans: [DCA_PLAN], activeId: 'dca-1' };
    },
    readLayeredPlans: () => {
      calls.layered += 1;
      return { plans: [LAYERED_PLAN], activeId: 'plan-9' };
    },
    now: () => NOW,
    ...overrides
  };
  return { controller: createPlansScreenController(deps), calls };
}

// ---------- 归一化 ----------

test('异常收敛成一句话', () => {
  assert.equal(errorMessage(new Error('localStorage 被禁')), 'localStorage 被禁');
  assert.equal(errorMessage(''), '计划加载失败');
});

test('只认两种分层策略，其余不猜', () => {
  assert.equal(strategyLabel('peak-drawdown'), '固定回撤');
  assert.equal(strategyLabel('ma120-risk'), '均线分层');
  assert.equal(strategyLabel(''), '均线分层');
});

test('定投计划归一化：每期优先取下一期金额', () => {
  const plan = normalizeDcaPlan(DCA_PLAN, 0, 'dca-1');
  assert.equal(plan.id, 'dca-1');
  assert.equal(plan.name, '纳指每月');
  assert.equal(plan.perExecution, 640, '智能定投下一期优先于固定金额');
  assert.equal(plan.smartMode, 'pyramid');
  assert.equal(plan.active, true);
  assert.equal(plan.executionCount, 12);
});

test('定投计划归一化：没下一期就退回固定金额，没名字就拼代码', () => {
  const plan = normalizeDcaPlan({ symbol: '159941', recurringInvestment: 500 }, 3, 'other');
  assert.equal(plan.id, 'dca-3');
  assert.equal(plan.name, '159941 定投');
  assert.equal(plan.perExecution, 500);
  assert.equal(plan.smartMode, 'fixed');
  assert.equal(plan.active, false);
});

test('定投计划归一化：缺字段给 null 而不是 0', () => {
  const plan = normalizeDcaPlan({ id: 'x' });
  assert.equal(plan.perExecution, null);
  assert.equal(plan.totalInvestment, null);
  assert.equal(plan.executionCount, null);
  assert.equal(plan.name, '未命名定投');
});

test('加仓计划归一化：批次数与最大跌幅从数组里取', () => {
  const plan = normalizeLayeredPlan(LAYERED_PLAN, 0, 'plan-1');
  assert.equal(plan.layerCount, 3);
  assert.equal(plan.maxDrawdown, 16);
  assert.equal(plan.strategyLabel, '固定回撤');
  assert.equal(plan.investable, 8400);
  assert.equal(plan.reserve, 3600);
  assert.equal(plan.active, true);
});

test('加仓计划归一化：没批次时不编跌幅', () => {
  const plan = normalizeLayeredPlan({ id: 'p', symbol: '513870' });
  assert.equal(plan.layerCount, 0);
  assert.equal(plan.maxDrawdown, null);
  assert.equal(plan.name, '513870 加仓');
});

test('垃圾条目直接丢弃', () => {
  assert.equal(normalizeDcaPlan(null), null);
  assert.equal(normalizeLayeredPlan('x'), null);
});

// ---------- 两段卡片 ----------

test('两段各自给 ready / empty / error', () => {
  const ready = buildDcaSection({ plans: [DCA_PLAN], activeId: 'dca-1' });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.rows.length, 1);

  assert.equal(buildDcaSection({ plans: [] }).status, 'empty');
  assert.equal(buildDcaSection({ plans: [], activeId: '' }).error, '');

  const failed = buildDcaSection({ ok: false, error: new Error('存储被禁') });
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, '存储被禁');

  assert.equal(buildDcaSection(null).error, '定投计划读取失败');
  assert.equal(buildLayeredSection(null).error, '加仓计划读取失败');
});

test('直接给数组也能认', () => {
  const section = buildLayeredSection([LAYERED_PLAN]);
  assert.equal(section.status, 'ready');
  assert.equal(section.rows[0].active, false, '没给 activeId 就都不高亮');
});

test('列表里的垃圾项不占位', () => {
  const section = buildDcaSection({ plans: [null, DCA_PLAN, 'x'], activeId: 'dca-1' });
  assert.equal(section.rows.length, 1);
});

// ---------- reducer ----------

test('首次 loading，二次 refreshing', () => {
  const first = plansScreenReducer(INITIAL_PLANS_STATE, { type: 'request', requestId: 1 });
  assert.equal(first.status, 'loading');
  const ready = plansScreenReducer(first, { type: 'success', requestId: 1, updatedAt: NOW });
  assert.equal(plansScreenReducer(ready, { type: 'request', requestId: 2 }).status, 'refreshing');
});

test('迟到响应丢弃，失败保留旧列表', () => {
  let state = plansScreenReducer(INITIAL_PLANS_STATE, { type: 'request', requestId: 1 });
  state = plansScreenReducer(state, {
    type: 'success',
    requestId: 1,
    updatedAt: NOW,
    dca: { status: 'ready', rows: [{ id: 'a' }], error: '' }
  });
  assert.equal(plansScreenReducer(state, { type: 'success', requestId: 99, updatedAt: 1 }), state);

  state = plansScreenReducer(state, { type: 'request', requestId: 2 });
  state = plansScreenReducer(state, { type: 'failure', requestId: 2, error: '炸' });
  assert.equal(state.status, 'error');
  assert.equal(state.dca.rows.length, 1);
});

test('reset 与未知 action', () => {
  const state = plansScreenReducer(INITIAL_PLANS_STATE, { type: 'request', requestId: 1 });
  assert.deepEqual(plansScreenReducer(state, { type: 'reset' }), { ...INITIAL_PLANS_STATE });
  assert.equal(plansScreenReducer(state, { type: 'nope' }), state);
});

// ---------- 加载器 ----------

test('缺依赖时直接报错', () => {
  assert.throws(() => createPlansScreenController({}), TypeError);
  assert.throws(() => createPlansScreenController({ readDcaPlans: () => ({}) }), /readLayeredPlans/);
});

test('两套存储各读一次', async () => {
  const { controller, calls } = createController();
  const result = await controller.load();
  assert.equal(result.ok, true);
  assert.equal(calls.dca, 1);
  assert.equal(calls.layered, 1);
  assert.equal(result.updatedAt, NOW);
  assert.equal(result.dca.rows[0].active, true);
  assert.equal(result.plans.rows[0].active, false, 'activeId 对不上就不高亮');
});

test('定投读不出来时加仓计划照常显示', async () => {
  const { controller } = createController({
    readDcaPlans: () => { throw new Error('localStorage is not available'); }
  });
  const result = await controller.load();
  assert.equal(result.ok, true, '一段挂掉不影响整页');
  assert.equal(result.dca.status, 'error');
  assert.equal(result.dca.error, 'localStorage is not available');
  assert.equal(result.plans.status, 'ready');
  assert.equal(result.plans.rows.length, 1);
});

test('两段都空时是引导态而不是错误态', async () => {
  const { controller } = createController({
    readDcaPlans: () => ({ plans: [], activeId: '' }),
    readLayeredPlans: () => ({ plans: [], activeId: '' })
  });
  const result = await controller.load();
  assert.equal(result.dca.status, 'empty');
  assert.equal(result.plans.status, 'empty');
  assert.equal(result.dca.error, '');
  assert.equal(result.plans.error, '');
});
