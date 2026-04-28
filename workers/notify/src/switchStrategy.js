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
const DEFAULT_THRESHOLDS = [1, 8];
const MAX_CANDIDATES = 20;

function sanitizeCode(value) {
  const code = String(value || '').trim();
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

export function normalizeSwitchConfig(input = {}) {
  const benchmarkCode = sanitizeCode(input?.benchmarkCode);
  const seen = new Set();
  if (benchmarkCode) seen.add(benchmarkCode);
  const candidateCodes = [];
  for (const raw of Array.isArray(input?.candidateCodes) ? input.candidateCodes : []) {
    const code = sanitizeCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    candidateCodes.push(code);
    if (candidateCodes.length >= MAX_CANDIDATES) break;
  }
  // 阈值：去重、>0、升序，最多 4 档；缺省 [1, 8]。
  const thresholdsRaw = Array.isArray(input?.thresholds) ? input.thresholds : DEFAULT_THRESHOLDS;
  const thresholds = Array.from(new Set(
    thresholdsRaw.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
  ))
    .sort((left, right) => left - right)
    .slice(0, 4);
  if (!thresholds.length) thresholds.push(...DEFAULT_THRESHOLDS);

  return {
    enabled: Boolean(input?.enabled),
    benchmarkCode,
    candidateCodes,
    thresholds,
    clientLabel: String(input?.clientLabel || '').trim().slice(0, 120),
    updatedAt: String(input?.updatedAt || '').trim() || new Date().toISOString()
  };
}

export function isSwitchConfigRunnable(config) {
  return Boolean(
    config
    && config.enabled
    && config.benchmarkCode
    && Array.isArray(config.candidateCodes)
    && config.candidateCodes.length > 0
    && Array.isArray(config.thresholds)
    && config.thresholds.length > 0
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

export function computeSwitchSnapshot(config, priceMap, navByCode, computedAt) {
  const benchmark = config.benchmarkCode;
  const benchPrice = Number(priceMap?.[benchmark]?.price);
  const benchNav = Number(navByCode?.[benchmark]?.nav);
  const benchPremium = Number.isFinite(benchPrice) && Number.isFinite(benchNav) && benchNav > 0
    ? ((benchPrice - benchNav) / benchNav) * 100
    : null;

  const candidates = config.candidateCodes.map((code) => {
    const candPrice = Number(priceMap?.[code]?.price);
    const candNav = Number(navByCode?.[code]?.nav);
    const candPremium = Number.isFinite(candPrice) && Number.isFinite(candNav) && candNav > 0
      ? ((candPrice - candNav) / candNav) * 100
      : null;
    const spread = Number.isFinite(benchPremium) && Number.isFinite(candPremium)
      ? benchPremium - candPremium
      : null;
    return {
      code,
      name: navByCode?.[code]?.name || '',
      price: Number.isFinite(candPrice) ? candPrice : null,
      nav: Number.isFinite(candNav) ? candNav : null,
      navDate: navByCode?.[code]?.latestNavDate || '',
      premiumPct: Number.isFinite(candPremium) ? candPremium : null,
      spreadVsBenchmarkPct: Number.isFinite(spread) ? spread : null
    };
  });

  const ready = Number.isFinite(benchPremium) && candidates.some((c) => Number.isFinite(c.spreadVsBenchmarkPct));
  return {
    computedAt: String(computedAt || new Date().toISOString()),
    benchmarkCode: benchmark,
    benchmarkName: navByCode?.[benchmark]?.name || '',
    benchmarkPrice: Number.isFinite(benchPrice) ? benchPrice : null,
    benchmarkNav: Number.isFinite(benchNav) ? benchNav : null,
    benchmarkNavDate: navByCode?.[benchmark]?.latestNavDate || '',
    benchmarkPremiumPct: Number.isFinite(benchPremium) ? benchPremium : null,
    candidates,
    thresholds: Array.isArray(config.thresholds) ? [...config.thresholds] : [...DEFAULT_THRESHOLDS],
    ready,
    triggers: []
  };
}

// 计算某个绝对溢价差跨越了几个阈值（0 / 1 / 2 / 3 ...）。
function levelFor(absSpread, thresholds = []) {
  let level = 0;
  for (const t of thresholds) {
    if (absSpread >= t) level += 1;
  }
  return level;
}

export function evaluateSwitchTriggers(snapshot, prevTriggerStates = {}) {
  const benchmark = snapshot.benchmarkCode;
  const benchName = snapshot.benchmarkName || '';
  const thresholds = Array.isArray(snapshot.thresholds) && snapshot.thresholds.length
    ? [...snapshot.thresholds].sort((a, b) => a - b)
    : [...DEFAULT_THRESHOLDS];
  const nextTriggerStates = {};
  const triggers = [];

  for (const cand of snapshot.candidates || []) {
    const pairKey = `${benchmark}:${cand.code}`;
    const spread = Number(cand.spreadVsBenchmarkPct);
    if (!Number.isFinite(spread)) {
      // 数据缺失：保留旧状态，不衰减、不触发。
      const prev = prevTriggerStates?.[pairKey];
      if (prev) nextTriggerStates[pairKey] = prev;
      continue;
    }
    const sign = spread === 0 ? 0 : spread > 0 ? 1 : -1;
    const absSpread = Math.abs(spread);
    const newLevel = levelFor(absSpread, thresholds);
    const prev = prevTriggerStates?.[pairKey] || { level: 0, sign: 0 };
    let shouldFire = false;
    if (newLevel >= 1) {
      if (sign !== prev.sign && prev.sign !== 0) {
        // 方向翻转：之前已经有触发，现在反向到了触发区，重新发一次。
        shouldFire = true;
      } else if (newLevel > Number(prev.level || 0)) {
        // 同方向升档（含从 0→任一）：发一次。
        shouldFire = true;
      } else if (Number(prev.level || 0) === 0 && newLevel >= 1) {
        // 兜底：上次未触发，此次触发了。
        shouldFire = true;
      }
    }
    if (shouldFire) {
      const fromCode = sign > 0 ? benchmark : cand.code;
      const toCode = sign > 0 ? cand.code : benchmark;
      const fromName = sign > 0 ? benchName : (cand.name || '');
      const toName = sign > 0 ? (cand.name || '') : benchName;
      // 选最大已跨越的阈值用于消息文案。
      const crossedThreshold = [...thresholds].reverse().find((t) => absSpread >= t) || thresholds[0];
      triggers.push({
        pairKey,
        level: newLevel,
        sign,
        threshold: crossedThreshold,
        fromCode,
        toCode,
        fromName,
        toName,
        spreadPct: spread,
        absSpreadPct: absSpread
      });
    }
    nextTriggerStates[pairKey] = {
      level: newLevel,
      sign: newLevel > 0 ? sign : 0,
      lastSpreadPct: spread,
      updatedAt: snapshot.computedAt
    };
  }

  return { triggers, nextTriggerStates };
}

export function buildSwitchTriggerNotification(snapshot, trigger, env) {
  const levelLabel = trigger.level >= 2 ? '强信号' : '弱信号';
  const fromLabel = trigger.fromName ? `${trigger.fromCode} ${trigger.fromName}` : trigger.fromCode;
  const toLabel = trigger.toName ? `${trigger.toCode} ${trigger.toName}` : trigger.toCode;
  const spread = Number(trigger.spreadPct).toFixed(2);
  const title = `[切换 ${levelLabel}] 卖 ${trigger.fromCode} → 买 ${trigger.toCode}`;
  const body = `溢价差 ${spread}%（≥ ${trigger.threshold}%）：${fromLabel} → ${toLabel}。下单前请到基金软件确认实时溢价。`;
  const summary = `切换信号 ${trigger.fromCode}→${trigger.toCode} ${spread}%`;
  const baseUrl = stripTrailingSlash(env?.PUBLIC_DATA_BASE_URL || 'https://tools.freebacktrack.tech');
  const detailUrl = `${baseUrl}/index.html?tab=tradePlans#switch`;
  // 同一对在同一时间点+level 只发一次；时间精确到分钟即可。
  const minuteKey = String(snapshot?.computedAt || '').slice(0, 16);
  const eventId = `switch:${snapshot.benchmarkCode}:${trigger.pairKey}:L${trigger.level}:S${trigger.sign >= 0 ? 'p' : 'n'}:${minuteKey}`;
  return {
    eventId,
    eventType: 'switch-strategy-trigger',
    ruleId: `switch:${snapshot.benchmarkCode}`,
    symbol: trigger.fromCode,
    strategyName: '场内切换',
    triggerCondition: `溢价差 ${spread}% ≥ ${trigger.threshold}%`,
    purchaseAmount: '',
    detailUrl,
    title,
    body,
    summary
  };
}
