import { jsonResponse, readOrigin } from './notifyHttp.js';
import { ensureStateBinding, readJson, readSettings, writeJson, writeSettings } from './notifyStorage.js';
import {
  ensureAuthenticatedClient,
  getClientRecord,
  normalizeClientName
} from './clientSettings.js';
import { trackAnalyticsEvent } from './notifyClientRoutes.js';
import {
  fetchFundNavHistoryWithMonthlyKv,
  fetchLatestNavMapWithCache,
  fetchFundMetricPrices
} from './getNav.js';
import {
  getExpectedLatestNavDate,
  getTodayShanghaiDate
} from './holdingsNavSupport.js';
import {
  buildSwitchTriggerNotification,
  computeSwitchSnapshot,
  evaluateSwitchTriggers,
  getRunnableSwitchRules,
  isInTradingSession,
  normalizeSwitchConfig
} from './switchStrategy.js';
import {
  adjustSwitchPaperCash,
  createDefaultSwitchPaperState,
  executeSwitchPaperTrade,
  normalizeSwitchPaperState,
  quantPremiumPaperStateKey
} from './premiumPaperTrading.js';

export const QUANT_PREMIUM_CONFIG_PREFIX = 'quant:premium:config:';
export const QUANT_PREMIUM_STRATEGIES_PREFIX = 'quant:premium:strategies:';
export const QUANT_PREMIUM_BACKTEST_PREFIX = 'quant:premium:backtest:';
const QUANT_PREMIUM_SNAPSHOT_PREFIX = 'quant:premium:snapshot:';
const QUANT_PREMIUM_STATE_PREFIX = 'quant:premium:state:';
const FUND_CODE_PATTERN = /^\d{6}$/;
const MAX_CODES_PER_SIDE = 20;
const DEFAULT_STRATEGY_ID = 'default';
const SUPPORTED_BACKTEST_TF = new Set(['1m', '5m', '15m', '30m', '60m', '1d']);

const DEFAULT_QUANT_PREMIUM_CONFIG = {
  enabled: false,
  name: '纳指 ETF 溢价差',
  highCodes: ['159513'],
  lowCodes: ['513100', '159501'],
  activeSide: 'all',
  intraSellLowerPct: 1,
  intraBuyOtherPct: 3,
  notifyEnabled: true,
  paperEnabled: true,
  liveSignalEnabled: false,
  backtestGate: {
    status: 'none',
    latestRunId: '',
    approvedAt: '',
    approvedFingerprint: '',
    summary: null
  },
  updatedAt: ''
};

function quantPremiumConfigKey(clientId) {
  return `${QUANT_PREMIUM_CONFIG_PREFIX}${String(clientId || '').trim()}`;
}

function quantPremiumStrategiesKey(clientId) {
  return `${QUANT_PREMIUM_STRATEGIES_PREFIX}${String(clientId || '').trim()}`;
}

function scopedClientStrategyKey(prefix, clientId, strategyId = DEFAULT_STRATEGY_ID) {
  const client = String(clientId || '').trim();
  const strategy = normalizeStrategyId(strategyId);
  return strategy === DEFAULT_STRATEGY_ID
    ? `${prefix}${client}`
    : `${prefix}${client}:${strategy}`;
}

function quantPremiumSnapshotKey(clientId, strategyId = DEFAULT_STRATEGY_ID) {
  return scopedClientStrategyKey(QUANT_PREMIUM_SNAPSHOT_PREFIX, clientId, strategyId);
}

function quantPremiumStateKey(clientId, strategyId = DEFAULT_STRATEGY_ID) {
  return scopedClientStrategyKey(QUANT_PREMIUM_STATE_PREFIX, clientId, strategyId);
}

function quantPremiumBacktestKey(clientId, strategyId, runId) {
  return `${QUANT_PREMIUM_BACKTEST_PREFIX}${String(clientId || '').trim()}:${normalizeStrategyId(strategyId)}:${String(runId || '').trim()}`;
}

function sanitizeCode(value = '') {
  const code = String(value || '').trim();
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

function normalizeCodeList(value) {
  const rawList = Array.isArray(value)
    ? value
    : String(value || '').split(/[\s,，、;；|]+/);
  const seen = new Set();
  const list = [];
  for (const raw of rawList) {
    const code = sanitizeCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    list.push(code);
    if (list.length >= MAX_CODES_PER_SIDE) break;
  }
  return list;
}

function pickPercent(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < -50) return -50;
  if (num > 50) return 50;
  return num;
}

function normalizeActiveSide(value = '') {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'H') return 'H';
  if (normalized === 'L') return 'L';
  return 'all';
}

function normalizeStrategyId(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return cleaned || DEFAULT_STRATEGY_ID;
}

function createStrategyId(seed = '') {
  const prefix = normalizeStrategyId(seed).replace(/^default$/, 'strategy') || 'strategy';
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}`;
}

function buildQuantPremiumConfigFingerprint(config = {}) {
  const source = config && typeof config === 'object' ? config : {};
  const highCodes = normalizeCodeList(source.highCodes ?? source.hCodes ?? source.H ?? DEFAULT_QUANT_PREMIUM_CONFIG.highCodes);
  const lowCodes = normalizeCodeList(source.lowCodes ?? source.lCodes ?? source.L ?? DEFAULT_QUANT_PREMIUM_CONFIG.lowCodes)
    .filter((code) => !highCodes.includes(code));
  return JSON.stringify({
    highCodes,
    lowCodes,
    activeSide: normalizeActiveSide(source.activeSide),
    intraSellLowerPct: pickPercent(source.intraSellLowerPct, DEFAULT_QUANT_PREMIUM_CONFIG.intraSellLowerPct),
    intraBuyOtherPct: pickPercent(source.intraBuyOtherPct, DEFAULT_QUANT_PREMIUM_CONFIG.intraBuyOtherPct)
  });
}

function normalizeBacktestGate(input = {}, config = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const status = ['none', 'passed', 'failed', 'stale'].includes(source.status) ? source.status : 'none';
  const approvedAt = String(source.approvedAt || '').trim();
  const approvedFingerprint = String(source.approvedFingerprint || '').trim();
  const currentFingerprint = buildQuantPremiumConfigFingerprint(config);
  const approved = status === 'passed' && approvedAt && approvedFingerprint === currentFingerprint;
  return {
    status,
    latestRunId: String(source.latestRunId || '').trim(),
    approvedAt: approved ? approvedAt : '',
    approvedFingerprint: approved ? approvedFingerprint : '',
    summary: source.summary && typeof source.summary === 'object' ? source.summary : null,
    updatedAt: String(source.updatedAt || '').trim()
  };
}

export function normalizeQuantPremiumConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const highCodes = normalizeCodeList(source.highCodes ?? source.hCodes ?? source.H ?? DEFAULT_QUANT_PREMIUM_CONFIG.highCodes);
  const lowCodes = normalizeCodeList(source.lowCodes ?? source.lCodes ?? source.L ?? DEFAULT_QUANT_PREMIUM_CONFIG.lowCodes)
    .filter((code) => !highCodes.includes(code));
  const base = {
    enabled: Boolean(source.enabled),
    name: String(source.name || DEFAULT_QUANT_PREMIUM_CONFIG.name).trim().slice(0, 60),
    highCodes,
    lowCodes,
    activeSide: normalizeActiveSide(source.activeSide),
    intraSellLowerPct: pickPercent(source.intraSellLowerPct, DEFAULT_QUANT_PREMIUM_CONFIG.intraSellLowerPct),
    intraBuyOtherPct: pickPercent(source.intraBuyOtherPct, DEFAULT_QUANT_PREMIUM_CONFIG.intraBuyOtherPct),
    notifyEnabled: source.notifyEnabled === undefined ? true : Boolean(source.notifyEnabled),
    paperEnabled: source.paperEnabled === undefined ? true : Boolean(source.paperEnabled),
    updatedAt: String(source.updatedAt || '').trim()
  };
  const backtestGate = normalizeBacktestGate(source.backtestGate, base);
  const liveSignalEnabled = Boolean(source.liveSignalEnabled)
    && backtestGate.status === 'passed'
    && Boolean(backtestGate.approvedAt)
    && backtestGate.approvedFingerprint === buildQuantPremiumConfigFingerprint(base);
  return {
    ...base,
    liveSignalEnabled,
    backtestGate
  };
}

export function normalizeQuantPremiumStrategy(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const normalized = normalizeQuantPremiumConfig(source);
  const createdAt = String(source.createdAt || source.updatedAt || new Date().toISOString()).trim();
  return {
    id: normalizeStrategyId(source.id || source.strategyId || DEFAULT_STRATEGY_ID),
    ...normalized,
    createdAt,
    updatedAt: String(source.updatedAt || createdAt).trim()
  };
}

export function buildQuantPremiumSwitchConfig(input = {}) {
  const config = normalizeQuantPremiumConfig(input);
  const allCodes = Array.from(new Set([...config.highCodes, ...config.lowCodes]));
  const premiumClass = {};
  for (const code of config.highCodes) premiumClass[code] = 'H';
  for (const code of config.lowCodes) premiumClass[code] = 'L';
  const benchmarkCodes = config.activeSide === 'H'
    ? config.highCodes
    : config.activeSide === 'L'
      ? config.lowCodes
      : allCodes;
  const enabledCodes = config.activeSide === 'H'
    ? config.lowCodes
    : config.activeSide === 'L'
      ? config.highCodes
      : [];
  return normalizeSwitchConfig({
    enabled: config.enabled,
    activeRuleId: 'quant-premium',
    rules: [{
      id: 'quant-premium',
      name: config.name,
      enabled: true,
      benchmarkCodes,
      enabledCodes,
      premiumClass,
      intraSellLowerPct: config.intraSellLowerPct,
      intraBuyOtherPct: config.intraBuyOtherPct
    }]
  });
}

function collectQuantPremiumCodes(config = {}) {
  const normalized = normalizeQuantPremiumConfig(config);
  return Array.from(new Set([...normalized.highCodes, ...normalized.lowCodes]));
}

function normalizeStrategyList(input = []) {
  const sourceList = Array.isArray(input) ? input : [];
  const seen = new Set();
  const list = [];
  for (const item of sourceList) {
    const normalized = normalizeQuantPremiumStrategy(item);
    if (!normalized.id || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    list.push(normalized);
  }
  return list;
}

async function readQuantPremiumConfigForClient(env, clientId) {
  const strategies = await readQuantPremiumStrategiesForClient(env, clientId);
  return normalizeQuantPremiumConfig(strategies[0] || DEFAULT_QUANT_PREMIUM_CONFIG);
}

async function writeQuantPremiumConfigForClient(env, clientId, config) {
  const existing = await readQuantPremiumStrategiesForClient(env, clientId);
  const currentDefault = existing[0] || normalizeQuantPremiumStrategy(DEFAULT_QUANT_PREMIUM_CONFIG);
  const normalizedStrategy = normalizeQuantPremiumStrategy({
    ...currentDefault,
    ...config,
    id: currentDefault.id || DEFAULT_STRATEGY_ID,
    updatedAt: new Date().toISOString()
  });
  const nextStrategies = [normalizedStrategy, ...existing.filter((item) => item.id !== normalizedStrategy.id)];
  await writeQuantPremiumStrategiesForClient(env, clientId, nextStrategies);
  const normalized = normalizeQuantPremiumConfig(normalizedStrategy);
  await writeJson(env, quantPremiumConfigKey(clientId), normalized);
  return normalized;
}

async function readQuantPremiumStrategiesForClient(env, clientId) {
  const stored = await readJson(env, quantPremiumStrategiesKey(clientId), null);
  const storedList = normalizeStrategyList(stored?.strategies || stored);
  if (storedList.length) return storedList;
  const legacy = await readJson(env, quantPremiumConfigKey(clientId), null);
  return [normalizeQuantPremiumStrategy({
    id: DEFAULT_STRATEGY_ID,
    ...(legacy || DEFAULT_QUANT_PREMIUM_CONFIG)
  })];
}

async function writeQuantPremiumStrategiesForClient(env, clientId, strategies) {
  const normalized = normalizeStrategyList(strategies);
  const payload = {
    version: 1,
    strategies: normalized,
    updatedAt: new Date().toISOString()
  };
  await writeJson(env, quantPremiumStrategiesKey(clientId), payload);
  return normalized;
}

function findStrategy(strategies, strategyId = DEFAULT_STRATEGY_ID) {
  const normalizedId = normalizeStrategyId(strategyId);
  return strategies.find((strategy) => strategy.id === normalizedId) || strategies[0] || normalizeQuantPremiumStrategy(DEFAULT_QUANT_PREMIUM_CONFIG);
}

async function readQuantPremiumStrategyForClient(env, clientId, strategyId = DEFAULT_STRATEGY_ID) {
  return findStrategy(await readQuantPremiumStrategiesForClient(env, clientId), strategyId);
}

function mergeStrategyPatch(current, patch = {}) {
  const now = new Date().toISOString();
  const source = patch && typeof patch === 'object' ? patch : {};
  const beforeFingerprint = buildQuantPremiumConfigFingerprint(current);
  const requestedLive = source.liveSignalEnabled === true || source.approveLiveSignal === true;
  const merged = {
    ...current,
    ...source,
    id: current.id || normalizeStrategyId(source.id || source.strategyId),
    updatedAt: now
  };
  let normalized = normalizeQuantPremiumStrategy(merged);
  const afterFingerprint = buildQuantPremiumConfigFingerprint(normalized);
  let backtestGate = normalized.backtestGate;

  if (beforeFingerprint !== afterFingerprint) {
    backtestGate = {
      ...backtestGate,
      status: backtestGate.status === 'none' ? 'none' : 'stale',
      approvedAt: '',
      approvedFingerprint: '',
      updatedAt: now
    };
  }

  if (requestedLive && backtestGate.status === 'passed') {
    backtestGate = {
      ...backtestGate,
      approvedAt: now,
      approvedFingerprint: afterFingerprint,
      updatedAt: now
    };
  }

  normalized = normalizeQuantPremiumStrategy({
    ...normalized,
    backtestGate,
    liveSignalEnabled: requestedLive || normalized.liveSignalEnabled
  });
  return normalized;
}

async function upsertQuantPremiumStrategyForClient(env, clientId, patch) {
  const strategies = await readQuantPremiumStrategiesForClient(env, clientId);
  const requestedId = normalizeStrategyId(patch?.id || patch?.strategyId || '');
  const creating = !requestedId || !strategies.some((item) => item.id === requestedId);
  const current = creating
    ? normalizeQuantPremiumStrategy({
      ...DEFAULT_QUANT_PREMIUM_CONFIG,
      id: requestedId && requestedId !== DEFAULT_STRATEGY_ID ? requestedId : createStrategyId(patch?.name || 'strategy')
    })
    : findStrategy(strategies, requestedId);
  const nextStrategy = mergeStrategyPatch(current, patch);
  const next = [
    nextStrategy,
    ...strategies.filter((item) => item.id !== nextStrategy.id)
  ];
  const saved = await writeQuantPremiumStrategiesForClient(env, clientId, next);
  return { strategy: findStrategy(saved, nextStrategy.id), strategies: saved };
}

async function deleteQuantPremiumStrategyForClient(env, clientId, strategyId) {
  const normalizedId = normalizeStrategyId(strategyId);
  const strategies = await readQuantPremiumStrategiesForClient(env, clientId);
  if (strategies.length <= 1 || normalizedId === DEFAULT_STRATEGY_ID) {
    return { deleted: false, strategies };
  }
  const next = strategies.filter((item) => item.id !== normalizedId);
  if (next.length === strategies.length) return { deleted: false, strategies };
  const saved = await writeQuantPremiumStrategiesForClient(env, clientId, next);
  return { deleted: true, strategies: saved };
}

async function readQuantPremiumPaperStateForClient(env, clientId, strategyId = DEFAULT_STRATEGY_ID) {
  return normalizeSwitchPaperState(await readJson(env, quantPremiumPaperStateKey(clientId, strategyId), null));
}

async function writeQuantPremiumPaperStateForClient(env, clientId, state, strategyId = DEFAULT_STRATEGY_ID) {
  const normalized = normalizeSwitchPaperState({
    ...state,
    updatedAt: state?.updatedAt || new Date().toISOString()
  });
  await writeJson(env, quantPremiumPaperStateKey(clientId, strategyId), normalized);
  return normalized;
}

async function listQuantPremiumClientIds(env) {
  ensureStateBinding(env);
  const ids = new Set();
  for (const prefix of [QUANT_PREMIUM_STRATEGIES_PREFIX, QUANT_PREMIUM_CONFIG_PREFIX]) {
    let cursor;
    do {
      const result = await env.NOTIFY_STATE.list({ prefix, cursor });
      for (const item of result.keys || []) {
        const clientId = String(item.name || '').slice(prefix.length).split(':')[0];
        if (clientId) ids.add(clientId);
      }
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);
  }
  return Array.from(ids);
}

function stripTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function buildQuantPremiumTriggerNotification(snapshot, trigger, paperResult, env) {
  const payload = buildSwitchTriggerNotification(snapshot, trigger, env);
  const baseUrl = stripTrailingSlash(env?.PUBLIC_DATA_BASE_URL || 'https://tools.freebacktrack.tech');
  const paperText = paperResult?.executed
    ? `模拟盘已成交 ${paperResult.fills.length} 笔`
    : `模拟盘未成交：${paperResult?.skipped || '未满足撮合条件'}`;
  return {
    ...payload,
    ruleId: `quant-premium:${trigger.ruleId || 'default'}:${trigger.fromCode || ''}`,
    strategyName: trigger.ruleName ? `量化溢价差 · ${trigger.ruleName}` : '量化溢价差',
    detailUrl: `${baseUrl}/index.html?tab=quant`,
    title: `量化 ${payload.title || '溢价差信号'}`,
    body: `${payload.body || ''}\n${paperText}`,
    summary: `${payload.summary || '量化溢价差信号'} · ${paperText}`,
    body_md: `${payload.body_md || payload.body || ''}\n\n${paperText}`
  };
}

function roundTo(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** digits;
  return Math.round((num + Number.EPSILON) * factor) / factor;
}

function shanghaiDateFromEpochSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date(n * 1000).toISOString().slice(0, 10);
  }
}

function normalizeBacktestTimeframe(value = '') {
  const tf = String(value || '').trim();
  return SUPPORTED_BACKTEST_TF.has(tf) ? tf : '5m';
}

function normalizeBacktestCandles(input = []) {
  return (Array.isArray(input) ? input : [])
    .map((item) => {
      const t = Number(item?.t ?? item?.timestamp);
      const close = Number(item?.c ?? item?.close);
      if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(close) || close <= 0) return null;
      const open = Number(item?.o ?? item?.open);
      const high = Number(item?.h ?? item?.high);
      const low = Number(item?.l ?? item?.low);
      return {
        t,
        date: shanghaiDateFromEpochSec(t),
        open: Number.isFinite(open) && open > 0 ? open : close,
        high: Number.isFinite(high) && high > 0 ? high : close,
        low: Number.isFinite(low) && low > 0 ? low : close,
        close
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
}

function buildNavLookup(items = []) {
  const sorted = (Array.isArray(items) ? items : [])
    .map((item) => {
      const date = String(item?.date || '').slice(0, 10);
      const nav = Number(item?.nav);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(nav) && nav > 0 ? { date, nav } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
  let cursor = 0;
  let current = null;
  return (date) => {
    while (cursor < sorted.length && sorted[cursor].date <= date) {
      current = sorted[cursor];
      cursor += 1;
    }
    return current?.nav || 0;
  };
}

function buildBacktestRunId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `bt-${globalThis.crypto.randomUUID()}`;
  }
  return `bt-${Date.now().toString(36)}`;
}

export function runQuantPremiumBacktest(strategyInput = {}, { timeframe = '5m', historyByCode = {}, navHistoryByCode = {}, dataIssues = {}, initialEquity = 100000, orderCash = 16000 } = {}) {
  const strategy = normalizeQuantPremiumStrategy(strategyInput);
  const tf = normalizeBacktestTimeframe(timeframe);
  const highCodes = strategy.highCodes;
  const lowCodes = strategy.lowCodes;
  const codes = Array.from(new Set([...highCodes, ...lowCodes]));
  const candleMap = {};
  for (const code of codes) {
    candleMap[code] = normalizeBacktestCandles(historyByCode?.[code]?.candles || historyByCode?.[code] || []);
  }
  const anchorCode = codes.slice().sort((a, b) => (candleMap[b]?.length || 0) - (candleMap[a]?.length || 0))[0] || '';
  const anchorCandles = candleMap[anchorCode] || [];
  const closeByCode = Object.fromEntries(codes.map((code) => [code, new Map((candleMap[code] || []).map((bar) => [bar.t, bar]))]));
  const navLookupByCode = Object.fromEntries(codes.map((code) => [code, buildNavLookup(navHistoryByCode?.[code] || [])]));
  const rows = [];
  const signals = [];
  let completePriceRows = 0;
  let completeNavRows = 0;
  let equity = Math.max(1, Number(initialEquity) || 100000);
  let peak = equity;
  let maxDrawdownPct = 0;
  const premiumClass = Object.fromEntries([
    ...highCodes.map((code) => [code, 'H']),
    ...lowCodes.map((code) => [code, 'L'])
  ]);
  let currentCode = '';
  let entryGapPct = null;

  function pickInitialHolding(highList, lowList) {
    if (strategy.activeSide === 'L') {
      return lowList.reduce((best, item) => (!best || item.premiumPct < best.premiumPct ? item : best), null)
        || highList.reduce((best, item) => (!best || item.premiumPct > best.premiumPct ? item : best), null);
    }
    return highList.reduce((best, item) => (!best || item.premiumPct > best.premiumPct ? item : best), null)
      || lowList.reduce((best, item) => (!best || item.premiumPct < best.premiumPct ? item : best), null);
  }

  for (const anchor of anchorCandles) {
    const premiums = {};
    let hasAllPrices = true;
    let hasAllNav = true;
    for (const code of codes) {
      const bar = closeByCode[code].get(anchor.t);
      if (!bar) {
        hasAllPrices = false;
        continue;
      }
      const nav = navLookupByCode[code](anchor.date);
      if (!(nav > 0)) {
        hasAllNav = false;
        continue;
      }
      premiums[code] = roundTo(((bar.close - nav) / nav) * 100, 4);
    }
    if (hasAllPrices) completePriceRows += 1;
    if (hasAllPrices && hasAllNav) completeNavRows += 1;
    if (!hasAllPrices || !hasAllNav) continue;

    const highList = highCodes.map((code) => ({ code, premiumPct: premiums[code] })).filter((item) => Number.isFinite(item.premiumPct));
    const lowList = lowCodes.map((code) => ({ code, premiumPct: premiums[code] })).filter((item) => Number.isFinite(item.premiumPct));
    if (!currentCode || !Number.isFinite(premiums[currentCode])) {
      const initial = pickInitialHolding(highList, lowList);
      currentCode = initial?.code || '';
      entryGapPct = null;
    }

    const currentClass = premiumClass[currentCode] || '';
    const currentPremiumPct = premiums[currentCode];
    let from = currentCode && Number.isFinite(currentPremiumPct)
      ? { code: currentCode, premiumPct: currentPremiumPct }
      : null;
    let to = null;
    let gapPct = NaN;
    let rule = 'none';
    let threshold = NaN;
    if (from && currentClass === 'H') {
      to = lowList.reduce((best, item) => (!best || item.premiumPct < best.premiumPct ? item : best), null);
      if (to) {
        gapPct = roundTo(from.premiumPct - to.premiumPct, 4);
        rule = 'B';
        threshold = strategy.intraBuyOtherPct;
      }
    } else if (from && currentClass === 'L') {
      to = highList.reduce((best, item) => (!best || item.premiumPct > best.premiumPct ? item : best), null);
      if (to) {
        gapPct = roundTo(to.premiumPct - from.premiumPct, 4);
        rule = 'A';
        threshold = strategy.intraSellLowerPct;
      }
    }
    if (!from || !to || !Number.isFinite(gapPct)) continue;

    const sideAllowed = strategy.activeSide === 'all' || strategy.activeSide === currentClass;
    const triggered = sideAllowed && (
      (rule === 'B' && gapPct > strategy.intraBuyOtherPct)
      || (rule === 'A' && gapPct < strategy.intraSellLowerPct)
    );
    let profit = 0;
    if (triggered) {
      if (rule === 'A' && Number.isFinite(entryGapPct)) {
        profit = roundTo(Math.max(0, Number(orderCash) || 16000) * Math.max(0, entryGapPct - gapPct) / 100, 2);
      }
      equity = roundTo(equity + profit, 2);
      signals.push({
        ts: anchor.t,
        date: anchor.date,
        fromCode: from.code,
        toCode: to.code,
        rule,
        threshold,
        gapPct,
        entryGapPct: Number.isFinite(entryGapPct) ? entryGapPct : null,
        profit
      });
      if (rule === 'B') {
        entryGapPct = gapPct;
      } else if (rule === 'A') {
        entryGapPct = null;
      }
      currentCode = to.code;
    }
    peak = Math.max(peak, equity);
    const drawdownPct = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
    maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);
    rows.push({
      ts: anchor.t,
      date: anchor.date,
      fromCode: from.code,
      toCode: to.code,
      currentCode: from.code,
      currentClass,
      highPremiumPct: currentClass === 'H' ? from.premiumPct : to.premiumPct,
      lowPremiumPct: currentClass === 'H' ? to.premiumPct : from.premiumPct,
      gapPct,
      rule,
      threshold,
      signal: triggered ? 'switch' : 'wait',
      profit,
      equity: roundTo(equity, 2)
    });
  }

  const sampleCount = rows.length;
  const priceCoveragePct = anchorCandles.length ? roundTo((completePriceRows / anchorCandles.length) * 100, 2) : 0;
  const navCoveragePct = completePriceRows ? roundTo((completeNavRows / completePriceRows) * 100, 2) : 0;
  const dataCoveragePct = anchorCandles.length ? roundTo((sampleCount / anchorCandles.length) * 100, 2) : 0;
  const totalProfit = roundTo(equity - Math.max(1, Number(initialEquity) || 100000), 2);
  const passed = sampleCount >= 10 && priceCoveragePct >= 60 && navCoveragePct >= 60;
  const klineIssues = Array.isArray(dataIssues?.kline) ? dataIssues.kline : [];
  const missingKlineCodes = klineIssues.map((item) => String(item?.code || '').trim()).filter(Boolean);
  const qualityReason = passed
    ? '数据覆盖率满足回测门槛'
    : missingKlineCodes.length
      ? `缺少 ${missingKlineCodes.join('、')} 的 ${tf} 历史 K 线，已按回测失败处理`
      : '样本或 NAV/价格覆盖率不足';
  const chartCandles = anchorCandles.map((bar) => ({
    t: bar.t,
    date: bar.date,
    o: roundTo(bar.open, 4),
    h: roundTo(bar.high, 4),
    l: roundTo(bar.low, 4),
    c: roundTo(bar.close, 4)
  }));
  const chartTs = new Set(chartCandles.map((bar) => bar.t));
  const chartMarkers = signals
    .filter((signal) => chartTs.has(signal.ts))
    .map((signal) => {
      const bar = closeByCode[anchorCode]?.get(signal.ts);
      const isSell = signal.fromCode === anchorCode;
      const isBuy = signal.toCode === anchorCode;
      const side = isSell ? 'sell' : isBuy ? 'buy' : 'signal';
      const markerPrice = side === 'sell'
        ? Number(bar?.high ?? bar?.close)
        : side === 'buy'
          ? Number(bar?.low ?? bar?.close)
          : Number(bar?.close);
      return {
        ts: signal.ts,
        date: signal.date,
        side,
        price: roundTo(Number.isFinite(markerPrice) && markerPrice > 0 ? markerPrice : bar?.close, 4),
        fromCode: signal.fromCode,
        toCode: signal.toCode,
        gapPct: signal.gapPct,
        label: side === 'sell'
          ? `卖 ${signal.fromCode} → 买 ${signal.toCode}`
          : side === 'buy'
            ? `卖 ${signal.fromCode} → 买 ${signal.toCode}`
            : `${signal.fromCode} → ${signal.toCode}`
      };
    });
  return {
    ok: true,
    status: passed ? 'passed' : 'failed',
    timeframe: tf,
    strategyId: strategy.id,
    strategyName: strategy.name,
    generatedAt: new Date().toISOString(),
    rows: rows.slice(-500),
    signals: signals.slice(-120),
    chart: {
      code: anchorCode,
      timeframe: tf,
      candles: chartCandles,
      markers: chartMarkers
    },
    summary: {
      sampleCount,
      signalCount: signals.length,
      totalProfit,
      totalReturnPct: roundTo((totalProfit / Math.max(1, Number(initialEquity) || 100000)) * 100, 2),
      maxDrawdownPct: roundTo(maxDrawdownPct, 2),
      finalEquity: roundTo(equity, 2),
      priceCoveragePct,
      navCoveragePct,
      dataCoveragePct,
      from: rows[0]?.date || '',
      to: rows[rows.length - 1]?.date || ''
    },
    quality: {
      passed,
      reason: qualityReason,
      anchorCode,
      anchorBars: anchorCandles.length,
      missingKlineCodes,
      klineIssues,
      supportedTimeframes: Array.from(SUPPORTED_BACKTEST_TF)
    }
  };
}

async function fetchMarketsJsonForQuantBacktest(env, path) {
  const baseUrl = stripTrailingSlash(env?.PUBLIC_DATA_BASE_URL || 'https://tools.freebacktrack.tech');
  const publicUrl = `${baseUrl}/api/markets${path}`;
  const request = new Request(`https://tools.freebacktrack.tech/api/markets${path}`, {
    headers: { accept: 'application/json' }
  });
  const response = env?.MARKETS && typeof env.MARKETS.fetch === 'function'
    ? await env.MARKETS.fetch(request)
    : await fetch(publicUrl, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text.slice(0, 200) };
    }
  }
  if (!response.ok) {
    const message = payload?.error || payload?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload || {};
}

async function fetchQuantBacktestKline(env, code, timeframe) {
  const payload = await fetchMarketsJsonForQuantBacktest(env, `/kline/${encodeURIComponent(code)}?tf=${encodeURIComponent(timeframe)}&limit=1000&session=all&refresh=1`);
  return Array.isArray(payload?.candles) ? payload.candles : [];
}

function shiftIsoDate(date, days) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : getTodayShanghaiDate();
  const parsed = Date.parse(`${base}T00:00:00Z`);
  const next = new Date(parsed + days * 86400 * 1000);
  return next.toISOString().slice(0, 10);
}

async function runQuantPremiumBacktestWithLiveData(env, strategy, options = {}) {
  const timeframe = normalizeBacktestTimeframe(options.timeframe || '5m');
  const codes = collectQuantPremiumCodes(strategy);
  const historyByCode = {};
  const klineIssues = [];
  for (const code of codes) {
    try {
      const candles = await fetchQuantBacktestKline(env, code, timeframe);
      historyByCode[code] = candles;
      if (!candles.length) {
        klineIssues.push({ code, timeframe, reason: 'no candles returned' });
      }
    } catch (error) {
      historyByCode[code] = [];
      klineIssues.push({
        code,
        timeframe,
        reason: error instanceof Error ? error.message : String(error || 'K 线请求失败')
      });
    }
  }
  const dates = Object.values(historyByCode)
    .flat()
    .map((bar) => shanghaiDateFromEpochSec(Number(bar?.t)))
    .filter(Boolean)
    .sort();
  const toDate = dates[dates.length - 1] || getTodayShanghaiDate();
  const fromDate = dates[0] || shiftIsoDate(toDate, -30);
  const navHistoryByCode = {};
  for (const code of codes) {
    try {
      const payload = await fetchFundNavHistoryWithMonthlyKv(code, fromDate, toDate, env, {
        today: getTodayShanghaiDate(),
        ttlMs: 24 * 60 * 60 * 1000
      });
      navHistoryByCode[code] = payload.items || [];
    } catch {
      navHistoryByCode[code] = [];
    }
  }
  return runQuantPremiumBacktest(strategy, {
    timeframe,
    historyByCode,
    navHistoryByCode,
    dataIssues: { kline: klineIssues },
    initialEquity: options.initialEquity,
    orderCash: options.orderCash
  });
}

async function runQuantPremiumForOneClient(env, clientId, config, { reason = 'quant-premium', strategyId = DEFAULT_STRATEGY_ID, priceMap = null, navByCode = null, computedAt = '', runClientDetection } = {}) {
  const normalizedConfig = normalizeQuantPremiumConfig(config);
  const switchConfig = buildQuantPremiumSwitchConfig(normalizedConfig);
  const runnableRules = getRunnableSwitchRules(switchConfig);
  if (!runnableRules.length) {
    return { strategyId, triggered: 0, pushed: 0, paperExecuted: 0, paperOrders: 0, skipped: 'no-runnable-rule' };
  }

  const codes = collectQuantPremiumCodes(normalizedConfig);
  const effectivePriceMap = priceMap || await fetchFundMetricPrices(codes, env).catch(() => ({}));
  const effectiveNavMap = navByCode || await fetchLatestNavMapWithCache(env, codes, [], {
    forceRefresh: false,
    todayDate: getTodayShanghaiDate(),
    readCache: async (key, fallback) => readJson(env, key, fallback),
    writeCache: async (key, value) => writeJson(env, key, value),
    getExpectedLatestNavDate
  });

  const computedAtIso = computedAt || new Date().toISOString();
  const prevState = (await readJson(env, quantPremiumStateKey(clientId, strategyId), null)) || {};
  const prevStatesByRule = (prevState && typeof prevState.triggerStatesByRule === 'object' && prevState.triggerStatesByRule)
    ? prevState.triggerStatesByRule
    : {};
  const nextTriggerStatesByRule = {};
  const snapshots = [];
  const triggerJobs = [];
  for (const rule of runnableRules) {
    const ruleConfig = {
      ...rule,
      ruleId: rule.id,
      ruleName: rule.name,
      enabled: rule.enabled
    };
    const snapshot = computeSwitchSnapshot(ruleConfig, effectivePriceMap, effectiveNavMap, computedAtIso);
    const prevRuleStates = prevStatesByRule[rule.id] || {};
    const { triggers, nextTriggerStates } = evaluateSwitchTriggers(snapshot, prevRuleStates);
    const taggedTriggers = triggers.map((trigger) => ({
      ...trigger,
      ruleId: rule.id,
      ruleName: rule.name,
      pairKey: `${rule.id}:${trigger.pairKey}`
    }));
    snapshot.triggers = taggedTriggers;
    snapshots.push(snapshot);
    nextTriggerStatesByRule[rule.id] = nextTriggerStates;
    for (const trigger of taggedTriggers) {
      triggerJobs.push({ snapshot, trigger });
    }
  }

  const snapshotToStore = snapshots[0] || { computedAt: computedAtIso, ready: false, triggers: [] };
  await writeJson(env, quantPremiumSnapshotKey(clientId, strategyId), snapshotToStore);
  await writeJson(env, quantPremiumStateKey(clientId, strategyId), {
    triggerStates: snapshots[0] ? nextTriggerStatesByRule[snapshots[0].ruleId] : {},
    triggerStatesByRule: nextTriggerStatesByRule,
    updatedAt: computedAtIso
  });

  let settings = await readSettings(env);
  const clientRecord = getClientRecord(settings, clientId);
  let pushedCount = 0;
  let paperExecutedCount = 0;
  let paperOrderCount = 0;
  let paperSkippedCount = 0;
  const paperResults = [];

  for (const { snapshot, trigger } of triggerJobs) {
    let paperResult = { executed: false, fills: [], skipped: 'paper-disabled' };
    if (normalizedConfig.paperEnabled) {
      const paperState = await readQuantPremiumPaperStateForClient(env, clientId, strategyId);
      paperResult = executeSwitchPaperTrade(paperState, snapshot, trigger, computedAtIso);
      if (paperResult.executed || paperResult.skipped) {
        await writeQuantPremiumPaperStateForClient(env, clientId, paperResult.state, strategyId);
      }
      if (paperResult.executed) {
        paperExecutedCount += 1;
        paperOrderCount += paperResult.fills.length;
      } else {
        paperSkippedCount += 1;
      }
    } else {
      paperSkippedCount += 1;
    }
    paperResults.push({
      trigger: trigger.pairKey,
      executed: paperResult.executed,
      orders: paperResult.fills.length,
      skipped: paperResult.skipped || ''
    });

    if (normalizedConfig.notifyEnabled && normalizedConfig.liveSignalEnabled && clientRecord?.clientId && typeof runClientDetection === 'function') {
      const testPayload = buildQuantPremiumTriggerNotification(snapshot, trigger, paperResult, env);
      try {
        const result = await runClientDetection(env, settings, clientRecord, {
          reason,
          testPayload
        });
        settings = result.settings;
        pushedCount += 1;
      } catch {
        // 单条通知失败不影响模拟盘状态。
      }
    }
  }

  if (pushedCount) {
    await writeSettings(env, settings);
  }

  return {
    strategyId,
    triggered: triggerJobs.length,
    pushed: pushedCount,
    paperExecuted: paperExecutedCount,
    paperOrders: paperOrderCount,
    paperSkipped: paperSkippedCount,
    paperResults,
    ready: snapshots.some((snapshot) => snapshot.ready)
  };
}

export async function handleQuantPremiumConfigGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await readQuantPremiumConfigForClient(env, auth.clientId);
  return jsonResponse({ ok: true, clientId: auth.clientId, config }, { origin });
}

export async function handleQuantPremiumStrategiesGet(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const strategies = await readQuantPremiumStrategiesForClient(env, auth.clientId);
  return jsonResponse({ ok: true, clientId: auth.clientId, strategies }, { origin });
}

export async function handleQuantPremiumStrategiesPost(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '')
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const { strategy, strategies } = await upsertQuantPremiumStrategyForClient(env, auth.clientId, payload?.strategy || payload);
  return jsonResponse({ ok: true, clientId: auth.clientId, strategy, strategies }, { origin });
}

export async function handleQuantPremiumStrategyPost(request, env, strategyId) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '')
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const { strategy, strategies } = await upsertQuantPremiumStrategyForClient(env, auth.clientId, {
    ...(payload?.strategy && typeof payload.strategy === 'object' ? payload.strategy : payload),
    id: strategyId
  });
  return jsonResponse({ ok: true, clientId: auth.clientId, strategy, strategies }, { origin });
}

export async function handleQuantPremiumStrategyDelete(request, env, strategyId) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const result = await deleteQuantPremiumStrategyForClient(env, auth.clientId, strategyId);
  return jsonResponse({ ok: true, clientId: auth.clientId, ...result }, { origin });
}

async function storeQuantPremiumBacktestResult(env, clientId, strategy, result) {
  const runId = result.runId || buildBacktestRunId();
  const stored = {
    ...result,
    runId,
    strategyId: strategy.id,
    strategyName: strategy.name,
    generatedAt: result.generatedAt || new Date().toISOString()
  };
  await writeJson(env, quantPremiumBacktestKey(clientId, strategy.id, runId), stored);
  const strategies = await readQuantPremiumStrategiesForClient(env, clientId);
  const next = strategies.map((item) => {
    if (item.id !== strategy.id) return item;
    return normalizeQuantPremiumStrategy({
      ...item,
      liveSignalEnabled: false,
      backtestGate: {
        status: stored.status === 'passed' ? 'passed' : 'failed',
        latestRunId: runId,
        approvedAt: '',
        approvedFingerprint: '',
        summary: stored.summary,
        updatedAt: stored.generatedAt
      },
      updatedAt: stored.generatedAt
    });
  });
  await writeQuantPremiumStrategiesForClient(env, clientId, next);
  return stored;
}

export async function handleQuantPremiumBacktestPost(request, env, strategyId) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '')
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const strategy = await readQuantPremiumStrategyForClient(env, auth.clientId, strategyId);
  const result = await runQuantPremiumBacktestWithLiveData(env, strategy, {
    timeframe: payload?.timeframe || payload?.tf || '5m',
    initialEquity: payload?.initialEquity,
    orderCash: payload?.orderCash
  });
  const stored = await storeQuantPremiumBacktestResult(env, auth.clientId, strategy, result);
  await trackAnalyticsEvent(env, 'quant_premium_backtest_run', {
    clientId: auth.clientId,
    strategyId: strategy.id,
    timeframe: stored.timeframe,
    status: stored.status,
    sampleCount: stored.summary?.sampleCount || 0,
    signalCount: stored.summary?.signalCount || 0
  });
  return jsonResponse({ ok: true, clientId: auth.clientId, strategyId: strategy.id, result: stored }, { origin });
}

export async function handleQuantPremiumBacktestLatestGet(request, env, strategyId) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const strategy = await readQuantPremiumStrategyForClient(env, auth.clientId, strategyId);
  const runId = strategy.backtestGate?.latestRunId || '';
  const result = runId ? await readJson(env, quantPremiumBacktestKey(auth.clientId, strategy.id, runId), null) : null;
  return jsonResponse({ ok: true, clientId: auth.clientId, strategyId: strategy.id, result, gate: strategy.backtestGate }, { origin });
}

export async function handleQuantPremiumConfigPost(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '')
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await writeQuantPremiumConfigForClient(env, auth.clientId, payload?.config || payload);
  return jsonResponse({ ok: true, clientId: auth.clientId, config }, { origin });
}

export async function handleQuantPremiumSnapshotGet(request, env) {
  const origin = readOrigin(request);
  const url = new URL(request.url);
  const strategyId = normalizeStrategyId(url.searchParams.get('strategyId') || DEFAULT_STRATEGY_ID);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const [config, snapshot] = await Promise.all([
    readQuantPremiumStrategyForClient(env, auth.clientId, strategyId),
    readJson(env, quantPremiumSnapshotKey(auth.clientId, strategyId), null)
  ]);
  return jsonResponse({ ok: true, clientId: auth.clientId, strategyId: config.id || strategyId, config, snapshot }, { origin });
}

export async function handleQuantPremiumPaperGet(request, env) {
  const origin = readOrigin(request);
  const url = new URL(request.url);
  const strategyId = normalizeStrategyId(url.searchParams.get('strategyId') || DEFAULT_STRATEGY_ID);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const state = await readQuantPremiumPaperStateForClient(env, auth.clientId, strategyId);
  return jsonResponse({ ok: true, clientId: auth.clientId, strategyId, state }, { origin });
}

export async function handleQuantPremiumPaperPost(request, env) {
  const origin = readOrigin(request);
  const url = new URL(request.url);
  const strategyId = normalizeStrategyId(url.searchParams.get('strategyId') || DEFAULT_STRATEGY_ID);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: normalizeClientName(payload?.clientLabel || payload?.notifyClientLabel || '')
  });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const current = await readQuantPremiumPaperStateForClient(env, auth.clientId, strategyId);
  let nextState;
  let cashEvent = null;
  if (payload?.reset) {
    nextState = createDefaultSwitchPaperState(payload?.state || {});
  } else if (payload?.adjustment || payload?.cashDelta !== undefined) {
    const adjustment = payload.adjustment && typeof payload.adjustment === 'object' ? payload.adjustment : {};
    const amount = Number(adjustment.amount ?? payload.cashDelta) || 0;
    const result = adjustSwitchPaperCash(current, {
      amount,
      note: adjustment.note || payload.note || '',
      timestamp: new Date().toISOString()
    });
    nextState = result.state;
    cashEvent = result.event;
  } else {
    nextState = normalizeSwitchPaperState({
      ...current,
      ...(payload?.state && typeof payload.state === 'object' ? payload.state : payload)
    });
  }
  const state = await writeQuantPremiumPaperStateForClient(env, auth.clientId, nextState, strategyId);
  return jsonResponse({ ok: true, clientId: auth.clientId, strategyId, state, cashEvent }, { origin });
}

export async function handleQuantPremiumRunPost(request, env, { runClientDetection }) {
  const origin = readOrigin(request);
  const url = new URL(request.url);
  const strategyId = normalizeStrategyId(url.searchParams.get('strategyId') || DEFAULT_STRATEGY_ID);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const config = await readQuantPremiumStrategyForClient(env, auth.clientId, strategyId);
  const switchConfig = buildQuantPremiumSwitchConfig(config);
  if (!getRunnableSwitchRules(switchConfig).length) {
    return jsonResponse({
      ok: false,
      error: '当前没有可计算的量化 H/L 配置：请至少设置一只 H 和一只 L，并启用策略。'
    }, { status: 400, origin });
  }
  const summary = await runQuantPremiumForOneClient(env, auth.clientId, config, {
    strategyId: config.id || strategyId,
    reason: 'quant-premium-manual-run',
    runClientDetection
  });
  await trackAnalyticsEvent(env, 'quant_premium_worker_run', { clientId: auth.clientId, strategyId: config.id || strategyId, reason: 'manual', triggered: summary?.triggered || 0, skipped: summary?.skipped || '' });
  const snapshot = await readJson(env, quantPremiumSnapshotKey(auth.clientId, config.id || strategyId), null);
  return jsonResponse({ ok: true, strategyId: config.id || strategyId, summary, snapshot }, { origin });
}

export async function runQuantPremiumTick(env, scheduledMs, { reason = 'quant-premium-cron', runClientDetection } = {}) {
  const scheduledIso = new Date(scheduledMs).toISOString();
  console.log('[notify] runQuantPremiumTick enter', JSON.stringify({ reason, scheduledMs, scheduledIso }));
  if (!isInTradingSession(new Date(scheduledMs))) {
    console.log('[notify] runQuantPremiumTick skip: outside trading session', JSON.stringify({ reason, scheduledIso }));
    return;
  }
  const clientIds = await listQuantPremiumClientIds(env);
  if (!clientIds.length) {
    console.log('[notify] runQuantPremiumTick skip: no quant premium clients', JSON.stringify({ reason }));
    return;
  }

  const enabledList = [];
  for (const clientId of clientIds) {
    const strategies = await readQuantPremiumStrategiesForClient(env, clientId);
    for (const strategy of strategies) {
      const switchConfig = buildQuantPremiumSwitchConfig(strategy);
      if (getRunnableSwitchRules(switchConfig).length) {
        enabledList.push({ clientId, strategyId: strategy.id, config: strategy });
      }
    }
  }
  if (!enabledList.length) return;

  const allCodes = new Set();
  for (const { config } of enabledList) {
    for (const code of collectQuantPremiumCodes(config)) allCodes.add(code);
  }
  const codeList = Array.from(allCodes);
  const [priceMap, navByCode] = await Promise.all([
    fetchFundMetricPrices(codeList, env).catch(() => ({})),
    fetchLatestNavMapWithCache(env, codeList, [], {
      forceRefresh: false,
      todayDate: getTodayShanghaiDate(),
      readCache: async (key, fallback) => readJson(env, key, fallback),
      writeCache: async (key, value) => writeJson(env, key, value),
      getExpectedLatestNavDate
    })
  ]);
  const computedAt = new Date(scheduledMs).toISOString();
  for (const { clientId, strategyId, config } of enabledList) {
    try {
      const summary = await runQuantPremiumForOneClient(env, clientId, config, {
        strategyId,
        reason,
        priceMap,
        navByCode,
        computedAt,
        runClientDetection
      });
      await trackAnalyticsEvent(env, 'quant_premium_worker_run', { clientId, strategyId, reason, triggered: summary?.triggered || 0, skipped: summary?.skipped || '' });
    } catch {
      // 单个 client 失败不阻断整轮。
    }
  }
}
