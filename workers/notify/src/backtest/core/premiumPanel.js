/**
 * Premium spread data panel.
 *
 * Turns raw price candles + NAV rows into aligned, reusable rows for the
 * premium-spread engine. The trading simulator should consume this panel
 * instead of rebuilding lookups inside the main loop.
 */

import { normalizeBacktestCandles } from './candles.js';
import { buildNavLookup } from './nav.js';
import { roundTo } from './math.js';

function uniqueCodes(codes = []) {
  return Array.from(new Set(
    (Array.isArray(codes) ? codes : [])
      .map((code) => String(code || '').trim())
      .filter(Boolean)
  ));
}

/**
 * 返回 ISO 日期的上一个日历日。
 * 用于 QDII/跨境基金：A 股 T 日收盘时，已披露净值对应的是海外市场 T-1 日收盘。
 */
function previousIsoDate(isoDate) {
  const parts = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return '';
  const [, year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function candlesForCode(historyByCode = {}, code) {
  const raw = historyByCode?.[code];
  return normalizeBacktestCandles(raw?.candles || raw || []);
}

function makeCandleMap(codes, historyByCode) {
  return Object.fromEntries(codes.map((code) => [code, candlesForCode(historyByCode, code)]));
}

function makeBarLookup(codes, candleMap) {
  return Object.fromEntries(
    codes.map((code) => [
      code,
      new Map((candleMap[code] || []).map((bar) => [bar.t, bar])),
    ])
  );
}

function makeNavLookup(codes, navHistoryByCode) {
  return Object.fromEntries(
    codes.map((code) => [code, buildNavLookup(navHistoryByCode?.[code] || [])])
  );
}

function pickAnchorCode(codes, candleMap) {
  return codes.slice().sort((a, b) => (candleMap[b]?.length || 0) - (candleMap[a]?.length || 0))[0] || '';
}

export function buildPremiumPanel({
  codes = [],
  historyByCode = {},
  navHistoryByCode = {},
  crossBorderCodes: crossBorderCodesInput,
} = {}) {
  const normalizedCodes = uniqueCodes(codes);
  const crossBorderCodes = crossBorderCodesInput != null
    ? new Set(Array.isArray(crossBorderCodesInput) ? crossBorderCodesInput : [...crossBorderCodesInput])
    : new Set();
  const candleMap = makeCandleMap(normalizedCodes, historyByCode);
  const anchorCode = pickAnchorCode(normalizedCodes, candleMap);
  const anchorCandles = candleMap[anchorCode] || [];
  const closeByCode = makeBarLookup(normalizedCodes, candleMap);
  const navLookupByCode = makeNavLookup(normalizedCodes, navHistoryByCode);

  const rows = [];
  let completePriceRows = 0;
  let completeNavRows = 0;

  for (const anchor of anchorCandles) {
    const premiums = {};
    const currentPrices = {};
    let hasAllPrices = true;
    let hasAllNav = true;

    for (const code of normalizedCodes) {
      const bar = closeByCode[code]?.get(anchor.t);
      if (!bar) {
        hasAllPrices = false;
        continue;
      }
      const lookup = navLookupByCode[code];
      const needsPrevNav = crossBorderCodes.has(code);
      let navDate = anchor.date;
      if (needsPrevNav) {
        navDate = previousIsoDate(anchor.date);
      }
      let nav = lookup?.(navDate);
      // 跨境基金优先用 T-1 净值；若 T-1 无数据（序列开头或长假后），回退到 T 日净值
      if (!(nav > 0) && needsPrevNav) {
        nav = lookup?.(anchor.date);
      }
      if (!(nav > 0)) {
        hasAllNav = false;
        continue;
      }
      currentPrices[code] = bar.close;
      premiums[code] = roundTo(((bar.close - nav) / nav) * 100, 4);
    }

    if (hasAllPrices) completePriceRows += 1;
    if (hasAllPrices && hasAllNav) completeNavRows += 1;

    // Preserve the legacy engine contract: rows without complete price data do
    // not enter the simulation timeline, but still reduce coverage.
    if (!hasAllPrices) continue;

    rows.push({
      ts: anchor.t,
      date: anchor.date,
      datetime: anchor.datetime,
      anchor,
      premiums,
      currentPrices,
      hasAllPrices,
      hasAllNav,
      canTrade: hasAllPrices && hasAllNav,
    });
  }

  const anchorCount = anchorCandles.length;
  const sampleCount = rows.length;

  return {
    codes: normalizedCodes,
    crossBorderCodes,
    candleMap,
    anchorCode,
    anchorCandles,
    closeByCode,
    navLookupByCode,
    rows,
    coverage: {
      anchorCount,
      completePriceRows,
      completeNavRows,
      sampleCount,
      priceCoveragePct: anchorCount ? roundTo((completePriceRows / anchorCount) * 100, 2) : 0,
      navCoveragePct: completePriceRows ? roundTo((completeNavRows / completePriceRows) * 100, 2) : 0,
      dataCoveragePct: anchorCount ? roundTo((sampleCount / anchorCount) * 100, 2) : 0,
    },
    getBar(code, ts) {
      return closeByCode[code]?.get(ts) || null;
    },
  };
}

export function classifyPremiumCodes(panel, codes = panel?.codes || []) {
  const normalizedCodes = uniqueCodes(codes);
  const crossBorderCodes = panel?.crossBorderCodes || new Set();
  const avgPremiumByCode = {};

  for (const code of normalizedCodes) {
    const samples = [];
    const needsPrevNav = crossBorderCodes.has(code);
    for (const anchor of panel?.anchorCandles || []) {
      const close = panel?.closeByCode?.[code]?.get(anchor.t)?.close;
      const lookup = panel?.navLookupByCode?.[code];
      let navDate = anchor.date;
      if (needsPrevNav) {
        navDate = previousIsoDate(anchor.date);
      }
      let nav = lookup?.(navDate);
      if (!(nav > 0) && needsPrevNav) {
        nav = lookup?.(anchor.date);
      }
      if (close > 0 && nav > 0) {
        samples.push(((close - nav) / nav) * 100);
      }
    }
    avgPremiumByCode[code] = samples.length
      ? roundTo(samples.reduce((sum, value) => sum + value, 0) / samples.length, 4)
      : 0;
  }

  const sorted = normalizedCodes
    .slice()
    .sort((a, b) => avgPremiumByCode[b] - avgPremiumByCode[a]);
  const mid = Math.ceil(sorted.length / 2);
  return {
    highCodes: sorted.slice(0, mid),
    lowCodes: sorted.slice(mid),
    avgPremiumByCode,
  };
}

export function buildPremiumLists(row, highCodes = [], lowCodes = []) {
  const premiums = row?.premiums || {};
  const highList = (Array.isArray(highCodes) ? highCodes : [])
    .map((code) => ({ code, premiumPct: premiums[code] }))
    .filter((item) => Number.isFinite(item.premiumPct));
  const lowList = (Array.isArray(lowCodes) ? lowCodes : [])
    .map((code) => ({ code, premiumPct: premiums[code] }))
    .filter((item) => Number.isFinite(item.premiumPct));
  return { highList, lowList };
}
