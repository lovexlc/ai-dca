import { buildNavLookup } from '../../app/backtest/index.js';
import { previousIsoDate } from '../../app/backtest/core/premiumPanel.js';

const DEFAULT_SELL_LOWER_GRID = Object.freeze([0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.5, 2]);
const DEFAULT_BUY_OTHER_GRID = Object.freeze([1, 1.5, 2, 2.5, 3, 3.5, 4, 5]);
const MAX_GRID_SIZE = 8;

function roundThreshold(value) {
  return Math.round(Number(value) * 10) / 10;
}

function uniqueSorted(values = []) {
  return Array.from(new Set(
    values
      .map(roundThreshold)
      .filter((value) => Number.isFinite(value))
  )).sort((a, b) => a - b);
}

function linearGrid(start, end, count = MAX_GRID_SIZE) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  if (count <= 1 || Math.abs(end - start) < 0.0001) return [roundThreshold(start)];
  const step = (end - start) / (count - 1);
  return uniqueSorted(Array.from({ length: count }, (_, index) => start + step * index));
}

export function buildGapDistributionThresholdGrids({
  historyByCode = {},
  navHistoryByCode = {},
  highCodes = [],
  lowCodes = [],
  crossBorderCodes = new Set(),
  fallbackSellLowerGrid = DEFAULT_SELL_LOWER_GRID,
  fallbackBuyOtherGrid = DEFAULT_BUY_OTHER_GRID,
} = {}) {
  const highList = (Array.isArray(highCodes) ? highCodes : []).filter(Boolean);
  const lowList = (Array.isArray(lowCodes) ? lowCodes : []).filter(Boolean);
  if (!highList.length || !lowList.length) {
    return { sellLowerGrid: fallbackSellLowerGrid, buyOtherGrid: fallbackBuyOtherGrid, stats: null };
  }

  const navLookupByCode = Object.fromEntries(
    [...highList, ...lowList].map((code) => [code, buildNavLookup(navHistoryByCode?.[code] || [])])
  );
  const premiumByCodeDate = {};
  for (const code of [...highList, ...lowList]) {
    const rows = Array.isArray(historyByCode?.[code]?.candles)
      ? historyByCode[code].candles
      : (Array.isArray(historyByCode?.[code]) ? historyByCode[code] : []);
    const byDate = new Map();
    const needsPrevNav = crossBorderCodes.has(code);
    for (const row of rows) {
      const date = String(row?.date || row?.day || row?.datetime || '').slice(0, 10);
      const close = Number(row?.close ?? row?.c ?? row?.price);
      let navDate = date;
      if (needsPrevNav) {
        navDate = previousIsoDate(date);
      }
      let nav = navLookupByCode[code]?.(navDate);
      if (!(nav > 0) && needsPrevNav) {
        nav = navLookupByCode[code]?.(date);
      }
      if (date && close > 0 && nav > 0) {
        byDate.set(date, ((close - nav) / nav) * 100);
      }
    }
    premiumByCodeDate[code] = byDate;
  }

  const samples = [];
  for (const highCode of highList) {
    for (const lowCode of lowList) {
      const highPremiums = premiumByCodeDate[highCode];
      const lowPremiums = premiumByCodeDate[lowCode];
      for (const [date, highPremium] of highPremiums || []) {
        const lowPremium = lowPremiums?.get(date);
        if (Number.isFinite(highPremium) && Number.isFinite(lowPremium)) {
          samples.push(highPremium - lowPremium);
        }
      }
    }
  }

  if (samples.length < 10) {
    return { sellLowerGrid: fallbackSellLowerGrid, buyOtherGrid: fallbackBuyOtherGrid, stats: null };
  }

  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / samples.length;
  const std = Math.sqrt(variance);
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  if (!Number.isFinite(std) || std < 0.0001 || min >= max) {
    return { sellLowerGrid: fallbackSellLowerGrid, buyOtherGrid: fallbackBuyOtherGrid, stats: { mean, std, min, max, sampleCount: samples.length } };
  }

  const sellStart = Math.max(min, mean - 1.5 * std);
  const sellEnd = Math.min(max, mean);
  const buyStart = Math.max(min, mean);
  const buyEnd = Math.min(max, mean + 1.5 * std);
  const sellLowerGrid = uniqueSorted(linearGrid(sellStart, sellEnd, MAX_GRID_SIZE).filter((value) => value >= min && value <= max));
  const buyOtherGrid = uniqueSorted(linearGrid(buyStart, buyEnd, MAX_GRID_SIZE).filter((value) => value >= min && value <= max));

  if (!sellLowerGrid.length || !buyOtherGrid.length || !buyOtherGrid.some((buy) => sellLowerGrid.some((sell) => buy > sell))) {
    return { sellLowerGrid: fallbackSellLowerGrid, buyOtherGrid: fallbackBuyOtherGrid, stats: { mean, std, min, max, sampleCount: samples.length } };
  }

  return {
    sellLowerGrid,
    buyOtherGrid,
    stats: {
      mean: roundThreshold(mean),
      std: roundThreshold(std),
      min: roundThreshold(min),
      max: roundThreshold(max),
      sampleCount: samples.length,
    }
  };
}

export { DEFAULT_BUY_OTHER_GRID, DEFAULT_SELL_LOWER_GRID };
