// 场内 ETF 切换信号策略（worker 端实现，前端只做配置）。
//
// 配置示例：
//   benchmarkCode: '159632'
//   candidateCodes: ['513100', '159501', ...]
//   thresholds: [1, 8]
//   enabled: true
//
// 每分钟（仅 A 股交易时段 9:30-11:30 / 13:00-15:00 周一至周五）由 Cron Trigger 触发：
//   1. 拉取所有相关 ETF 的实时盘中价（新浪 hq.sinajs.cn）
//   2. 拉取最新单位净值（PUBLIC_DATA_BASE_URL/data/<code>/latest-nav.json，由 GitHub Action 维护）
//   3. 计算每只候选与基准的 (price - nav) / nav 溢价百分比
//   4. 取「基准溢价 - 候选溢价」绝对值，跨越任一阈值即触发
//   5. 推送到该 client 已配对的设备（Bark + FCM 通道，复用既有 runClientDetection 流程）
//
// 去重：每对 (benchmark, candidate) 维护 (level, sign)：
//   - level = 跨越的阈值数 (0 / 1 / 2)
//   - sign = +1 表示 benchmark 比 candidate 贵；-1 表示反向
//   level 提升或 sign 翻转都会推送一次；维持或下降不重复推。

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

const FUND_CODE_PATTERN = /^\d{6}$/;
const MAX_CANDIDATES = 20;
// 与前端 SwitchStrategyExperience 的 DEFAULT_PREFS 保持一致。
const DEFAULT_INTRA_SELL_LOWER_PCT = 1;   // 规则 A：基准溢价 − 候选溢价 ≤ X% → 卖候选买基准
const DEFAULT_INTRA_BUY_OTHER_PCT = 3;    // 规则 B：基准溢价 − 候选溢价 ≥ Y% → 卖基准买候选

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

// 配置与前端 aiDcaSwitchStrategyPrefs 同名，不重复定义一套参数。
// 字段：
//  - benchmarkCode: 基准 ETF
//  - enabledCodes:   勾选的候选 ETF 集合（不含基准）
//  - intraSellLowerPct / intraBuyOtherPct: 规则 A / B 阈值，与页面同含义
export function normalizeSwitchConfig(input = {}) {
  const benchmarkCode = sanitizeCode(input?.benchmarkCode);
  const seen = new Set();
  if (benchmarkCode) seen.add(benchmarkCode);
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
  return {
    enabled: Boolean(input?.enabled),
    benchmarkCode,
    enabledCodes,
    intraSellLowerPct: pickPercent(input?.intraSellLowerPct, DEFAULT_INTRA_SELL_LOWER_PCT),
    intraBuyOtherPct: pickPercent(input?.intraBuyOtherPct, DEFAULT_INTRA_BUY_OTHER_PCT),
    clientLabel: String(input?.clientLabel || '').trim().slice(0, 120),
    updatedAt: String(input?.updatedAt || '').trim() || new Date().toISOString()
  };
}

export function isSwitchConfigRunnable(config) {
  return Boolean(
    config
    && config.enabled
    && config.benchmarkCode
    && Array.isArray(config.enabledCodes)
    && config.enabledCodes.length > 0
    && Number.isFinite(config.intraSellLowerPct)
    && Number.isFinite(config.intraBuyOtherPct)
    && config.intraBuyOtherPct > config.intraSellLowerPct
  );
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

// --- 新浪实时报价 ----------------------------------------------------------
//
// 新浪 hq.sinajs.cn 强制要求 Referer，否则会 403 / 空 body。
// 一次最多支持几十只代码，逗号分隔；本仓库一个 client 上限 20 只候选 + 1 基准 = 21
// 个查询，远低于上限。

function sinaSymbol(code) {
  const c = sanitizeCode(code);
  if (!c) return '';
  // 沪市 ETF 主要是 5 / 6 / 9 开头；深市 ETF 主要是 1 / 0 / 3 开头。
  return /^[569]/.test(c) ? `sh${c}` : `sz${c}`;
}

export async function fetchSinaPrices(codes = []) {
  const symbols = Array.from(new Set(codes.map((c) => sinaSymbol(c)).filter(Boolean)));
  if (!symbols.length) return {};
  const url = `https://hq.sinajs.cn/list=${symbols.join(',')}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Referer': 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0 (compatible; ai-dca-notify/1.0)'
    },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) {
    throw new Error(`新浪行情请求失败：状态 ${response.status}`);
  }
  // 新浪原文是 GB18030，但我们只需要数字字段，逗号、引号、=、数字、字母都是 ASCII，
  // 无需特殊解码。中文名称会乱码但忽略即可。
  const text = await response.text();
  const map = {};
  const re = /var\s+hq_str_(sh|sz)(\d{6})="([^"]*)";?/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const code = match[2];
    const fields = String(match[3] || '').split(',');
    if (fields.length < 4) continue;
    // ETF/股票字段：[0]=name [1]=open [2]=preClose [3]=current [4]=high [5]=low
    // ... [30]=date [31]=time
    const price = Number(fields[3]);
    if (!Number.isFinite(price) || price <= 0) continue;
    map[code] = {
      code,
      price,
      preClose: Number(fields[2]) || 0,
      open: Number(fields[1]) || 0,
      high: Number(fields[4]) || 0,
      low: Number(fields[5]) || 0,
      date: String(fields[30] || '').trim(),
      time: String(fields[31] || '').trim()
    };
  }
  return map;
}

// --- 最新单位净值 ----------------------------------------------------------

function stripTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

export async function fetchLatestNav(env, code) {
  const c = sanitizeCode(code);
  if (!c) return null;
  const baseUrl = stripTrailingSlash(env?.PUBLIC_DATA_BASE_URL || 'https://tools.freebacktrack.tech');
  try {
    const response = await fetch(`${baseUrl}/data/${c}/latest-nav.json`, {
      headers: { accept: 'application/json' },
      // 一天内 NAV 不会变化太多次；缓存 10 分钟即可。
      cf: { cacheTtl: 600, cacheEverything: true }
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const nav = Number(payload?.latestNav);
    if (!Number.isFinite(nav) || nav <= 0) return null;
    return {
      code: c,
      name: String(payload?.name || '').trim(),
      nav,
      latestNavDate: String(payload?.latestNavDate || '').trim()
    };
  } catch (_error) {
    return null;
  }
}

export async function fetchLatestNavMap(env, codes = []) {
  const list = Array.from(new Set(codes.map((c) => sanitizeCode(c)).filter(Boolean)));
  const results = await Promise.all(list.map((code) => fetchLatestNav(env, code)));
  const map = {};
  for (const entry of results) {
    if (entry && entry.code) map[entry.code] = entry;
  }
  return map;
}

// --- 快照与触发 ------------------------------------------------------------

// 计算 worker 快照，与前端 SwitchStrategyExperience.fundsWithPremium / intraSignals 同语义。
export function computeSwitchSnapshot(config, priceMap, navByCode, computedAt) {
  const benchmark = config.benchmarkCode;
  const benchPrice = Number(priceMap?.[benchmark]?.price);
  const benchNav = Number(navByCode?.[benchmark]?.nav);
  const benchNavDate = String(navByCode?.[benchmark]?.latestNavDate || '').trim();
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
  const benchNavStale = navAgeDays(benchNavDate) > NAV_STALE_DAYS;
  const benchPremium = Number.isFinite(benchPrice) && Number.isFinite(benchNav) && benchNav > 0 && !benchNavStale
    ? ((benchPrice - benchNav) / benchNav) * 100
    : null;

  const candidates = (config.enabledCodes || []).map((code) => {
    const candPrice = Number(priceMap?.[code]?.price);
    const candNav = Number(navByCode?.[code]?.nav);
    const candNavDate = String(navByCode?.[code]?.latestNavDate || '').trim();
    const navMissing = !Number.isFinite(candNav) || candNav <= 0;
    const navStale = !navMissing && navAgeDays(candNavDate) > NAV_STALE_DAYS;
    const priceMissing = !Number.isFinite(candPrice) || candPrice <= 0;
    const candPremium = (!navMissing && !priceMissing && !navStale)
      ? ((candPrice - candNav) / candNav) * 100
      : null;
    const diff = Number.isFinite(benchPremium) && Number.isFinite(candPremium)
      ? benchPremium - candPremium
      : null;
    // 标注原因，供 UI / 调试使用；评估器看到 spreadVsBenchmarkPct=null 就不会触发。
    let note = '';
    if (navMissing) note = 'nav-missing';
    else if (navStale) note = 'nav-stale';
    else if (priceMissing) note = 'price-missing';
    else if (!Number.isFinite(benchPremium)) note = 'benchmark-unavailable';
    return {
      code,
      name: navByCode?.[code]?.name || '',
      price: Number.isFinite(candPrice) ? candPrice : null,
      nav: Number.isFinite(candNav) ? candNav : null,
      navDate: candNavDate,
      premiumPct: Number.isFinite(candPremium) ? candPremium : null,
      // diff = benchPremium − candPremium，与页面 intraSignals 中同名。
      spreadVsBenchmarkPct: Number.isFinite(diff) ? diff : null,
      note
    };
  });

  const ready = Number.isFinite(benchPremium) && candidates.some((c) => Number.isFinite(c.spreadVsBenchmarkPct));
  return {
    computedAt: computedAtIso,
    benchmarkCode: benchmark,
    benchmarkName: navByCode?.[benchmark]?.name || '',
    benchmarkPrice: Number.isFinite(benchPrice) ? benchPrice : null,
    benchmarkNav: Number.isFinite(benchNav) ? benchNav : null,
    benchmarkNavDate: benchNavDate,
    benchmarkPremiumPct: Number.isFinite(benchPremium) ? benchPremium : null,
    benchmarkNote: !Number.isFinite(benchPrice) || benchPrice <= 0
      ? 'price-missing'
      : (!Number.isFinite(benchNav) || benchNav <= 0)
        ? 'nav-missing'
        : (benchNavStale ? 'nav-stale' : ''),
    candidates,
    intraSellLowerPct: Number(config.intraSellLowerPct),
    intraBuyOtherPct: Number(config.intraBuyOtherPct),
    ready,
    triggers: []
  };
}

// 与前端 intraSignals 算法一致：
//   diff = benchPremium − candPremium
//   |diff| ≤ intraSellLowerPct (默认 1%) → 规则 A：溢价差极小（premiums 接近）
//   |diff| ≥ intraBuyOtherPct  (默认 3%) → 规则 B：溢价差极大（庄家套利机会）
// 方向由 sign(diff) 决定：总是「卖溢价高的一只，买溢价低的一只」。
// per-pair dedup：仅当本轮 (rule + 方向) 与上次不同时才推送。
function classifyRule(diff, sellLower, buyOther) {
  if (!Number.isFinite(diff) || diff === 0) return 'none';
  const absDiff = Math.abs(diff);
  if (absDiff <= sellLower) return 'A';
  if (absDiff >= buyOther) return 'B';
  return 'none';
}

export function evaluateSwitchTriggers(snapshot, prevTriggerStates = {}) {
  const benchmark = snapshot.benchmarkCode;
  const benchName = snapshot.benchmarkName || '';
  const sellLower = Number(snapshot.intraSellLowerPct);
  const buyOther = Number(snapshot.intraBuyOtherPct);
  const nextTriggerStates = {};
  const triggers = [];

  for (const cand of snapshot.candidates || []) {
    const pairKey = `${benchmark}:${cand.code}`;
    // 重要：Number(null) 会变成 0，会被误当作「diff = 0%」命中规则 A（如果 sellLower ≥ 0）。
    // 仅在原始值为 number 时才计算，null / undefined / NaN / 字符串均视为「数据缺失」。
    const rawDiff = cand.spreadVsBenchmarkPct;
    const diff = (typeof rawDiff === 'number' && Number.isFinite(rawDiff)) ? rawDiff : NaN;
    if (!Number.isFinite(diff)) {
      // 数据缺失：保留旧状态，不衰减、不触发。
      const prev = prevTriggerStates?.[pairKey];
      if (prev) nextTriggerStates[pairKey] = prev;
      continue;
    }
    const rule = classifyRule(diff, sellLower, buyOther);
    // 方向：diff > 0 表示 bench 溢价更高（卖 bench 买 cand）；diff < 0 表示 cand 溢价更高（卖 cand 买 bench）。
    const benchHigher = Number.isFinite(diff) && diff > 0;
    const fromCode = benchHigher ? benchmark : cand.code;
    const toCode = benchHigher ? cand.code : benchmark;
    const fromName = benchHigher ? benchName : (cand.name || '');
    const toName = benchHigher ? (cand.name || '') : benchName;
    const threshold = rule === 'A' ? sellLower : buyOther;
    const prev = prevTriggerStates?.[pairKey] || { rule: 'none', fromCode: '' };
    const prevRule = String(prev.rule || 'none');
    const prevFrom = String(prev.fromCode || '');
    const dirChanged = rule !== 'none' && fromCode !== prevFrom;
    if (rule !== 'none' && (rule !== prevRule || dirChanged)) {
      triggers.push({
        pairKey,
        rule,
        fromCode,
        toCode,
        fromName,
        toName,
        diffPct: diff,
        threshold
      });
    }
    nextTriggerStates[pairKey] = {
      rule,
      fromCode: rule === 'none' ? '' : fromCode,
      lastDiffPct: diff,
      updatedAt: snapshot.computedAt
    };
  }

  return { triggers, nextTriggerStates };
}

export function buildSwitchTriggerNotification(snapshot, trigger, env) {
  // 精简后通知格式（无字段重复）：
  //   title:   切换 A | 159632→513100
  //   body:    |diff| 0.85% ≤ 1%  · NAV 2026-04-28
  //            卖 159632 纳指ETF → 买 513100 纳指ETF
  //            下单前请以基金软件实时溢价为准。
  const fromLabel = trigger.fromName ? `${trigger.fromCode} ${trigger.fromName}` : trigger.fromCode;
  const toLabel = trigger.toName ? `${trigger.toCode} ${trigger.toName}` : trigger.toCode;
  const diff = Number(trigger.diffPct);
  const absDiffStr = Math.abs(diff).toFixed(2);
  const threshold = Number(trigger.threshold);
  const cmp = trigger.rule === 'A' ? '≤' : '≥';
  const navDate = String(snapshot?.benchmarkNavDate || '').trim();
  const navHint = navDate ? ` · NAV ${navDate}` : '';
  const title = `切换 ${trigger.rule} | ${trigger.fromCode}→${trigger.toCode}`;
  const body = `|diff| ${absDiffStr}% ${cmp} ${threshold}%${navHint}\n卖 ${fromLabel} → 买 ${toLabel}\n下单前请以基金软件实时溢价为准。`;
  const summary = `切换 ${trigger.rule} ${trigger.fromCode}→${trigger.toCode} ${absDiffStr}%`;
  const ruleLabel = trigger.rule === 'A'
    ? `规则 A：|基准溢价 − 候选溢价| ≤ ${threshold}%（溢价接近）`
    : `规则 B：|基准溢价 − 候选溢价| ≥ ${threshold}%（溢价偏离）`;
  const baseUrl = stripTrailingSlash(env?.PUBLIC_DATA_BASE_URL || 'https://tools.freebacktrack.tech');
  const detailUrl = `${baseUrl}/index.html?tab=tradePlans#switch`;
  // 同一对 + 同一规则 + 同一分钟，只发一次。
  const minuteKey = String(snapshot?.computedAt || '').slice(0, 16);
  const eventId = `switch:${snapshot.benchmarkCode}:${trigger.pairKey}:R${trigger.rule}:${minuteKey}`;
  return {
    eventId,
    eventType: 'switch-strategy-trigger',
    ruleId: `switch:${snapshot.benchmarkCode}`,
    symbol: trigger.fromCode,
    strategyName: '场内切换',
    triggerCondition: ruleLabel,
    purchaseAmount: '',
    detailUrl,
    title,
    body,
    summary
  };
}
