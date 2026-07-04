import { getLatestNavWithCache } from './getNav.js';
import { readJson, writeJson } from './notifyStorage.js';

export const HOLDINGS_RULE_KEY_PREFIX = 'holdings-rule:';
const HOLDINGS_DEDUP_KEY_PREFIX = 'holdings-dedup:';
export const HOLDINGS_DEDUP_TTL_SECONDS = 36 * 3600;
export const FUND_CODE_PATTERN = /^\d{6}$/;

export function holdingsRuleKey(clientId) {
  return `${HOLDINGS_RULE_KEY_PREFIX}${clientId}`;
}

export function holdingsDedupKey(clientId, kind, dateKey) {
  return `${HOLDINGS_DEDUP_KEY_PREFIX}${clientId}:${kind}:${dateKey}`;
}

export function hasConfirmedPushDelivery(runResult = {}) {
  const channels = Array.isArray(runResult?.summary?.events?.[0]?.channels)
    ? runResult.summary.events[0].channels
    : [];
  return channels.some((channel) => {
    const channelName = String(channel?.channel || '').trim();
    const status = String(channel?.status || '').trim();
    return (status === 'delivered' && ['bark', 'serverchan3', 'ws'].includes(channelName))
      || (channelName === 'pc' && status === 'queued');
  });
}

export async function resolveHoldingKindAsync(code, bucketKind, env) {
  const kind = String(bucketKind || '').trim().toLowerCase();
  if (kind === 'exchange' || kind === 'qdii' || kind === 'otc') return kind;
  return 'otc';
}

export function isChinaMarketHoliday(dateStr) {
  // A 股休市（除周末外）——与前端 holidaysCN.js 保持一致。
  const d = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const y = d.slice(0, 4);
  const rangesByYear = {
    '2025': [
      ['2025-01-01', '2025-01-01'],
      ['2025-01-28', '2025-02-04'],
      ['2025-04-04', '2025-04-06'],
      ['2025-05-01', '2025-05-05'],
      ['2025-05-31', '2025-06-02'],
      ['2025-10-01', '2025-10-08']
    ],
    '2026': [
      ['2026-01-01', '2026-01-03'],
      ['2026-02-15', '2026-02-23'],
      ['2026-04-04', '2026-04-06'],
      ['2026-05-01', '2026-05-05'],
      ['2026-06-19', '2026-06-21'],
      ['2026-09-25', '2026-09-27'],
      ['2026-10-01', '2026-10-07']
    ]
  };
  const ranges = rangesByYear[y] || [];

  for (const [start, end] of ranges) {
    if (d >= start && d <= end) return true;
  }
  return false;
}

function isWeekendShanghai(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map((s) => Number(s));
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  return dow === 0 || dow === 6;
}

function shiftShanghaiDate(dateStr, daysBack = 1) {
  const [y, m, d] = String(dateStr).split('-').map((s) => Number(s));
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - daysBack);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function getPreviousTradingDayShanghai(dateStr) {
  let cur = shiftShanghaiDate(dateStr, 1);
  // 最多回退 30 天，避免死循环。
  for (let i = 0; i < 30; i++) {
    if (!isWeekendShanghai(cur) && !isChinaMarketHoliday(cur)) return cur;
    cur = shiftShanghaiDate(cur, 1);
  }
  return cur;
}

export function isTradingDayShanghai(dateStr) {
  return !isWeekendShanghai(dateStr) && !isChinaMarketHoliday(dateStr);
}

export function getExpectedLatestNavDate(kind, todayShanghai) {
  const today = String(todayShanghai || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return todayShanghai;

  // 这里的 T 定义为“最近一个交易日”（如果今天不是交易日，就回退到最近交易日）。
  // 规则：
  //   - exchange / otc：预期 = T
  //   - qdii：预期 = T-1（即上一个交易日；若 T 为周一，则会自然回退到上周五，即 T-3）
  const T = isTradingDayShanghai(today) ? today : getPreviousTradingDayShanghai(today);

  // 场内 ETF + 境内场外：预期都是“今日（非交易日回退到上一个交易日）”。
  if (kind === 'exchange' || kind === 'otc') {
    return T;
  }

  // qdii：T+1 发布，预期 = T-1
  return getPreviousTradingDayShanghai(T);
}

export function getShanghaiDateParts(date = new Date()) {
  // 使用 Intl 拿到 Asia/Shanghai 的年月日/小时/分钟（包依轻量，Worker 运行时可用）。
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${hour}:${parts.minute}`
  };
}

export function getTodayShanghaiDate() {
  try {
    return getShanghaiDateParts(new Date()).date;
  } catch (_error) {
    const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  }
}

export async function getLatestNav(env, code, fundKind = 'exchange', forceRefreshOrOptions = false) {
  if (!env || !env.NOTIFY_STATE) return null;

  const options = (forceRefreshOrOptions && typeof forceRefreshOrOptions === 'object')
    ? forceRefreshOrOptions
    : {};
  const forceRefresh = (forceRefreshOrOptions && typeof forceRefreshOrOptions === 'object')
    ? options.forceRefresh === true
    : forceRefreshOrOptions === true;
  const todayDate = options.todayDate || getTodayShanghaiDate();
  const readCache = async (key, fallback) => readJson(env, key, fallback);
  const writeCache = async (key, value) => writeJson(env, key, value);

  return getLatestNavWithCache(env, code, fundKind, {
    forceRefresh,
    todayDate,
    readCache,
    writeCache,
    getExpectedLatestNavDate
  });
}

export function normalizeHoldingsDigest(digest) {
  const result = {
    version: 1,
    generatedAt: '',
    exchange: [],
    otc: []
  };
  if (!digest || typeof digest !== 'object') return result;
  if (digest.generatedAt) result.generatedAt = String(digest.generatedAt);

  let totalWeight = 0;
  for (const bucket of ['exchange', 'otc']) {
    const list = Array.isArray(digest[bucket]) ? digest[bucket] : [];
    for (const entry of list) {
      const code = String(entry?.code || '').trim();
      const weight = Number(entry?.weight);
      const rawKind = String(entry?.kind || bucket).trim().toLowerCase();
      const kind = rawKind === 'exchange' || rawKind === 'otc' || rawKind === 'qdii' ? rawKind : bucket;
      if (!FUND_CODE_PATTERN.test(code)) continue;
      if (!Number.isFinite(weight) || weight <= 0 || weight > 1) continue;
      result[bucket].push({ code, weight, kind });
      totalWeight += weight;
    }
  }

  // 软限制：总权重 ≤ 1.5（两个 bucket 各自合计 ≤ 1，上限考虑取整冗余）
  if (totalWeight > 1.5) {
    return result;
  }

  // 旧版 digest 可能携带 totals（marketValue / todayProfit / totalProfit / …）。
  // 出于隐私考虑现在统一丢弃：不透传到 KV，也不在推送里展示金额；worker 仅根据 code/weight 计算加权收益率百分比。

  return result;
}
