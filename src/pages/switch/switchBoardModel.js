// 基金切换看板的纯数据派生层。
//
// 输入：`normalizeSwitchConfigShape()` 产出的 config + `/api/notify/switch/snapshot` 返回的快照。
// 输出：看板卡片视图与 PC 表格视图可以直接渲染的行数据。
//
// 约定：本文件不引用 React / DOM / localStorage，保证可以被 `node --test` 直接覆盖。

import { pickSwitchSnapshotForRule } from '../switchStrategyViewUtils.js';

export const SWITCH_CHANNEL_DEFS = [
  { key: 'ios', label: 'iOS', shortLabel: 'iOS', hint: 'Bark 系统推送' },
  { key: 'serverchan3', label: 'Android', shortLabel: '安卓', hint: 'Server酱³ 系统推送' },
  { key: 'pc', label: 'PC', shortLabel: 'PC', hint: '浏览器桌面通知' },
  { key: 'email', label: 'Email', shortLabel: '邮件', hint: '邮件提醒' }
];

export const SWITCH_CHANNEL_KEYS = SWITCH_CHANNEL_DEFS.map((item) => item.key);

// Worker 的基准行情和候选行情字段名不同，这里统一映射成同一种 quote 结构。
const PRICE_FIELDS = ['price', 'benchmarkPrice', 'intraPrice', 'lastPrice', 'last', 'close', 'current'];
const PREMIUM_FIELDS = ['premiumRatePct', 'premiumPct', 'benchmarkPremiumPct', 'premiumRate', 'premium'];
const CHANGE_FIELDS = ['changePct', 'benchmarkChangePct', 'changeRatePct', 'pctChange'];
const HIT_FIELDS = ['hitCount', 'triggerCount', 'todayTriggerCount', 'firedCount'];

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pickNumberField(source, fields) {
  if (!source || typeof source !== 'object') return null;
  for (const field of fields) {
    const value = toFiniteNumber(source[field]);
    if (value != null) return value;
  }
  return null;
}

function normalizeClass(value) {
  const upper = String(value || '').trim().toUpperCase();
  return upper === 'H' || upper === 'L' ? upper : '';
}

function normalizeCode(value) {
  return String(value || '').trim();
}

function uniqueCodes(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(normalizeCode).filter(Boolean)));
}

function configuredRuleCodes(rule = {}) {
  return uniqueCodes([
    ...(Array.isArray(rule.benchmarkCodes) ? rule.benchmarkCodes : []),
    ...(Array.isArray(rule.enabledCodes) ? rule.enabledCodes : []),
    ...Object.keys(rule.premiumClass && typeof rule.premiumClass === 'object' ? rule.premiumClass : {})
  ]);
}

function mergeQuote(previous, next) {
  if (!previous) return next;
  return {
    ...previous,
    ...next,
    name: next.name || previous.name,
    price: next.price ?? previous.price,
    premiumPct: next.premiumPct ?? previous.premiumPct,
    changePct: next.changePct ?? previous.changePct
  };
}

function buildRuleQuoteMap(rule = {}, ruleSnapshot = null) {
  const premiumClass = rule.premiumClass && typeof rule.premiumClass === 'object' ? rule.premiumClass : {};
  const quoteMap = new Map();
  for (const group of Array.isArray(ruleSnapshot?.byBenchmark) ? ruleSnapshot.byBenchmark : []) {
    const benchmarkCode = normalizeCode(group?.benchmarkCode);
    if (benchmarkCode) {
      const side = normalizeClass(premiumClass[benchmarkCode]) || normalizeClass(group?.benchmarkClass);
      const quote = buildQuote(side, benchmarkCode, {
        name: group?.benchmarkName,
        price: group?.benchmarkPrice ?? group?.price,
        premiumPct: group?.benchmarkPremiumPct ?? group?.premiumRatePct ?? group?.premiumPct,
        changePct: group?.benchmarkChangePct ?? group?.changePct
      }, '');
      quoteMap.set(benchmarkCode, mergeQuote(quoteMap.get(benchmarkCode), quote));
    }
    for (const candidate of Array.isArray(group?.candidates) ? group.candidates : []) {
      const code = normalizeCode(candidate?.code);
      if (!code) continue;
      const side = normalizeClass(premiumClass[code]) || normalizeClass(candidate?.candClass);
      const quote = buildQuote(side, code, candidate, '');
      quoteMap.set(code, mergeQuote(quoteMap.get(code), quote));
    }
  }
  return quoteMap;
}

function inferHoldingSide(rule = {}) {
  const premiumClass = rule.premiumClass && typeof rule.premiumClass === 'object' ? rule.premiumClass : {};
  const classes = uniqueCodes(rule.benchmarkCodes).map((code) => normalizeClass(premiumClass[code])).filter(Boolean);
  const uniqueClasses = new Set(classes);
  if (uniqueClasses.size > 1) return 'BOTH';
  if (uniqueClasses.has('L')) return 'L';
  return 'H';
}

/** 只保留受支持的渠道 key；传入空集合时按「未指定 = 全部渠道」处理。 */
export function sanitizeSwitchChannelKeys(values) {
  const list = Array.isArray(values) ? values.map((item) => String(item || '').trim()) : [];
  const picked = SWITCH_CHANNEL_KEYS.filter((key) => list.includes(key));
  return picked.length ? picked : SWITCH_CHANNEL_KEYS.slice();
}

/** 快照既可能是 `{ snapshot }` 包装体，也可能是裸快照，两种都要兼容。 */
export function resolveSnapshotRoot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return snapshot.snapshot && typeof snapshot.snapshot === 'object' ? snapshot.snapshot : snapshot;
}

/**
 * Worker 的 `spreadVsBenchmarkPct` = 基准溢价 − 候选溢价。
 * 基准在 H 组时它已经是 H−L；基准在 L 组时需要取反，统一成 H−L 口径。
 */
export function resolveSpreadPct(benchmarkClass, spreadVsBenchmarkPct) {
  const raw = toFiniteNumber(spreadVsBenchmarkPct);
  if (raw == null) return null;
  return normalizeClass(benchmarkClass) === 'H' ? raw : -raw;
}

/** 在规则与单个基准快照中定位一组 H / L 双腿。 */
export function resolveRulePair(rule = {}, group = null) {
  const premiumClass = rule && typeof rule.premiumClass === 'object' && rule.premiumClass ? rule.premiumClass : {};
  const benchmarkCodes = Array.isArray(rule.benchmarkCodes) ? rule.benchmarkCodes : [];
  const benchmarkCode = normalizeCode(group?.benchmarkCode || benchmarkCodes[0]);
  const benchmarkClass = normalizeClass(premiumClass[benchmarkCode]) || normalizeClass(group?.benchmarkClass) || 'L';
  const oppositeClass = benchmarkClass === 'H' ? 'L' : 'H';
  const candidates = Array.isArray(group?.candidates) ? group.candidates : [];
  const counterpart = candidates
    .filter((item) => item && item.valid !== false && (normalizeClass(premiumClass[normalizeCode(item.code)]) || normalizeClass(item?.candClass)) === oppositeClass)
    .sort((a, b) => Math.abs(toFiniteNumber(b?.spreadVsBenchmarkPct) ?? 0) - Math.abs(toFiniteNumber(a?.spreadVsBenchmarkPct) ?? 0))[0] || null;
  const fallbackCode = normalizeCode(
    configuredRuleCodes(rule).find((code) => code !== benchmarkCode && normalizeClass(premiumClass[code]) === oppositeClass)
  );
  const counterpartCode = normalizeCode(counterpart?.code) || fallbackCode;
  return {
    benchmarkCode,
    benchmarkClass,
    counterpart,
    counterpartCode,
    highCode: benchmarkClass === 'H' ? benchmarkCode : counterpartCode,
    lowCode: benchmarkClass === 'L' ? benchmarkCode : counterpartCode
  };
}

/**
 * 计算利差标尺的几何数据。
 * 轨道左端 = L→H 切回阈值，右端 = H→L 切出阈值。
 */
export function buildSpreadGauge({ spreadPct, lowerPct, upperPct } = {}) {
  const lower = toFiniteNumber(lowerPct) ?? 0;
  const upperRaw = toFiniteNumber(upperPct);
  const upper = upperRaw == null || upperRaw <= lower ? lower + 1 : upperRaw;
  const span = upper - lower;
  const spread = toFiniteNumber(spreadPct);
  const ratio = spread == null ? null : Math.max(0, Math.min(1, (spread - lower) / span));

  let direction = '';
  let distancePct = null;
  let triggered = false;
  if (spread != null) {
    const toUpper = upper - spread;
    const toLower = spread - lower;
    if (toUpper <= 0) {
      direction = 'H_TO_L';
      distancePct = 0;
      triggered = true;
    } else if (toLower <= 0) {
      direction = 'L_TO_H';
      distancePct = 0;
      triggered = true;
    } else if (toUpper <= toLower) {
      direction = 'H_TO_L';
      distancePct = toUpper;
    } else {
      direction = 'L_TO_H';
      distancePct = toLower;
    }
  }

  return {
    lowerPct: lower,
    upperPct: upper,
    spreadPct: spread,
    ratio,
    percent: ratio == null ? null : ratio * 100,
    direction,
    directionLabel: direction === 'H_TO_L' ? 'H→L' : direction === 'L_TO_H' ? 'L→H' : '',
    distancePct,
    triggered
  };
}

function buildQuote(side, code, source, fallbackName) {
  return {
    side,
    code: normalizeCode(code),
    name: String(source?.name || source?.benchmarkName || fallbackName || '').trim(),
    price: pickNumberField(source, PRICE_FIELDS),
    premiumPct: pickNumberField(source, PREMIUM_FIELDS),
    changePct: pickNumberField(source, CHANGE_FIELDS)
  };
}

function pickRepresentativePair(rule, ruleSnapshot) {
  const groups = Array.isArray(ruleSnapshot?.byBenchmark) ? ruleSnapshot.byBenchmark : [];
  const pairs = groups.map((group) => ({ group, pair: resolveRulePair(rule, group) }));
  const withSpread = pairs.filter(({ pair }) => toFiniteNumber(pair.counterpart?.spreadVsBenchmarkPct) != null);
  return (withSpread.sort((a, b) => (
    Math.abs(toFiniteNumber(b.pair.counterpart?.spreadVsBenchmarkPct) ?? 0)
      - Math.abs(toFiniteNumber(a.pair.counterpart?.spreadVsBenchmarkPct) ?? 0)
  ))[0] || pairs[0] || { group: null, pair: resolveRulePair(rule, null) });
}

/** 把单条规则 + 快照映射成一行看板数据。 */
export function buildSwitchBoardRow(rule = {}, snapshot = null, options = {}) {
  const ruleId = String(rule.id || '').trim();
  const root = resolveSnapshotRoot(snapshot);
  const ruleSnapshot = root ? pickSwitchSnapshotForRule(root, ruleId) : null;
  const { group, pair } = pickRepresentativePair(rule, ruleSnapshot);
  const spreadPct = resolveSpreadPct(pair.benchmarkClass, pair.counterpart?.spreadVsBenchmarkPct);
  const lowerPct = toFiniteNumber(rule.intraSellLowerPct) ?? 0;
  const upperPct = toFiniteNumber(rule.intraBuyOtherPct) ?? 0;
  const gauge = buildSpreadGauge({ spreadPct, lowerPct, upperPct });
  const quoteMap = buildRuleQuoteMap(rule, ruleSnapshot);
  const premiumClass = rule.premiumClass && typeof rule.premiumClass === 'object' ? rule.premiumClass : {};
  const allCodes = configuredRuleCodes(rule);
  const highCodes = allCodes.filter((code) => normalizeClass(premiumClass[code]) === 'H');
  const lowCodes = allCodes.filter((code) => normalizeClass(premiumClass[code]) === 'L');
  const highQuotes = highCodes.map((code) => quoteMap.get(code) || buildQuote('H', code, null, ''));
  const lowQuotes = lowCodes.map((code) => quoteMap.get(code) || buildQuote('L', code, null, ''));
  const representativeBenchmark = buildQuote(pair.benchmarkClass, pair.benchmarkCode, {
    name: group?.benchmarkName,
    price: group?.benchmarkPrice ?? group?.price,
    premiumPct: group?.benchmarkPremiumPct ?? group?.premiumRatePct ?? group?.premiumPct
  }, rule.holdingFundName);
  const representativeCounterpart = buildQuote(pair.benchmarkClass === 'H' ? 'L' : 'H', pair.counterpartCode, pair.counterpart, '');
  const high = quoteMap.get(pair.highCode)
    || (pair.benchmarkClass === 'H' ? representativeBenchmark : representativeCounterpart)
    || highQuotes[0];
  const low = quoteMap.get(pair.lowCode)
    || (pair.benchmarkClass === 'L' ? representativeBenchmark : representativeCounterpart)
    || lowQuotes[0];
  const channels = sanitizeSwitchChannelKeys(options.channels);
  const holdingSide = inferHoldingSide(rule);
  const benchmarkSet = new Set(uniqueCodes(rule.benchmarkCodes));
  const holdingCodes = allCodes.filter((code) => benchmarkSet.has(code));

  return {
    id: ruleId,
    name: String(rule.name || '未命名方案').trim(),
    enabled: Boolean(rule.enabled),
    holdingSide,
    holdingCodes,
    rule,
    high: { ...(high || buildQuote('H', highCodes[0], null, '')), side: 'H' },
    low: { ...(low || buildQuote('L', lowCodes[0], null, '')), side: 'L' },
    highQuotes,
    lowQuotes,
    highCodes,
    lowCodes,
    highCode: pair.highCode || highCodes[0] || '',
    lowCode: pair.lowCode || lowCodes[0] || '',
    spreadPct,
    lowerPct: gauge.lowerPct,
    upperPct: gauge.upperPct,
    gauge,
    channels,
    hitCount: pickNumberField(ruleSnapshot, HIT_FIELDS) ?? pickNumberField(group, HIT_FIELDS) ?? 0,
    computedAt: String(ruleSnapshot?.computedAt || root?.computedAt || ''),
    hasQuote: spreadPct != null,
    searchText: [
      rule.name,
      ...allCodes,
      ...highQuotes.map((quote) => quote.name),
      ...lowQuotes.map((quote) => quote.name)
    ].filter(Boolean).join(' ').toLowerCase()
  };
}

export function buildSwitchBoardRows(config = {}, snapshot = null, options = {}) {
  const rules = Array.isArray(config?.rules) ? config.rules : [];
  const channelsByRuleId = options.channelsByRuleId && typeof options.channelsByRuleId === 'object' ? options.channelsByRuleId : {};
  return rules.map((rule) => buildSwitchBoardRow(rule, snapshot, { channels: channelsByRuleId[String(rule?.id || '')] }));
}

export function filterSwitchBoardRows(rows = [], keyword = '') {
  const needle = String(keyword || '').trim().toLowerCase();
  const list = Array.isArray(rows) ? rows : [];
  if (!needle) return list;
  return list.filter((row) => String(row?.searchText || '').includes(needle));
}

export function summarizeSwitchBoard(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    monitoring: list.filter((row) => row?.enabled).length,
    triggeredToday: list.reduce((acc, row) => acc + (toFiniteNumber(row?.hitCount) ?? 0), 0)
  };
}
