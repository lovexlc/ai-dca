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
  // premiumClass: 仅保留出现在 benchmarkCodes / enabledCodes 中的代码，且值为 'H' | 'L'。
  const premiumClass = {};
  const rawClass = (input && typeof input.premiumClass === 'object' && input.premiumClass) ? input.premiumClass : {};
  const validCodes = new Set([...benchmarkCodes, ...enabledCodes]);
  for (const [code, value] of Object.entries(rawClass)) {
    const c = sanitizeCode(code);
    if (!c || !validCodes.has(c)) continue;
    const v = String(value || '').trim().toUpperCase();
    if (v === 'H' || v === 'L') premiumClass[c] = v;
  }
  return {
    enabled: Boolean(input?.enabled),
    benchmarkCodes,
    enabledCodes,
    premiumClass,
    intraSellLowerPct: pickPercent(input?.intraSellLowerPct, DEFAULT_INTRA_SELL_LOWER_PCT),
    intraBuyOtherPct: pickPercent(input?.intraBuyOtherPct, DEFAULT_INTRA_BUY_OTHER_PCT),
    clientLabel: String(input?.clientLabel || '').trim().slice(0, 120),
    updatedAt: String(input?.updatedAt || '').trim() || new Date().toISOString()
  };
}

export function isSwitchConfigRunnable(config) {
  if (!config || !config.enabled) return false;
  if (!Number.isFinite(config.intraSellLowerPct) || !Number.isFinite(config.intraBuyOtherPct)) return false;
  if (config.intraBuyOtherPct <= config.intraSellLowerPct) return false;
  const benches = Array.isArray(config.benchmarkCodes) ? config.benchmarkCodes : [];
  if (!benches.length) return false;
  const enabled = Array.isArray(config.enabledCodes) ? config.enabledCodes : [];
  const cls = (config && typeof config.premiumClass === 'object' && config.premiumClass) ? config.premiumClass : {};
  const pool = Array.from(new Set([...benches, ...enabled])).filter((c) => cls[c] === 'H' || cls[c] === 'L');
  for (const b of benches) {
    const bc = cls[b];
    if (bc !== 'H' && bc !== 'L') continue;
    const opp = bc === 'H' ? 'L' : 'H';
    if (pool.some((c) => c !== b && cls[c] === opp)) return true;
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
  const premiumClass = (config && typeof config.premiumClass === 'object' && config.premiumClass) ? config.premiumClass : {};

  // 候选池 = (enabledCodes ∪ benchmarkCodes) \ self，这样一 H 一 L 的两只持仓
  // 也能互为候选，而不是仅限于 enabledCodes（= 非持仓分类代码）。
  const classifiedPool = Array.from(new Set([...benchmarkCodes, ...enabledCodes]))
    .filter((c) => premiumClass[c] === 'H' || premiumClass[c] === 'L');
  const byBenchmark = benchmarkCodes.map((benchmarkCode) => {
    // v3：bench 已分类时，只留对立类（H↔L）的候选，同类/未分类全部剔除。
    const benchmarkClass = premiumClass[benchmarkCode] || null;
    const oppClass = benchmarkClass === 'H' ? 'L' : (benchmarkClass === 'L' ? 'H' : null);
    const eligibleCodes = oppClass
      ? classifiedPool.filter((c) => c !== benchmarkCode && premiumClass[c] === oppClass)
      : enabledCodes;

    const benchPrice = Number(priceMap?.[benchmarkCode]?.price);
    const benchNav = Number(navByCode?.[benchmarkCode]?.nav);
    const benchNavDate = String(navByCode?.[benchmarkCode]?.latestNavDate || '').trim();
    const benchNavStale = navAgeDays(benchNavDate) > NAV_STALE_DAYS;
    const benchPremium = Number.isFinite(benchPrice) && Number.isFinite(benchNav) && benchNav > 0 && !benchNavStale
      ? ((benchPrice - benchNav) / benchNav) * 100
      : null;

    const candidates = eligibleCodes.map((code) => {
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
        candClass: premiumClass[code] || null,
        note
      };
    });

    return {
      benchmarkCode,
      benchmarkName: navByCode?.[benchmarkCode]?.name || '',
      benchmarkClass,
      benchmarkPrice: Number.isFinite(benchPrice) ? benchPrice : null,
      benchmarkNav: Number.isFinite(benchNav) ? benchNav : null,
      benchmarkNavDate: benchNavDate,
      benchmarkPremiumPct: Number.isFinite(benchPremium) ? benchPremium : null,
      benchmarkNote: !Number.isFinite(benchPrice) || benchPrice <= 0
        ? 'price-missing'
        : (!Number.isFinite(benchNav) || benchNav <= 0)
          ? 'nav-missing'
          : (benchNavStale ? 'nav-stale' : ''),
      candidates
    };
  });

  const ready = byBenchmark.some((b) =>
    Number.isFinite(b.benchmarkPremiumPct)
    && b.candidates.some((c) => Number.isFinite(c.spreadVsBenchmarkPct))
  );

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
    for (const cand of (group.candidates || [])) {
      const candClass = premiumClass[cand.code];
      const diff = cand?.spreadVsBenchmarkPct;
      if (typeof diff !== 'number' || !Number.isFinite(diff)) continue;
      let gap = NaN;
      if (benchClass === 'H') gap = diff;
      else if (benchClass === 'L') gap = -diff;
      const rule = classifyRule({ benchClass, candClass, gap, sellLower: sellLowerCfg, buyOther: buyOtherCfg });
      if (rule === 'none') continue;
      const hCode = benchClass === 'H' ? benchCode : cand.code;
      const lCode = benchClass === 'H' ? cand.code : benchCode;
      const tag = rule === 'A' ? '差价收窄' : '差价扩大';
      const arrow = rule === 'A' ? '低→高' : '高→低';
      const cmp = rule === 'A' ? '<' : '>';
      const threshold = rule === 'A' ? sellLowerCfg : buyOtherCfg;
      const gapStr = (gap >= 0 ? '+' : '') + gap.toFixed(2);
      signals.push({
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
    intraSellLowerPct: Number(config.intraSellLowerPct),
    intraBuyOtherPct: Number(config.intraBuyOtherPct),
    // 随快照一起带 premiumClass，供 evaluateSwitchTriggers 使用。
    premiumClass,
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
  const sellLower = Number(snapshot.intraSellLowerPct);
  const buyOther = Number(snapshot.intraBuyOtherPct);
  const premiumClass = (snapshot && typeof snapshot.premiumClass === 'object' && snapshot.premiumClass) ? snapshot.premiumClass : {};
  const nextTriggerStates = {};
  const triggers = [];

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
      const diff = (typeof rawDiff === 'number' && Number.isFinite(rawDiff)) ? rawDiff : NaN;
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
      // 方向始终是「卖持仓 bench, 买候选 cand」。
      const fromCode = rule === 'none' ? '' : benchmark;
      const toCode = rule === 'none' ? '' : cand.code;
      const fromName = benchName;
      const toName = cand.name || '';
      const threshold = rule === 'A' ? sellLower : (rule === 'B' ? buyOther : NaN);
      const prev = prevTriggerStates?.[pairKey] || { rule: 'none' };
      const prevRule = String(prev.rule || 'none');
      if (rule !== 'none' && rule !== prevRule) {
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
          candClass
        });
      }
      nextTriggerStates[pairKey] = {
        rule,
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
    .find((b) => b?.benchmarkCode === benchHCode) || null;
  const navDate = String(benchmarkEntry?.benchmarkNavDate || '').trim();
  const navHint = navDate ? ` · NAV ${navDate}` : '';
  const arrow = trigger.rule === 'A' ? '低→高' : '高→低';
  const title = `切换 ${trigger.rule} ${arrow} | ${trigger.fromCode}→${trigger.toCode}`;
  const body = `H−L ${gapStr}% ${cmp} ${threshold}%${navHint}\n卖 ${fromLabel} → 买 ${toLabel}\n下单前请以基金软件实时溢价为准。`;
  const summary = `切换 ${trigger.rule} ${trigger.fromCode}→${trigger.toCode} ${gapStr}%`;
  const ruleLabel = trigger.rule === 'A'
    ? `规则 A 低→高：H溢价 − L溢价 < ${threshold}%（差价收窄，从持仓 L 换到 H）`
    : `规则 B 高→低：H溢价 − L溢价 > ${threshold}%（差价扩大，从持仓 H 换到 L）`;
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
    ruleId: `switch:${trigger.fromCode}`,
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
