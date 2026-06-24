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
  const {
    startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    endDate = new Date().toISOString().slice(0, 10),
    forceRefresh = false,
    highCodes = [],
    lowCodes = []
  } = options;
  const normalizedCodes = Array.from(new Set((Array.isArray(codes) ? codes : [])
    .map((code) => String(code || '').trim())
    .filter(Boolean)));
  const normalizedHighCodes = (Array.isArray(highCodes) ? highCodes : [])
    .map((code) => String(code || '').trim())
    .filter(Boolean);
  const normalizedLowCodes = (Array.isArray(lowCodes) ? lowCodes : [])
    .map((code) => String(code || '').trim())
    .filter(Boolean);

  // 获取 K线历史数据
  const rawHistory = await getCachedHistoricalData(normalizedCodes, startDate, endDate, forceRefresh);
  let historyByCode = rawHistory && typeof rawHistory === 'object' && !Array.isArray(rawHistory)
    ? rawHistory
    : {};
  let legacyNavHistoryByCode = {};
  if (Array.isArray(rawHistory)) {
    const adapted = buildPremiumSpreadInputFromLegacyRows(rawHistory, {
      highCode: normalizedHighCodes[0] || normalizedCodes[0],
      lowCode: normalizedLowCodes[0] || normalizedCodes[1]
    });
    historyByCode = adapted.historyByCode;
    legacyNavHistoryByCode = adapted.navHistoryByCode;
  }

  // 获取 NAV 历史数据
  const navHistoryByCode = {};
  const navPromises = normalizedCodes.map(async (code) => {
    try {
      const navData = await getNavHistory(code, { from: startDate, to: endDate, forceRefresh });
      const navHistory = navData?.history || navData?.items || [];
      navHistoryByCode[code] = navHistory.length ? navHistory : (legacyNavHistoryByCode[code] || []);
    } catch (err) {
      console.warn(`Failed to fetch NAV for ${code}:`, err);
      navHistoryByCode[code] = legacyNavHistoryByCode[code] || [];
    }
  });

  await Promise.all(navPromises);

  return { historyByCode, navHistoryByCode };
}
