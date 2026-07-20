import { fetchFundNavHistoryWithMonthlyKv } from './getNav.js';
import { runPremiumSpreadBacktest } from './backtest/index.js';

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

function normalizeCode(value) {
  const code = String(value || '').trim().replace(/^(sh|sz|bj)/i, '');
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

export function classifyCurrentPremiums(codes = [], priceMap = {}, navMap = {}) {
  const entries = uniqueCodes(codes)
    .map((code) => ({ code, premium: metricPremium(code, priceMap, navMap) }))
    .filter((item) => Number.isFinite(item.premium));
  if (entries.length < 2) return {};
  const sorted = entries.slice().sort((a, b) => a.premium - b.premium);
  const highStart = Math.max(1, Math.ceil(sorted.length / 2));
  const result = {};
  sorted.forEach((item, index) => {
    result[item.code] = index >= highStart ? 'H' : 'L';
  });
  return result;
}

function normalizeCandle(item = {}) {
  const close = Number(item?.close ?? item?.c);
  const open = Number(item?.open ?? item?.o ?? close);
  const high = Number(item?.high ?? item?.h ?? close);
  const low = Number(item?.low ?? item?.l ?? close);
  const rawTime = Number(item?.t ?? item?.timestamp ?? item?.time);
  const t = Number.isFinite(rawTime) ? (rawTime > 1e12 ? Math.round(rawTime / 1000) : rawTime) : NaN;
  const date = String(item?.date || '').slice(0, 10) || (Number.isFinite(t)
    ? new Date(t * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    : '');
  if (!date || !Number.isFinite(close) || close <= 0) return null;
  return { t: Number.isFinite(t) ? t : Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000), date, open, high, low, close };
}

async function fetchKline(env, code, from, to) {
  const url = `https://internal/api/markets/kline/${code}?tf=1d&limit=500&session=all`;
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

function annualizedReturn(result = {}) {
  const total = Number(result?.summary?.totalReturnPct);
  const from = Date.parse(`${result?.summary?.from || ''}T00:00:00Z`);
  const to = Date.parse(`${result?.summary?.to || ''}T00:00:00Z`);
  const days = Number.isFinite(from) && Number.isFinite(to) ? Math.max(1, (to - from) / 86400000) : 365;
  if (!Number.isFinite(total)) return 0;
  return round(((Math.pow(Math.max(0, 1 + total / 100), 365 / days) - 1) * 100), 2) || 0;
}

function backtestScenario({ holdingCode, codes, historyByCode, navHistoryByCode, feeConfig, threshold, side, backtestParams = {} }) {
  const lowThreshold = side === 'low' ? threshold : Math.max(0.5, Math.min(2, threshold - 1));
  const highThreshold = side === 'high' ? threshold : Math.max(threshold + 1, 3);
  const result = runPremiumSpreadBacktest({
    id: `switch-recommend-${holdingCode}`,
    name: '基金切换推荐回测',
    highCodes: [],
    lowCodes: [],
    activeSide: 'all',
    initialSide: side === 'low' ? 'L' : 'H',
    intraSellLowerPct: lowThreshold,
    intraBuyOtherPct: highThreshold,
    autoClassify: true
  }, {
    timeframe: backtestParams?.timeframe || '1d',
    historyByCode,
    navHistoryByCode,
    initialEquity: Math.max(10000, Number(backtestParams?.initialEquity) || 100000),
    ...feeOptions(feeConfig, Math.max(10000, Number(backtestParams?.initialEquity) || 100000)),
    slippageTicks: Math.max(0, Number(backtestParams?.slippageTicks) || 1),
    lotSize: 100
  });
  return result;
}

export async function generateSwitchRecommendationData(env, {
  holdingFundCode,
  holdingFundName = '',
  holdingQuantity,
  feeConfig = {},
  candidateCodes = [],
  backtestParams = {}
} = {}) {
  const holdingCode = normalizeCode(holdingFundCode);
  if (!holdingCode) throw new Error('缺少有效的当前持仓基金');
  const catalogItem = SWITCH_CANDIDATE_CATALOG.find((item) => item.code === holdingCode);
  const requestedCandidates = candidateCodes.length
    ? candidateCodes
    : SWITCH_CANDIDATE_CATALOG
    .filter((item) => !catalogItem || item.indexKey === catalogItem.indexKey)
    .map((item) => item.code);
  const candidates = uniqueCodes(requestedCandidates)
    .filter((code) => {
      const item = SWITCH_CANDIDATE_CATALOG.find((candidate) => candidate.code === code);
      return !catalogItem || !item || item.indexKey === catalogItem.indexKey;
    })
    .filter((code) => code !== holdingCode)
    .slice(0, MAX_RECOMMENDATION_CODES - 1);
  const codes = [holdingCode, ...candidates];
  const to = todayShanghai();
  const from = addDays(to, -Math.max(60, Math.min(3650, Number(backtestParams?.days) || RECOMMENDATION_DAYS)));
  const [priceMap, navMap] = await Promise.all([
    (async () => {
      const response = env?.MARKETS?.fetch
        ? await env.MARKETS.fetch(new Request('https://internal/api/markets/fund-metrics', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ codes })
        }))
        : null;
      if (!response || !response.ok) throw new Error('最新行情获取失败');
      const payload = await response.json();
      return Object.fromEntries((Array.isArray(payload?.items) ? payload.items : [])
        .map((item) => [normalizeCode(item?.code), item])
        .filter(([code, item]) => code && item?.ok !== false));
    })(),
    (async () => {
      const result = {};
      await mapLimit(codes, 4, async (code) => {
        const item = await fetchFundNavHistoryWithMonthlyKv(code, to, to, env, { today: to, ttlMs: 60 * 60 * 1000 });
        const latest = Array.isArray(item?.items) ? item.items[item.items.length - 1] : null;
        if (latest) result[code] = { code, nav: Number(latest.nav), latestNavDate: latest.date, source: item?.cache?.source || 'nav-history' };
      });
      return result;
    })()
  ]);
  const historyEntries = await mapLimit(codes, 3, async (code) => {
    try {
      const [candles, navHistoryResult] = await Promise.all([
        fetchKline(env, code, from, to),
        fetchFundNavHistoryWithMonthlyKv(code, from, to, env, { today: to, ttlMs: 6 * 60 * 60 * 1000 })
      ]);
      return [code, candles, Array.isArray(navHistoryResult?.items) ? navHistoryResult.items : []];
    } catch (error) {
      return [code, [], [], String(error?.message || error)];
    }
  });
  const historyByCode = Object.fromEntries(historyEntries.map(([code, candles]) => [code, candles]));
  const navHistoryByCode = Object.fromEntries(historyEntries.map(([code, , nav]) => [code, nav]));
  const historyIssues = historyEntries.filter(([, , , error]) => error).map(([code, , , error]) => ({ code, error }));
  const currentPremiumByCode = Object.fromEntries(codes.map((code) => {
    const value = metricPremium(code, priceMap, navMap);
    return [code, Number.isFinite(value) ? round(value, 4) : null];
  }));
  const initialClass = classifyCurrentPremiums(codes, priceMap, navMap);
  const holdingSide = initialClass[holdingCode] === 'L' ? 'low' : 'high';
  const values = [2, 2.5, 2.65, 3];
  const comparison = values.map((threshold) => {
    const result = backtestScenario({ holdingCode, codes, historyByCode, navHistoryByCode, feeConfig, threshold, side: holdingSide, backtestParams });
    return {
      threshold,
      triggerCount: Number(result?.summary?.signalCount) || 0,
      winRatePct: Number(result?.summary?.winRatePct) || 0,
      annualizedReturnPct: annualizedReturn(result),
      maxDrawdownPct: Number(result?.summary?.maxDrawdownPct) || 0,
      passed: result?.status === 'passed'
    };
  });
  const recommended = comparison.find((item) => item.threshold === 2.65) || comparison[comparison.length - 1];
  const primary = backtestScenario({ holdingCode, codes, historyByCode, navHistoryByCode, feeConfig, threshold: recommended.threshold, side: holdingSide, backtestParams });
  const premiumClass = Object.keys(initialClass).length >= 2
    ? initialClass
    : Object.fromEntries([
      ...(primary?.effectiveHighCodes || []).map((code) => [code, 'H']),
      ...(primary?.effectiveLowCodes || []).map((code) => [code, 'L'])
    ]);
  const thresholdValue = Number(recommended.threshold) || 2.65;
  const intraSellLowerPct = holdingSide === 'low' ? thresholdValue : 1;
  const intraBuyOtherPct = holdingSide === 'high' ? thresholdValue : Math.max(3, thresholdValue + 1);
  const recommendationId = `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const candidatesResult = candidates.map((code) => {
    const premium = Number(currentPremiumByCode[code]);
    const holdingPremium = Number(currentPremiumByCode[holdingCode]);
    const advantage = Number.isFinite(premium) && Number.isFinite(holdingPremium)
      ? holdingSide === 'high' ? holdingPremium - premium : premium - holdingPremium
      : null;
    return {
      code,
      name: String(priceMap?.[code]?.name || SWITCH_CANDIDATE_CATALOG.find((item) => item.code === code)?.name || '').trim(),
      currentPremiumPct: Number.isFinite(premium) ? round(premium, 4) : null,
      currentAdvantagePct: Number.isFinite(advantage) ? round(advantage, 4) : null,
      status: Number.isFinite(advantage) && advantage >= thresholdValue ? 'triggered' : Number.isFinite(advantage) && advantage > 0 ? 'near' : 'not_reached'
    };
  }).sort((a, b) => (Number(b.currentAdvantagePct) || -Infinity) - (Number(a.currentAdvantagePct) || -Infinity));
  return {
    recommendationId,
    holdingFundCode: holdingCode,
    holdingFundName: String(holdingFundName || priceMap?.[holdingCode]?.name || '').trim(),
    holdingQuantity: Number.isFinite(Number(holdingQuantity)) ? Number(holdingQuantity) : undefined,
    candidateFundCodes: candidates,
    premiumClass,
    holdingSide,
    triggerOperator: holdingSide === 'low' ? 'lte' : 'gte',
    thresholdValue,
    intraSellLowerPct,
    intraBuyOtherPct,
    classificationStatus: Object.keys(premiumClass).length >= codes.length ? 'fresh' : 'pending_classification',
    classificationSource: 'worker-backtest',
    classifiedAt: new Date().toISOString(),
    feeConfig,
    backtest: {
      recommendedValue: thresholdValue,
      triggerCount: recommended.triggerCount,
      winRatePct: recommended.winRatePct,
      annualizedReturnPct: recommended.annualizedReturnPct,
      maxDrawdownPct: recommended.maxDrawdownPct,
      from,
      to,
      sampleCount: Number(primary?.summary?.sampleCount) || 0,
      status: primary?.status || 'failed',
      comparison
    },
    candidatesResult,
    currentPremiumByCode,
    historyIssues,
    generatedAt: new Date().toISOString()
  };
}

export async function hashRecommendationInput(input = {}) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
