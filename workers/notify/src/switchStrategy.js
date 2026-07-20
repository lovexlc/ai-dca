// 场内 ETF 切换信号策略（worker 端实现，前端只做配置）。
//
// 配置示例：
//   benchmarkCode: '159632'
//   candidateCodes: ['513100', '159501', ...]
//   thresholds: [1, 8]
//   enabled: true
//
// 每分钟（仅 A 股交易时段 9:30-11:30 / 13:00-15:00 周一至周五）由 Cron Trigger 触发：
//   1. 拉取所有相关 ETF 的实时盘中价（统一走 markets/fund-metrics）
//   2. 拉取最新单位净值（统一走 markets/fund-metrics，保留 KV 缓存）
//   3. 计算每只候选与基准的 (price - nav) / nav 溢价百分比
//   4. 取「基准溢价 - 候选溢价」绝对值，跨越任一阈值即触发
//   5. 复用既有 runClientDetection 流程推送到该 client 的通知通道
//
// 去重：每对 (benchmark, candidate) 维护 (level, sign)：
//   - level = 跨越的阈值数 (0 / 1 / 2)
//   - sign = +1 表示 benchmark 比 candidate 贵；-1 表示反向
//   level 提升或 sign 翻转都会推送一次；维持或下降不重复推。

import {
  fetchLatestNav,
  fetchLatestNavMap,
  fetchLatestNavMapWithCache,
  fetchFundMetricPrices,
  getLatestNavWithCache,
  NAV_CACHE_PREFIX
} from './getNav.js';
import { buildNotificationAction } from './notificationLinks.js';

export const SWITCH_CONFIG_PREFIX = 'switch:config:';
export const SWITCH_SNAPSHOT_PREFIX = 'switch:snapshot:';
export const SWITCH_STATE_PREFIX = 'switch:state:';
export const SWITCH_PUSH_DIGEST_PREFIX = 'switch:push-digest:';
export const SWITCH_RECOMMENDATION_PREFIX = 'switch:recommendation:';
export const SWITCH_RECOMMEND_CACHE_PREFIX = 'switch:recommend-cache:';
export const SWITCH_RUN_PREFIX = 'switch:run:';
export const SWITCH_RUN_RESULT_PREFIX = 'switch:run-result:';

export function switchConfigKey(clientId) {
  return `${SWITCH_CONFIG_PREFIX}${clientId}`;
}
export function switchSnapshotKey(clientId) {
  return `${SWITCH_SNAPSHOT_PREFIX}${clientId}`;
}
export function switchStateKey(clientId) {
  return `${SWITCH_STATE_PREFIX}${clientId}`;
}

export function switchPushDigestKey(clientId) {
  return `${SWITCH_PUSH_DIGEST_PREFIX}${clientId}`;
}

export function switchRecommendationKey(clientId, recommendationId) {
  return `${SWITCH_RECOMMENDATION_PREFIX}${clientId}:${recommendationId}`;
}

export function switchRecommendationCacheKey(cacheHash) {
  return `${SWITCH_RECOMMEND_CACHE_PREFIX}${String(cacheHash || '').trim()}`;
}

export function switchRunKey(clientId, runId) {
  return `${SWITCH_RUN_PREFIX}${clientId}:${runId}`;
}

export function switchRunResultKey(clientId) {
  return `${SWITCH_RUN_RESULT_PREFIX}${clientId}`;
}

function uniqueNonEmpty(values = []) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

export function buildSwitchPushDigest({ clientId = '', computedAt = '', triggerRecords = [] } = {}) {
  const records = Array.isArray(triggerRecords) ? triggerRecords.filter((item) => item?.trigger) : [];
  if (!records.length) return null;
  const fromCodes = uniqueNonEmpty(records.map((item) => item.trigger.fromCode));
  const codes = fromCodes.length
    ? fromCodes
    : uniqueNonEmpty(records.flatMap((item) => [item.trigger.fromCode, item.trigger.toCode]));
  const codeText =
    codes.length > 5 ? `${codes.slice(0, 5).join('/')} 等 ${codes.length} 只` : codes.join('/');
  const strongest =
    records.slice().sort((a, b) => {
      const aScore = String(a.trigger.rule || '').includes('STRONG')
        ? 100
        : Math.abs(Number(a.trigger.gapPct ?? a.trigger.diffPct ?? a.trigger.benchPremiumPct) || 0);
      const bScore = String(b.trigger.rule || '').includes('STRONG')
        ? 100
        : Math.abs(Number(b.trigger.gapPct ?? b.trigger.diffPct ?? b.trigger.benchPremiumPct) || 0);
      return bScore - aScore;
    })[0]?.trigger || records[0].trigger;
  const keyCode = strongest.fromCode || codes[0] || '';
  const reason =
    strongest.kind === 'otc' || String(strongest.rule || '').startsWith('OTC_')
      ? `${keyCode} 场外切换信号较强`
      : strongest.operator === 'lte'
        ? `${keyCode} 与候选基金的价差已收窄`
        : strongest.operator === 'gte'
          ? `${keyCode} 比候选基金更贵`
          : `${keyCode} 溢价差触发 ${strongest.rule || '切换'} 规则`;
  const fundCount = codes.length || records.length;
  const title = `今日 ${fundCount} 只纳指 ETF 触发切换信号`;
  const body = `${title}${codeText ? `（${codeText}）` : ''}，其中 ${reason}。点击查看 →`;
  return {
    clientId,
    kind: 'switch-premium',
    status: 'triggered',
    title,
    body,
    summary: body,
    computedAt,
    generatedAt: new Date().toISOString(),
    triggerCount: records.length,
    fundCount,
    codes,
    triggers: records.map((item) => ({
      ruleId: item.trigger.ruleId || '',
      ruleName: item.trigger.ruleName || '',
      rule: item.trigger.rule || '',
      kind: item.trigger.kind || 'exchange',
      fromCode: item.trigger.fromCode || '',
      toCode: item.trigger.toCode || '',
      gapPct: Number.isFinite(Number(item.trigger.gapPct ?? item.trigger.diffPct))
        ? Number(item.trigger.gapPct ?? item.trigger.diffPct)
        : null,
      eventId: item.event?.id || item.event?.eventId || ''
    }))
  };
}
export function navCacheKey(code) {
  return `${NAV_CACHE_PREFIX}${sanitizeCode(code)}`;
}

const FUND_CODE_PATTERN = /^\d{6}$/;
const MAX_CANDIDATES = 20;
const MAX_SWITCH_RULES = 12;
// 与前端 SwitchStrategyExperience 的 DEFAULT_PREFS 保持一致。
// v4 规则基准 + H/L 双维度：
//   benchmarkCodes = 当前规则基准（默认来自持仓，也允许前端手动设置未持有模拟基准）
//   enabledCodes   = 用户挑选的候选（前端按 H/L 分类做对侧过滤后下发）
//   premiumClass   = 每只 ETF 的「溢价中枢」分类 'H' | 'L'，与持仓/候选解耦
//   触发方向锚定在 benchmark 的分类：
//     bench ∈ L 持有 → 仅看规则 A：gap = H溢价 − L溢价 < X% → 卖 bench(L) 买 cand(H)
//     bench ∈ H 持有 → 仅看规则 B：gap = H溢价 − L溢价 > Y% → 卖 bench(H) 买 cand(L)
//     同类、未分类、cand 未分类 都不触发。
const DEFAULT_INTRA_SELL_LOWER_PCT = 1; // 规则 A：差价收窄阈值
const DEFAULT_INTRA_BUY_OTHER_PCT = 3; // 规则 B：差价扩大阈值
const DEFAULT_OTC_PREMIUM_THRESHOLD_PCT = 8;
const DEFAULT_OTC_MIN_INTRA_PREMIUM_LOW = 1;
const DEFAULT_OTC_MIN_INTRA_PREMIUM_HIGH = 2;
const DEFAULT_ARB_TARGET_PCT = 2;
const SWITCH_THRESHOLD_RANGES = Object.freeze({
  gte: Object.freeze({ min: 0.5, max: 5 }),
  lte: Object.freeze({ min: 1, max: 1 })
});
// 默认只把这两只基金视为 H 侧；其它基金默认都是 L 侧。
// 用户可以通过规则的 highPremiumCodes 覆盖这份默认名单。
export const DEFAULT_SWITCH_HIGH_CODES = Object.freeze(['159501', '513100']);
const DELAYED_OPEN_PREMIUM_THRESHOLD_PCT = 10;
const DELAYED_OPEN_UNTIL_MINUTE = 10 * 60 + 30;

function sanitizeCode(value) {
  const code = String(value || '').trim();
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

export function normalizeSwitchHighCodes(value, { max = MAX_CANDIDATES } = {}) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(new Set(values.map(sanitizeCode).filter(Boolean))).slice(0, max);
}

export function buildSwitchPremiumClass(codes = [], highCodes = DEFAULT_SWITCH_HIGH_CODES) {
  const validCodes = Array.from(new Set((Array.isArray(codes) ? codes : []).map(sanitizeCode).filter(Boolean)));
  const highSet = new Set(normalizeSwitchHighCodes(highCodes));
  return Object.fromEntries(validCodes.map((code) => [code, highSet.has(code) ? 'H' : 'L']));
}

function pickPercent(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  // 阈值限为 [-50, 50]，防止脱疑配置。
  if (num < -50) return -50;
  if (num > 50) return 50;
  return num;
}

function defaultSwitchRuleName(index = 0) {
  return index === 0 ? '默认规则' : `规则 ${index + 1}`;
}

function sanitizeRuleId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9:_-]{1,64}$/.test(id) ? id : '';
}

function normalizeSwitchRule(input = {}, index = 0, { defaultEnabled = true, readEnabled = true } = {}) {
  const rawBenchmarks = Array.isArray(input?.benchmarkCodes)
    ? input.benchmarkCodes
    : input?.benchmarkCode
      ? [input.benchmarkCode]
      : input?.holdingFundCode
        ? [input.holdingFundCode]
      : [];
  const benchmarkCodes = [];
  const seen = new Set();
  for (const raw of rawBenchmarks) {
    const code = sanitizeCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    benchmarkCodes.push(code);
    if (benchmarkCodes.length >= MAX_CANDIDATES) break;
  }
  const enabledCodesRaw = Array.isArray(input?.enabledCodes)
    ? input.enabledCodes
    : Array.isArray(input?.candidateFundCodes)
      ? input.candidateFundCodes
    : Array.isArray(input?.candidateCodes)
      ? input.candidateCodes
      : [];
  const enabledCodes = [];
  for (const raw of enabledCodesRaw) {
    const code = sanitizeCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    enabledCodes.push(code);
    if (enabledCodes.length >= MAX_CANDIDATES) break;
  }
  const runtimeInput =
    input?.runtimeConfig && typeof input.runtimeConfig === 'object' ? input.runtimeConfig : input;
  const rawClass =
    (input?.runtimeConfig &&
      typeof input.runtimeConfig.premiumClass === 'object' &&
      input.runtimeConfig.premiumClass) ||
    (input && typeof input.premiumClass === 'object' && input.premiumClass ? input.premiumClass : {});
  const validCodes = [...new Set([...benchmarkCodes, ...enabledCodes])];
  const rawHighCodes = Array.isArray(runtimeInput?.highPremiumCodes)
    ? runtimeInput.highPremiumCodes
    : Array.isArray(input?.highPremiumCodes)
      ? input.highPremiumCodes
      : null;
  const legacyHighCodes = Object.entries(rawClass)
    .filter(([, value]) => String(value || '').trim().toUpperCase() === 'H')
    .map(([code]) => code);
  const classificationSource = String(runtimeInput?.classificationSource || '').toLowerCase();
  const legacyGeneratedClassification = ['worker', 'backtest', 'runtime'].some((token) =>
    classificationSource.includes(token)
  );
  const hasUserClassification =
    Array.isArray(rawHighCodes) ||
    (legacyHighCodes.length > 0 &&
      (runtimeInput?.premiumClassSource === 'user' || !legacyGeneratedClassification));
  const highPremiumCodes = normalizeSwitchHighCodes(
    hasUserClassification ? rawHighCodes || legacyHighCodes : DEFAULT_SWITCH_HIGH_CODES
  ).filter((code) => validCodes.includes(code));
  const premiumClass = buildSwitchPremiumClass(validCodes, highPremiumCodes);
  const rawName = String(input?.name || input?.ruleName || '').trim();
  const rawEnabled = readEnabled ? input?.enabled : undefined;
  const holdingFundCode = sanitizeCode(input?.holdingFundCode || benchmarkCodes[0]);
  const holdingSide = premiumClass[holdingFundCode] === 'L' ? 'low' : 'high';
  const runtimeConfig = {
    recommendationId: String(runtimeInput?.recommendationId || '')
      .trim()
      .slice(0, 100),
    premiumClass,
    highPremiumCodes,
    premiumClassSource: hasUserClassification ? 'user' : 'default',
    premiumClassUpdatedAt: String(runtimeInput?.premiumClassUpdatedAt || '').trim(),
    classificationSource: String(
      runtimeInput?.classificationSource || (hasUserClassification ? 'user' : 'default-high-list')
    )
      .trim()
      .slice(0, 80),
    classificationStatus:
      runtimeInput?.classificationStatus === 'stale'
        ? 'stale'
        : runtimeInput?.classificationStatus === 'pending_classification'
          ? 'pending_classification'
          : runtimeInput?.classificationStatus === 'classification_expired'
            ? 'classification_expired'
            : 'fresh',
    classificationWarning: String(runtimeInput?.classificationWarning || '')
      .trim()
      .slice(0, 240),
    intraSellLowerPct: DEFAULT_INTRA_SELL_LOWER_PCT,
    intraBuyOtherPct: pickPercent(
      runtimeInput?.intraBuyOtherPct ?? input?.intraBuyOtherPct,
      DEFAULT_INTRA_BUY_OTHER_PCT
    ),
    holdingSideAtRecommendation: holdingSide,
    triggerOperatorAtRecommendation: holdingSide === 'low' ? 'lte' : 'gte'
  };
  const recommendedValue =
    runtimeConfig.holdingSideAtRecommendation === 'low'
      ? runtimeConfig.intraSellLowerPct
      : runtimeConfig.intraBuyOtherPct;
  return {
    id: sanitizeRuleId(input?.id || input?.ruleId) || `rule-${index + 1}`,
    name: (rawName || defaultSwitchRuleName(index)).slice(0, 40),
    enabled: rawEnabled === undefined ? Boolean(defaultEnabled) : Boolean(rawEnabled),
    benchmarkCodes,
    enabledCodes,
    premiumClass: runtimeConfig.premiumClass,
    highPremiumCodes: runtimeConfig.highPremiumCodes,
    premiumClassSource: runtimeConfig.premiumClassSource,
    arbTargetPct: pickPercent(input?.arbTargetPct, DEFAULT_ARB_TARGET_PCT),
    intraSellLowerPct: runtimeConfig.intraSellLowerPct,
    intraBuyOtherPct: runtimeConfig.intraBuyOtherPct,
    otcPremiumThresholdPct: pickPercent(input?.otcPremiumThresholdPct, DEFAULT_OTC_PREMIUM_THRESHOLD_PCT),
    otcMinIntraPremiumLow: pickPercent(input?.otcMinIntraPremiumLow, DEFAULT_OTC_MIN_INTRA_PREMIUM_LOW),
    otcMinIntraPremiumHigh: pickPercent(input?.otcMinIntraPremiumHigh, DEFAULT_OTC_MIN_INTRA_PREMIUM_HIGH),
    holdingFundCode,
    holdingFundName: String(input?.holdingFundName || '')
      .trim()
      .slice(0, 120),
    holdingQuantity: Number.isFinite(Number(input?.holdingQuantity))
      ? Number(input.holdingQuantity)
      : undefined,
    thresholdMode: input?.thresholdMode === 'fixed' ? 'fixed' : 'backtest',
    thresholdValue:
      holdingSide === 'low'
        ? DEFAULT_INTRA_SELL_LOWER_PCT
        : pickPercent(input?.thresholdValue, runtimeConfig.intraBuyOtherPct),
    backtestRecommendedValue:
      input?.backtestRecommendedValue === null
        ? null
        : holdingSide === 'low'
          ? DEFAULT_INTRA_SELL_LOWER_PCT
          : pickPercent(input?.backtestRecommendedValue, recommendedValue),
    recommendationStatus: ['valid', 'fee_changed', 'expired'].includes(input?.recommendationStatus)
      ? input.recommendationStatus
      : 'valid',
    feeConfig: input?.feeConfig && typeof input.feeConfig === 'object' ? input.feeConfig : null,
    candidateFundCodes: enabledCodes,
    runtimeConfig
  };
}

export function validateSwitchRuleThreshold(rule = {}) {
  const operator =
    rule?.runtimeConfig?.triggerOperatorAtRecommendation === 'lte' || rule?.triggerOperator === 'lte'
      ? 'lte'
      : 'gte';
  const range = SWITCH_THRESHOLD_RANGES[operator];
  const value = Number(rule?.thresholdValue);
  if (!Number.isFinite(value)) {
    return { valid: false, operator, error: '提醒值必须是数字。' };
  }
  if (value < 0) {
    return { valid: false, operator, error: '提醒值不能为负数。' };
  }
  if (value < range.min || value > range.max) {
    return { valid: false, operator, error: `提醒值应在 ${range.min}%–${range.max}% 之间。` };
  }
  return { valid: true, operator, value };
}

export function validateSwitchConfigThresholds(config = {}) {
  const normalized = normalizeSwitchConfig(config);
  const errors = normalized.rules
    .filter((rule) => rule.enabled)
    .map((rule) => {
      const result = validateSwitchRuleThreshold(rule);
      return result.valid ? null : { ruleId: rule.id, error: result.error };
    })
    .filter(Boolean);
  return { valid: errors.length === 0, errors };
}

// 配置与前端 aiDcaSwitchStrategyPrefs 同名，不重复定义一套参数。
// v4 规则基准 + H/L 双维度（benchmarkCodes 决定基准，H/L 决定方向）：
//  - benchmarkCodes: 当前规则基准；通常来自持仓，也可包含未持有模拟基准
//  - enabledCodes:   候选（前端按 premiumClass 过滤后只剩对侧）
//  - premiumClass:   { [code]: 'H' | 'L' }，每只 ETF 的溢价中枢标签
//  - intraSellLowerPct / intraBuyOtherPct: 场内阈值，与页面同名同义。
//  - otcPremiumThresholdPct / otcMinIntraPremiumLow / otcMinIntraPremiumHigh: 场外切换阈值。
//  - 触发逻辑：每对 (bench, cand) 仅当 cand.class !== bench.class 且都已分类时考虑：
//      bench=L → 看 gap = H溢价 − L溢价 < 1% → 卖 bench(L) 买 cand(H)
//      bench=H → 看 gap > buyOther          → 卖 bench(H) 买 cand(L)
//  - 未分类的 bench 或 cand：不触发，前端会有提示。
export function normalizeSwitchConfig(input = {}) {
  const hasRulesArray = Array.isArray(input?.rules);
  const rawRules = hasRulesArray ? input.rules : [];
  const rules = [];
  const usedIds = new Set();
  if (rawRules.length) {
    for (const rawRule of rawRules.slice(0, MAX_SWITCH_RULES)) {
      const normalizedRule = normalizeSwitchRule(rawRule, rules.length);
      let id = normalizedRule.id;
      if (usedIds.has(id)) id = `${id}-${rules.length + 1}`;
      usedIds.add(id);
      rules.push({ ...normalizedRule, id });
    }
  } else if (!hasRulesArray) {
    const legacyRule = normalizeSwitchRule(
      {
        ...input,
        id: input?.ruleId || 'rule-1',
        name: input?.ruleName || input?.name || '默认规则'
      },
      0,
      { defaultEnabled: true, readEnabled: false }
    );
    rules.push(legacyRule);
    usedIds.add(legacyRule.id);
  }
  const requestedActiveId = sanitizeRuleId(input?.activeRuleId);
  const activeRule = rules.find((rule) => rule.id === requestedActiveId) || rules[0] || null;
  return {
    schemaVersion: 2,
    enabled: Boolean(input?.enabled) && rules.length > 0,
    activeRuleId: activeRule?.id || '',
    rules,
    ruleEnabled: Boolean(activeRule?.enabled),
    ruleName: activeRule?.name || '',
    benchmarkCodes: activeRule?.benchmarkCodes || [],
    enabledCodes: activeRule?.enabledCodes || [],
    premiumClass: activeRule?.premiumClass || {},
    highPremiumCodes: activeRule?.highPremiumCodes || DEFAULT_SWITCH_HIGH_CODES,
    premiumClassSource: activeRule?.premiumClassSource || 'default',
    arbTargetPct: activeRule?.arbTargetPct,
    intraSellLowerPct: activeRule?.intraSellLowerPct,
    intraBuyOtherPct: activeRule?.intraBuyOtherPct,
    otcPremiumThresholdPct: activeRule?.otcPremiumThresholdPct,
    otcMinIntraPremiumLow: activeRule?.otcMinIntraPremiumLow,
    otcMinIntraPremiumHigh: activeRule?.otcMinIntraPremiumHigh,
    holdingFundCode: activeRule?.holdingFundCode || '',
    holdingFundName: activeRule?.holdingFundName || '',
    holdingQuantity: activeRule?.holdingQuantity,
    thresholdMode: activeRule?.thresholdMode || 'backtest',
    thresholdValue: activeRule?.thresholdValue,
    backtestRecommendedValue: activeRule?.backtestRecommendedValue,
    feeConfig: activeRule?.feeConfig || null,
    candidateFundCodes: activeRule?.candidateFundCodes || [],
    runtimeConfig: activeRule?.runtimeConfig || null,
    clientLabel: String(input?.clientLabel || '')
      .trim()
      .slice(0, 120),
    updatedAt: String(input?.updatedAt || '').trim() || new Date().toISOString()
  };
}

function isSwitchRuleRunnable(rule) {
  if (!rule || !rule.enabled) return false;
  if (!validateSwitchRuleThreshold(rule).valid) return false;
  if (!Number.isFinite(rule.intraSellLowerPct) || !Number.isFinite(rule.intraBuyOtherPct)) return false;
  const benches = Array.isArray(rule.benchmarkCodes) ? rule.benchmarkCodes : [];
  if (!benches.length) return false;
  const enabled = Array.isArray(rule.enabledCodes) ? rule.enabledCodes : [];
  const benchSet = new Set(benches);
  const hasOtcCandidates = enabled.some((c) => c && !benchSet.has(c));
  const cls = rule && typeof rule.premiumClass === 'object' && rule.premiumClass ? rule.premiumClass : {};
  const pool = Array.from(new Set([...benches, ...enabled])).filter((c) => cls[c] === 'H' || cls[c] === 'L');
  for (const b of benches) {
    const bc = cls[b];
    if (bc !== 'H' && bc !== 'L') continue;
    const opp = bc === 'H' ? 'L' : 'H';
    if (pool.some((c) => c !== b && cls[c] === opp)) return true;
  }
  return hasOtcCandidates;
}

export function getRunnableSwitchRules(input = {}, { forceEnabled = false } = {}) {
  const config = normalizeSwitchConfig(input);
  if (!forceEnabled && !config.enabled) return [];
  return (config.rules || []).filter((rule) => isSwitchRuleRunnable(rule));
}

export function collectSwitchConfigCodes(input = {}) {
  const config = normalizeSwitchConfig(input);
  const codes = new Set();
  for (const rule of config.rules || []) {
    for (const code of rule.benchmarkCodes || []) codes.add(code);
    for (const code of rule.enabledCodes || []) codes.add(code);
  }
  return Array.from(codes);
}

export function isSwitchConfigRunnable(config) {
  return getRunnableSwitchRules(config).length > 0;
}

// --- 时间窗口 -------------------------------------------------------------

export function getShanghaiHourMinute(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  const hourRaw = parts.hour === '24' ? '00' : parts.hour;
  return {
    weekday: String(parts.weekday || ''),
    hour: Number(hourRaw),
    minute: Number(parts.minute || '0')
  };
}

export function isInTradingSession(date = new Date()) {
  const { weekday, hour, minute } = getShanghaiHourMinute(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const m = hour * 60 + minute;
  // 上午：09:30-11:30；下午：13:00-15:00。
  if (m >= 570 && m <= 690) return true;
  if (m >= 780 && m <= 900) return true;
  return false;
}

function getShanghaiDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function positiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : NaN;
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function normalizeOrderBook(book = null) {
  if (!book || typeof book !== 'object') return null;
  const fromLevels = Array.isArray(book.levels) ? book.levels : [];
  const levels = [1, 2, 3]
    .map((level) => {
      const source = fromLevels.find((item) => Number(item?.level) === level) || fromLevels[level - 1] || {};
      const bidPrice = finiteNumber(
        source.bidPrice ??
          source.bid_price ??
          source.bp ??
          book[`bp${level}`] ??
          book[`bid${level}`] ??
          book[`bid${level}_price`] ??
          book[`bid_price${level}`] ??
          book[`buy${level}`] ??
          book[`buy${level}_price`] ??
          book[`buy_price${level}`]
      );
      const askPrice = finiteNumber(
        source.askPrice ??
          source.ask_price ??
          source.sp ??
          book[`sp${level}`] ??
          book[`ask${level}`] ??
          book[`ask${level}_price`] ??
          book[`ask_price${level}`] ??
          book[`sell${level}`] ??
          book[`sell${level}_price`] ??
          book[`sell_price${level}`]
      );
      const bidVolume = finiteNumber(
        source.bidVolume ??
          source.bid_volume ??
          source.bc ??
          book[`bc${level}`] ??
          book[`bid${level}_volume`] ??
          book[`bid${level}_vol`] ??
          book[`bid_volume${level}`] ??
          book[`buy${level}_volume`] ??
          book[`buy${level}_vol`] ??
          book[`buy_volume${level}`]
      );
      const askVolume = finiteNumber(
        source.askVolume ??
          source.ask_volume ??
          source.sc ??
          book[`sc${level}`] ??
          book[`ask${level}_volume`] ??
          book[`ask${level}_vol`] ??
          book[`ask_volume${level}`] ??
          book[`sell${level}_volume`] ??
          book[`sell${level}_vol`] ??
          book[`sell_volume${level}`]
      );
      return {
        level,
        bidPrice: Number.isFinite(bidPrice) && bidPrice > 0 ? bidPrice : null,
        bidVolume: Number.isFinite(bidVolume) && bidVolume >= 0 ? bidVolume : null,
        askPrice: Number.isFinite(askPrice) && askPrice > 0 ? askPrice : null,
        askVolume: Number.isFinite(askVolume) && askVolume >= 0 ? askVolume : null
      };
    })
    .filter((item) => item.bidPrice != null || item.askPrice != null);
  const topLevel = levels.find((item) => item.level === 1) || levels[0] || {};
  const bidPrice = Number(topLevel.bidPrice ?? book.bidPrice ?? book.bid_price ?? book.bp1);
  const askPrice = Number(topLevel.askPrice ?? book.askPrice ?? book.ask_price ?? book.sp1);
  const bidVolume = Number(topLevel.bidVolume ?? book.bidVolume ?? book.bid_volume ?? book.bc1);
  const askVolume = Number(topLevel.askVolume ?? book.askVolume ?? book.ask_volume ?? book.sc1);
  const spread = Number(book.spread);
  const mid = Number.isFinite(bidPrice) && Number.isFinite(askPrice) ? (bidPrice + askPrice) / 2 : NaN;
  const derivedSpread = Number.isFinite(bidPrice) && Number.isFinite(askPrice) ? askPrice - bidPrice : NaN;
  const spreadPercent = Number.isFinite(book.spreadPercent)
    ? Number(book.spreadPercent)
    : Number.isFinite(mid) && mid > 0 && Number.isFinite(derivedSpread)
      ? (derivedSpread / mid) * 100
      : NaN;
  if (!Number.isFinite(bidPrice) && !Number.isFinite(askPrice) && !levels.length) return null;
  return {
    bidPrice: Number.isFinite(bidPrice) ? bidPrice : null,
    bidVolume: Number.isFinite(bidVolume) ? bidVolume : null,
    askPrice: Number.isFinite(askPrice) ? askPrice : null,
    askVolume: Number.isFinite(askVolume) ? askVolume : null,
    levels,
    spread: Number.isFinite(spread) ? spread : Number.isFinite(derivedSpread) ? derivedSpread : null,
    spreadPercent: Number.isFinite(spreadPercent) ? spreadPercent : null
  };
}

function previousCloseOf(priceEntry) {
  return positiveNumber(priceEntry?.previousClose ?? priceEntry?.prevClose ?? priceEntry?.preClose);
}

export function getDelayedOpenInfo(code, priceMap, navByCode, computedAt, navAgeDays = null) {
  const { weekday, hour, minute } = getShanghaiHourMinute(new Date(computedAt || Date.now()));
  if (weekday === 'Sat' || weekday === 'Sun') return { delayed: false };
  const marketMinute = hour * 60 + minute;
  if (marketMinute >= DELAYED_OPEN_UNTIL_MINUTE) return { delayed: false };

  const previousClose = previousCloseOf(priceMap?.[code]);
  const nav = positiveNumber(navByCode?.[code]?.nav);
  if (!Number.isFinite(previousClose) || !Number.isFinite(nav)) return { delayed: false };
  if (typeof navAgeDays === 'function') {
    const navDate = String(navByCode?.[code]?.latestNavDate || '').trim();
    if (navAgeDays(navDate) > 14) return { delayed: false };
  }

  const previousClosePremiumPct = ((previousClose - nav) / nav) * 100;
  if (
    !Number.isFinite(previousClosePremiumPct) ||
    previousClosePremiumPct <= DELAYED_OPEN_PREMIUM_THRESHOLD_PCT
  ) {
    return { delayed: false, previousClosePremiumPct };
  }
  return {
    delayed: true,
    previousClosePremiumPct,
    previousClose,
    nav,
    delayedUntilMinute: DELAYED_OPEN_UNTIL_MINUTE,
    delayedUntil: '10:30'
  };
}

// 净值获取相关的函数已抽离到 getNav.js 模块
// 其中 fetchLatestNav, fetchLatestNavMap, fetchLatestNavMapWithCache, fetchFundMetricPrices, getLatestNavWithCache
// 均由 getNav.js 统一接入 markets/fund-metrics。
// 由该模块导出并在本文件顶部导入

/**
 * 直接用最新净值更新现有 snapshot，避免完整重算。
 * 保留原有的价格和触发状态，仅补充/刷新净值及相关的溢价字段。
 *
 * 使用支持 KV 缓存的 getLatestNavFn 进行净值获取，确保数据新鲜度和性能。
 * 通过并行批量拉取，快速响应净值更新。
 *
 * @param {Object} snapshot - 现有快照
 * @param {Object} env - Worker env（用于 KV 操作）
 * @param {Function} getLatestNavFn - 支持 KV 缓存的净值获取函数（必需）
 * @returns {Promise<Object>} 更新后的 snapshot
 */
export async function refreshSnapshotWithLatestNav(snapshot, env, getLatestNavFn) {
  if (!snapshot || !Array.isArray(snapshot.byBenchmark)) {
    return snapshot;
  }

  // 收集所有相关的基金代码
  const allCodes = new Set();
  const codeToKind = {}; // 记录每个代码的基金类型

  for (const group of snapshot.byBenchmark) {
    if (group?.benchmarkCode) {
      allCodes.add(group.benchmarkCode);
      codeToKind[group.benchmarkCode] = 'exchange'; // 基准默认为场内 ETF
    }
    for (const cand of group?.candidates || []) {
      if (cand?.code) {
        allCodes.add(cand.code);
        codeToKind[cand.code] = 'exchange'; // 候选默认为场内 ETF
      }
    }
  }

  if (allCodes.size === 0) {
    return snapshot;
  }

  // 批量拉取最新净值（使用统一的 KV 缓存方法）
  let navByCode = {};
  try {
    // 使用支持 KV 缓存的方法，并行处理所有基金代码
    const results = await Promise.all(
      Array.from(allCodes).map((code) =>
        getLatestNavFn(env, code, codeToKind[code] || 'exchange', { forceRefresh: false }).catch(() => null)
      )
    );
    for (const result of results) {
      if (result && result.code) {
        navByCode[result.code] = result;
      }
    }
    console.log(
      `[switch] refreshSnapshotWithLatestNav: 用 KV 缓存拉取 ${Object.keys(navByCode).length}/${allCodes.size} 个基金`
    );
  } catch (_error) {
    console.warn('[switch] refreshSnapshotWithLatestNav: fetch failed', _error);
    return snapshot;
  }

  // 第三步：更新 snapshot 中的净值，重新计算溢价
  const NAV_STALE_DAYS = 14;
  function navAgeDays(dateStr) {
    if (!dateStr) return Infinity;
    const t = Date.parse(dateStr);
    if (!Number.isFinite(t)) return Infinity;
    const ref = Date.parse(snapshot.computedAt) || Date.now();
    return (ref - t) / 86400000;
  }

  const updatedByBenchmark = snapshot.byBenchmark.map((group) => {
    const benchmarkCode = group.benchmarkCode || '';
    const benchNav = Number(navByCode?.[benchmarkCode]?.nav);
    const benchNavDate = String(navByCode?.[benchmarkCode]?.latestNavDate || '').trim();
    const benchPrice = group.benchmarkPrice; // 保留原有价格，不重新拉取
    const benchNavStale = benchNav && navAgeDays(benchNavDate) > NAV_STALE_DAYS;
    const benchDelayedOpen = Boolean(group.benchmarkDelayedOpen);
    const benchPremium =
      Number.isFinite(benchPrice) &&
      Number.isFinite(benchNav) &&
      benchNav > 0 &&
      !benchNavStale &&
      !benchDelayedOpen
        ? ((benchPrice - benchNav) / benchNav) * 100
        : null;

    const updatedCandidates = (group.candidates || []).map((cand) => {
      const candNav = Number(navByCode?.[cand.code]?.nav);
      const candNavDate = String(navByCode?.[cand.code]?.latestNavDate || '').trim();
      const candPrice = cand.price; // 保留原有价格
      const navMissing = !Number.isFinite(candNav) || candNav <= 0;
      const navStale = !navMissing && navAgeDays(candNavDate) > NAV_STALE_DAYS;
      const priceMissing = !Number.isFinite(candPrice) || candPrice <= 0;
      const candDelayedOpen = Boolean(cand.delayedOpen);
      const candPremium =
        !navMissing && !priceMissing && !navStale && !candDelayedOpen
          ? ((candPrice - candNav) / candNav) * 100
          : null;
      const diff =
        Number.isFinite(benchPremium) && Number.isFinite(candPremium) ? benchPremium - candPremium : null;

      let note = '';
      if (navMissing) note = 'nav-missing';
      else if (navStale) note = 'nav-stale';
      else if (priceMissing) note = 'price-missing';
      else if (candDelayedOpen) note = 'delayed-open';
      else if (benchDelayedOpen) note = 'benchmark-delayed-open';
      else if (!Number.isFinite(benchPremium)) note = 'benchmark-unavailable';

      return {
        ...cand,
        nav: Number.isFinite(candNav) ? candNav : cand.nav,
        navDate: candNavDate || cand.navDate,
        premiumPct: Number.isFinite(candPremium) ? candPremium : cand.premiumPct,
        spreadVsBenchmarkPct: Number.isFinite(diff) ? diff : cand.spreadVsBenchmarkPct,
        note
      };
    });

    return {
      ...group,
      benchmarkNav: Number.isFinite(benchNav) ? benchNav : group.benchmarkNav,
      benchmarkNavDate: benchNavDate || group.benchmarkNavDate,
      benchmarkPremiumPct: Number.isFinite(benchPremium) ? benchPremium : group.benchmarkPremiumPct,
      benchmarkNote:
        !Number.isFinite(benchPrice) || benchPrice <= 0
          ? 'price-missing'
          : !Number.isFinite(benchNav) || benchNav <= 0
            ? 'nav-missing'
            : benchNavStale
              ? 'nav-stale'
              : benchDelayedOpen
                ? 'delayed-open'
                : '',
      candidates: updatedCandidates
    };
  });

  // 第四步：重新计算 ready 标志和 signals
  const ready = updatedByBenchmark.some(
    (b) =>
      Number.isFinite(b.benchmarkPremiumPct) &&
      b.candidates.some((c) => Number.isFinite(c.spreadVsBenchmarkPct))
  );

  // 保留原 signals 和 triggers（这些是触发决策，不应因净值刷新而改变）
  return {
    ...snapshot,
    byBenchmark: updatedByBenchmark,
    ready
  };
}

// --- 快照与触发 ------------------------------------------------------------

// 计算 worker 快照，与前端 SwitchStrategyExperience.fundsWithPremium / intraSignals 同语义。
// 多基准（benchmarkCodes）下采用「全配对」结构：每只基准都有一份候选评估，存放于 byBenchmark[]。
export function computeSwitchSnapshot(config, priceMap, navByCode, computedAt) {
  const computedAtIso = String(computedAt || new Date().toISOString());
  // NAV 过旧（默认 14 天）也视为不可用，以免拿陈旧 NAV 算溢价误触发。
  const NAV_STALE_DAYS = 14;
  function navAgeDays(dateStr) {
    if (!dateStr) return Infinity;
    const t = Date.parse(dateStr);
    if (!Number.isFinite(t)) return Infinity;
    const ref = Date.parse(computedAtIso) || Date.now();
    return (ref - t) / 86400000;
  }

  const benchmarkCodes = Array.isArray(config.benchmarkCodes) ? config.benchmarkCodes : [];
  const enabledCodes = Array.isArray(config.enabledCodes) ? config.enabledCodes : [];
  const premiumClass =
    config && typeof config.premiumClass === 'object' && config.premiumClass ? config.premiumClass : {};
  const otcPremiumThresholdPct = pickPercent(
    config.otcPremiumThresholdPct,
    DEFAULT_OTC_PREMIUM_THRESHOLD_PCT
  );
  const otcMinIntraPremiumLow = pickPercent(config.otcMinIntraPremiumLow, DEFAULT_OTC_MIN_INTRA_PREMIUM_LOW);
  const otcMinIntraPremiumHigh = pickPercent(
    config.otcMinIntraPremiumHigh,
    DEFAULT_OTC_MIN_INTRA_PREMIUM_HIGH
  );
  const allConfigCodes = Array.from(new Set([...benchmarkCodes, ...enabledCodes]));

  function buildPremiumEntry(code) {
    const quote = priceMap?.[code] || {};
    const price = Number(priceMap?.[code]?.price);
    const nav = Number(navByCode?.[code]?.nav);
    const navDate = String(navByCode?.[code]?.latestNavDate || '').trim();
    const navMissing = !Number.isFinite(nav) || nav <= 0;
    const navStale = !navMissing && navAgeDays(navDate) > NAV_STALE_DAYS;
    const priceMissing = !Number.isFinite(price) || price <= 0;
    const delayedOpen = getDelayedOpenInfo(code, priceMap, navByCode, computedAtIso, navAgeDays);
    const premiumPct =
      !navMissing && !priceMissing && !navStale && !delayedOpen.delayed ? ((price - nav) / nav) * 100 : null;
    let note = '';
    if (navMissing) note = 'nav-missing';
    else if (navStale) note = 'nav-stale';
    else if (priceMissing) note = 'price-missing';
    else if (delayedOpen.delayed) note = 'delayed-open';
    return {
      code,
      name: navByCode?.[code]?.name || '',
      price: Number.isFinite(price) ? price : null,
      high: Number(priceMap?.[code]?.high) || null,
      low: Number(priceMap?.[code]?.low) || null,
      orderBook: normalizeOrderBook(quote.orderBook),
      nav: Number.isFinite(nav) ? nav : null,
      navDate,
      premiumPct: Number.isFinite(premiumPct) ? premiumPct : null,
      previousClosePremiumPct: Number.isFinite(delayedOpen.previousClosePremiumPct)
        ? delayedOpen.previousClosePremiumPct
        : null,
      delayedOpen: Boolean(delayedOpen.delayed),
      delayedUntil: delayedOpen.delayedUntil || '',
      note
    };
  }

  const premiumByCode = {};
  for (const code of allConfigCodes) {
    premiumByCode[code] = buildPremiumEntry(code);
  }

  function computeOtcSignal() {
    let topBench = null;
    // 场外触发必须从“规则基准”发起；候选即使高溢价也不能作为卖出侧触发推送。
    for (const code of benchmarkCodes) {
      const entry = premiumByCode[code];
      if (!entry || !Number.isFinite(entry.premiumPct)) continue;
      if (!topBench || entry.premiumPct > topBench.premiumPct) topBench = entry;
    }

    let minFund = null;
    for (const code of enabledCodes) {
      const entry = premiumByCode[code];
      if (!entry || !Number.isFinite(entry.premiumPct)) continue;
      if (!minFund || entry.premiumPct < minFund.premiumPct) minFund = entry;
    }

    if (!topBench || !minFund) {
      return {
        ready: false,
        message: 'otc-signal-unavailable',
        otcPremiumThresholdPct,
        otcMinIntraPremiumLow,
        otcMinIntraPremiumHigh
      };
    }

    const benchHigh = topBench.premiumPct > otcPremiumThresholdPct;
    const intraLowSoft = minFund.premiumPct < otcMinIntraPremiumHigh;
    const intraLowHard = minFund.premiumPct < otcMinIntraPremiumLow;
    const triggered = benchHigh && (intraLowSoft || intraLowHard);
    const rule = triggered ? (intraLowHard ? 'OTC_STRONG' : 'OTC_WEAK') : 'none';
    const level = rule === 'OTC_STRONG' ? '强信号' : rule === 'OTC_WEAK' ? '弱信号' : '未触发';

    return {
      ready: true,
      benchCode: topBench.code,
      benchName: topBench.name || topBench.code,
      benchPremiumPct: topBench.premiumPct,
      benchPrice: topBench.price,
      benchOrderBook: topBench.orderBook || null,
      benchNav: topBench.nav,
      benchNavDate: topBench.navDate,
      lowestCode: minFund.code,
      lowestName: minFund.name || minFund.code,
      lowestPremiumPct: minFund.premiumPct,
      lowestPrice: minFund.price,
      lowestOrderBook: minFund.orderBook || null,
      lowestNav: minFund.nav,
      lowestNavDate: minFund.navDate,
      benchHigh,
      intraLowSoft,
      intraLowHard,
      triggered,
      rule,
      level,
      otcPremiumThresholdPct,
      otcMinIntraPremiumLow,
      otcMinIntraPremiumHigh
    };
  }

  // 候选池 = (enabledCodes ∪ benchmarkCodes) \ self，这样一 H 一 L 的两只持仓
  // 也能互为候选，而不是仅限于 enabledCodes（= 非持仓分类代码）。
  const classifiedPool = Array.from(new Set([...benchmarkCodes, ...enabledCodes])).filter(
    (c) => premiumClass[c] === 'H' || premiumClass[c] === 'L'
  );
  const byBenchmark = benchmarkCodes.map((benchmarkCode) => {
    // v3：bench 已分类时，只留对立类（H↔L）的候选，同类/未分类全部剔除。
    const benchmarkClass = premiumClass[benchmarkCode] || null;
    const oppClass = benchmarkClass === 'H' ? 'L' : benchmarkClass === 'L' ? 'H' : null;
    const eligibleCodes = oppClass
      ? classifiedPool.filter((c) => c !== benchmarkCode && premiumClass[c] === oppClass)
      : enabledCodes;

    const benchPrice = Number(priceMap?.[benchmarkCode]?.price);
    const benchOrderBook = normalizeOrderBook(priceMap?.[benchmarkCode]?.orderBook);
    const benchNav = Number(navByCode?.[benchmarkCode]?.nav);
    const benchNavDate = String(navByCode?.[benchmarkCode]?.latestNavDate || '').trim();
    const benchNavStale = navAgeDays(benchNavDate) > NAV_STALE_DAYS;
    const benchDelayedOpen = getDelayedOpenInfo(
      benchmarkCode,
      priceMap,
      navByCode,
      computedAtIso,
      navAgeDays
    );
    const benchPremium =
      Number.isFinite(benchPrice) &&
      Number.isFinite(benchNav) &&
      benchNav > 0 &&
      !benchNavStale &&
      !benchDelayedOpen.delayed
        ? ((benchPrice - benchNav) / benchNav) * 100
        : null;

    const candidates = eligibleCodes.map((code) => {
      const candPrice = Number(priceMap?.[code]?.price);
      const candNav = Number(navByCode?.[code]?.nav);
      const candNavDate = String(navByCode?.[code]?.latestNavDate || '').trim();
      const navMissing = !Number.isFinite(candNav) || candNav <= 0;
      const navStale = !navMissing && navAgeDays(candNavDate) > NAV_STALE_DAYS;
      const priceMissing = !Number.isFinite(candPrice) || candPrice <= 0;
      const candDelayedOpen = getDelayedOpenInfo(code, priceMap, navByCode, computedAtIso, navAgeDays);
      const candPremium =
        !navMissing && !priceMissing && !navStale && !candDelayedOpen.delayed
          ? ((candPrice - candNav) / candNav) * 100
          : null;
      const diff =
        Number.isFinite(benchPremium) && Number.isFinite(candPremium) ? benchPremium - candPremium : null;
      // 标注原因，供 UI / 调试使用；评估器看到 spreadVsBenchmarkPct=null 就不会触发。
      let note = '';
      if (navMissing) note = 'nav-missing';
      else if (navStale) note = 'nav-stale';
      else if (priceMissing) note = 'price-missing';
      else if (candDelayedOpen.delayed) note = 'delayed-open';
      else if (benchDelayedOpen.delayed) note = 'benchmark-delayed-open';
      else if (!Number.isFinite(benchPremium)) note = 'benchmark-unavailable';
      return {
        code,
        name: navByCode?.[code]?.name || '',
        price: Number.isFinite(candPrice) ? candPrice : null,
        orderBook: normalizeOrderBook(priceMap?.[code]?.orderBook),
        nav: Number.isFinite(candNav) ? candNav : null,
        navDate: candNavDate,
        premiumPct: Number.isFinite(candPremium) ? candPremium : null,
        previousClosePremiumPct: Number.isFinite(candDelayedOpen.previousClosePremiumPct)
          ? candDelayedOpen.previousClosePremiumPct
          : null,
        delayedOpen: Boolean(candDelayedOpen.delayed),
        delayedUntil: candDelayedOpen.delayedUntil || '',
        // diff = benchPremium − candPremium，与页面 intraSignals 中同名。
        spreadVsBenchmarkPct: Number.isFinite(diff) ? diff : null,
        // 面向 App 的统一优势：高侧为 H-L，低侧仍返回 H-L，交由 operator 决定越高/越低更好。
        advantagePct: Number.isFinite(diff) ? (benchmarkClass === 'L' ? -diff : diff) : null,
        candClass: premiumClass[code] || null,
        note
      };
    });

    return {
      benchmarkCode,
      benchmarkName: navByCode?.[benchmarkCode]?.name || '',
      benchmarkClass,
      benchmarkPrice: Number.isFinite(benchPrice) ? benchPrice : null,
      benchmarkOrderBook: benchOrderBook,
      benchmarkNav: Number.isFinite(benchNav) ? benchNav : null,
      benchmarkNavDate: benchNavDate,
      benchmarkPremiumPct: Number.isFinite(benchPremium) ? benchPremium : null,
      benchmarkPreviousClosePremiumPct: Number.isFinite(benchDelayedOpen.previousClosePremiumPct)
        ? benchDelayedOpen.previousClosePremiumPct
        : null,
      benchmarkDelayedOpen: Boolean(benchDelayedOpen.delayed),
      benchmarkDelayedUntil: benchDelayedOpen.delayedUntil || '',
      benchmarkNote:
        !Number.isFinite(benchPrice) || benchPrice <= 0
          ? 'price-missing'
          : !Number.isFinite(benchNav) || benchNav <= 0
            ? 'nav-missing'
            : benchNavStale
              ? 'nav-stale'
              : benchDelayedOpen.delayed
                ? 'delayed-open'
                : '',
      candidates
    };
  });

  const otcSignal = computeOtcSignal();
  const ready =
    byBenchmark.some(
      (b) =>
        Number.isFinite(b.benchmarkPremiumPct) &&
        b.candidates.some((c) => Number.isFinite(c.spreadVsBenchmarkPct))
    ) || Boolean(otcSignal.ready);

  // signals: 与前端原 intraSignals 同语义的「当前命中规则」列表（无 dedup，每次快照重算）。
  // 前端 UI 直接渲染这一列表，避免浏览器再独立算一份。
  const sellLowerCfg = Number(config.intraSellLowerPct);
  const buyOtherCfg = Number(config.intraBuyOtherPct);
  const signals = [];
  for (const group of byBenchmark) {
    const benchCode = group?.benchmarkCode || '';
    if (!benchCode) continue;
    if (!Number.isFinite(group?.benchmarkPremiumPct)) continue;
    const benchClass = premiumClass[benchCode];
    for (const cand of group.candidates || []) {
      const candClass = premiumClass[cand.code];
      const diff = cand?.spreadVsBenchmarkPct;
      if (typeof diff !== 'number' || !Number.isFinite(diff)) continue;
      let gap = NaN;
      if (benchClass === 'H') gap = diff;
      else if (benchClass === 'L') gap = -diff;
      const rule = classifyRule({
        benchClass,
        candClass,
        gap,
        sellLower: sellLowerCfg,
        buyOther: buyOtherCfg
      });
      if (rule === 'none') continue;
      const hCode = benchClass === 'H' ? benchCode : cand.code;
      const lCode = benchClass === 'H' ? cand.code : benchCode;
      const tag = rule === 'A' ? '差价收窄' : '差价扩大';
      const arrow = rule === 'A' ? '低→高' : '高→低';
      const cmp = rule === 'A' ? '<' : '>';
      const threshold = rule === 'A' ? sellLowerCfg : buyOtherCfg;
      const gapStr = (gap >= 0 ? '+' : '') + gap.toFixed(2);
      signals.push({
        ruleId: config.ruleId || config.id || '',
        ruleName: config.ruleName || config.name || '',
        kind: rule,
        from: benchCode,
        fromName: group.benchmarkName || benchCode,
        to: cand.code,
        toName: cand.name || cand.code,
        gapPct: gap,
        threshold,
        description: `${hCode}(H) − ${lCode}(L) 溢价差 ${gapStr}% ${cmp} ${threshold}%（${tag}，${arrow}）：卖 ${benchCode} 买 ${cand.code}`
      });
    }
  }

  return {
    computedAt: computedAtIso,
    ruleId: config.ruleId || config.id || '',
    ruleName: config.ruleName || config.name || '',
    ruleEnabled: config.enabled !== false,
    intraSellLowerPct: Number(config.intraSellLowerPct),
    intraBuyOtherPct: Number(config.intraBuyOtherPct),
    otcPremiumThresholdPct,
    otcMinIntraPremiumLow,
    otcMinIntraPremiumHigh,
    otcSignal,
    // 随快照一起带 premiumClass，供 evaluateSwitchTriggers 使用。
    premiumClass,
    classificationStatus: String(config?.runtimeConfig?.classificationStatus || '').trim() || 'fresh',
    classificationUpdatedAt: String(config?.runtimeConfig?.premiumClassUpdatedAt || '').trim(),
    classificationWarning: String(config?.runtimeConfig?.classificationWarning || '').trim(),
    byBenchmark,
    // signals: 前端 UI 直接渲染的「当前命中规则」列表（无 dedup）。
    signals,
    ready,
    triggers: []
  };
}

// 与前端 intraSignals 算法一致（v4：规则基准决定基准，H/L 决定方向）：
//   gap = H溢价 − L溢价（始终 H 在前）。满足以下任一才可能触发：
//   - bench.class === 'L' && cand.class === 'H' && gap < 1% → 卖 bench(L) 买 cand(H)
//   - bench.class === 'H' && cand.class === 'L' && gap > intraBuyOtherPct → 卖 bench(H) 买 cand(L)
//   同类、未分类、数据缺失 都不触发。
const MAX_SWITCH_PUSHES_PER_TRADING_DAY = 3;

// per-pair dedup：同一交易日内同一 rule 最多推 3 次；跨交易日重新计数。
function classifyRule({ benchClass, candClass, gap, sellLower, buyOther }) {
  if (!Number.isFinite(gap)) return 'none';
  if (benchClass !== 'H' && benchClass !== 'L') return 'none';
  if (candClass !== 'H' && candClass !== 'L') return 'none';
  if (benchClass === candClass) return 'none';
  if (benchClass === 'L' && gap < sellLower) return 'A';
  if (benchClass === 'H' && gap > buyOther) return 'B';
  return 'none';
}

function readDailyTriggerCount(prev = {}, rule = '', signalDate = '') {
  const prevRule = String(prev.lastTriggeredRule || prev.rule || '').trim();
  const prevDate = String(prev.lastTriggeredDate || '').trim();
  if (prevRule !== rule || prevDate !== signalDate) return 0;
  return Math.max(0, Number.parseInt(String(prev.dailyTriggerCount || '0'), 10) || 0);
}

function buildTriggerCounterState(prev = {}, rule = '', signalDate = '', didTrigger = false) {
  if (rule === 'none') {
    return {
      lastTriggeredDate: String(prev.lastTriggeredDate || '').trim(),
      lastTriggeredRule: String(prev.lastTriggeredRule || '').trim(),
      dailyTriggerCount: Math.max(0, Number.parseInt(String(prev.dailyTriggerCount || '0'), 10) || 0)
    };
  }
  const prevCount = readDailyTriggerCount(prev, rule, signalDate);
  return {
    lastTriggeredDate: signalDate,
    lastTriggeredRule: rule,
    dailyTriggerCount: didTrigger ? prevCount + 1 : prevCount
  };
}

export function evaluateSwitchTriggers(snapshot, prevTriggerStates = {}) {
  const sellLower = Number(snapshot.intraSellLowerPct);
  const buyOther = Number(snapshot.intraBuyOtherPct);
  const premiumClass =
    snapshot && typeof snapshot.premiumClass === 'object' && snapshot.premiumClass
      ? snapshot.premiumClass
      : {};
  const signalDate = getShanghaiDateKey(snapshot?.computedAt || Date.now());
  const nextTriggerStates = {};
  const triggers = [];

  function preservePreviousOtcStates() {
    for (const [key, value] of Object.entries(prevTriggerStates || {})) {
      if (String(key).startsWith('otc:')) nextTriggerStates[key] = value;
    }
  }

  const groups = Array.isArray(snapshot.byBenchmark) ? snapshot.byBenchmark : [];
  for (const group of groups) {
    const benchmark = group?.benchmarkCode || '';
    const benchName = group?.benchmarkName || '';
    if (!benchmark) continue;
    const benchClass = premiumClass[benchmark];
    for (const cand of group.candidates || []) {
      const pairKey = `${benchmark}:${cand.code}`;
      const candClass = premiumClass[cand.code];
      // Number(null) 会变成 0，会被误当作「diff = 0%」。仅在原始值为 number 时才计算。
      const rawDiff = cand.spreadVsBenchmarkPct;
      const diff = typeof rawDiff === 'number' && Number.isFinite(rawDiff) ? rawDiff : NaN;
      if (!Number.isFinite(diff)) {
        const prev = prevTriggerStates?.[pairKey];
        if (prev) nextTriggerStates[pairKey] = prev;
        continue;
      }
      // diff = benchPremium − candPremium。gap 始终以 H 为被减数：
      //   bench=H → gap = diff；bench=L → gap = -diff。未分类 → gap=NaN。
      let gap = NaN;
      if (benchClass === 'H') gap = diff;
      else if (benchClass === 'L') gap = -diff;
      const rule = classifyRule({ benchClass, candClass, gap, sellLower, buyOther });
      // 方向始终是「卖/观察基准 bench, 买候选 cand」。
      const fromCode = rule === 'none' ? '' : benchmark;
      const toCode = rule === 'none' ? '' : cand.code;
      const fromName = benchName;
      const toName = cand.name || '';
      const threshold = rule === 'A' ? sellLower : rule === 'B' ? buyOther : NaN;
      const prev = prevTriggerStates?.[pairKey] || { rule: 'none' };
      const dailyTriggerCount = readDailyTriggerCount(prev, rule, signalDate);
      const didTrigger = rule !== 'none' && dailyTriggerCount < MAX_SWITCH_PUSHES_PER_TRADING_DAY;
      if (didTrigger) {
        triggers.push({
          pairKey,
          rule,
          fromCode,
          toCode,
          fromName,
          toName,
          // diffPct 字段保留为「H−L gap」（UI 渲染以该值为准）。
          diffPct: gap,
          gapPct: gap,
          threshold,
          benchClass,
          candClass,
          operator: rule === 'A' ? 'lte' : rule === 'B' ? 'gte' : ''
        });
      }
      nextTriggerStates[pairKey] = {
        rule,
        fromCode,
        ...buildTriggerCounterState(prev, rule, signalDate, didTrigger),
        lastDiffPct: diff,
        lastGapPct: Number.isFinite(gap) ? gap : null,
        updatedAt: snapshot.computedAt
      };
    }
  }

  const otc = snapshot?.otcSignal;
  if (otc?.ready && otc.benchCode && otc.lowestCode) {
    const pairKey = `otc:${otc.benchCode}:${otc.lowestCode}`;
    const rule = otc.triggered ? (otc.intraLowHard ? 'OTC_STRONG' : 'OTC_WEAK') : 'none';
    const prev = prevTriggerStates?.[pairKey] || { rule: 'none' };
    const dailyTriggerCount = readDailyTriggerCount(prev, rule, signalDate);
    const didTrigger = rule !== 'none' && dailyTriggerCount < MAX_SWITCH_PUSHES_PER_TRADING_DAY;
    if (didTrigger) {
      triggers.push({
        kind: 'otc',
        pairKey,
        rule,
        fromCode: otc.benchCode,
        fromName: otc.benchName || '',
        toCode: otc.lowestCode,
        toName: otc.lowestName || '',
        level: otc.level || (rule === 'OTC_STRONG' ? '强信号' : '弱信号'),
        benchPremiumPct: otc.benchPremiumPct,
        lowestPremiumPct: otc.lowestPremiumPct,
        threshold: otc.otcPremiumThresholdPct,
        lowThreshold: otc.otcMinIntraPremiumLow,
        highThreshold: otc.otcMinIntraPremiumHigh
      });
    }
    nextTriggerStates[pairKey] = {
      rule,
      fromCode: otc.benchCode,
      toCode: otc.lowestCode,
      ...buildTriggerCounterState(prev, rule, signalDate, didTrigger),
      level: otc.level || '',
      lastBenchPremiumPct: Number.isFinite(otc.benchPremiumPct) ? otc.benchPremiumPct : null,
      lastLowestPremiumPct: Number.isFinite(otc.lowestPremiumPct) ? otc.lowestPremiumPct : null,
      updatedAt: snapshot.computedAt
    };
  } else {
    preservePreviousOtcStates();
  }

  return { triggers, nextTriggerStates };
}

function formatSignedPercentText(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

function formatDepthPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return num >= 10 ? num.toFixed(2) : num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function formatDepthVolume(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (num >= 100000000) return `${(num / 100000000).toFixed(2)}亿`;
  if (num >= 10000) return `${(num / 10000).toFixed(2)}万`;
  return String(Math.round(num));
}

function formatOrderBookLine(label, orderBook) {
  const book = normalizeOrderBook(orderBook);
  if (!book) return '';
  const levelNames = ['一', '二', '三'];
  const levels = book.levels?.length
    ? book.levels
    : [
        {
          level: 1,
          bidPrice: book.bidPrice,
          bidVolume: book.bidVolume,
          askPrice: book.askPrice,
          askVolume: book.askVolume
        }
      ];
  const depthText = levels
    .slice(0, 3)
    .map((level) => {
      const name = levelNames[level.level - 1] || String(level.level);
      const bidPrice = formatDepthPrice(level.bidPrice);
      const askPrice = formatDepthPrice(level.askPrice);
      const bidVolume = formatDepthVolume(level.bidVolume);
      const askVolume = formatDepthVolume(level.askVolume);
      const bid = bidVolume ? `${bidPrice} × ${bidVolume}` : bidPrice;
      const ask = askVolume ? `${askPrice} × ${askVolume}` : askPrice;
      return `买${name} ${bid} / 卖${name} ${ask}`;
    })
    .join('；');
  const spread = Number(book.spread);
  const spreadText = Number.isFinite(spread) ? `，价差 ${formatDepthPrice(spread)}` : '';
  return `${label}盘口：${depthText}${spreadText}`;
}

function findSwitchOrderBookLines(snapshot, trigger) {
  const groups = Array.isArray(snapshot?.byBenchmark) ? snapshot.byBenchmark : [];
  const group = groups.find((item) => item?.benchmarkCode === trigger?.fromCode) || null;
  const candidate = (group?.candidates || []).find((item) => item?.code === trigger?.toCode) || null;
  return [
    formatOrderBookLine(trigger?.fromCode || '', group?.benchmarkOrderBook),
    formatOrderBookLine(trigger?.toCode || '', candidate?.orderBook)
  ].filter(Boolean);
}

function buildOtcSwitchTriggerNotification(snapshot, trigger, env) {
  const fromLabel = trigger.fromName ? `${trigger.fromCode} ${trigger.fromName}` : trigger.fromCode;
  const refLabel = trigger.toName ? `${trigger.toCode} ${trigger.toName}` : trigger.toCode;
  const benchPremium = formatSignedPercentText(trigger.benchPremiumPct);
  const lowestPremium = formatSignedPercentText(trigger.lowestPremiumPct);
  const threshold = Number(trigger.threshold);
  const lowThreshold = Number(trigger.lowThreshold);
  const highThreshold = Number(trigger.highThreshold);
  const signalThreshold = trigger.rule === 'OTC_STRONG' ? lowThreshold : highThreshold;
  const level = trigger.level || (trigger.rule === 'OTC_STRONG' ? '强信号' : '弱信号');
  const otcOrderBookLines = [
    formatOrderBookLine(trigger.fromCode, snapshot?.otcSignal?.benchOrderBook),
    formatOrderBookLine(trigger.toCode, snapshot?.otcSignal?.lowestOrderBook)
  ].filter(Boolean);
  const otcOrderBookText = otcOrderBookLines.length ? `\n${otcOrderBookLines.join('\n')}` : '';
  const action = buildNotificationAction(env, 'fundSwitch', {
    code: trigger.fromCode,
    targetCode: trigger.toCode,
    trigger: 'switch-otc',
    rule: trigger.rule || ''
  });
  const minuteKey = String(snapshot?.computedAt || '').slice(0, 16);
  const eventId = `switch:${trigger.pairKey}:R${trigger.rule}:${minuteKey}`;
  const title = `场外切换 ${level} | ${trigger.fromCode}→场外QDII`;
  const ruleLabel =
    trigger.rule === 'OTC_STRONG'
      ? `场外强信号：基准溢价 > ${threshold}% 且场内最低溢价 < ${lowThreshold}%`
      : `场外弱信号：基准溢价 > ${threshold}% 且场内最低溢价 < ${highThreshold}%`;
  const body = `基准溢价 ${benchPremium} > ${threshold}% · 场内最低 ${lowestPremium} < ${signalThreshold}%\n卖 ${fromLabel} → 申购场外 QDII 联接基金\n参考低溢价 ${refLabel}${otcOrderBookText}\n点此查看策略详情，下单前请以基金软件实时溢价和申购限额为准。`;
  const summary = `场外切换 ${level} ${trigger.fromCode}→场外QDII ${benchPremium}/${lowestPremium}`;
  const body_md = [
    `**基准溢价 ${benchPremium}** > ${threshold}%`,
    `**场内最低 ${lowestPremium}** < ${signalThreshold}%（参考 ${refLabel}）`,
    `卖 **${fromLabel}** → 申购 **场外 QDII 联接基金**`,
    ...otcOrderBookLines.map((line) => `- ${line}`),
    `*下单前请以基金软件实时溢价和申购限额为准。*`
  ].join('\n');
  return {
    eventId,
    eventType: 'switch-strategy-trigger',
    ruleId: trigger.ruleId
      ? `switch-otc:${trigger.ruleId}:${trigger.fromCode}`
      : `switch-otc:${trigger.fromCode}`,
    symbol: trigger.fromCode,
    strategyName: trigger.ruleName ? `场外切换 · ${trigger.ruleName}` : '场外切换',
    triggerCondition: ruleLabel,
    purchaseAmount: '',
    detailUrl: action.detailUrl,
    url: action.url,
    links: action.links,
    target: action.target,
    params: action.params,
    title,
    body,
    summary,
    body_md
  };
}

export function buildSwitchTriggerNotification(snapshot, trigger, env) {
  if (trigger?.kind === 'otc' || String(trigger?.rule || '').startsWith('OTC_')) {
    return buildOtcSwitchTriggerNotification(snapshot, trigger, env);
  }
  // v4 通知格式（规则基准 bench + H/L 双维度）：
  //   title:   切换 A 低→高 | 159632→513100
  //   body:    H−L +0.85% < 1%  · NAV 2026-04-28
  //            卖 159632 纳指ETF → 买 513100 纳指ETF
  //            下单前请以基金软件实时溢价为准。
  const fromLabel = trigger.fromName ? `${trigger.fromCode} ${trigger.fromName}` : trigger.fromCode;
  const toLabel = trigger.toName ? `${trigger.toCode} ${trigger.toName}` : trigger.toCode;
  const gap = Number(trigger.gapPct ?? trigger.diffPct);
  const gapStr = (gap >= 0 ? '+' : '') + gap.toFixed(2);
  const threshold = Number(trigger.threshold);
  const userFacing = trigger.operator === 'gte' || trigger.operator === 'lte';
  const compatibilityRule = trigger.operator === 'lte' ? 'A' : 'B';
  const cmp = trigger.operator === 'lte' ? '<' : '>';
  // v4：fromCode 始终 = benchmark（规则基准）。H 组只：
  //   bench.class === 'H' → H = fromCode；bench.class === 'L' → H = toCode。
  const benchHCode = trigger.benchClass === 'H' ? trigger.fromCode : trigger.toCode;
  const benchmarkEntry =
    (Array.isArray(snapshot?.byBenchmark) ? snapshot.byBenchmark : []).find(
      (b) => b?.benchmarkCode === benchHCode
    ) || null;
  const navDate = String(benchmarkEntry?.benchmarkNavDate || '').trim();
  const navHint = navDate ? ` · NAV ${navDate}` : '';
  const orderBookLines = findSwitchOrderBookLines(snapshot, trigger);
  const orderBookText = orderBookLines.length ? `\n${orderBookLines.join('\n')}` : '';
  const arrow = trigger.rule === 'A' ? '低→高' : '高→低';
  const staleText =
    snapshot?.classificationStatus === 'stale'
      ? `\n本次提醒基于 ${snapshot?.classificationUpdatedAt || '上次分析时间'} 的历史分析，建议打开 App 确认当前数据。`
      : '';
  const title = userFacing
    ? `基金切换提醒 | ${trigger.fromCode}→${trigger.toCode}`
    : `切换 ${trigger.rule} ${arrow} | ${trigger.fromCode}→${trigger.toCode}`;
  const body = userFacing
    ? `当前切换优势 ${gapStr}% ${cmp} ${threshold}%${navHint}\n卖 ${fromLabel} → 买 ${toLabel}${orderBookText}\n下单前请以基金软件实时溢价为准。${staleText}`
    : `H−L ${gapStr}% ${cmp} ${threshold}%${navHint}\n卖 ${fromLabel} → 买 ${toLabel}${orderBookText}\n下单前请以基金软件实时溢价为准。`;
  const summary = userFacing
    ? `基金切换提醒 ${trigger.fromCode}→${trigger.toCode} ${gapStr}%`
    : `切换 ${trigger.rule} ${trigger.fromCode}→${trigger.toCode} ${gapStr}%`;
  const ruleLabel = userFacing
    ? trigger.operator === 'lte'
      ? `当 H-L 溢价差小于 ${threshold}% 时提醒`
      : `当当前持仓比同类候选基金贵 ${threshold}% 时提醒`
    : trigger.rule === 'A'
      ? `规则 A 低→高：H溢价 − L溢价 < ${threshold}%（差价收窄，从持仓 L 换到 H）`
      : `规则 B 高→低：H溢价 − L溢价 > ${threshold}%（差价扩大，从持仓 H 换到 L）`;
  const action = buildNotificationAction(env, 'fundSwitch', {
    code: trigger.fromCode,
    targetCode: trigger.toCode,
    trigger: 'switch-threshold',
    rule: userFacing ? compatibilityRule : trigger.rule || ''
  });
  // 同一对 + 同一规则 + 同一分钟，只发一次。
  const minuteKey = String(snapshot?.computedAt || '').slice(0, 16);
  // pairKey 已含 benchmark:cand，多基准下仍唯一。
  const eventId = `switch:${trigger.pairKey}:R${userFacing ? compatibilityRule : trigger.rule}:${minuteKey}`;
  const body_md = [
    userFacing
      ? `**当前切换优势 ${gapStr}%** ${cmp} ${threshold}%${navHint}`
      : `**H−L ${gapStr}%** ${cmp} ${threshold}%${navHint}`,
    `卖 **${fromLabel}** → 买 **${toLabel}**`,
    ...orderBookLines.map((line) => `- ${line}`),
    `*点此查看策略详情，下单前请以基金软件实时溢价为准。*${staleText}`
  ].join('\n');
  return {
    eventId,
    eventType: 'switch-strategy-trigger',
    ruleId: trigger.ruleId ? `switch:${trigger.ruleId}:${trigger.fromCode}` : `switch:${trigger.fromCode}`,
    symbol: trigger.fromCode,
    strategyName: trigger.ruleName ? `场内切换 · ${trigger.ruleName}` : '场内切换',
    triggerCondition: ruleLabel,
    purchaseAmount: '',
    detailUrl: action.detailUrl,
    url: action.url,
    links: action.links,
    target: action.target,
    params: action.params,
    title,
    body: `${body}\n点此查看策略详情。`,
    summary,
    body_md
  };
}

/**
 * 测试方法：获取 513100 的最新净值
 * 用于验证统一 NAV 方法对美股 QDII 的支持
 */
export async function testGetNav513100(env) {
  const code = '513100';
  try {
    const result = await getLatestNavWithCache(env, code, 'qdii');
    return {
      success: true,
      code,
      fundKind: 'qdii',
      data: result,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      code,
      fundKind: 'qdii',
      error: String(error),
      timestamp: new Date().toISOString()
    };
  }
}
