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

import { fetchFundMetricsPayload } from './getNav.js';

// 14只标准纳斯达克100ETF（剔除科技细分和LOF）
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
  { code: '159509', name: '景顺长城纳斯达克科技ETF' },
  { code: '161128', name: '易方达标普信息科技LOF' },
]);

const KV_LATEST = 'nasdaq-radar:latest';
const KV_HISTORY = 'nasdaq-radar:history';
const HISTORY_DAYS = 20;
// 日成交额低于此值（元）视为流动性不足，剔除
const MIN_TURNOVER = 5_000_000;

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

  try {
    const codes = NASDAQ_ETFS.map(e => e.code);
    const fundKinds = Object.fromEntries(codes.map(c => [c, 'exchange']));
    const payload = await fetchFundMetricsPayload(env, codes, { refresh: true, fundKinds });
    const items = Array.isArray(payload?.items) ? payload.items : [];

    // 提取溢价率，按流动性过滤
    const ranked = [];
    for (const item of items) {
      const code = String(item.code || '').trim();
      const meta = NASDAQ_ETFS.find(e => e.code === code);
      if (!meta) continue;
      const premium = finiteNumber(item.premiumPercent ?? item.premium);
      const turnover = finiteNumber(item.turnover);
      if (premium === null) continue;
      // 流动性过滤：turnover 缺失时保留（避免误杀），有值且过低才剔除
      if (turnover !== null && turnover < MIN_TURNOVER) continue;
      ranked.push({ code, name: meta.name, premium, price: finiteNumber(item.price) });
    }

    if (ranked.length < 2) {
      console.log(`[nasdaq-radar] insufficient data: ${ranked.length} ETFs`);
      return null;
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
  } catch (err) {
    console.log('[nasdaq-radar] compute failed:', err?.message || String(err));
    return null;
  }
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
