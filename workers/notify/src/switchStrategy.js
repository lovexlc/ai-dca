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
  fetchSinaPrices,
  getLatestNavWithCache,
  NAV_CACHE_PREFIX
} from './getNav.js';

export const SWITCH_CONFIG_PREFIX = 'switch:config:';
export const SWITCH_SNAPSHOT_PREFIX = 'switch:snapshot:';
export const SWITCH_STATE_PREFIX = 'switch:state:';

export function switchConfigKey(clientId) {
  return `${SWITCH_CONFIG_PREFIX}${clientId}`;
}
export function switchSnapshotKey(clientId) {
  return `${SWITCH_SNAPSHOT_PREFIX}${clientId}`;
}
export function switchStateKey(clientId) {
  return `${SWITCH_STATE_PREFIX}${clientId}`;
}
export function navCacheKey(code) {
  return `${NAV_CACHE_PREFIX}${sanitizeCode(code)}`;
}

const FUND_CODE_PATTERN = /^\d{6}$/;
const MAX_CANDIDATES = 20;
// 与前端 SwitchStrategyExperience 的 DEFAULT_PREFS 保持一致。
// v3 持仓 + H/L 双维度：
//   benchmarkCodes = 持仓基准（前端从持仓详情自动派生，worker 端只接收）
//   enabledCodes   = 用户挑选的候选（前端按 H/L 分类做对侧过滤后下发）
//   premiumClass   = 每只 ETF 的「溢价中枢」分类 'H' | 'L'，与持仓/候选解耦
//   触发方向锚定在 benchmark 的分类：
//     bench ∈ L 持有 → 仅看规则 A：gap = H溢价 − L溢价 < X% → 卖 bench(L) 买 cand(H)
//     bench ∈ H 持有 → 仅看规则 B：gap = H溢价 − L溢价 > Y% → 卖 bench(H) 买 cand(L)
//     同类、未分类、cand 未分类 都不触发。
const DEFAULT_INTRA_SELL_LOWER_PCT = 1;   // 规则 A：差价收窄阈值
const DEFAULT_INTRA_BUY_OTHER_PCT = 3;    // 规则 B：差价扩大阈值
const DEFAULT_SWITCH_RULE = {
  id: 'rule-default',
  name: '默认规则',
  enabled: true,
  benchmarkCodes: [],
  enabledCodes: [],
  premiumClass: {},
  intraSellLowerPct: DEFAULT_INTRA_SELL_LOWER_PCT,
  intraBuyOtherPct: DEFAULT_INTRA_BUY_OTHER_PCT
};
const DELAYED_OPEN_PREMIUM_THRESHOLD_PCT = 10;
const DELAYED_OPEN_UNTIL_MINUTE = 10 * 60 + 30;

function sanitizeCode(value) {
  const code = String(value || '').trim();
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

function pickPercent(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  // 阈值限为 [-50, 50]，防止脱疑配置。
  if (num < -50) return -50;
  if (num > 50) return 50;
  return num;
}

function normalizeSwitchRule(rule = {}, index = 0, fallbackSource = {}) {
  const fallback = index === 0
    ? {
        ...DEFAULT_SWITCH_RULE,
        intraSellLowerPct: fallbackSource?.intraSellLowerPct,
        intraBuyOtherPct: fallbackSource?.intraBuyOtherPct
      }
    : {
        ...DEFAULT_SWITCH_RULE,
        id: `rule-${index + 1}`,
        name: `规则 ${index + 1}`
      };
  return {
    id: String(rule?.id || fallback.id || `rule-${index + 1}`).trim().slice(0, 64),
    name: String(rule?.name || fallback.name || `规则 ${index + 1}`).trim().slice(0, 40),
    enabled: rule?.enabled !== false,
    benchmarkCodes: normalizeCodeList(rule?.benchmarkCodes, fallback.benchmarkCodes || fallbackSource?.benchmarkCodes),
    enabledCodes: normalizeCodeList(rule?.enabledCodes, fallback.enabledCodes || fallbackSource?.enabledCodes),
    premiumClass: normalizePremiumClass(rule?.premiumClass || fallback.premiumClass || fallbackSource?.premiumClass),
    intraSellLowerPct: pickPercent(rule?.intraSellLowerPct, fallback.intraSellLowerPct),
    intraBuyOtherPct: pickPercent(rule?.intraBuyOtherPct, fallback.intraBuyOtherPct)
  };
}

function normalizeSwitchRules(input, fallbackSource = {}) {
  const raw = Array.isArray(input) ? input : [];
  const source = raw.length ? raw.map((rule, index) => (
    index === 0 ? {
      ...rule,
      benchmarkCodes: rule?.benchmarkCodes ?? fallbackSource?.benchmarkCodes,
      enabledCodes: rule?.enabledCodes ?? fallbackSource?.enabledCodes,
      premiumClass: rule?.premiumClass ?? fallbackSource?.premiumClass
    } : rule
  )) : [{
    ...DEFAULT_SWITCH_RULE,
    benchmarkCodes: fallbackSource?.benchmarkCodes,
    enabledCodes: fallbackSource?.enabledCodes,
    premiumClass: fallbackSource?.premiumClass,
    intraSellLowerPct: fallbackSource?.intraSellLowerPct,
    intraBuyOtherPct: fallbackSource?.intraBuyOtherPct
  }];
  const seen = new Set();
  const rules = [];
  for (const item of source) {
    const rule = normalizeSwitchRule(item, rules.length, fallbackSource);
    if (!rule.id || seen.has(rule.id)) rule.id = `rule-${rules.length + 1}`;
    seen.add(rule.id);
    rules.push(rule);
    if (rules.length >= MAX_CANDIDATES / 2) break;
  }
  return rules.length ? rules : [normalizeSwitchRule(DEFAULT_SWITCH_RULE, 0, fallbackSource)];
}

function normalizeCodeList(input, fallback = []) {
  const raw = Array.isArray(input) ? input : fallback;
  const seen = new Set();
  const codes = [];
  for (const item of raw || []) {
    const code = sanitizeCode(item);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (codes.length >= MAX_CANDIDATES) break;
  }
  return codes;
}

function normalizePremiumClass(input = {}) {
  const rawClass = input && typeof input === 'object' ? input : {};
  const premiumClass = {};
  for (const [code, value] of Object.entries(rawClass)) {
    const c = sanitizeCode(code);
    const v = String(value || '').trim().toUpperCase();
    if (c && (v === 'H' || v === 'L')) premiumClass[c] = v;
  }
  return premiumClass;
}

// 配置与前端 aiDcaSwitchStrategyPrefs 同名，不重复定义一套参数。
// v3 持仓 + H/L 双维度（持仓决定基准，H/L 决定方向）：
//  - benchmarkCodes: 持仓基准（前端从持仓详情自动派生，禁止手挑非持仓代码）
//  - enabledCodes:   候选（前端按 premiumClass 过滤后只剩对侧）
//  - premiumClass:   { [code]: 'H' | 'L' }，每只 ETF 的溢价中枢标签
//  - intraSellLowerPct / intraBuyOtherPct: 阈值，与页面同名同义。
//  - 触发逻辑：每对 (bench, cand) 仅当 cand.class !== bench.class 且都已分类时考虑：
//      bench=L → 看 gap = H溢价 − L溢价 < sellLower → 规则 A：卖 bench(L) 买 cand(H)
//      bench=H → 看 gap > buyOther                  → 规则 B：卖 bench(H) 买 cand(L)
//  - 未分类的 bench 或 cand：不触发，前端会有提示。
export function normalizeSwitchConfig(input = {}) {
  // 兼容旧格式：input.benchmarkCode (string) → [benchmarkCode]。
  const rawBenchmarks = Array.isArray(input?.benchmarkCodes)
    ? input.benchmarkCodes
    : (input?.benchmarkCode ? [input.benchmarkCode] : []);
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
    : Array.isArray(input?.candidateCodes) ? input.candidateCodes : [];
  const enabledCodes = [];
  for (const raw of enabledCodesRaw) {
    const code = sanitizeCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    enabledCodes.push(code);
    if (enabledCodes.length >= MAX_CANDIDATES) break;
  }
  const legacyPremiumClass = normalizePremiumClass(input?.premiumClass);
  const rules = normalizeSwitchRules(input?.rules, {
    ...input,
    benchmarkCodes,
    enabledCodes,
    premiumClass: legacyPremiumClass
  });
  const unionBenchmarks = [];
  const unionEnabled = [];
  const unionClass = {};
  const seenBench = new Set();
  const seenEnabled = new Set();
  for (const rule of rules) {
    for (const code of rule.benchmarkCodes || []) {
      if (!seenBench.has(code)) {
        seenBench.add(code);
        unionBenchmarks.push(code);
      }
    }
    for (const code of rule.enabledCodes || []) {
      if (!seenBench.has(code) && !seenEnabled.has(code)) {
        seenEnabled.add(code);
        unionEnabled.push(code);
      }
    }
    Object.assign(unionClass, normalizePremiumClass(rule.premiumClass));
  }
  const primaryRule = rules[0] || DEFAULT_SWITCH_RULE;
  return {
    enabled: Boolean(input?.enabled),
    benchmarkCodes: unionBenchmarks.length ? unionBenchmarks : benchmarkCodes,
    enabledCodes: unionEnabled.length ? unionEnabled : enabledCodes,
    premiumClass: Object.keys(unionClass).length ? unionClass : legacyPremiumClass,
    rules,
    intraSellLowerPct: pickPercent(input?.intraSellLowerPct, primaryRule.intraSellLowerPct),
    intraBuyOtherPct: pickPercent(input?.intraBuyOtherPct, primaryRule.intraBuyOtherPct),
    clientLabel: String(input?.clientLabel || '').trim().slice(0, 120),
    updatedAt: String(input?.updatedAt || '').trim() || new Date().toISOString()
  };
}

export function isSwitchConfigRunnable(config) {
  if (!config || !config.enabled) return false;
  const rules = normalizeSwitchRules(config.rules, config).filter((rule) => rule.enabled);
  if (!rules.length) return false;
  for (const rule of rules) {
    if (!(rule.intraBuyOtherPct > rule.intraSellLowerPct)) continue;
    const benches = Array.isArray(rule.benchmarkCodes) ? rule.benchmarkCodes : [];
    if (!benches.length) continue;
    const enabled = Array.isArray(rule.enabledCodes) ? rule.enabledCodes : [];
    const cls = normalizePremiumClass(rule.premiumClass);
    const pool = Array.from(new Set([...benches, ...enabled])).filter((c) => cls[c] === 'H' || cls[c] === 'L');
    for (const b of benches) {
      const bc = cls[b];
      if (bc !== 'H' && bc !== 'L') continue;
      const opp = bc === 'H' ? 'L' : 'H';
      if (pool.some((c) => c !== b && cls[c] === opp)) return true;
    }
  }
  return false;
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

function positiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : NaN;
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
  if (!Number.isFinite(previousClosePremiumPct) || previousClosePremiumPct <= DELAYED_OPEN_PREMIUM_THRESHOLD_PCT) {
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
// 其中 fetchLatestNav, fetchLatestNavMap, fetchLatestNavMapWithCache, fetchSinaPrices, getLatestNavWithCache
// 均由 getNav.js 统一接入 markets/fund-metrics；fetchSinaPrices 是兼容旧调用名。
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
    for (const cand of (group?.candidates || [])) {
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
      Array.from(allCodes).map(code => 
        getLatestNavFn(env, code, codeToKind[code] || 'exchange', { forceRefresh: false })
          .catch(() => null)
      )
    );
    for (const result of results) {
      if (result && result.code) {
        navByCode[result.code] = result;
      }
    }
    console.log(`[switch] refreshSnapshotWithLatestNav: 用 KV 缓存拉取 ${Object.keys(navByCode).length}/${allCodes.size} 个基金`);
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
    const benchPremium = Number.isFinite(benchPrice) && Number.isFinite(benchNav) && benchNav > 0 && !benchNavStale && !benchDelayedOpen
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
      const candPremium = (!navMissing && !priceMissing && !navStale && !candDelayedOpen)
        ? ((candPrice - candNav) / candNav) * 100
        : null;
      const diff = Number.isFinite(benchPremium) && Number.isFinite(candPremium)
        ? benchPremium - candPremium
        : null;

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
      benchmarkNote: !Number.isFinite(benchPrice) || benchPrice <= 0
        ? 'price-missing'
        : (!Number.isFinite(benchNav) || benchNav <= 0)
          ? 'nav-missing'
          : (benchNavStale ? 'nav-stale' : (benchDelayedOpen ? 'delayed-open' : '')),
      candidates: updatedCandidates
    };
  });

  // 第四步：重新计算 ready 标志和 signals
  const ready = updatedByBenchmark.some((b) =>
    Number.isFinite(b.benchmarkPremiumPct)
    && b.candidates.some((c) => Number.isFinite(c.spreadVsBenchmarkPct))
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

  const rules = normalizeSwitchRules(config.rules, config);
  const byBenchmark = rules.flatMap((ruleConfig) => {
    const benchmarkCodes = Array.isArray(ruleConfig.benchmarkCodes) ? ruleConfig.benchmarkCodes : [];
    const enabledCodes = Array.isArray(ruleConfig.enabledCodes) ? ruleConfig.enabledCodes : [];
    const premiumClass = normalizePremiumClass(ruleConfig.premiumClass);
    const classifiedPool = Array.from(new Set([...benchmarkCodes, ...enabledCodes]))
      .filter((c) => premiumClass[c] === 'H' || premiumClass[c] === 'L');
    return benchmarkCodes.map((benchmarkCode) => {
      const benchmarkClass = premiumClass[benchmarkCode] || null;
      const oppClass = benchmarkClass === 'H' ? 'L' : (benchmarkClass === 'L' ? 'H' : null);
      const eligibleCodes = oppClass
        ? classifiedPool.filter((c) => c !== benchmarkCode && premiumClass[c] === oppClass)
        : enabledCodes;

      const benchPrice = Number(priceMap?.[benchmarkCode]?.price);
      const benchNav = Number(navByCode?.[benchmarkCode]?.nav);
      const benchNavDate = String(navByCode?.[benchmarkCode]?.latestNavDate || '').trim();
      const benchNavStale = navAgeDays(benchNavDate) > NAV_STALE_DAYS;
      const benchDelayedOpen = getDelayedOpenInfo(benchmarkCode, priceMap, navByCode, computedAtIso, navAgeDays);
      const benchPremium = Number.isFinite(benchPrice) && Number.isFinite(benchNav) && benchNav > 0 && !benchNavStale && !benchDelayedOpen.delayed
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
        const candPremium = (!navMissing && !priceMissing && !navStale && !candDelayedOpen.delayed)
          ? ((candPrice - candNav) / candNav) * 100
          : null;
        const diff = Number.isFinite(benchPremium) && Number.isFinite(candPremium)
          ? benchPremium - candPremium
          : null;
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
          nav: Number.isFinite(candNav) ? candNav : null,
          navDate: candNavDate,
          premiumPct: Number.isFinite(candPremium) ? candPremium : null,
          previousClosePremiumPct: Number.isFinite(candDelayedOpen.previousClosePremiumPct) ? candDelayedOpen.previousClosePremiumPct : null,
          delayedOpen: Boolean(candDelayedOpen.delayed),
          delayedUntil: candDelayedOpen.delayedUntil || '',
          spreadVsBenchmarkPct: Number.isFinite(diff) ? diff : null,
          candClass: premiumClass[code] || null,
          note
        };
      });

      return {
        ruleId: ruleConfig.id,
        ruleName: ruleConfig.name,
        benchmarkCode,
        benchmarkName: navByCode?.[benchmarkCode]?.name || '',
        benchmarkClass,
        benchmarkPrice: Number.isFinite(benchPrice) ? benchPrice : null,
        benchmarkNav: Number.isFinite(benchNav) ? benchNav : null,
        benchmarkNavDate: benchNavDate,
        benchmarkPremiumPct: Number.isFinite(benchPremium) ? benchPremium : null,
        benchmarkPreviousClosePremiumPct: Number.isFinite(benchDelayedOpen.previousClosePremiumPct) ? benchDelayedOpen.previousClosePremiumPct : null,
        benchmarkDelayedOpen: Boolean(benchDelayedOpen.delayed),
        benchmarkDelayedUntil: benchDelayedOpen.delayedUntil || '',
        benchmarkNote: !Number.isFinite(benchPrice) || benchPrice <= 0
          ? 'price-missing'
          : (!Number.isFinite(benchNav) || benchNav <= 0)
            ? 'nav-missing'
            : (benchNavStale ? 'nav-stale' : (benchDelayedOpen.delayed ? 'delayed-open' : '')),
        candidates
      };
    });
  });

  const ready = byBenchmark.some((b) =>
    Number.isFinite(b.benchmarkPremiumPct)
    && b.candidates.some((c) => Number.isFinite(c.spreadVsBenchmarkPct))
  );

  // signals: 与前端原 intraSignals 同语义的「当前命中规则」列表（无 dedup，每次快照重算）。
  // 前端 UI 直接渲染这一列表，避免浏览器再独立算一份。
  const signals = [];
  for (const group of byBenchmark) {
    const benchCode = group?.benchmarkCode || '';
    if (!benchCode) continue;
    if (!Number.isFinite(group?.benchmarkPremiumPct)) continue;
    const ruleConfig = rules.find((rule) => rule.id === group.ruleId);
    if (!ruleConfig || !ruleConfig.enabled) continue;
    if (!(Number(ruleConfig.intraBuyOtherPct) > Number(ruleConfig.intraSellLowerPct))) continue;
    const premiumClass = normalizePremiumClass(ruleConfig.premiumClass);
    const benchClass = premiumClass[benchCode];
    for (const cand of (group.candidates || [])) {
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
        sellLower: Number(ruleConfig.intraSellLowerPct),
        buyOther: Number(ruleConfig.intraBuyOtherPct)
      });
      if (rule === 'none') continue;
      const hCode = benchClass === 'H' ? benchCode : cand.code;
      const lCode = benchClass === 'H' ? cand.code : benchCode;
      const tag = rule === 'A' ? '差价收窄' : '差价扩大';
      const arrow = rule === 'A' ? '低→高' : '高→低';
      const cmp = rule === 'A' ? '<' : '>';
      const threshold = rule === 'A' ? Number(ruleConfig.intraSellLowerPct) : Number(ruleConfig.intraBuyOtherPct);
      const gapStr = (gap >= 0 ? '+' : '') + gap.toFixed(2);
      signals.push({
        kind: rule,
        ruleId: ruleConfig.id,
        ruleName: ruleConfig.name,
        from: benchCode,
        fromName: group.benchmarkName || benchCode,
        to: cand.code,
        toName: cand.name || cand.code,
        gapPct: gap,
        threshold,
        description: `${hCode}(H) − ${lCode}(L) 溢价差 ${gapStr}% ${cmp} ${threshold}%（${ruleConfig.name} · ${tag}，${arrow}）：卖 ${benchCode} 买 ${cand.code}`
      });
    }
  }

  return {
    computedAt: computedAtIso,
    intraSellLowerPct: Number(config.intraSellLowerPct),
    intraBuyOtherPct: Number(config.intraBuyOtherPct),
    rules,
    // 随快照一起带 premiumClass，供 evaluateSwitchTriggers 使用。
    premiumClass: config.premiumClass || {},
    byBenchmark,
    // signals: 前端 UI 直接渲染的「当前命中规则」列表（无 dedup）。
    signals,
    ready,
    triggers: []
  };
}

// 与前端 intraSignals 算法一致（v3：持仓决定基准，H/L 决定方向）：
//   gap = H溢价 − L溢价（始终 H 在前）。满足以下任一才可能触发：
//   - bench.class === 'L' && cand.class === 'H' && gap < intraSellLowerPct → 规则 A：卖 bench(L) 买 cand(H)
//   - bench.class === 'H' && cand.class === 'L' && gap > intraBuyOtherPct  → 规则 B：卖 bench(H) 买 cand(L)
//   同类、未分类、数据缺失 都不触发。
// per-pair dedup：仅当本轮 rule 与上次不同时才推送（方向已被类别锁定，不会翻转）。
function classifyRule({ benchClass, candClass, gap, sellLower, buyOther }) {
  if (!Number.isFinite(gap)) return 'none';
  if (benchClass !== 'H' && benchClass !== 'L') return 'none';
  if (candClass !== 'H' && candClass !== 'L') return 'none';
  if (benchClass === candClass) return 'none';
  if (benchClass === 'L' && gap < sellLower) return 'A';
  if (benchClass === 'H' && gap > buyOther) return 'B';
  return 'none';
}

export function evaluateSwitchTriggers(snapshot, prevTriggerStates = {}) {
  const rules = normalizeSwitchRules(snapshot.rules, snapshot);
  const nextTriggerStates = {};
  const triggers = [];

  const groups = Array.isArray(snapshot.byBenchmark) ? snapshot.byBenchmark : [];
  for (const group of groups) {
    const benchmark = group?.benchmarkCode || '';
    const benchName = group?.benchmarkName || '';
    if (!benchmark) continue;
    const ruleConfig = rules.find((rule) => rule.id === group.ruleId);
    if (!ruleConfig) continue;
    const premiumClass = normalizePremiumClass(ruleConfig.premiumClass);
    const benchClass = premiumClass[benchmark];
    for (const cand of group.candidates || []) {
      const candClass = premiumClass[cand.code];
      // Number(null) 会变成 0，会被误当作「diff = 0%」。仅在原始值为 number 时才计算。
      const rawDiff = cand.spreadVsBenchmarkPct;
      const diff = (typeof rawDiff === 'number' && Number.isFinite(rawDiff)) ? rawDiff : NaN;
      if (!Number.isFinite(diff)) {
        const pairKey = `${benchmark}:${cand.code}:${ruleConfig.id}`;
        const prev = prevTriggerStates?.[pairKey];
        if (prev) nextTriggerStates[pairKey] = prev;
        continue;
      }
      // diff = benchPremium − candPremium。gap 始终以 H 为被减数：
      //   bench=H → gap = diff；bench=L → gap = -diff。未分类 → gap=NaN。
      let gap = NaN;
      if (benchClass === 'H') gap = diff;
      else if (benchClass === 'L') gap = -diff;
      const pairKey = `${benchmark}:${cand.code}:${ruleConfig.id}`;
      if (!ruleConfig.enabled || !(Number(ruleConfig.intraBuyOtherPct) > Number(ruleConfig.intraSellLowerPct))) {
        const prev = prevTriggerStates?.[pairKey];
        if (prev) nextTriggerStates[pairKey] = { ...prev, rule: 'none', updatedAt: snapshot.computedAt };
        continue;
      }
      const rule = classifyRule({
        benchClass,
        candClass,
        gap,
        sellLower: Number(ruleConfig.intraSellLowerPct),
        buyOther: Number(ruleConfig.intraBuyOtherPct)
      });
      const fromCode = rule === 'none' ? '' : benchmark;
      const toCode = rule === 'none' ? '' : cand.code;
      const fromName = benchName;
      const toName = cand.name || '';
      const threshold = rule === 'A' ? Number(ruleConfig.intraSellLowerPct) : (rule === 'B' ? Number(ruleConfig.intraBuyOtherPct) : NaN);
      const prev = prevTriggerStates?.[pairKey] || { rule: 'none' };
      const prevRule = String(prev.rule || 'none');
      if (rule !== 'none' && rule !== prevRule) {
        triggers.push({
          pairKey,
          rule,
          ruleId: ruleConfig.id,
          ruleName: ruleConfig.name,
          fromCode,
          toCode,
          fromName,
          toName,
          diffPct: gap,
          gapPct: gap,
          threshold,
          benchClass,
          candClass
        });
      }
      nextTriggerStates[pairKey] = {
        rule,
        ruleId: ruleConfig.id,
        ruleName: ruleConfig.name,
        fromCode,
        lastDiffPct: diff,
        lastGapPct: Number.isFinite(gap) ? gap : null,
        updatedAt: snapshot.computedAt
      };
    }
  }

  return { triggers, nextTriggerStates };
}

export function buildSwitchTriggerNotification(snapshot, trigger, env) {
  // v3 通知格式（持仓 bench + H/L 双维度）：
  //   title:   切换 A 低→高 | 159632→513100
  //   body:    H−L +0.85% < 1%  · NAV 2026-04-28
  //            卖 159632 纳指ETF → 买 513100 纳指ETF
  //            下单前请以基金软件实时溢价为准。
  const fromLabel = trigger.fromName ? `${trigger.fromCode} ${trigger.fromName}` : trigger.fromCode;
  const toLabel = trigger.toName ? `${trigger.toCode} ${trigger.toName}` : trigger.toCode;
  const gap = Number(trigger.gapPct ?? trigger.diffPct);
  const gapStr = (gap >= 0 ? '+' : '') + gap.toFixed(2);
  const threshold = Number(trigger.threshold);
  const cmp = trigger.rule === 'A' ? '<' : '>';
  // v3：fromCode 始终 = benchmark（持仓）。H 组只：
  //   bench.class === 'H' → H = fromCode；bench.class === 'L' → H = toCode。
  const benchHCode = trigger.benchClass === 'H' ? trigger.fromCode : trigger.toCode;
  const benchmarkEntry = (Array.isArray(snapshot?.byBenchmark) ? snapshot.byBenchmark : [])
    .find((b) => b?.benchmarkCode === benchHCode && (!trigger.ruleId || b?.ruleId === trigger.ruleId)) || null;
  const navDate = String(benchmarkEntry?.benchmarkNavDate || '').trim();
  const navHint = navDate ? ` · NAV ${navDate}` : '';
  const arrow = trigger.rule === 'A' ? '低→高' : '高→低';
  const rulePrefix = trigger.ruleName ? `${trigger.ruleName} · ` : '';
  const title = `切换 ${trigger.rule} ${arrow} | ${trigger.fromCode}→${trigger.toCode}`;
  const body = `H−L ${gapStr}% ${cmp} ${threshold}%${navHint}\n卖 ${fromLabel} → 买 ${toLabel}\n下单前请以基金软件实时溢价为准。`;
  const summary = `${rulePrefix}切换 ${trigger.rule} ${trigger.fromCode}→${trigger.toCode} ${gapStr}%`;
  const ruleLabel = trigger.rule === 'A'
    ? `${rulePrefix}规则 A 低→高：H溢价 − L溢价 < ${threshold}%（差价收窄，从持仓 L 换到 H）`
    : `${rulePrefix}规则 B 高→低：H溢价 − L溢价 > ${threshold}%（差价扩大，从持仓 H 换到 L）`;
  const baseUrl = stripTrailingSlash(env?.PUBLIC_DATA_BASE_URL || 'https://tools.freebacktrack.tech');
  const detailUrl = `${baseUrl}/index.html?tab=tradePlans#switch`;
  // 同一对 + 同一规则 + 同一分钟，只发一次。
  const minuteKey = String(snapshot?.computedAt || '').slice(0, 16);
  // pairKey 已含 benchmark:cand，多基准下仍唯一。
  const eventId = `switch:${trigger.pairKey}:R${trigger.rule}:${minuteKey}`;
  const body_md = [
    `**H−L ${gapStr}%** ${cmp} ${threshold}%${navHint}`,
    `卖 **${fromLabel}** → 买 **${toLabel}**`,
    `*下单前请以基金软件实时溢价为准。*`
  ].join('\n');
  return {
    eventId,
    eventType: 'switch-strategy-trigger',
    ruleId: `switch:${trigger.ruleId || trigger.fromCode}`,
    symbol: trigger.fromCode,
    strategyName: '场内切换',
    triggerCondition: ruleLabel,
    purchaseAmount: '',
    detailUrl,
    title,
    body,
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
