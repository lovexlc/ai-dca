/**
 * 纳指ETF套利雷达：每日净值发布后扫描12只纳指ETF，找出最优套利对。
 *
 * 数据流：
 * 1. cron (35 13 * * MON-FRI，即北京时间21:35，当日净值已发布) 触发 computeNasdaqRadar()
 * 2. 获取12只ETF当日收盘价与单位净值，计算NAV口径溢价率：(收盘价 − 当日净值) / 当日净值 ×100
 * 3. 找出溢价最高/最低对，计算价差
 * 4. 从KV读取近20天价差历史，计算当前分位数
 * 5. 结果存入 KV `nasdaq-radar:latest` 和 `nasdaq-radar:history`
 *
 * 前端通过 /api/nasdaq-radar 接口读取。
 */

import { fetchSwitchOrderBooks, parseFundMobApiReferences } from './switchMarketCollector.js';
import { fetchFundMetricsForCodes } from './getNav.js';

const EASTMONEY_FUNDMOB_URL = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo';

// 雷达专用：直接从东方财富 fundmob 获取收盘价与当日净值（不要求2分钟新鲜度）
async function fetchRadarPremiums(codes) {
  const params = new URLSearchParams({
    pageIndex: '1',
    pageSize: '200',
    plat: 'Android',
    appType: 'ttjj',
    product: 'EFund',
    Version: '1',
    deviceid: 'ai-dca-radar',
    Fcodes: codes.join(',')
  });
  const response = await fetch(EASTMONEY_FUNDMOB_URL + '?' + params.toString(), {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: 'https://fund.eastmoney.com/',
      'user-agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Eastmoney fundmob failed: HTTP ' + response.status);
  const payload = await response.json().catch(() => null);
  if (!payload || payload.Success === false || !Array.isArray(payload.Datas)) {
    throw new Error('Eastmoney fundmob invalid response');
  }
  return parseFundMobApiReferences(payload);
}

// 12只标准纳斯达克100ETF（剔除159509纳指科技ETF、161128信息科技LOF）
export const NASDAQ_ETFS = Object.freeze([
  { code: '159513', name: '大成纳斯达克100ETF' },
  { code: '159941', name: '广发纳斯达克100ETF' },
  { code: '513100', name: '国泰纳斯达克100ETF' },
  { code: '159696', name: '易方达纳斯达克100ETF' },
  { code: '159632', name: '华安纳斯达克100ETF' },
  { code: '513390', name: '博时纳斯达克100ETF' },
  { code: '513300', name: '华夏纳斯达克100ETF' },
  { code: '159501', name: '嘉实纳斯达克100ETF' },
  { code: '513870', name: '富国纳斯达克100ETF' },
  { code: '159660', name: '汇添富纳斯达克100ETF' },
  { code: '513110', name: '华泰柏瑞纳斯达克100ETF' },
  { code: '159659', name: '招商纳斯达克100ETF' },
]);

const KV_LATEST = 'nasdaq-radar:latest';
const KV_HISTORY = 'nasdaq-radar:history';
const KV_FEATURE_HISTORY = 'nasdaq-radar:feature-history:v1';
const HISTORY_DAYS = 20;
const FEATURE_HISTORY_DAYS = 90;

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonNegativeNumber(value) {
  const n = finiteNumber(value);
  return n != null && n >= 0 ? n : null;
}

function roundNumber(value, precision = 4) {
  const n = finiteNumber(value);
  if (n == null) return null;
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
}

function navPremiumFromRef(ref = {}) {
  const price = finiteNumber(ref?.price);
  const nav = finiteNumber(ref?.latestNav);
  return price != null && price > 0 && nav != null && nav > 0
    ? ((price - nav) / nav) * 100
    : null;
}

function normalizeOrderBookFeatures(bookEntry = null) {
  const book = bookEntry?.orderBook && typeof bookEntry.orderBook === 'object' ? bookEntry.orderBook : null;
  if (!book) {
    return {
      bidPrice: null,
      askPrice: null,
      bidAskSpreadBps: null,
      depth1: null,
      depth5: null,
      orderBookSource: '',
      orderBookAsOf: ''
    };
  }
  const levels = Array.isArray(book.levels) ? book.levels.slice(0, 5) : [];
  const top = levels.find((item) => Number(item?.level) === 1) || levels[0] || book;
  const bidPrice = finiteNumber(top?.bidPrice ?? book?.bidPrice);
  const askPrice = finiteNumber(top?.askPrice ?? book?.askPrice);
  const mid = bidPrice != null && askPrice != null && bidPrice > 0 && askPrice > 0
    ? (bidPrice + askPrice) / 2
    : null;
  const bidAskSpreadBps = mid != null && mid > 0
    ? roundNumber(((askPrice - bidPrice) / mid) * 10000, 4)
    : null;
  const depthAmount = (item) => {
    const bp = finiteNumber(item?.bidPrice);
    const bv = nonNegativeNumber(item?.bidVolume);
    const ap = finiteNumber(item?.askPrice);
    const av = nonNegativeNumber(item?.askVolume);
    return (bp != null && bv != null ? bp * bv : 0) + (ap != null && av != null ? ap * av : 0);
  };
  const normalizedLevels = levels.length ? levels : [top];
  return {
    bidPrice: roundNumber(bidPrice, 4),
    askPrice: roundNumber(askPrice, 4),
    bidAskSpreadBps,
    depth1: roundNumber(depthAmount(normalizedLevels[0]), 2),
    depth5: roundNumber(normalizedLevels.reduce((sum, item) => sum + depthAmount(item), 0), 2),
    orderBookSource: String(bookEntry?.source || book?.source || '').trim(),
    orderBookAsOf: String(bookEntry?.asOf || '').trim()
  };
}

async function collectRadarFeatureSnapshot(env, codes, refs) {
  const fundKinds = Object.fromEntries(codes.map((code) => [code, 'exchange']));
  const [metricsResult, booksResult] = await Promise.allSettled([
    fetchFundMetricsForCodes(env, codes, { refresh: true, fundKinds }),
    fetchSwitchOrderBooks(codes)
  ]);
  const metrics = metricsResult.status === 'fulfilled' && metricsResult.value && typeof metricsResult.value === 'object'
    ? metricsResult.value
    : {};
  const booksPayload = booksResult.status === 'fulfilled' && booksResult.value && typeof booksResult.value === 'object'
    ? booksResult.value
    : {};
  const books = booksPayload.books && typeof booksPayload.books === 'object' ? booksPayload.books : {};

  if (metricsResult.status === 'rejected') {
    console.log('[nasdaq-radar] fund metrics collection failed:', metricsResult.reason?.message || String(metricsResult.reason));
  }
  if (booksResult.status === 'rejected') {
    console.log('[nasdaq-radar] order book collection failed:', booksResult.reason?.message || String(booksResult.reason));
  }

  const etfs = {};
  for (const meta of NASDAQ_ETFS) {
    const ref = refs?.[meta.code] || {};
    const metric = metrics?.[meta.code] || {};
    etfs[meta.code] = {
      code: meta.code,
      name: String(ref?.name || metric?.name || meta.name).trim(),
      premium: roundNumber(navPremiumFromRef(ref), 4),
      premiumSource: 'eastmoney-fundmobapi-nav',
      price: roundNumber(ref?.price ?? metric?.price ?? metric?.currentPrice, 4),
      iopv: roundNumber(ref?.iopv ?? metric?.iopv, 4),
      latestNav: roundNumber(ref?.latestNav ?? metric?.latestNav, 4),
      volume: nonNegativeNumber(metric?.volume),
      turnover: nonNegativeNumber(metric?.turnover ?? metric?.amount),
      marketCapital: nonNegativeNumber(metric?.marketCapital ?? metric?.marketCap),
      totalShares: nonNegativeNumber(metric?.totalShares ?? metric?.total_shares),
      fundMetricsSource: String(metric?.source || '').trim(),
      fundMetricsAsOf: String(metric?.asOf || '').trim(),
      ...normalizeOrderBookFeatures(books?.[meta.code])
    };
  }

  return {
    collectedAt: new Date().toISOString(),
    references: { nasdaq100: '^NDX', usdcny: 'CNY=X' },
    sources: {
      premium: 'eastmoney-fundmobapi-nav',
      fundMetrics: 'markets/fund-metrics',
      orderBook: booksPayload.source || 'tencent+sina-fallback',
      benchmarkKline: 'markets/r2:yahoo'
    },
    etfs
  };
}

async function readFeatureHistory(env) {
  try {
    const stored = await env.NOTIFY_STATE.get(KV_FEATURE_HISTORY, 'json');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

async function upsertFeatureHistory(env, today, featureSnapshot, currentHistory = null) {
  let history = Array.isArray(currentHistory) ? currentHistory : await readFeatureHistory(env);
  history = history.filter((item) => item?.date !== today);
  history.push({ date: today, ...featureSnapshot });
  history.sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
  history = history.slice(-FEATURE_HISTORY_DAYS);
  await env.NOTIFY_STATE.put(KV_FEATURE_HISTORY, JSON.stringify(history));
  return history;
}

function shanghaiDateStr(d = new Date()) {
  // 北京时间日期 YYYY-MM-DD
  const shanghai = new Date(d.getTime() + (8 * 60 + d.getTimezoneOffset()) * 60000);
  return shanghai.toISOString().slice(0, 10);
}

/**
 * 计算分位数：value 在 sorted 数组中的百分位 (0-100)
 */
function percentile(sorted, value) {
  if (!sorted.length) return 50;
  let count = 0;
  for (const v of sorted) {
    if (v <= value) count++;
  }
  return Math.round((count / sorted.length) * 100);
}

/**
 * 每日雷达计算（cron 调用）
 */
export async function computeNasdaqRadar(env, { force = false } = {}) {
  const today = shanghaiDateStr();

  // 读取历史价差（幂等保护与分位数计算共用）
  let history = [];
  try {
    const stored = await env.NOTIFY_STATE.get(KV_HISTORY, 'json');
    if (Array.isArray(stored)) history = stored;
  } catch {}

  // 数据源快照与雷达结果都完成后才直接复用；这样新版本上线当天也能补齐 feature history。
  const existingFeatureHistory = await readFeatureHistory(env);
  const radarComputedToday = history.some((item) => item?.date === today);
  const featuresCollectedToday = existingFeatureHistory.some((item) => item?.date === today);
  if (!force && radarComputedToday && featuresCollectedToday) {
    try {
      const latest = await env.NOTIFY_STATE.get(KV_LATEST, 'json');
      if (latest) {
        console.log(`[nasdaq-radar] already computed with features for ${today}, return existing latest`);
        return latest;
      }
    } catch {}
  }

  console.log(`[nasdaq-radar] computing for ${today}, force=${force}`);

  const codes = NASDAQ_ETFS.map(e => e.code);
  // 雷达专用数据源：东方财富 fundmob 收盘价 + 当日净值（21:35 当日净值已发布）
  let refs;
  try {
    refs = await fetchRadarPremiums(codes);
  } catch (err) {
    console.log('[nasdaq-radar] premium fetch failed:', err?.message || String(err));
    throw new Error('获取溢价数据失败: ' + (err?.message || String(err)));
  }
  console.log(`[nasdaq-radar] fetched ${Object.keys(refs).length} refs`);

  // 评分层暂不启用，先把流动性、盘口、规模与基准数据源完整采集并开始积累历史。
  const featureSnapshot = await collectRadarFeatureSnapshot(env, codes, refs);
  const featureHistory = await upsertFeatureHistory(env, today, featureSnapshot, existingFeatureHistory);

  // 提取溢价率：NAV口径 (收盘价 − 当日净值) / 当日净值 ×100
  const ranked = [];
  const skipped = [];
  for (const meta of NASDAQ_ETFS) {
    const ref = refs[meta.code];
    // Number.isFinite 不做 null→0 强转，缺失即跳过（finiteNumber 会把 null 变 0）
    const price = Number.isFinite(ref?.price) ? ref.price : null;
    const nav = Number.isFinite(ref?.latestNav) ? ref.latestNav : null;
    if (price === null || nav === null || price <= 0 || nav <= 0) { skipped.push(`${meta.code}:no-price-or-nav`); continue; }
    ranked.push({
      code: meta.code,
      name: ref?.name || meta.name,
      premium: ((price - nav) / nav) * 100,
      price,
    });
  }
  console.log(`[nasdaq-radar] ranked=${ranked.length}, skipped=[${skipped.join(',')}]`);

  if (ranked.length < 2) {
    throw new Error(`有效数据不足: 仅${ranked.length}只ETF有溢价数据 (跳过: ${skipped.join(',')})`);
  }

  ranked.sort((a, b) => b.premium - a.premium);
  const highest = ranked[0];
  const lowest = ranked[ranked.length - 1];
  const spread = +(highest.premium - lowest.premium).toFixed(4);

  // 计算分位数
  const spreads = history.map(h => h.spread).filter(v => typeof v === 'number').sort((a, b) => a - b);
  const pct = percentile(spreads, spread);

  // 更新历史（同日覆盖，保留近 HISTORY_DAYS 天）
  history = history.filter((item) => item?.date !== today);
  history.push({ date: today, spread, high: highest.code, low: lowest.code });
  history = history.slice(-HISTORY_DAYS);

  const result = {
    date: today,
    computedAt: new Date().toISOString(),
    premiumSource: 'eastmoney-fundmobapi-nav',
    etfs: ranked.map(e => ({ code: e.code, name: e.name, premium: +e.premium.toFixed(2) })),
    bestPair: {
      sell: { code: highest.code, name: highest.name, premium: +highest.premium.toFixed(2) },
      buy: { code: lowest.code, name: lowest.name, premium: +lowest.premium.toFixed(2) },
      spread,
      percentile: pct,
      historyDays: spreads.length,
    },
    // 近期机会（历史价差前3）
    recentOpportunities: history
      .slice(-5)
      .reverse()
      .map(h => ({ date: h.date, pair: `${h.high} → ${h.low}`, spread: h.spread })),
    dataCoverage: {
      featureHistoryDays: featureHistory.length,
      maxFeatureHistoryDays: FEATURE_HISTORY_DAYS,
      benchmarkSymbols: featureSnapshot.references,
      sources: featureSnapshot.sources,
      featureCompleteness: {
        total: codes.length,
        premium: codes.filter((code) => Number.isFinite(featureSnapshot.etfs?.[code]?.premium)).length,
        turnover: codes.filter((code) => Number.isFinite(featureSnapshot.etfs?.[code]?.turnover)).length,
        marketCapital: codes.filter((code) => Number.isFinite(featureSnapshot.etfs?.[code]?.marketCapital)).length,
        totalShares: codes.filter((code) => Number.isFinite(featureSnapshot.etfs?.[code]?.totalShares)).length,
        spread: codes.filter((code) => Number.isFinite(featureSnapshot.etfs?.[code]?.bidAskSpreadBps)).length,
        depth5: codes.filter((code) => Number.isFinite(featureSnapshot.etfs?.[code]?.depth5)).length,
      },
    },
  };

  await env.NOTIFY_STATE.put(KV_LATEST, JSON.stringify(result));
  await env.NOTIFY_STATE.put(KV_HISTORY, JSON.stringify(history));

  console.log(`[nasdaq-radar] done: ${highest.code}(${highest.premium}%) → ${lowest.code}(${lowest.premium}%), spread=${spread}%, p${pct}`);
  return result;
}

/**
 * 获取雷达数据（API 调用）
 */
export async function getNasdaqRadar(env) {
  try {
    const data = await env.NOTIFY_STATE.get(KV_LATEST, 'json');
    return data || null;
  } catch {
    return null;
  }
}

export async function getNasdaqRadarFeatureHistory(env) {
  return readFeatureHistory(env);
}
