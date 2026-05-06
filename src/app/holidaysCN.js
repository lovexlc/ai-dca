/**
 * 上海证券交易所 / 深圳证券交易所 法定节假日休市表（A 股）。
 *
 * 数据来源：上交所《年度部分节假日休市安排》公告。
 *   - 2025: https://www.sse.com.cn/disclosure/announcement/general/c/c_20241115_10778145.shtml
 *   - 2026: https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml
 *
 * 仅记录闭市区间（闭区间），不含周末（周末由 isWeekendShanghai 单独判定）。
 * 与 workers/notify/src/index.js 内置的 isChinaMarketHoliday 保持一致。
 *
 * 用途：让 holdingsLedgerCore.getExpectedLatestNavDate 在 A 股长假期间
 * 把「预期最新 NAV 日期」回退到节前最后一个交易日，避免节内 / 节后
 * 第一个交易日把 latestNavDate 误判为「滞后」。
 */

const HOLIDAY_RANGES = {
  '2025': [
    ['2025-01-01', '2025-01-01'], // 元旦
    ['2025-01-28', '2025-02-04'], // 春节
    ['2025-04-04', '2025-04-06'], // 清明
    ['2025-05-01', '2025-05-05'], // 劳动节
    ['2025-05-31', '2025-06-02'], // 端午
    ['2025-10-01', '2025-10-08']  // 国庆 + 中秋
  ],
  '2026': [
    ['2026-01-01', '2026-01-03'], // 元旦
    ['2026-02-15', '2026-02-23'], // 春节
    ['2026-04-04', '2026-04-06'], // 清明
    ['2026-05-01', '2026-05-05'], // 劳动节
    ['2026-06-19', '2026-06-21'], // 端午
    ['2026-09-25', '2026-09-27'], // 中秋
    ['2026-10-01', '2026-10-07']  // 国庆
  ]
};

/** A 股法定节假日（闭市区间，不含周末）。dateStr: YYYY-MM-DD。 */
export function isChinaMarketHoliday(dateStr) {
  const d = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const ranges = HOLIDAY_RANGES[d.slice(0, 4)];
  if (!ranges) return false;
  for (const [start, end] of ranges) {
    if (d >= start && d <= end) return true;
  }
  return false;
}

/** 上海时区周六/周日判断（基于 UTC 日期，无时区坑）。 */
export function isWeekendShanghai(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map((s) => Number(s));
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  return dow === 0 || dow === 6;
}

/** 是否为 A 股交易日：非周末 + 非法定假期。 */
export function isTradingDayShanghai(dateStr) {
  return !isWeekendShanghai(dateStr) && !isChinaMarketHoliday(dateStr);
}

function shiftDate(dateStr, daysBack) {
  const [y, m, d] = String(dateStr).split('-').map((s) => Number(s));
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - daysBack);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** 严格早于 dateStr 的最近一个 A 股交易日。最多回退 30 天，避免死循环。 */
export function getPreviousTradingDayShanghai(dateStr) {
  let cur = shiftDate(dateStr, 1);
  for (let i = 0; i < 30; i++) {
    if (isTradingDayShanghai(cur)) return cur;
    cur = shiftDate(cur, 1);
  }
  return cur;
}

/** 若 dateStr 自身是交易日则返回它，否则回退到最近的上一个交易日。 */
export function getNearestTradingDayShanghai(dateStr) {
  return isTradingDayShanghai(dateStr) ? dateStr : getPreviousTradingDayShanghai(dateStr);
}
