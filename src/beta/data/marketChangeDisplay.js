/**
 * 把 beta 的涨跌闸门内核绑到网页端已有的上海交易日历上。
 *
 * 小程序侧同名文件直接 import 了 holidaysCN / holdingsLedgerBasics；
 * 网页端这两个模块都已存在且导出同名能力，所以这里不重复实现，只做绑定。
 * 纯逻辑与单测在 ./changeDisplayCore.js。
 */

import { isTradingDayShanghai } from '../../app/holidaysCN.js';
import {
  getTodayShanghaiDate,
  getExpectedLatestNavDate,
  normalizeFundKind
} from '../../app/holdingsLedgerBasics.js';
import { createChangeDisplay } from './changeDisplayCore.js';

const display = createChangeDisplay({
  isTradingDay: isTradingDayShanghai,
  getToday: getTodayShanghaiDate,
  getExpectedDate: getExpectedLatestNavDate,
  normalizeKind: normalizeFundKind
});

/**
 * 计算某条基金行情记录「应当展示」的涨跌百分比。
 * 与小程序 services/marketChangeDisplay.js 的 getDisplayChangePercent 行为一致，
 * 额外返回 reason 便于渲染层区分「真的没涨跌」和「数据还没到」。
 */
export function getDisplayChangePercent(item, context = {}) {
  return display.getDisplayChangePercent(item, context);
}

export { toDateStr, resolveLatestDataDate, createChangeDisplay } from './changeDisplayCore.js';
