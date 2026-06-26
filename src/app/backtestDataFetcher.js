/**
 * 回测数据获取辅助函数
 *
 * 回测溢价只由价格 K 线和 NAV 净值计算，不从历史溢价接口获取。
 */

import { fetchKline } from './marketsApi.js';
import { getNavHistory } from './navService.js';

function normalizeDate(value) {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function shanghaiDateFromEpochSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch (_error) {
    return new Date(n * 1000 + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

function normalizePriceCandles(rawCandles = [], { startDate, endDate } = {}) {
  return (Array.isArray(rawCandles) ? rawCandles : [])
    .map((bar) => {
      const t = Number(bar?.t ?? bar?.timestamp ?? 0);
      const date = normalizeDate(bar?.date || bar?.day) || shanghaiDateFromEpochSec(t);
      const close = Number(bar?.c ?? bar?.close ?? bar?.price);
      if (!date || !Number.isFinite(close) || close <= 0) return null;
      return {
        ...bar,
        t,
        date,
        c: close,
        close,
        o: Number(bar?.o ?? bar?.open ?? close),
        h: Number(bar?.h ?? bar?.high ?? close),
        l: Number(bar?.l ?? bar?.low ?? close),
        open: Number(bar?.open ?? bar?.o ?? close),
        high: Number(bar?.high ?? bar?.h ?? close),
        low: Number(bar?.low ?? bar?.l ?? close),
        bidPrice: Number(bar?.bidPrice ?? bar?.bid ?? bar?.bp1) || null,
        askPrice: Number(bar?.askPrice ?? bar?.ask ?? bar?.sp1) || null
      };
    })
    .filter((bar) => bar && (!startDate || bar.date >= startDate) && (!endDate || bar.date <= endDate))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.t) - Number(b.t));
}

function normalizeNavHistory(rawItems = [], { startDate, endDate } = {}) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => {
      const date = normalizeDate(item?.date || item?.navDate || item?.day);
      const nav = Number(item?.nav ?? item?.unitNav ?? item?.latestNav);
      if (!date || !Number.isFinite(nav) || nav <= 0) return null;
      return { ...item, date, nav };
    })
    .filter((item) => item && (!startDate || item.date >= startDate) && (!endDate || item.date <= endDate))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 获取回测所需的完整数据
 * @param {Array<string>} codes - 基金代码列表
 * @param {Object} options - 选项
 * @returns {Promise<Object>} {historyByCode, navHistoryByCode}
 */
export async function fetchBacktestData(codes, options = {}) {
  console.log('[backtestDataFetcher] fetchBacktestData called:', { codes, options });

  const {
    startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    endDate = new Date().toISOString().slice(0, 10),
    forceRefresh = false,
  } = options;

  const normalizedCodes = Array.from(new Set((Array.isArray(codes) ? codes : [])
    .map((code) => String(code || '').trim())
    .filter(Boolean)));

  console.log('[backtestDataFetcher] normalized codes:', { normalizedCodes, startDate, endDate });

  const historyByCode = {};
  const navHistoryByCode = {};

  await Promise.all(normalizedCodes.map(async (code) => {
    const [klinePayload, navData] = await Promise.all([
      fetchKline(code, { timeframe: '1d' }),
      getNavHistory(code, { from: startDate, to: endDate, forceRefresh })
    ]);

    const candles = normalizePriceCandles(klinePayload?.candles || klinePayload?.bars || [], { startDate, endDate });
    const navHistory = normalizeNavHistory(navData?.history || navData?.items || [], { startDate, endDate });

    historyByCode[code] = candles;
    navHistoryByCode[code] = navHistory;

    console.log('[backtestDataFetcher] code data ready:', {
      code,
      candles: candles.length,
      navHistory: navHistory.length
    });
  }));

  const missingPriceCodes = normalizedCodes.filter((code) => !(historyByCode[code]?.length >= 10));
  const missingNavCodes = normalizedCodes.filter((code) => !(navHistoryByCode[code]?.length >= 2));

  if (missingPriceCodes.length || missingNavCodes.length) {
    throw new Error([
      missingPriceCodes.length ? `缺少 ${missingPriceCodes.join('、')} 的价格 K 线` : '',
      missingNavCodes.length ? `缺少 ${missingNavCodes.join('、')} 的 NAV 净值` : ''
    ].filter(Boolean).join('；'));
  }

  console.log('[backtestDataFetcher] final history lengths:',
    Object.fromEntries(Object.entries(historyByCode).map(([k, v]) => [k, v?.length])));
  console.log('[backtestDataFetcher] final nav lengths:',
    Object.fromEntries(Object.entries(navHistoryByCode).map(([k, v]) => [k, v?.length])));

  return { historyByCode, navHistoryByCode };
}
