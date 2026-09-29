#!/usr/bin/env node
/**
 * 纳指ETF套利雷达历史回填（一次性工具，node 直接运行）。
 *
 * 数据源：
 * - 新浪K线：近30个交易日收盘价（159xxx/16xxxx 用 sz 前缀，51xxx/52xxx 用 sh 前缀）
 * - 东方财富 fundmob FundMNHisNetList：近30天单位净值（该接口只支持单个 FCODE，逐只查询）
 *
 * 口径与线上 computeNasdaqRadar 一致：溢价率 = (收盘价 − 当日净值) / 当日净值 ×100，
 * 每日 spread = 最高溢价 − 最低溢价；取最近 20 个交易日输出 [{date, spread, high, low}]。
 *
 * 校验（任一不通过则打印异常并以非零退出码退出，不写文件）：
 * 1. 共 20 条，日期升序；
 * 2. 按交易日历连续（相邻日期之间只允许周末/法定休市日，如国庆 2026-10-01~07）；
 * 3. spread > 0 且 < 20%；
 * 4. 每只ETF相邻两天溢价变化绝对值 ≤ 3 个百分点
 *    （新浪收盘价若为前复权且窗口内有分红除权，或净值与收盘价错位，会触发此项）。
 *
 * 只生成 radar-history-backfill.json，不写 KV（由调用方写入）。
 */

import { writeFileSync } from 'node:fs';
import { NASDAQ_ETFS } from '../src/nasdaqRadar.js';
import { isTradingDayShanghai } from '../src/holdingsNavSupport.js';

const SINA_KLINE_URL = 'https://quotes.sina.cn/cn/api/openapi.php/CN_MarketDataService.getKLineData';
const FUNDMOB_NAV_URL = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList';
const HISTORY_DAYS = 20;
const MAX_SPREAD_PCT = 20;
const MAX_PREMIUM_JUMP_PP = 3;
const OUTPUT_PATH = new URL('./radar-history-backfill.json', import.meta.url);

function sinaSymbol(code) {
  if (/^1[56]/.test(code)) return 'sz' + code;
  if (/^5[12]/.test(code)) return 'sh' + code;
  throw new Error(`无法识别交易所前缀: ${code}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, tries = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (err) {
      lastError = err;
      if (attempt < tries) await sleep(500 * attempt);
    }
  }
  throw new Error(`请求失败 ${url}: ${lastError?.message || lastError}`);
}

function collectDailyValues(rows, fields) {
  // fields: { day: 字段名, value: 字段名, label: 报错用 }
  const values = {};
  for (const row of rows) {
    const day = String(row?.[fields.day] || '').slice(0, 10);
    const value = Number(row?.[fields.value]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(value) && value > 0) values[day] = value;
  }
  return values;
}

async function fetchCloses(code) {
  const payload = await fetchJson(`${SINA_KLINE_URL}?symbol=${sinaSymbol(code)}&scale=240&ma=no&datalen=30`);
  const rows = payload?.result?.data;
  if (!Array.isArray(rows) || !rows.length) throw new Error(`新浪K线无数据: ${code}`);
  const closes = collectDailyValues(rows, { day: 'day', value: 'close', label: '收盘价' });
  if (!Object.keys(closes).length) throw new Error(`新浪K线无有效收盘价: ${code}`);
  return closes;
}

async function fetchNavs(code) {
  const url = `${FUNDMOB_NAV_URL}?FCODE=${code}&pageIndex=1&pageSize=30&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=ai-dca-radar`;
  const payload = await fetchJson(url);
  const rows = payload?.Datas;
  if (!Array.isArray(rows) || !rows.length) throw new Error(`fundmob净值无数据: ${code}`);
  const navs = collectDailyValues(rows, { day: 'FSRQ', value: 'DWJZ', label: '单位净值' });
  if (!Object.keys(navs).length) throw new Error(`fundmob无有效净值: ${code}`);
  return navs;
}

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function calendarProblems(dates) {
  const problems = [];
  for (const date of dates) {
    if (!isTradingDayShanghai(date)) problems.push(`${date} 不是交易日`);
  }
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] <= dates[i - 1]) problems.push(`日期非升序: ${dates[i - 1]} → ${dates[i]}`);
    let cursor = shiftDate(dates[i - 1], 1);
    while (cursor < dates[i]) {
      if (isTradingDayShanghai(cursor)) {
        problems.push(`${dates[i - 1]} → ${dates[i]} 之间缺失交易日 ${cursor}`);
        break;
      }
      cursor = shiftDate(cursor, 1);
    }
  }
  return problems;
}

function buildEntries(dates, perFund) {
  const entries = [];
  const premiumSeries = {}; // code -> premium[]（与 dates 对齐）
  const jumps = [];
  for (const meta of NASDAQ_ETFS) {
    const { closes, navs } = perFund[meta.code];
    const series = dates.map((date) => ((closes[date] - navs[date]) / navs[date]) * 100);
    premiumSeries[meta.code] = series;
    for (let i = 1; i < series.length; i++) {
      const delta = Math.abs(series[i] - series[i - 1]);
      if (delta > MAX_PREMIUM_JUMP_PP) {
        jumps.push(`${meta.code}(${meta.name}) ${dates[i - 1]}→${dates[i]} 溢价 ${series[i - 1].toFixed(2)}% → ${series[i].toFixed(2)}%（Δ${delta.toFixed(2)}pp，疑似复权/除权或数据错位）`);
      }
    }
  }
  for (let i = 0; i < dates.length; i++) {
    let high = null;
    let low = null;
    for (const meta of NASDAQ_ETFS) {
      const premium = premiumSeries[meta.code][i];
      if (!high || premium > high.premium) high = { code: meta.code, premium };
      if (!low || premium < low.premium) low = { code: meta.code, premium };
    }
    const spread = high.premium - low.premium;
    entries.push({ date: dates[i], spread: +spread.toFixed(4), high: high.code, low: low.code });
  }
  return { entries, jumps };
}

async function main() {
  // 逐只拉取（fundmob 历史净值接口不支持批量 FCODE），加小间隔避免限流
  const perFund = {};
  for (const meta of NASDAQ_ETFS) {
    const [closes, navs] = await Promise.all([fetchCloses(meta.code), fetchNavs(meta.code)]);
    perFund[meta.code] = { closes, navs };
    console.log(`[backfill] ${meta.code} ${meta.name}: 收盘价 ${Object.keys(closes).length} 天, 净值 ${Object.keys(navs).length} 天`);
    await sleep(200);
  }

  // 日期对齐：12 只ETF当天收盘价与净值齐备的日期
  let commonDays = null;
  for (const meta of NASDAQ_ETFS) {
    const { closes, navs } = perFund[meta.code];
    const days = new Set(Object.keys(closes).filter((d) => navs[d] != null));
    commonDays = commonDays === null ? days : new Set([...commonDays].filter((d) => days.has(d)));
  }
  const dates = [...commonDays].sort().slice(-HISTORY_DAYS);
  console.log(`[backfill] 可对齐交易日 ${[...commonDays].length} 天，取最近 ${dates.length} 天`);

  const problems = [];
  let entries = [];
  if (dates.length !== HISTORY_DAYS) {
    problems.push(`可对齐交易日仅 ${dates.length} 天（需要 ${HISTORY_DAYS}）`);
  }
  if (dates.length) {
    problems.push(...calendarProblems(dates));
    const built = buildEntries(dates, perFund);
    entries = built.entries;
    problems.push(...built.jumps);
    for (const entry of entries) {
      if (entry.spread <= 0 || entry.spread >= MAX_SPREAD_PCT) {
        problems.push(`${entry.date} spread 异常: ${entry.spread}%（需 >0 且 <${MAX_SPREAD_PCT}%）`);
      }
    }
  }

  if (problems.length) {
    console.error('[backfill] 校验未通过，不写文件：');
    for (const problem of problems) console.error('  - ' + problem);
    process.exitCode = 1;
    return;
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(entries, null, 2) + '\n');
  console.log(`[backfill] 已写入 ${OUTPUT_PATH.pathname}（${entries.length} 条）`);
  console.log('[backfill] 近20天 spread 序列（旧→新）:');
  for (const entry of entries) {
    console.log(`  ${entry.date}  spread=${entry.spread.toFixed(4)}%  ${entry.high} → ${entry.low}`);
  }
}

main().catch((err) => {
  console.error('[backfill] 失败:', err?.message || err);
  process.exitCode = 1;
});
