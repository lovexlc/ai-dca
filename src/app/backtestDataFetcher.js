/**
 * 回测数据获取辅助函数
 *
 * 从各数据源获取历史 K线和 NAV 数据，供本地回测引擎使用
 */

import { getCachedHistoricalData } from './quantHistoricalData.js';
import { getNavHistory } from './navService.js';

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
    forceRefresh = false
  } = options;

  // 获取 K线历史数据
  const historyByCode = await getCachedHistoricalData(codes, startDate, endDate, forceRefresh);

  // 获取 NAV 历史数据
  const navHistoryByCode = {};
  const navPromises = codes.map(async (code) => {
    try {
      const navData = await getNavHistory(code, { from: startDate, to: endDate, forceRefresh });
      navHistoryByCode[code] = navData?.history || [];
    } catch (err) {
      console.warn(`Failed to fetch NAV for ${code}:`, err);
      navHistoryByCode[code] = [];
    }
  });

  await Promise.all(navPromises);

  return { historyByCode, navHistoryByCode };
}
