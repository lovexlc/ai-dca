#!/usr/bin/env node

import { fetchBacktestData } from '../src/app/backtestDataFetcher.js';
import { runBacktest } from '../src/app/backtest/index.js';

const OPTIMIZE_SELL_LOWER_GRID = Object.freeze([0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.5, 2]);
const OPTIMIZE_BUY_OTHER_GRID = Object.freeze([1, 1.5, 2, 2.5, 3, 3.5, 4, 5]);
const BACKTEST_TRADING_COSTS = Object.freeze({
  feeRate: 0.00005,
  minFee: 0,
  tickSize: 0.005,
  slippageTicks: 1,
  lotSize: 100,
  useQuotedPrices: false
});
const API_ORIGIN = String(process.env.DIAG_API_ORIGIN || 'https://api.freebacktrack.tech').replace(/\/$/, '');
const nativeFetch = globalThis.fetch?.bind(globalThis);
if (nativeFetch) {
  globalThis.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      return nativeFetch(API_ORIGIN + input, init);
    }
    if (input instanceof URL && input.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }
    return nativeFetch(input, init);
  };
}

function todayShanghaiIso() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  } catch (_error) {
    return new Date().toISOString().slice(0, 10);
  }
}

function shiftIsoDate(isoDate, deltaDays) {
  const [year, month, day] = String(isoDate || '').split('-').map((part) => Number(part));
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(deltaDays || 0));
  return date.toISOString().slice(0, 10);
}

function makeRotationResult(result) {
  if (!result?.ok || result.status !== 'passed') return null;
  return {
    totalReturnPct: result.summary.totalReturnPct,
    maxDrawdownPct: result.summary.maxDrawdownPct,
    rotationCount: result.summary.switchCount || result.summary.signalCount || 0,
    tradeCount: result.summary.tradeCount,
    autoClassified: result.autoClassified || false,
    effectiveHighCodes: result.effectiveHighCodes || [],
    effectiveLowCodes: result.effectiveLowCodes || [],
    avgPremiumByCode: result.avgPremiumByCode || null,
    summary: result.summary,
    quality: result.quality
  };
}

function pickBetterBacktest(currentBest, candidate) {
  if (!candidate) return currentBest;
  if (!currentBest) return candidate;
  const candidateReturn = Number(candidate.totalReturnPct);
  const bestReturn = Number(currentBest.totalReturnPct);
  if (candidateReturn > bestReturn) return candidate;
  if (candidateReturn < bestReturn) return currentBest;
  return Math.abs(Number(candidate.maxDrawdownPct)) < Math.abs(Number(currentBest.maxDrawdownPct))
    ? candidate
    : currentBest;
}

function optimizePremiumSpread({ baseStrategy, backtestOptions }) {
  let best = null;
  const attempts = [];
  for (const initialSide of ['L', 'H']) {
    for (const sellLowerThreshold of OPTIMIZE_SELL_LOWER_GRID) {
      for (const buyOtherThreshold of OPTIMIZE_BUY_OTHER_GRID) {
        if (buyOtherThreshold < sellLowerThreshold) continue;
        const result = runBacktest({
          ...baseStrategy,
          initialSide,
          intraSellLowerPct: sellLowerThreshold,
          intraBuyOtherPct: buyOtherThreshold
        }, backtestOptions);
        const rotation = makeRotationResult(result);
        if (rotation) {
          rotation.initialSide = initialSide;
          rotation.thresholds = { sellLowerThreshold, buyOtherThreshold };
          attempts.push(rotation);
          best = pickBetterBacktest(best, rotation);
        }
      }
    }
  }
  return { best, attempts };
}

function withFilteredBuildNavLogs(fn) {
  const originalLog = console.log;
  console.log = (...args) => {
    if (String(args[0] || '').startsWith('[buildNavLookup]')) return;
    originalLog(...args);
  };
  try {
    return fn();
  } finally {
    console.log = originalLog;
  }
}

async function main() {
  const [rawHighCode, rawLowCode] = process.argv.slice(2);
  const highCode = String(rawHighCode || '').trim();
  const lowCode = String(rawLowCode || '').trim();
  if (!/^\d{6}$/.test(highCode) || !/^\d{6}$/.test(lowCode)) {
    console.error('Usage: node scripts/diag-real-premium-spread.mjs <H_CODE> <L_CODE>');
    process.exit(1);
  }

  const endDate = todayShanghaiIso();
  const startDate = shiftIsoDate(endDate, -365);
  const codes = [highCode, lowCode];
  console.log('[diag] fetching real backtest data', { codes, startDate, endDate });
  const { historyByCode, navHistoryByCode } = await fetchBacktestData(codes, {
    startDate,
    endDate,
    forceRefresh: true
  });

  const baseStrategy = {
    type: 'premium-spread',
    highCodes: [highCode],
    lowCodes: [lowCode],
    activeSide: 'all'
  };
  const backtestOptions = {
    timeframe: '1d',
    historyByCode,
    navHistoryByCode,
    initialEquity: 100000,
    ...BACKTEST_TRADING_COSTS,
    silent: true
  };
  const optimized = withFilteredBuildNavLogs(() => optimizePremiumSpread({ baseStrategy, backtestOptions }));
  const best = optimized.best;

  console.log('[diag] data lengths', {
    historyByCode: Object.fromEntries(Object.entries(historyByCode).map(([code, rows]) => [code, rows.length])),
    navHistoryByCode: Object.fromEntries(Object.entries(navHistoryByCode).map(([code, rows]) => [code, rows.length]))
  });
  console.log('[diag] optimization', {
    attempts: optimized.attempts.length,
    rotationAttempts: optimized.attempts.filter((item) => item.rotationCount > 0).length,
    best: best ? {
      totalReturnPct: best.totalReturnPct,
      maxDrawdownPct: best.maxDrawdownPct,
      rotationCount: best.rotationCount,
      initialSide: best.initialSide,
      thresholds: best.thresholds,
      autoClassified: best.autoClassified,
      effectiveHighCodes: best.effectiveHighCodes,
      effectiveLowCodes: best.effectiveLowCodes,
      avgPremiumByCode: best.avgPremiumByCode,
      navCoveragePct: best.summary.navCoveragePct,
      priceCoveragePct: best.summary.priceCoveragePct,
      passed: best.summary.passed
    } : null
  });
}

main().catch((error) => {
  console.error('[diag] failed:', error?.stack || error?.message || error);
  process.exit(1);
});
