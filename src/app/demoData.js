import { STRATEGY_PARAMS } from './assetType.js';
import { buildFixedDrawdownPlan } from './newPlan.js';
import { buildDcaProjection, DCA_KEY } from './dca.js';
import { WORKSPACE_PREFS_KEY, readWorkspacePrefs } from './workspacePrefs.js';

export const DEMO_DATA_MARKER_KEY = 'aiDcaDemoDataMeta';

const LEDGER_KEY = 'aiDcaFundHoldingsLedger';
const PLAN_KEY = 'aiDcaPlanState';
const PLAN_STORE_KEY = 'aiDcaPlanStore';
const ACCOUNT_KEY = 'aiDcaAccountAssignments';
const WATCHLIST_KEY = 'markets:watchlist:v1';

const DEMO_KEYS = [
  LEDGER_KEY,
  PLAN_KEY,
  PLAN_STORE_KEY,
  DCA_KEY,
  ACCOUNT_KEY,
  WATCHLIST_KEY,
  WORKSPACE_PREFS_KEY
];

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
  const positions = [
    ['QQQ', 'Invesco QQQ Trust', 'stable', 520, 535],
    ['SPY', 'SPDR S&P 500 ETF', 'stable', 590, 604],
    ['VOO', 'Vanguard S&P 500 ETF', 'stable', 540, 552],
    ['AAPL', 'Apple', 'aggressive', 210, 228],
    ['NVDA', 'NVIDIA', 'aggressive', 112, 129],
    ['TSLA', 'Tesla', 'aggressive', 205, 238],
    ['TSM', 'Taiwan Semiconductor', 'aggressive', 162, 178],
    ['BRK.B', 'Berkshire Hathaway', 'defensive', 430, 448],
    ['KO', 'Coca-Cola', 'defensive', 61, 64],
    ['SCHD', 'Schwab US Dividend Equity ETF', 'defensive', 76, 79]
  ];

  const transactions = [];
  const snapshotsByCode = {};
  positions.forEach(([code, name, , basePrice, latest], idx) => {
    const shares = 4 + Math.floor(random() * 18);
    transactions.push(buildTx({ code, name, date: '2025-10-18', price: basePrice, shares, note: 'Demo：初始建仓' }, idx * 3 + 1));
    transactions.push(buildTx({ code, name, date: '2026-01-16', price: basePrice * (0.88 + random() * 0.07), shares: shares * 0.45, note: 'Demo：回撤加仓' }, idx * 3 + 2));
    if (idx % 3 === 1) {
      transactions.push(buildTx({ code, name, type: 'SELL', date: '2026-04-12', price: latest * 1.06, shares: shares * 0.18, note: 'Demo：做 T 减仓' }, idx * 3 + 3));
    }
    snapshotsByCode[code] = {
      code,
      name,
      latestNav: round(latest, 4),
      latestNavDate: '2026-05-18',
      previousNav: round(latest * (0.99 + random() * 0.02), 4),
      previousNavDate: '2026-05-17',
      updatedAt: now,
      cacheHit: true,
      cacheSource: 'demo',
      cacheKey: `demo:${code}`,
      error: ''
    };
  });

  const qqqPlan = makePlan({ id: 'demo-plan-qqq', symbol: 'QQQ', name: 'QQQ · 宽基金字塔 Demo', basePrice: 560, totalBudget: 24000, assetType: 'index' });
  const aaplPlan = makePlan({ id: 'demo-plan-aapl', symbol: 'AAPL', name: 'AAPL · 个股建仓 Demo', basePrice: 235, totalBudget: 15000, assetType: 'stock' });
  const nvdaPlan = makePlan({ id: 'demo-plan-nvda', symbol: 'NVDA', name: 'NVDA · 高波动个股 Demo', basePrice: 145, totalBudget: 18000, assetType: 'stock' });
  const plans = [qqqPlan, aaplPlan, nvdaPlan];
  const planStore = { source: 'react-plan-store', version: 1, activePlanId: qqqPlan.id, plans };

  const dcaState = {
    source: 'react-dca',
    version: 5,
    symbol: 'QQQ',
    initialInvestment: 0,
    recurringInvestment: 1000,
    frequency: '每月',
    executionDay: 8,
    termMonths: 12,
    targetReturn: 30,
    currentPrice: 535,
    rollingHigh: 560,
    capitalPool: 2700,
    currentLevel: -1,
    linkedPlanId: qqqPlan.id,
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
    activePlan: qqqPlan,
    dcaState,
    accountAssignments,
    watchlist: { us: positions.map(([code]) => code), cn: [] },
    workspacePrefs,
    meta
  };
}

function hasExistingUserData() {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  return [LEDGER_KEY, PLAN_STORE_KEY, DCA_KEY].some((key) => Boolean(window.localStorage.getItem(key)));
}

export function readDemoDataMeta() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEMO_DATA_MARKER_KEY) || 'null');
    return parsed && parsed.source === 'ai-dca-demo-data' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

export function hasDemoData() {
  return Boolean(readDemoDataMeta());
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

export function clearDemoData() {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  const meta = readDemoDataMeta();
  if (!meta) return false;
  for (const key of Array.isArray(meta.keys) ? meta.keys : DEMO_KEYS) {
    window.localStorage.removeItem(key);
  }
  window.localStorage.removeItem(DEMO_DATA_MARKER_KEY);
  return true;
}

export function hasPotentialUserData() {
  return hasExistingUserData() && !hasDemoData();
}
