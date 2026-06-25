/**
 * 回测数据获取辅助函数
 *
 * 从各数据源获取历史 K线和 NAV 数据，供本地回测引擎使用
 */

import { getCachedHistoricalData } from './quantHistoricalData.js';
import { getNavHistory } from './navService.js';
import { buildPremiumSpreadInputFromLegacyRows } from './backtest/index.js';

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
    highCodes = [],
    lowCodes = []
  } = options;

  console.log('[backtestDataFetcher] date range:', { startDate, endDate });

  const normalizedCodes = Array.from(new Set((Array.isArray(codes) ? codes : [])
    .map((code) => String(code || '').trim())
    .filter(Boolean)));
  const normalizedHighCodes = (Array.isArray(highCodes) ? highCodes : [])
    .map((code) => String(code || '').trim())
    .filter(Boolean);
  const normalizedLowCodes = (Array.isArray(lowCodes) ? lowCodes : [])
    .map((code) => String(code || '').trim())
    .filter(Boolean);

  console.log('[backtestDataFetcher] normalized codes:', { normalizedCodes, normalizedHighCodes, normalizedLowCodes });

  // 获取 K线历史数据
  console.log('[backtestDataFetcher] fetching historical data...');
  const rawHistory = await getCachedHistoricalData(normalizedCodes, startDate, endDate, forceRefresh);
  console.log('[backtestDataFetcher] rawHistory type:', Array.isArray(rawHistory) ? 'array' : typeof rawHistory);

  let historyByCode = rawHistory && typeof rawHistory === 'object' && !Array.isArray(rawHistory)
    ? rawHistory
    : {};
  let legacyNavHistoryByCode = {};

  if (Array.isArray(rawHistory)) {
    console.log('[backtestDataFetcher] rawHistory is array, adapting...');
    const adapted = buildPremiumSpreadInputFromLegacyRows(rawHistory, {
      highCode: normalizedHighCodes[0] || normalizedCodes[0],
      lowCode: normalizedLowCodes[0] || normalizedCodes[1]
    });
    historyByCode = adapted.historyByCode;
    legacyNavHistoryByCode = adapted.navHistoryByCode;
    console.log('[backtestDataFetcher] adapted historyByCode keys:', Object.keys(historyByCode));
  }

  console.log('[backtestDataFetcher] historyByCode keys:', Object.keys(historyByCode));
  console.log('[backtestDataFetcher] historyByCode lengths:',
    Object.fromEntries(Object.entries(historyByCode).map(([k, v]) => [k, v?.length])));

  // 获取 NAV 历史数据
  console.log('[backtestDataFetcher] fetching NAV history...');
  const navHistoryByCode = {};
  const navPromises = normalizedCodes.map(async (code) => {
    try {
      console.log('[backtestDataFetcher] fetching NAV for:', code);
      const navData = await getNavHistory(code, { from: startDate, to: endDate, forceRefresh });
      const navHistory = navData?.history || navData?.items || [];
      navHistoryByCode[code] = navHistory.length ? navHistory : (legacyNavHistoryByCode[code] || []);
      console.log('[backtestDataFetcher] NAV fetched for', code, 'length:', navHistoryByCode[code]?.length);
    } catch (err) {
      console.warn(`[backtestDataFetcher] Failed to fetch NAV for ${code}:`, err);
      navHistoryByCode[code] = legacyNavHistoryByCode[code] || [];
    }
  });

  await Promise.all(navPromises);

  console.log('[backtestDataFetcher] final navHistoryByCode keys:', Object.keys(navHistoryByCode));
  console.log('[backtestDataFetcher] final navHistoryByCode lengths:',
    Object.fromEntries(Object.entries(navHistoryByCode).map(([k, v]) => [k, v?.length])));

  return { historyByCode, navHistoryByCode };
}
