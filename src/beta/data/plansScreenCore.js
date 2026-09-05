// beta 计划 tab 核心：把两套计划存储拼成一个列表（纯逻辑，零 import）。
//
// 正式版把「计划」分成两套完全独立的存储，页面上也是两类卡片：
//   - 定投计划（dca store）：多久投一次、每次投多少
//   - 加仓计划（plan store）：一笔预算按跌幅分几批建仓
// 这两套各自带自己的 legacy 迁移路径，读任何一套都可能抛异常，
// 所以两段各自 try/catch：定投读不出来不该让加仓计划一起空掉。
//
// 三条规则：
//   1. 只读。beta 不写计划存储 —— 两边写同一个 key 迟早写坏，
//      新建 / 编辑 / 删除仍然回正式版做。
//   2. 空列表是引导态而不是错误态。
//   3. 缺字段不编造：拿不到就给 null，页面打「—」，
//      不要显示 0 让人误判成「每期投 0 元」。

export const INITIAL_PLANS_STATE = Object.freeze({
  status: 'idle',
  dca: Object.freeze({ status: 'idle', rows: [], error: '' }),
  plans: Object.freeze({ status: 'idle', rows: [], error: '' }),
  error: '',
  updatedAt: 0,
  requestId: 0
});

const REQUIRED_DEPS = ['readDcaPlans', 'readLayeredPlans'];

const PER_EXECUTION_KEYS = ['nextExecutionAmount', 'recurringInvestment', 'monthlyInvestment'];

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickNumberField(source, keys) {
  for (let i = 0; i < keys.length; i += 1) {
    const num = toNumber(source[keys[i]]);
    if (num !== null) return num;
  }
  return null;
}

function text(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

export function errorMessage(error, fallback = '计划加载失败') {
  if (typeof error === 'string') return error.trim() || fallback;
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  return fallback;
}

/** 正式版里只有两种分层策略，其余值不猜。 */
export function strategyLabel(value) {
  return text(value) === 'peak-drawdown' ? '固定回撤' : '均线分层';
}

export function normalizeDcaPlan(plan, index = 0, activeId = '') {
  if (!plan || typeof plan !== 'object') return null;
  const id = text(plan.id) || 'dca-' + index;
  const symbol = text(plan.symbol);
  return {
    id,
    name: text(plan.name) || (symbol ? symbol + ' 定投' : '未命名定投'),
    symbol,
    frequency: text(plan.frequency),
    cadence: text(plan.cadenceLabel),
    perExecution: pickNumberField(plan, PER_EXECUTION_KEYS),
    totalInvestment: toNumber(plan.totalInvestment),
    executionCount: toNumber(plan.executionCount),
    termMonths: toNumber(plan.termMonths),
    targetReturn: toNumber(plan.targetReturn),
    smartMode: text(plan.smartDcaMode) || 'fixed',
    poolBalance: toNumber(plan.poolBalance),
    linkedPlanId: text(plan.linkedPlanId),
    active: Boolean(activeId) && id === text(activeId),
    updatedAt: text(plan.updatedAt) || text(plan.createdAt)
  };
}

export function normalizeLayeredPlan(plan, index = 0, activeId = '') {
  if (!plan || typeof plan !== 'object') return null;
  const id = text(plan.id) || 'plan-' + index;
  const symbol = text(plan.symbol);
  const drops = Array.isArray(plan.triggerDrops) ? plan.triggerDrops : [];
  const weights = Array.isArray(plan.layerWeights) ? plan.layerWeights : [];
  return {
    id,
    name: text(plan.name) || (symbol ? symbol + ' 加仓' : '未命名计划'),
    symbol,
    strategy: text(plan.selectedStrategy),
    strategyLabel: strategyLabel(plan.selectedStrategy),
    totalBudget: toNumber(plan.totalBudget),
    investable: toNumber(plan.investableCapital),
    reserve: toNumber(plan.reserveCapital),
    cashReservePct: toNumber(plan.cashReservePct),
    averageCost: toNumber(plan.averageCost),
    basePrice: toNumber(plan.basePrice),
    layerCount: weights.length,
    maxDrawdown: drops.length ? toNumber(drops[drops.length - 1]) : null,
    active: Boolean(activeId) && id === text(activeId),
    updatedAt: text(plan.updatedAt) || text(plan.createdAt)
  };
}

function readRows(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.plans)) return result.plans;
  return [];
}

function buildSection(result, normalize, fallbackError) {
  if (!result || typeof result !== 'object') {
    return { status: 'error', rows: [], error: fallbackError };
  }
  if (result.ok === false) {
    return { status: 'error', rows: [], error: errorMessage(result.error, fallbackError) };
  }
  const activeId = Array.isArray(result) ? '' : text(result.activeId);
  const rows = readRows(result)
    .map((plan, index) => normalize(plan, index, activeId))
    .filter(Boolean);
  return { status: rows.length ? 'ready' : 'empty', rows, error: '' };
}

export function buildDcaSection(result) {
  return buildSection(result, normalizeDcaPlan, '定投计划读取失败');
}

export function buildLayeredSection(result) {
  return buildSection(result, normalizeLayeredPlan, '加仓计划读取失败');
}

function isCurrentRequest(state, action) {
  return Number(action.requestId) === Number(state.requestId);
}

export function plansScreenReducer(state = INITIAL_PLANS_STATE, action = {}) {
  switch (action.type) {
    case 'request':
      return {
        ...state,
        status: state.updatedAt ? 'refreshing' : 'loading',
        error: '',
        requestId: Number(action.requestId) || 0
      };

    case 'success': {
      if (!isCurrentRequest(state, action)) return state;
      return {
        ...state,
        status: 'ready',
        dca: action.dca || state.dca,
        plans: action.plans || state.plans,
        updatedAt: Number(action.updatedAt) || 0,
        error: ''
      };
    }

    case 'failure': {
      if (!isCurrentRequest(state, action)) return state;
      return { ...state, status: 'error', error: errorMessage(action.error) };
    }

    case 'reset':
      return { ...INITIAL_PLANS_STATE };

    default:
      return state;
  }
}

async function settle(run) {
  try {
    return await run();
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * @param {object} deps
 * @param {() => ({plans: Array, activeId: string})} deps.readDcaPlans 定投存储
 * @param {() => ({plans: Array, activeId: string})} deps.readLayeredPlans 加仓存储
 * @param {() => number} [deps.now]
 */
export function createPlansScreenController(deps = {}) {
  for (let i = 0; i < REQUIRED_DEPS.length; i += 1) {
    const name = REQUIRED_DEPS[i];
    if (typeof deps[name] !== 'function') {
      throw new TypeError('createPlansScreenController requires a ' + name + ' function');
    }
  }

  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();

  async function load() {
    const results = await Promise.all([
      settle(() => deps.readDcaPlans()),
      settle(() => deps.readLayeredPlans())
    ]);

    return {
      ok: true,
      dca: buildDcaSection(results[0]),
      plans: buildLayeredSection(results[1]),
      updatedAt: now()
    };
  }

  return { load };
}
