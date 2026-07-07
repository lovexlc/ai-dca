import { resolveHistoricalPremiumNavItem } from '../../app/fundPremiumNav.js';

const DEFAULT_SELL_LOWER_GRID = Object.freeze([-1, -0.5, 0, 0.2, 0.5, 0.8, 1, 1.5]);
const DEFAULT_BUY_OTHER_GRID = Object.freeze([0.5, 1, 1.5, 2, 2.5, 3, 4, 5]);
const MAX_GRID_SIZE = 8;
const MIN_THRESHOLD_SPREAD = 1;

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

export function isValidThresholdPair(sellLowerThreshold, buyOtherThreshold, minSpread = MIN_THRESHOLD_SPREAD) {
  const sell = Number(sellLowerThreshold);
  const buy = Number(buyOtherThreshold);
  return Number.isFinite(sell) && Number.isFinite(buy) && buy - sell >= minSpread;
}

export function hasValidThresholdSpread(sellLowerGrid = [], buyOtherGrid = [], minSpread = MIN_THRESHOLD_SPREAD) {
  return (Array.isArray(buyOtherGrid) ? buyOtherGrid : []).some((buy) =>
    (Array.isArray(sellLowerGrid) ? sellLowerGrid : []).some((sell) => isValidThresholdPair(sell, buy, minSpread))
  );
}

function pruneThresholdGridsBySpread(sellLowerGrid = [], buyOtherGrid = [], minSpread = MIN_THRESHOLD_SPREAD) {
  const sellGrid = uniqueSorted(sellLowerGrid);
  const buyGrid = uniqueSorted(buyOtherGrid);
  const nextSellGrid = sellGrid.filter((sell) => buyGrid.some((buy) => isValidThresholdPair(sell, buy, minSpread)));
  const nextBuyGrid = buyGrid.filter((buy) => sellGrid.some((sell) => isValidThresholdPair(sell, buy, minSpread)));
  return { sellLowerGrid: nextSellGrid, buyOtherGrid: nextBuyGrid };
}

export function buildGapDistributionThresholdGrids({
  historyByCode = {},
  navHistoryByCode = {},
  highCodes = [],
  lowCodes = [],
  crossBorderCodes = new Set(),
  fallbackSellLowerGrid = DEFAULT_SELL_LOWER_GRID,
  fallbackBuyOtherGrid = DEFAULT_BUY_OTHER_GRID,
  minThresholdSpread = MIN_THRESHOLD_SPREAD,
  skipChinaHolidayGap = false,
} = {}) {
  const highList = (Array.isArray(highCodes) ? highCodes : []).filter(Boolean);
  const lowList = (Array.isArray(lowCodes) ? lowCodes : []).filter(Boolean);
  if (!highList.length || !lowList.length) {
    return { sellLowerGrid: fallbackSellLowerGrid, buyOtherGrid: fallbackBuyOtherGrid, stats: null };
  }

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
      const navItem = resolveHistoricalPremiumNavItem(navHistoryByCode?.[code] || [], date, {
        isCrossBorder: needsPrevNav,
        skipChinaHolidayGap,
      });
      const nav = Number(navItem?.nav);
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

  const spreadFiltered = pruneThresholdGridsBySpread(sellLowerGrid, buyOtherGrid, minThresholdSpread);

  if (!spreadFiltered.sellLowerGrid.length || !spreadFiltered.buyOtherGrid.length || !hasValidThresholdSpread(spreadFiltered.sellLowerGrid, spreadFiltered.buyOtherGrid, minThresholdSpread)) {
    return { sellLowerGrid: fallbackSellLowerGrid, buyOtherGrid: fallbackBuyOtherGrid, stats: { mean, std, min, max, sampleCount: samples.length } };
  }

  return {
    sellLowerGrid: spreadFiltered.sellLowerGrid,
    buyOtherGrid: spreadFiltered.buyOtherGrid,
    stats: {
      mean: roundThreshold(mean),
      std: roundThreshold(std),
      min: roundThreshold(min),
      max: roundThreshold(max),
      sampleCount: samples.length,
    }
  };
}

export { DEFAULT_BUY_OTHER_GRID, DEFAULT_SELL_LOWER_GRID, MIN_THRESHOLD_SPREAD };
