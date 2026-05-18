// DCA 回测引擎（PR 2.5）。
// 纯函数：传入一串 candles（{t, c} 或类似）+ 策略参数，返回每期买入 + 最终总资产。
// 依赖讷限：不在这里拉取数据，调用方负责代理 `fetchKline` 。

import { fetchKline } from './marketsApi.js';

export const DCA_FREQUENCIES = Object.freeze([
  { value: 'weekly', label: '每周', days: 7 },
  { value: 'biweekly', label: '双周', days: 14 },
  { value: 'monthly', label: '每月', days: 30 }
]);

export const DCA_TIMEFRAMES = Object.freeze([
  { value: '1d', label: '过去 1 个月（1d K）', approxDays: 30 },
  { value: '1w', label: '过去 1 年（1w K）', approxDays: 365 },
  { value: '1mo', label: '过去 5 年（1mo K）', approxDays: 365 * 5 }
]);

function normalizeCandles(rawCandles = []) {
  return rawCandles
    .map((c) => {
      const close = Number(c.c ?? c.close ?? c.price);
      const ts = Number(c.t ?? c.timestamp);
      if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(ts)) return null;
      // worker 返回的 `t` 是秒。统一转为毫秒以供 JS Date 使用。
      const ms = ts > 1e12 ? ts : ts * 1000;
      return { ts: ms, date: new Date(ms), close };
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
}

/**
 * 过滤出按定投频率需要购买的 candles。
 * 从首棹开始，每 `intervalDays` 天往后跳一棹。
 */
export function filterBuyDates(candles, intervalDays) {
  if (!candles.length) return [];
  const step = Math.max(intervalDays || 7, 1);
  const buys = [candles[0]];
  let lastTs = candles[0].ts;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const days = (c.ts - lastTs) / (1000 * 60 * 60 * 24);
    if (days >= step) {
      buys.push(c);
      lastTs = c.ts;
    }
  }
  return buys;
}

/**
 * 纯函数回测。返回按期购买记录 + 汇总统计。
 */
export function calculateDcaBacktest({ rawCandles = [], amount = 100, frequencyDays = 7 }) {
  const candles = normalizeCandles(rawCandles);
  if (!candles.length) {
    return { ok: false, reason: 'no_candles', rows: [], summary: null };
  }
  const buys = filterBuyDates(candles, frequencyDays);
  const safeAmount = Math.max(Number(amount) || 0, 0);
  if (!buys.length || safeAmount <= 0) {
    return { ok: false, reason: 'invalid_input', rows: [], summary: null };
  }

  let totalShares = 0;
  let totalInvested = 0;
  const rows = buys.map((b, index) => {
    const shares = safeAmount / b.close;
    totalShares += shares;
    totalInvested += safeAmount;
    return {
      index: index + 1,
      date: b.date.toISOString().slice(0, 10),
      price: b.close,
      shares: round(shares, 4),
      invested: round(totalInvested, 2),
      sharesAccum: round(totalShares, 4),
      marketValue: round(totalShares * b.close, 2),
      avgCost: round(totalInvested / totalShares, 4)
    };
  });

  const lastClose = candles[candles.length - 1].close;
  const finalValue = totalShares * lastClose;
  const profit = finalValue - totalInvested;
  const returnPct = totalInvested > 0 ? (profit / totalInvested) * 100 : 0;
  const periods = rows.length;
  const spanDays = (candles[candles.length - 1].ts - candles[0].ts) / (1000 * 60 * 60 * 24);
  const years = spanDays / 365;
  const annualizedPct = years > 0 && totalInvested > 0
    ? (Math.pow(finalValue / totalInvested, 1 / years) - 1) * 100
    : 0;

  return {
    ok: true,
    rows,
    candles,
    summary: {
      periods,
      totalInvested: round(totalInvested, 2),
      totalShares: round(totalShares, 4),
      avgCost: round(totalInvested / totalShares, 4),
      lastClose: round(lastClose, 4),
      finalValue: round(finalValue, 2),
      profit: round(profit, 2),
      returnPct: round(returnPct, 2),
      annualizedPct: round(annualizedPct, 2),
      startDate: candles[0].date.toISOString().slice(0, 10),
      endDate: candles[candles.length - 1].date.toISOString().slice(0, 10),
      spanDays: Math.round(spanDays)
    }
  };
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

/**
 * 拉取 candles，仅是 `fetchKline` 的薄包装。保留未来加缓存的接口。
 */
export async function loadBacktestCandles(symbol, timeframe = '1mo') {
  const res = await fetchKline(symbol, { timeframe });
  return Array.isArray(res?.candles) ? res.candles : [];
}

/**
 * 构造 recharts 可用的股价 vs 累计资产点列。
 */
export function buildDcaChartData(rows, candles) {
  if (!Array.isArray(candles) || !candles.length) return [];
  const rowsByDate = new Map(rows.map((r) => [r.date, r]));
  let lastRow = null;
  return candles.map((c) => {
    const dateKey = c.date.toISOString().slice(0, 10);
    const row = rowsByDate.get(dateKey);
    if (row) lastRow = row;
    const marketValue = lastRow ? round(lastRow.sharesAccum * c.close, 2) : 0;
    const invested = lastRow ? lastRow.invested : 0;
    return {
      date: dateKey,
      price: round(c.close, 4),
      invested,
      marketValue
    };
  });
}
