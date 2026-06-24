/**
 * K线数据处理工具 - 回测统一真源
 */

import { roundTo, firstPositiveNumber, firstFiniteNumber } from './math.js';

/**
 * 将 epoch 秒转为上海日期 YYYY-MM-DD
 */
export function shanghaiDateFromEpochSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date(n * 1000).toISOString().slice(0, 10);
  }
}

/**
 * 将 epoch 秒转为上海分钟 YYYY-MM-DD HH:mm
 */
export function shanghaiMinuteFromEpochSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(new Date(n * 1000)).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    if (parts.year && parts.month && parts.day && parts.hour && parts.minute) {
      return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    }
  } catch {
    // Fall through to deterministic UTC+8 fallback.
  }
  return new Date(n * 1000 + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * 标准化分钟标签 YYYY-MM-DD HH:mm
 */
export function normalizeMinuteLabel(value) {
  const label = String(value || '').trim().slice(0, 16).replace('T', ' ');
  return /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(label) ? label : '';
}

/**
 * 标准化回测时间周期
 */
export function normalizeBacktestTimeframe(value = '') {
  const tf = String(value || '').trim();
  return new Set(['1m', '5m', '15m', '30m', '60m', '1d']).has(tf) ? tf : '5m';
}

/**
 * 标准化回测 K线数据（扩展版，含订单簿）
 * @param {Array} candles - 原始 K线数组
 * @returns {Array} 标准化后的 K线数组
 */
export function normalizeBacktestCandles(candles = []) {
  return (Array.isArray(candles) ? candles : [])
    .map((bar) => {
      const t = Number(bar?.t ?? bar?.timestamp);
      const close = Number(bar?.c ?? bar?.close);
      if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(close) || close <= 0) return null;
      const open = Number(bar?.o ?? bar?.open);
      const high = Number(bar?.h ?? bar?.high);
      const low = Number(bar?.l ?? bar?.low);
      const orderBook = bar?.orderBook && typeof bar.orderBook === 'object' ? bar.orderBook : {};
      const bidPrice = firstPositiveNumber(
        bar?.bidPrice, bar?.bid, bar?.bp1, bar?.bid1, bar?.bid1_price, bar?.bid_price1,
        bar?.buy1, bar?.buy1_price, bar?.buy_price1, orderBook.bidPrice, orderBook.bid
      );
      const askPrice = firstPositiveNumber(
        bar?.askPrice, bar?.ask, bar?.sp1, bar?.ask1, bar?.ask1_price, bar?.ask_price1,
        bar?.sell1, bar?.sell1_price, bar?.sell_price1, orderBook.askPrice, orderBook.ask
      );
      const bidVolume = firstFiniteNumber(
        bar?.bidVolume, bar?.bidSize, bar?.bc1, bar?.bid1_volume, bar?.bid_volume1,
        bar?.buy1_volume, bar?.buy_volume1, orderBook.bidVolume, orderBook.bidSize
      );
      const askVolume = firstFiniteNumber(
        bar?.askVolume, bar?.askSize, bar?.sc1, bar?.ask1_volume, bar?.ask_volume1,
        bar?.sell1_volume, bar?.sell_volume1, orderBook.askVolume, orderBook.askSize
      );
      return {
        t,
        date: String(bar?.date || '').slice(0, 10) || shanghaiDateFromEpochSec(t),
        datetime: normalizeMinuteLabel(bar?.datetime) || shanghaiMinuteFromEpochSec(t),
        open: Number.isFinite(open) && open > 0 ? open : close,
        high: Number.isFinite(high) && high > 0 ? high : close,
        low: Number.isFinite(low) && low > 0 ? low : close,
        close,
        bidPrice: bidPrice != null ? roundTo(bidPrice, 4) : null,
        bidVolume: bidVolume != null ? bidVolume : null,
        askPrice: askPrice != null ? roundTo(askPrice, 4) : null,
        askVolume: askVolume != null ? askVolume : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
}

/**
 * 构建 NAV 查询函数
 * @param {Array} navHistory - NAV 历史数据 [{date, nav}, ...]
 * @returns {Function} 查询函数 (date) => nav
 */
export function buildNavLookup(navHistory = []) {
  const sorted = (Array.isArray(navHistory) ? navHistory : [])
    .map((item) => {
      const date = String(item?.date || '').slice(0, 10);
      const nav = Number(item?.nav);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(nav) && nav > 0
        ? { date, nav }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
  return (date) => {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].date <= date) return sorted[i].nav;
    }
    return 0;
  };
}
