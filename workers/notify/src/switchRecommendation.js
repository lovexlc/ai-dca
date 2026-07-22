import { fetchFundNavHistoryWithMonthlyKv } from './getNav.js';
import { runPremiumSpreadBacktest } from './backtest/index.js';
import {
  DEFAULT_SWITCH_HIGH_CODES,
  buildSwitchPremiumClass,
  normalizeSwitchHighCodes
} from './switchStrategy.js';

async function mapLimit(items, limit, worker) {
  const values = Array.isArray(items) ? items : [];
  const output = new Array(values.length);
  let cursor = 0;
  async function consume() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, values.length || 1)) }, consume));
  return output;
}

const FUND_CODE_PATTERN = /^\d{6}$/;
const RECOMMENDATION_DAYS = 365;
const MAX_RECOMMENDATION_CODES = 12;
const MAX_BACKTEST_CANDIDATES = 3;

export const SWITCH_CANDIDATE_CATALOG = Object.freeze([
  { code: '159513', name: '大成纳斯达克100ETF(QDII)', indexKey: 'nasdaq100' },
  { code: '159509', name: '景顺长城纳斯达克科技ETF(QDII)', indexKey: 'nasdaq100' },
  { code: '159941', name: '广发纳斯达克100ETF', indexKey: 'nasdaq100' },
  { code: '513100', name: '国泰纳斯达克100ETF', indexKey: 'nasdaq100' },
  { code: '159696', name: '易方达纳斯达克100ETF(QDII)', indexKey: 'nasdaq100' },
  { code: '159632', name: '华安纳斯达克100ETF(QDII)', indexKey: 'nasdaq100' },
  { code: '513390', name: '博时纳斯达克100ETF(QDII)', indexKey: 'nasdaq100' },
  { code: '513300', name: '华夏纳斯达克100ETF(QDII)', indexKey: 'nasdaq100' },
  { code: '159501', name: '嘉实纳斯达克100ETF(QDII)', indexKey: 'nasdaq100' },
  { code: '513870', name: '富国纳斯达克100ETF(QDII)', indexKey: 'nasdaq100' },
  { code: '159660', name: '汇添富纳斯达克100ETF', indexKey: 'nasdaq100' },
  { code: '513110', name: '华泰柏瑞纳斯达克100ETF(QDII)', indexKey: 'nasdaq100' },
  { code: '159659', name: '招商纳斯达克100ETF(QDII)', indexKey: 'nasdaq100' },
  { code: '161128', name: '易方达标普信息科技指数(QDII-LOF)A', indexKey: 'nasdaq100' },
  { code: '513500', name: '博时标普500ETF(QDII)', indexKey: 'sp500' },
  { code: '513650', name: '南方标普500ETF(QDII)', indexKey: 'sp500' },
  { code: '159612', name: '国泰标普500ETF(QDII)', indexKey: 'sp500' },
  { code: '159655', name: '华夏标普500ETF(QDII)', indexKey: 'sp500' }
]);

const SWITCH_CROSS_BORDER_CODES = new Set(SWITCH_CANDIDATE_CATALOG.map((item) => item.code));

function normalizeCode(value) {
  const code = String(value || '')
    .trim()
    .replace(/^(sh|sz|bj)/i, '');
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

function uniqueCodes(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [values]).map(normalizeCode).filter(Boolean)));
}

function round(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

export function metricYtdReturnPct(metric = {}) {
  const raw = metric?.ytdReturnPct ?? metric?.ytdReturn ?? metric?.currentYearPercent;
  if (raw === null || raw === undefined || raw === '') return null;
  return round(raw, 4);
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function todayShanghai() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function metricPremium(code, priceMap = {}, navMap = {}) {
  const price = Number(priceMap?.[code]?.price ?? priceMap?.[code]?.currentPrice);
  const nav = Number(navMap?.[code]?.nav ?? navMap?.[code]?.latestNav);
  if (Number.isFinite(price) && price > 0 && Number.isFinite(nav) && nav > 0) {
    return ((price - nav) / nav) * 100;
  }
  const explicit = Number(priceMap?.[code]?.premiumPercent ?? navMap?.[code]?.premiumPercent);
  return Number.isFinite(explicit) ? explicit : null;
}

export function classifyCurrentPremiums(codes = []) {
  // 保留旧函数名供兼容调用，但分类不再根据当前溢价动态切半。
  // 默认 H 只有 159501 / 513100，其余代码都是 L。
  return buildSwitchPremiumClass(uniqueCodes(codes), DEFAULT_SWITCH_HIGH_CODES);
}

function normalizeCandle(item = {}) {
  const close = Number(item?.close ?? item?.c);
  const open = Number(item?.open ?? item?.o ?? close);
  const high = Number(item?.high ?? item?.h ?? close);
  const low = Number(item?.low ?? item?.l ?? close);
  const rawTime = Number(item?.t ?? item?.timestamp ?? item?.time);
  const t = Number.isFinite(rawTime) ? (rawTime > 1e12 ? Math.round(rawTime / 1000) : rawTime) : NaN;
  const date =
    String(item?.date || '').slice(0, 10) ||
    (Number.isFinite(t) ? new Date(t * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) : '');
  if (!date || !Number.isFinite(close) || close <= 0) return null;
  return {
    t: Number.isFinite(t) ? t : Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000),
    date,
    open,
    high,
    low,
    close
  };
}

async function fetchKline(env, code, from, to, timeframe = '1d') {
  const url = `https://internal/api/markets/kline/${code}?tf=${timeframe}&limit=all&session=all&includeR2=1`;
  const response = env?.MARKETS?.fetch
    ? await env.MARKETS.fetch(new Request(url, { headers: { accept: 'application/json' } }))
    : null;
  if (!response || !response.ok) throw new Error(`${code} 历史行情获取失败`);
  const payload = await response.json();
  const candles = (Array.isArray(payload?.candles) ? payload.candles : [])
    .map(normalizeCandle)
    .filter((item) => item && item.date >= from && item.date <= to)
    .sort((a, b) => a.t - b.t);
  if (!candles.length) throw new Error(`${code} 没有可用历史行情`);
  return candles;
}

function feeOptions(feeConfig = {}, initialEquity = 100000) {
  const mode = feeConfig?.mode === 'estimated_total' ? 'estimated_total' : 'detailed';
  if (mode === 'estimated_total') {
    const total = Math.max(0, Number(feeConfig?.estimatedTotalFee) || 0);
    return { feeRate: total / Math.max(1, initialEquity) / 2, minFee: 0 };
  }
  const sell = Math.max(0, Number(feeConfig?.sellCommissionRate) || 0) / 100;
  const buy = Math.max(0, Number(feeConfig?.buyCommissionRate) || 0) / 100;
  return {
    feeRate: Math.max(sell, buy),
    minFee: Math.max(0, Number(feeConfig?.minimumCommission) || 0)
  };
}

function annualizedRate(totalReturnPct, fromDate, toDate) {
  if (totalReturnPct === null || totalReturnPct === undefined || totalReturnPct === '') return null;
  const total = Number(totalReturnPct);
  const from = Date.parse(`${fromDate || ''}T00:00:00Z`);
  const to = Date.parse(`${toDate || ''}T00:00:00Z`);
  const days = Number.isFinite(from) && Number.isFinite(to) ? Math.max(1, (to - from) / 86400000) : NaN;
  if (!Number.isFinite(total) || !Number.isFinite(days)) return null;
  return round((Math.pow(Math.max(0, 1 + total / 100), 365 / days) - 1) * 100, 2);
}

function holdingReturnPct(history = [], fromDate = '', toDate = '') {
  const candles = (Array.isArray(history?.candles) ? history.candles : Array.isArray(history) ? history : [])
    .map(normalizeCandle)
    .filter((item) => item && (!fromDate || item.date >= fromDate) && (!toDate || item.date <= toDate))
    .sort((a, b) => a.t - b.t);
  const first = Number(candles[0]?.close);
  const last = Number(candles[candles.length - 1]?.close);
  return first > 0 && last > 0 ? ((last - first) / first) * 100 : null;
}

export function annualizedImprovement(result = {}, holdingHistory = []) {
  const fromDate = result?.summary?.from || '';
  const toDate = result?.summary?.to || '';
  const strategyRate = annualizedRate(result?.summary?.totalReturnPct, fromDate, toDate);
  const baselineRate = annualizedRate(holdingReturnPct(holdingHistory, fromDate, toDate), fromDate, toDate);
  if (!Number.isFinite(strategyRate) || !Number.isFinite(baselineRate)) return null;
  return round(strategyRate - baselineRate, 2);
}

export function switchRecommendationCrossBorderCodes(codes = []) {
  return uniqueCodes(codes).filter((code) => SWITCH_CROSS_BORDER_CODES.has(code));
}

export function recommendationWinRate(result = {}) {
  if (!(Number(result?.summary?.cycleCount) > 0)) return null;
  const winRate = Number(result?.summary?.winRatePct);
  return Number.isFinite(winRate) ? winRate : null;
}

export function runRecommendationBacktestScenario({
  holdingCode,
  codes,
  historyByCode,
  navHistoryByCode,
  feeConfig,
  threshold,
  side,
  highCodes,
  lowCodes,
  holdingNotional,
  backtestParams = {}
}) {
  const lowThreshold = side === 'low' ? threshold : 1;
  const highThreshold = side === 'high' ? threshold : 3;
  const configuredEquity = Number(backtestParams?.initialEquity);
  const initialEquity = Number.isFinite(Number(holdingNotional)) && Number(holdingNotional) > 0
    ? Number(holdingNotional)
    : Math.max(10000, configuredEquity || 100000);
  const result = runPremiumSpreadBacktest(
    {
      id: `switch-recommend-${holdingCode}`,
      name: '基金切换推荐回测',
      codes,
      highCodes,
      lowCodes,
      activeSide: 'all',
      initialSide: side === 'low' ? 'L' : 'H',
      initialCode: holdingCode,
      intraSellLowerPct: lowThreshold,
      intraBuyOtherPct: highThreshold,
      autoClassify: false
    },
    {
      timeframe: backtestParams?.timeframe || '1d',
      historyByCode,
      navHistoryByCode,
      crossBorderCodes: switchRecommendationCrossBorderCodes(codes),
      initialEquity,
      ...feeOptions(feeConfig, initialEquity),
      slippageTicks: 0,
      tickSize: 0.005,
      lotSize: 100
    }
  );
  return result;
}

export function selectRecommendedThreshold(comparison = [], fallbackThreshold = 2.65) {
  const eligible = comparison
    .filter((item) => item?.passed && Number(item?.cycleCount) > 0)
    .slice()
    .sort((a, b) => {
      const annualized = Number(b?.annualizedReturnPct || 0) - Number(a?.annualizedReturnPct || 0);
      if (annualized !== 0) return annualized;
      const winRate = Number(b?.winRatePct || 0) - Number(a?.winRatePct || 0);
      if (winRate !== 0) return winRate;
      const drawdown = Math.abs(Number(a?.maxDrawdownPct || 0)) - Math.abs(Number(b?.maxDrawdownPct || 0));
      if (drawdown !== 0) return drawdown;
      return (
        Math.abs(Number(a?.threshold) - fallbackThreshold) -
        Math.abs(Number(b?.threshold) - fallbackThreshold)
      );
    });
  if (eligible.length) {
    return {
      item: eligible[0],
      status: 'optimized',
      metric: 'annualizedReturnPct',
      reason: '按年化提升优先、胜率次优、最大回撤幅度更小选择'
    };
  }
  return {
    item:
      comparison.find((item) => Number(item?.threshold) === fallbackThreshold) ||
      comparison[comparison.length - 1],
    status: 'fallback',
    metric: 'none',
    reason: '历史区间没有产生有效交易信号，当前值仅作参考'
  };
}

export function selectRecommendationThresholdForSide(comparison = [], side = 'high') {
  return selectRecommendedThreshold(comparison, side === 'low' ? 1 : 2.65);
}

export function selectBacktestCounterpart(scenarios = []) {
  const ranked = (Array.isArray(scenarios) ? scenarios : [])
    .filter((item) => item?.candidateCode)
    .slice()
    .sort((a, b) => {
      const passed = Number(b?.result?.status === 'passed') - Number(a?.result?.status === 'passed');
      if (passed !== 0) return passed;
      const cycles = Number(Number(b?.result?.summary?.cycleCount) > 0) - Number(Number(a?.result?.summary?.cycleCount) > 0);
      if (cycles !== 0) return cycles;
      const signals = Number(Number(b?.result?.summary?.signalCount) > 0) - Number(Number(a?.result?.summary?.signalCount) > 0);
      if (signals !== 0) return signals;
      const annualized = Number(b?.annualizedReturnPct ?? -Infinity) - Number(a?.annualizedReturnPct ?? -Infinity);
      if (Number.isFinite(annualized) && annualized !== 0) return annualized;
      const samples = Number(b?.result?.summary?.sampleCount || 0) - Number(a?.result?.summary?.sampleCount || 0);
      if (samples !== 0) return samples;
      return Number(a?.currentRank || 0) - Number(b?.currentRank || 0);
    });
  return ranked[0] || null;
}

export async function generateSwitchRecommendationData(
  env,
  {
    holdingFundCode,
    holdingFundName = '',
    holdingQuantity,
    feeConfig = {},
    candidateCodes = [],
    highCodes = [],
    holdingNotional,
    backtestParams = {}
  } = {}
) {
  const holdingCode = normalizeCode(holdingFundCode);
  if (!holdingCode) throw new Error('缺少有效的当前持仓基金');
  const catalogItem = SWITCH_CANDIDATE_CATALOG.find((item) => item.code === holdingCode);
  const requestedCandidates = candidateCodes.length
    ? candidateCodes
    : SWITCH_CANDIDATE_CATALOG.filter((item) => !catalogItem || item.indexKey === catalogItem.indexKey).map(
        (item) => item.code
      );
  const candidates = uniqueCodes(requestedCandidates)
    .filter((code) => {
      const item = SWITCH_CANDIDATE_CATALOG.find((candidate) => candidate.code === code);
      return !catalogItem || !item || item.indexKey === catalogItem.indexKey;
    })
    .filter((code) => code !== holdingCode)
    .slice(0, MAX_RECOMMENDATION_CODES - 1);
  const codes = [holdingCode, ...candidates];
  const to = todayShanghai();
  const from = addDays(
    to,
    -Math.max(60, Math.min(3650, Number(backtestParams?.days) || RECOMMENDATION_DAYS))
  );
  const timeframe = backtestParams?.timeframe || '1d';
  const response = env?.MARKETS?.fetch
    ? await env.MARKETS.fetch(
        new Request('https://internal/api/markets/fund-metrics', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ codes })
        })
      )
    : null;
  if (!response || !response.ok) throw new Error('最新行情获取失败');
  const metricsPayload = await response.json();
  const priceMap = Object.fromEntries(
    (Array.isArray(metricsPayload?.items) ? metricsPayload.items : [])
      .map((item) => [normalizeCode(item?.code), item])
      .filter(([code, item]) => code && item?.ok !== false)
  );
  const navMap = Object.fromEntries(
    codes.map((code) => {
      const metric = priceMap[code] || {};
      const nav = Number(metric.latestNav ?? metric.navBase ?? metric.iopv);
      return [code, nav > 0 ? { code, nav, latestNavDate: metric.latestNavDate || metric.navDate || '' } : null];
    }).filter(([, item]) => item)
  );
  const currentPremiumByCode = Object.fromEntries(
    codes.map((code) => {
      const value = metricPremium(code, priceMap, navMap);
      return [code, Number.isFinite(value) ? round(value, 4) : null];
    })
  );
  const latestHoldingPrice = Number(
    priceMap?.[holdingCode]?.price ??
      priceMap?.[holdingCode]?.currentPrice ??
      priceMap?.[holdingCode]?.close
  );
  const resolvedHoldingNotional =
    Number.isFinite(Number(holdingNotional)) && Number(holdingNotional) > 0
      ? Number(holdingNotional)
      : Number.isFinite(Number(holdingQuantity)) && Number(holdingQuantity) > 0 && latestHoldingPrice > 0
        ? Number(holdingQuantity) * latestHoldingPrice
        : null;
  const configuredHighCodes = normalizeSwitchHighCodes(
    Array.isArray(highCodes) && highCodes.length ? highCodes : DEFAULT_SWITCH_HIGH_CODES
  );
  const premiumClass = buildSwitchPremiumClass(codes, configuredHighCodes);
  const holdingSide = premiumClass[holdingCode] === 'L' ? 'low' : 'high';
  const fallbackThreshold = holdingSide === 'low' ? 1 : 2.65;
  const candidatesResult = candidates
    .map((code) => {
      const premium = Number(currentPremiumByCode[code]);
      const holdingPremium = Number(currentPremiumByCode[holdingCode]);
      const ytdReturnPct = metricYtdReturnPct(priceMap?.[code]);
      const advantage =
        Number.isFinite(premium) && Number.isFinite(holdingPremium)
          ? holdingSide === 'high'
            ? holdingPremium - premium
            : premium - holdingPremium
          : null;
      return {
        code,
        name: String(
          priceMap?.[code]?.name || SWITCH_CANDIDATE_CATALOG.find((item) => item.code === code)?.name || ''
        ).trim(),
        currentPremiumPct: Number.isFinite(premium) ? round(premium, 4) : null,
        currentAdvantagePct: Number.isFinite(advantage) ? round(advantage, 4) : null,
        ytdReturnPct,
        ytdReturn: ytdReturnPct,
        switchable: premiumClass[code] !== premiumClass[holdingCode]
      };
    })
    .sort((a, b) => {
      const aValue = Number(a.currentAdvantagePct);
      const bValue = Number(b.currentAdvantagePct);
      if (holdingSide === 'low') {
        return (Number.isFinite(aValue) ? aValue : Infinity) - (Number.isFinite(bValue) ? bValue : Infinity);
      }
      return (Number.isFinite(bValue) ? bValue : -Infinity) - (Number.isFinite(aValue) ? aValue : -Infinity);
    });
  const counterpartCandidates = candidatesResult.filter((candidate) => candidate.switchable);
  const backtestCandidateCodes = counterpartCandidates
    .slice(0, MAX_BACKTEST_CANDIDATES)
    .map((candidate) => candidate.code);
  const historyCodes = uniqueCodes([holdingCode, ...backtestCandidateCodes]);
  const historyEntries = await mapLimit(historyCodes, 2, async (code) => {
    try {
      const [candles, navHistoryResult] = await Promise.all([
        fetchKline(env, code, from, to, timeframe),
        fetchFundNavHistoryWithMonthlyKv(code, from, to, env, { today: to, ttlMs: 6 * 60 * 60 * 1000 })
      ]);
      return [code, candles, Array.isArray(navHistoryResult?.items) ? navHistoryResult.items : []];
    } catch (error) {
      return [code, [], [], String(error?.message || error)];
    }
  });
  const historyByCode = Object.fromEntries(historyEntries.map(([code, candles]) => [code, candles]));
  const navHistoryByCode = Object.fromEntries(historyEntries.map(([code, , nav]) => [code, nav]));
  const historyIssues = historyEntries
    .filter(([, , , error]) => error)
    .map(([code, , , error]) => ({ code, error }));
  const counterpartScenarios = backtestCandidateCodes.map((candidateCode, currentRank) => {
    const pairCodes = [holdingCode, candidateCode];
    const result = runRecommendationBacktestScenario({
      holdingCode,
      codes: pairCodes,
      historyByCode,
      navHistoryByCode,
      feeConfig,
      threshold: fallbackThreshold,
      side: holdingSide,
      highCodes: pairCodes.filter((code) => premiumClass[code] === 'H'),
      lowCodes: pairCodes.filter((code) => premiumClass[code] === 'L'),
      holdingNotional: resolvedHoldingNotional,
      backtestParams
    });
    return {
      candidateCode,
      currentRank,
      result,
      annualizedReturnPct: annualizedImprovement(result, historyByCode?.[holdingCode])
    };
  });
  const counterpartSelection = selectBacktestCounterpart(counterpartScenarios);
  const selectedCandidateCode = counterpartSelection?.candidateCode || counterpartCandidates[0]?.code || '';
  const backtestCodes = uniqueCodes([holdingCode, selectedCandidateCode]);
  const effectiveHighCodes = backtestCodes.filter((code) => premiumClass[code] === 'H');
  const effectiveLowCodes = backtestCodes.filter((code) => premiumClass[code] === 'L');
  const values = holdingSide === 'low'
    ? [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
    : [0.5, 1, 1.5, 2, 2.5, 2.65, 3, 3.5, 4, 5];
  const comparison = values.map((threshold) => {
    const result = runRecommendationBacktestScenario({
      holdingCode,
      codes: backtestCodes,
      historyByCode,
      navHistoryByCode,
      feeConfig,
      threshold,
      side: holdingSide,
      highCodes: effectiveHighCodes,
      lowCodes: effectiveLowCodes,
      holdingNotional: resolvedHoldingNotional,
      backtestParams
    });
    return {
      threshold,
      triggerCount: Number(result?.summary?.signalCount) || 0,
      tradeCount: Number(result?.summary?.tradeCount) || 0,
      cycleCount: Number(result?.summary?.cycleCount) || 0,
      winRatePct: recommendationWinRate(result),
      annualizedReturnPct: annualizedImprovement(result, historyByCode?.[holdingCode]),
      maxDrawdownPct: Number(result?.summary?.maxDrawdownPct) || 0,
      passed: result?.status === 'passed'
    };
  });
  const selection = selectRecommendationThresholdForSide(comparison, holdingSide);
  const recommended = selection.item || comparison[comparison.length - 1];
  const markedComparison = comparison.map((item) => ({
    ...item,
    recommended: item.threshold === recommended?.threshold
  }));
  const primary = runRecommendationBacktestScenario({
    holdingCode,
    codes: backtestCodes,
    historyByCode,
    navHistoryByCode,
    feeConfig,
    threshold: recommended.threshold,
    side: holdingSide,
    highCodes: effectiveHighCodes,
    lowCodes: effectiveLowCodes,
    holdingNotional: resolvedHoldingNotional,
    backtestParams
  });
  const thresholdValue = Number(recommended.threshold) || fallbackThreshold;
  const intraSellLowerPct = holdingSide === 'low' ? thresholdValue : 1;
  const intraBuyOtherPct = holdingSide === 'high' ? thresholdValue : 3;
  const recommendationId = `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const resolvedCandidatesResult = candidatesResult.map((candidate) => {
    const advantage = Number(candidate.currentAdvantagePct);
    return {
      ...candidate,
      status: candidate.switchable
        ? Number.isFinite(advantage) &&
          (holdingSide === 'low' ? advantage < thresholdValue : advantage > thresholdValue)
          ? 'triggered'
          : Number.isFinite(advantage) && Math.abs(thresholdValue - advantage) <= 1
            ? 'near'
            : 'not_reached'
        : 'not_reached'
    };
  });
  const recommendedCandidate =
    resolvedCandidatesResult.find((candidate) => candidate.code === selectedCandidateCode) ||
    resolvedCandidatesResult.find((candidate) => candidate.switchable) ||
    null;
  return {
    recommendationId,
    holdingFundCode: holdingCode,
    holdingFundName: String(holdingFundName || priceMap?.[holdingCode]?.name || '').trim(),
    holdingQuantity: Number.isFinite(Number(holdingQuantity)) ? Number(holdingQuantity) : undefined,
    holdingNotional: resolvedHoldingNotional,
    candidateFundCodes: candidates,
    counterpartCodes: counterpartCandidates.map((candidate) => candidate.code),
    recommendedCandidate,
    highPremiumCodes: configuredHighCodes,
    premiumClassSource: Array.isArray(highCodes) && highCodes.length ? 'user' : 'default',
    premiumClass,
    holdingSide,
    triggerOperator: holdingSide === 'low' ? 'lte' : 'gte',
    thresholdValue,
    intraSellLowerPct,
    intraBuyOtherPct,
    classificationStatus:
      Object.keys(premiumClass).length >= codes.length ? 'fresh' : 'pending_classification',
    classificationSource: 'worker-backtest',
    classifiedAt: new Date().toISOString(),
    feeConfig,
    backtest: {
      recommendedValue: thresholdValue,
      triggerCount: recommended.triggerCount,
      cycleCount: recommended.cycleCount,
      winRatePct: recommended.winRatePct,
      annualizedReturnPct: recommended.annualizedReturnPct,
      maxDrawdownPct: recommended.maxDrawdownPct,
      from,
      to,
      sampleCount: Number(primary?.summary?.sampleCount) || 0,
      status: primary?.status || 'failed',
      comparison: markedComparison,
      candidateCode: recommendedCandidate?.code || null,
      selectionStatus: selection.status,
      selectionMetric: selection.metric,
      selectionReason: selection.reason
    },
    candidatesResult: resolvedCandidatesResult,
    currentPremiumByCode,
    historyIssues,
    generatedAt: new Date().toISOString()
  };
}

export async function hashRecommendationInput(input = {}) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 40);
}
