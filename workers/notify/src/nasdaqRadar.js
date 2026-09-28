/**
 * 纳指ETF套利雷达：每日收盘后扫描14只纳指ETF，找出最优套利对。
 *
 * 数据流：
 * 1. cron (30 7 * * MON-FRI，即北京时间15:30) 触发 computeNasdaqRadar()
 * 2. 获取14只ETF当日溢价率，按流动性过滤
 * 3. 找出溢价最高/最低对，计算价差
 * 4. 从KV读取近20天价差历史，计算当前分位数
 * 5. 结果存入 KV `nasdaq-radar:latest` 和 `nasdaq-radar:history`
 *
 * 前端通过 /api/nasdaq-radar 接口读取。
 */

import { parseFundMobApiReferences } from './switchMarketCollector.js';

const EASTMONEY_FUNDMOB_URL = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo';

// 雷达专用：直接从东方财富 fundmob 获取溢价，不要求2分钟新鲜度（收盘数据即可）
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
const NASDAQ_ETFS = Object.freeze([
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
const HISTORY_DAYS = 20;

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
export async function computeNasdaqRadar(env) {
  const today = shanghaiDateStr();
  console.log(`[nasdaq-radar] computing for ${today}`);

  const codes = NASDAQ_ETFS.map(e => e.code);
  // 雷达专用数据源：东方财富 fundmob 溢价（收盘数据即可，不要求2分钟新鲜度）
  let refs;
  try {
    refs = await fetchRadarPremiums(codes);
  } catch (err) {
    console.log('[nasdaq-radar] premium fetch failed:', err?.message || String(err));
    throw new Error('获取溢价数据失败: ' + (err?.message || String(err)));
  }
  console.log(`[nasdaq-radar] fetched ${Object.keys(refs).length} refs`);

  // 提取溢价率
  const ranked = [];
  const skipped = [];
  for (const meta of NASDAQ_ETFS) {
    const ref = refs[meta.code];
    const premium = finiteNumber(ref?.vendorPremiumPct);
    if (premium === null) { skipped.push(`${meta.code}:no-premium`); continue; }
    ranked.push({
      code: meta.code,
      name: ref?.name || meta.name,
      premium,
      price: finiteNumber(ref?.price),
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

    // 读取历史价差，计算分位数
    let history = [];
    try {
      const stored = await env.NOTIFY_STATE.get(KV_HISTORY, 'json');
      if (Array.isArray(stored)) history = stored;
    } catch {}
    const spreads = history.map(h => h.spread).filter(v => typeof v === 'number').sort((a, b) => a - b);
    const pct = percentile(spreads, spread);

    // 更新历史（保留近 HISTORY_DAYS 天）
    history.push({ date: today, spread, high: highest.code, low: lowest.code });
    history = history.slice(-HISTORY_DAYS);

    const result = {
      date: today,
      computedAt: new Date().toISOString(),
      etfs: ranked.map(e => ({ code: e.code, name: e.name, premium: +e.premium.toFixed(2) })),
      bestPair: {
        sell: { code: highest.code, name: highest.name, premium: +highest.premium.toFixed(2) },
        buy: { code: lowest.code, name: lowest.name, premium: +lowest.premium.toFixed(2) },
        spread,
        percentile: pct,
      },
      // 近期机会（历史价差前3）
      recentOpportunities: history
        .slice(-5)
        .reverse()
        .map(h => ({ date: h.date, pair: `${h.high} → ${h.low}`, spread: h.spread })),
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
