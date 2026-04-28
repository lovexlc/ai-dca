#!/usr/bin/env node
// 为每只场内 ETF 拉取「最新单位净值」，落到 data/<code>/latest-nav.json。
//
// 数据源：https://api.fund.eastmoney.com/f10/lsjz?fundCode=<code>&pageIndex=1&pageSize=6
// 与 workers/ocr-proxy fetchFundNavSnapshot 同源。场内 ETF 也能从该接口拿到 DWJZ。
//
// 输出结构：
// {
//   "code": "513100",
//   "name": "国泰纳斯达克100ETF",
//   "latestNav": 1.4321,
//   "latestNavDate": "2026-04-25",
//   "previousNav": 1.4297,
//   "previousNavDate": "2026-04-24",
//   "source": "eastmoney:f10/lsjz",
//   "generatedAt": "2026-04-28T...Z"
// }
//
// 用法：node scripts/fetch_etf_latest_nav.mjs --output-dir data
// 默认 source: data/all_nasdq.json -> etfs[].code

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_SOURCE = 'data/all_nasdq.json';
const DEFAULT_OUTPUT_DIR = 'data';
const DEFAULT_PAGE_SIZE = 8;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE, outputDir: DEFAULT_OUTPUT_DIR, codes: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') args.source = argv[i + 1] || DEFAULT_SOURCE, (i += 1);
    else if (arg === '--output-dir') args.outputDir = argv[i + 1] || DEFAULT_OUTPUT_DIR, (i += 1);
    else if (arg === '--codes') args.codes = String(argv[i + 1] || '').split(',').map((s) => s.trim()).filter(Boolean), (i += 1);
  }
  return args;
}

async function readEtfList(sourcePath) {
  const raw = await fs.readFile(sourcePath, 'utf8');
  const payload = JSON.parse(raw);
  const list = Array.isArray(payload?.etfs) ? payload.etfs : Array.isArray(payload) ? payload : [];
  return list
    .map((entry) => ({
      code: String(entry?.code || '').trim(),
      name: String(entry?.name || '').trim()
    }))
    .filter((entry) => /^\d{6}$/.test(entry.code));
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  // 東财 lsjz 返回 YYYY-MM-DD
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function roundNav(value, digits = 4) {
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(v * factor) / factor;
}

async function fetchOnce(code) {
  const url = new URL('https://api.fund.eastmoney.com/f10/lsjz');
  url.searchParams.set('fundCode', code);
  url.searchParams.set('pageIndex', '1');
  url.searchParams.set('pageSize', String(DEFAULT_PAGE_SIZE));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        accept: 'application/json, text/plain, */*',
        referer: 'https://fundf10.eastmoney.com/',
        'user-agent': 'Mozilla/5.0 (compatible; ai-dca-action)'
      }
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('non-JSON response'); }

  const errCode = Number(payload?.ErrCode || 0);
  if (errCode !== 0) throw new Error(payload?.ErrMsg || `ErrCode ${errCode}`);

  const rows = Array.isArray(payload?.Data?.LSJZList) ? payload.Data.LSJZList : [];
  const validRows = rows
    .map((row) => ({
      dwjz: roundNav(row?.DWJZ),
      fsrq: normalizeDate(row?.FSRQ)
    }))
    .filter((r) => Number.isFinite(r.dwjz) && r.dwjz > 0 && r.fsrq);

  if (validRows.length === 0) throw new Error('no DWJZ rows');

  const latest = validRows[0];
  const previous = validRows[1] || null;
  return { latest, previous };
}

async function fetchWithRetry(code) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fetchOnce(code);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeNavFile(outputDir, entry, fetched, generatedAt) {
  const dir = path.join(outputDir, entry.code);
  await ensureDir(dir);
  const file = path.join(dir, 'latest-nav.json');
  const json = {
    dataset: 'etf_latest_nav_eastmoney',
    code: entry.code,
    name: entry.name || '',
    latestNav: fetched.latest.dwjz,
    latestNavDate: fetched.latest.fsrq,
    previousNav: fetched.previous?.dwjz ?? null,
    previousNavDate: fetched.previous?.fsrq ?? '',
    source: 'eastmoney:f10/lsjz',
    generatedAt
  };
  await fs.writeFile(file, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  return file;
}

async function main() {
  const args = parseArgs(process.argv);
  const generatedAt = new Date().toISOString();
  const outputDir = path.resolve(args.outputDir);
  const sourcePath = path.resolve(args.source);

  let etfs = await readEtfList(sourcePath);
  if (Array.isArray(args.codes) && args.codes.length) {
    const filter = new Set(args.codes);
    etfs = etfs.filter((e) => filter.has(e.code));
  }
  if (!etfs.length) {
    console.error('[fetch_etf_latest_nav] no ETF codes resolved.');
    process.exit(1);
  }

  console.log(`[fetch_etf_latest_nav] target ETFs: ${etfs.length}`);
  let okCount = 0;
  let failCount = 0;
  const failures = [];
  // 串行，避免被东财限频
  for (const entry of etfs) {
    try {
      const fetched = await fetchWithRetry(entry.code);
      const file = await writeNavFile(outputDir, entry, fetched, generatedAt);
      okCount += 1;
      console.log(`  ✓ ${entry.code} latest=${fetched.latest.dwjz} (${fetched.latest.fsrq}) -> ${path.relative(process.cwd(), file)}`);
    } catch (error) {
      failCount += 1;
      failures.push({ code: entry.code, error: error instanceof Error ? error.message : String(error) });
      console.warn(`  ✗ ${entry.code} failed: ${error instanceof Error ? error.message : error}`);
    }
    // 250ms gap
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  // 写个 manifest 便于前端一次加载
  const manifestPath = path.join(outputDir, 'etf_latest_nav.json');
  const manifest = {
    dataset: 'etf_latest_nav_manifest',
    generatedAt,
    source: 'eastmoney:f10/lsjz',
    successCount: okCount,
    failureCount: failCount,
    failures,
    items: []
  };
  for (const entry of etfs) {
    try {
      const file = path.join(outputDir, entry.code, 'latest-nav.json');
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      manifest.items.push({
        code: parsed.code,
        name: parsed.name,
        latestNav: parsed.latestNav,
        latestNavDate: parsed.latestNavDate,
        previousNav: parsed.previousNav,
        previousNavDate: parsed.previousNavDate
      });
    } catch {}
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`[fetch_etf_latest_nav] ok=${okCount} fail=${failCount} manifest=${path.relative(process.cwd(), manifestPath)}`);
  // 部分成功也让 CI 继续走 (不以 fail 退出)
}

main().catch((error) => {
  console.error('[fetch_etf_latest_nav] fatal:', error);
  process.exit(2);
});
