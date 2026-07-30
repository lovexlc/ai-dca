import { roundTo, firstPositiveNumber, firstFiniteNumber } from './math.js';

export function shanghaiDateFromEpochSec(sec) {
  const number = Number(sec);
  if (!Number.isFinite(number) || number <= 0) return '';
  try {
    return new Date(number * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date(number * 1000).toISOString().slice(0, 10);
  }
}

export function shanghaiMinuteFromEpochSec(sec) {
  const number = Number(sec);
  if (!Number.isFinite(number) || number <= 0) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(new Date(number * 1000)).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    if (parts.year && parts.month && parts.day && parts.hour && parts.minute) {
      return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    }
  } catch {
    // Use the deterministic UTC+8 fallback below.
  }
  return new Date(number * 1000 + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export function normalizeMinuteLabel(value) {
  const label = String(value || '').trim().slice(0, 16).replace('T', ' ');
  return /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(label) ? label : '';
}

export function normalizeBacktestTimeframe(value = '') {
  const timeframe = String(value || '').trim();
  return new Set(['1m', '5m', '15m', '30m', '60m', '1d']).has(timeframe) ? timeframe : '5m';
}

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
