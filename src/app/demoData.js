import { STRATEGY_PARAMS } from './assetType.js';
import { buildFixedDrawdownPlan } from './newPlan.js';
import { buildDcaProjection } from './dca.js';
import { readWorkspacePrefs } from './workspacePrefs.js';
import {
  ACCOUNT_KEY,
  DEMO_DATA_MARKER_KEY,
  DEMO_KEYS,
  DCA_KEY,
  LEDGER_KEY,
  PLAN_KEY,
  PLAN_STORE_KEY,
  WATCHLIST_KEY,
  WORKSPACE_PREFS_KEY,
  clearDemoData,
  hasDemoData,
  readDemoDataMeta
} from './demoDataMeta.js';

export { DEMO_DATA_MARKER_KEY, clearDemoData, hasDemoData, readDemoDataMeta };

const NASDAQ_ETF_DEMO_POSITIONS = [
  ['159513', '大成纳斯达克100ETF(QDII)', 'stable', 1.476, 1.85],
  ['159941', '广发纳斯达克100ETF', 'stable', 1.337, 1.691],
  ['513100', '国泰纳斯达克100ETF', 'stable', 1.802, 2.266],
  ['159696', '易方达纳斯达克100ETF(QDI)', 'aggressive', 1.653, 2.071],
  ['159632', '华安纳斯达克100ETF(QDII)', 'aggressive', 1.997, 2.493],
  ['513390', '博时纳斯达克100ETF(QDII)', 'aggressive', 1.984, 2.469],
  ['513300', '华夏纳斯达克100ETF(QDII)', 'aggressive', 2.183, 2.749],
  ['159501', '嘉实纳斯达克100ETF(QDII)', 'defensive', 1.673, 2.119],
  ['513870', '富国纳斯达克100ETF(QDII)', 'defensive', 1.681, 2.114],
  ['159660', '汇添富纳斯达克100ETF', 'defensive', 1.932, 2.407],
  ['513110', '华泰柏瑞纳斯达克100ETF(QDII)', 'defensive', 2.026, 2.521],
  ['159659', '招商纳斯达克100ETF(QDII)', 'defensive', 1.903, 2.368]
];

const DEMO_BUY_DATE = '2026-03-01';
const DEMO_BUY_PRICE_DATE = '2026-03-02';
const DEMO_LATEST_PRICE_DATE = '2026-05-29';

function seededRandom(seed = '') {
  let hash = 2166136261;
  for (const ch of String(seed || 'demo')) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return function random() {
    hash += 0x6D2B79F5;
    let t = hash;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function buildTx({ code, name, type = 'BUY', date, price, shares, note }, index) {
  return {
    id: `demo-tx-${code.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${index}`,
    code,
    name,
    kind: 'exchange',
    type,
    date,
    price: round(price, 4),
    shares: round(shares, 4),
    note
  };
}

function makePlan({ id, symbol, name, basePrice, totalBudget, assetType }) {
  const computed = buildFixedDrawdownPlan({ symbol, basePrice, totalBudget, cashReservePct: 30 }, assetType);
  const now = new Date().toISOString();
  return {
    source: 'react-plan',
    version: 2,
    id,
    name,
    symbol,
    totalBudget,
    cashReservePct: 30,
    basePrice,
    riskControlPrice: round(basePrice * 0.85, 2),
    selectedStrategy: 'peak-drawdown',
    isConfigured: true,
    frequency: '每周',
    layerWeights: computed.layerWeights,
    triggerDrops: computed.triggerDrops,
    assetType,
    strategyParams: STRATEGY_PARAMS[assetType],
    screeningAnswers: assetType === 'stock' ? {
      'first-and-unique': true,
      'revenue-growth': true,
      'balance-sheet': true,
      cashflow: true,
      'industry-outlook': true,
      valuation: false
    } : {},
    screeningResult: assetType === 'stock' ? { passed: true, failures: [], message: 'Demo：基本面筛查通过，可创建建仓计划。' } : null,
    investableCapital: round(computed.investableCapital, 2),
    reserveCapital: round(computed.reserveCapital, 2),
    averageCost: round(computed.averageCost, 2),
    createdAt: now,
    updatedAt: now
  };
}

export function generateDemoData({ seed = `demo-${Date.now().toString(36)}` } = {}) {
  const random = seededRandom(seed);
  const now = new Date().toISOString();
  const positions = NASDAQ_ETF_DEMO_POSITIONS;

  const transactions = [];
  const snapshotsByCode = {};
  positions.forEach(([code, name, , basePrice, latest], idx) => {
    const shares = 1000 + Math.floor(random() * 18) * 100;
    transactions.push(buildTx({
      code,
      name,
      date: DEMO_BUY_DATE,
      price: basePrice,
      shares,
      note: `Demo：纳指 ETF 模拟持仓，买入价锚定 ${DEMO_BUY_PRICE_DATE}`
    }, idx + 1));
    snapshotsByCode[code] = {
      code,
      name,
      latestNav: round(latest, 4),
      latestNavDate: DEMO_LATEST_PRICE_DATE,
      previousNav: round(latest * (0.99 + random() * 0.02), 4),
      previousNavDate: '2026-05-28',
      updatedAt: now,
      cacheHit: true,
      cacheSource: 'demo',
      cacheKey: `demo:${code}`,
      error: ''
    };
  });

  const primaryPlan = makePlan({ id: 'demo-plan-513100', symbol: '513100', name: '国泰纳斯达克100ETF · 金字塔 Demo', basePrice: 1.802, totalBudget: 24000, assetType: 'index' });
  const secondaryPlan = makePlan({ id: 'demo-plan-159941', symbol: '159941', name: '广发纳斯达克100ETF · 分批加仓 Demo', basePrice: 1.337, totalBudget: 18000, assetType: 'index' });
  const satellitePlan = makePlan({ id: 'demo-plan-513870', symbol: '513870', name: '富国纳斯达克100ETF · 观察 Demo', basePrice: 1.681, totalBudget: 12000, assetType: 'index' });
  const plans = [primaryPlan, secondaryPlan, satellitePlan];
  const planStore = { source: 'react-plan-store', version: 1, activePlanId: primaryPlan.id, plans };

  const dcaState = {
    source: 'react-dca',
    version: 5,
    symbol: '513100',
    initialInvestment: 0,
    recurringInvestment: 1000,
    frequency: '每月',
    executionDay: 8,
    termMonths: 12,
    targetReturn: 30,
    currentPrice: 2.266,
    rollingHigh: 2.32,
    capitalPool: 2700,
    currentLevel: -1,
    linkedPlanId: primaryPlan.id,
    createdAt: now,
    updatedAt: now
  };
  const dcaComputed = buildDcaProjection(dcaState, { planList: plans });
  Object.assign(dcaState, {
    executionCount: dcaComputed.executionCount,
    totalInvestment: round(dcaComputed.totalInvestment, 2),
    cadenceLabel: dcaComputed.cadenceLabel,
    nextExecutionAmount: round(dcaComputed.nextExecutionAmount, 2),
    linkedPlanFirstInvestment: round(dcaComputed.linkedPlanFirstInvestment, 2),
    smartDcaMode: dcaComputed.smartDcaMode,
    poolBalance: round(dcaComputed.poolBalance, 2),
    dropPct: round(dcaComputed.dropPct, 2)
  });

  const accountAssignments = Object.fromEntries(positions.map(([code, , account]) => [code, account]));
  const workspacePrefs = { ...readWorkspacePrefs(), source: 'react-workspace-prefs', version: 1, homepageTab: 'strategy', updatedAt: now };
  const meta = { source: 'ai-dca-demo-data', version: 1, seed, generatedAt: now, keys: DEMO_KEYS };

  return {
    ledgerState: {
      source: 'react-fund-holdings-ledger',
      version: 2,
      transactions,
      snapshotsByCode,
      lastNavMeta: { status: 'success', updatedAt: now, successCount: positions.length, failureCount: 0, errors: [] },
      migratedFromLegacy: false,
      legacyMigrationAt: '',
      switchChains: []
    },
    planStore,
    activePlan: primaryPlan,
    dcaState,
    accountAssignments,
    watchlist: { us: [], cn: positions.map(([code]) => code) },
    workspacePrefs,
    meta
  };
}

function hasExistingUserData() {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  return [LEDGER_KEY, PLAN_STORE_KEY, DCA_KEY].some((key) => Boolean(window.localStorage.getItem(key)));
}

export function installDemoData(options = {}) {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const hadExistingUserData = hasExistingUserData();
  const demo = generateDemoData(options);
  window.localStorage.setItem(LEDGER_KEY, JSON.stringify(demo.ledgerState));
  window.localStorage.setItem(PLAN_STORE_KEY, JSON.stringify(demo.planStore));
  window.localStorage.setItem(PLAN_KEY, JSON.stringify(demo.activePlan));
  window.localStorage.setItem(DCA_KEY, JSON.stringify(demo.dcaState));
  window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(demo.accountAssignments));
  window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(demo.watchlist));
  window.localStorage.setItem(WORKSPACE_PREFS_KEY, JSON.stringify(demo.workspacePrefs));
  window.localStorage.setItem(DEMO_DATA_MARKER_KEY, JSON.stringify({ ...demo.meta, hadExistingUserData }));
  return demo.meta;
}

export function hasPotentialUserData() {
  return hasExistingUserData() && !hasDemoData();
}
