/**
 * 样例数据生成器 - 用于演示和测试
 */

import { roundTo, clampNumber } from '../core/math.js';

/**
 * 日期偏移工具
 */
function shiftIsoDate(isoDate, offsetDays) {
  const date = new Date(isoDate);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/**
 * 构建样例回测数据行
 * @param {number} days - 天数（默认 30）
 * @param {string} endDate - 结束日期（默认 '2026-06-12'）
 * @returns {Array} 样例数据行
 */
export function buildSampleBacktestRows(days = 30, endDate = '2026-06-12') {
  const totalDays = Math.max(8, Math.min(180, Math.floor(clampNumber(days, 30))));
  const rows = [];
  for (let index = 0; index < totalDays; index += 1) {
    const offset = index - totalDays + 1;
    const wave = Math.sin(index * 0.72) * 0.28 + Math.cos(index * 0.19) * 0.12;
    const sellPremiumPct = 0.26 + wave + (index % 11 === 5 ? 0.22 : 0);
    const buyPremiumPct = 0.04 - Math.sin(index * 0.47) * 0.1 + (index % 13 === 7 ? -0.08 : 0);
    rows.push({
      date: shiftIsoDate(endDate, offset),
      sellPremiumPct: roundTo(sellPremiumPct, 4),
      buyPremiumPct: roundTo(buyPremiumPct, 4)
    });
  }
  return rows;
}
