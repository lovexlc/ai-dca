#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_SOURCE_CANDIDATES = [
  'data/all_nasdq.json',
  'data/all_nasdaq.json',
  'data/nasdaq_latest.json',
  'data/all_qdii.json'
];

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    sourceFile: '',
    outputDir: 'data',
    datalen: 700,
    lookbackDays: 730,
    sleepMs: 250,
    maxRetries: 3,
    retryDelayMs: 1000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--source-file' && next) {
      options.sourceFile = next;
      index += 1;
      continue;
    }

    if (arg === '--output-dir' && next) {
      options.outputDir = next;
      index += 1;
      continue;
    }

    if (arg === '--datalen' && next) {
      options.datalen = Number(next) || options.datalen;
      index += 1;
      continue;
    }

    if (arg === '--lookback-days' && next) {
      options.lookbackDays = Number(next) || options.lookbackDays;
      index += 1;
      continue;
    }

    if (arg === '--sleep-ms' && next) {
      options.sleepMs = Number(next) || options.sleepMs;
      index += 1;
      continue;
    }

    if (arg === '--max-retries' && next) {
      options.maxRetries = Number(next) || options.maxRetries;
      index += 1;
      continue;
    }

    if (arg === '--retry-delay-ms' && next) {
      options.retryDelayMs = Number(next) || options.retryDelayMs;
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/fetch_nasdaq_etf_daily_sina.mjs [options]

Options:
  --source-file <path>      Optional fund list source.
  --output-dir <path>       Root output directory. Default: data
  --datalen <number>        Sina requested bar count. Default: 700
  --lookback-days <number>  Keep only recent N calendar days. Default: 730
  --sleep-ms <number>       Delay between upstream requests. Default: 250
  --max-retries <number>    Retry count per fund. Default: 3
  --retry-delay-ms <number> Base retry delay. Default: 1000
`);
      process.exit(0);
    }
  }

  return options;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function resolveSourceFile(explicitPath = '') {
  if (explicitPath) {
    return resolve(process.cwd(), explicitPath);
  }

  for (const candidate of DEFAULT_SOURCE_CANDIDATES) {
    const resolved = resolve(process.cwd(), candidate);
    try {
      readFileSync(resolved, 'utf8');
      return resolved;
    } catch {
      continue;
    }
  }

  throw new Error(`No source file found. Expected one of: ${DEFAULT_SOURCE_CANDIDATES.join(', ')}`);
}

function dedupeFunds(funds = []) {
  const seen = new Set();
  return funds.filter((fund) => {
    if (!fund.code || seen.has(fund.code)) {
      return false;
    }
    seen.add(fund.code);
    return true;
  });
}

function extractFunds(payload) {
  if (Array.isArray(payload)) {
    return dedupeFunds(
      payload.map((item) => ({
        code: String(item?.code || item || '').trim(),
        name: String(item?.name || item?.code || item || '').trim(),
        indexKey: String(item?.index_key || 'nasdaq100').trim() || 'nasdaq100'
      }))
    );
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Unsupported source payload.');
  }

  const dataset = String(payload.dataset || '').trim();
  const rawFunds = payload.funds || payload.etfs || [];
  const funds = rawFunds
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      code: String(item.code || '').trim(),
      name: String(item.name || item.code || '').trim(),
      indexKey: String(item.index_key || 'nasdaq100').trim() || 'nasdaq100'
    }))
    .filter((fund) => fund.code);

  if (dataset === 'all_qdii') {
    return dedupeFunds(funds.filter((fund) => fund.indexKey === 'nasdaq100'));
  }

  return dedupeFunds(funds);
}

function toSinaSymbol(code) {
  const trimmed = String(code || '').trim();
  if (!trimmed) {
    throw new Error('Fund code is required.');
  }

  return /^[569]/.test(trimmed) ? `sh${trimmed}` : `sz${trimmed}`;
}

function toNumber(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBars(rows = []) {
  return rows
    .map((row) => ({
      date: String(row?.day || row?.date || '').trim(),
      open: toNumber(row?.open),
      close: toNumber(row?.close),
      high: toNumber(row?.high),
      low: toNumber(row?.low),
      volume: toNumber(row?.volume)
    }))
    .filter((bar) => bar.date && [bar.open, bar.close, bar.high, bar.low, bar.volume].every((value) => Number.isFinite(value)))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function filterRecentBars(bars = [], lookbackDays = 730) {
  if (!bars.length) {
    return [];
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - Math.max(lookbackDays, 1));
  const sinceDate = since.toISOString().slice(0, 10);

  return bars.filter((bar) => bar.date >= sinceDate);
}

async function fetchDailyBars(fund, options) {
  const url = new URL('https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData');
  url.searchParams.set('symbol', toSinaSymbol(fund.code));
  url.searchParams.set('scale', '240');
  url.searchParams.set('ma', 'no');
  url.searchParams.set('datalen', String(options.datalen));

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://finance.sina.com.cn',
      Accept: 'application/json,text/plain,*/*'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) {
    throw new Error('Unexpected Sina daily response.');
  }

  return filterRecentBars(normalizeBars(rows), options.lookbackDays);
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function fetchDailyBarsWithRetry(fund, options) {
  let lastError = null;

  for (let attempt = 1; attempt <= options.maxRetries; attempt += 1) {
    try {
      return await fetchDailyBars(fund, options);
    } catch (error) {
      lastError = error;
      if (attempt >= options.maxRetries) {
        break;
      }
      await sleep(options.retryDelayMs * attempt);
    }
  }

  throw lastError || new Error(`Daily bars fetch failed for ${fund.code}`);
}

function writeFundDailyFile(fund, bars, options, sourceFile) {
  const outputDir = resolve(process.cwd(), options.outputDir, fund.code);
  const outputPath = resolve(outputDir, 'daily-sina.json');
  mkdirSync(outputDir, { recursive: true });

  const payload = {
    dataset: 'nasdaq_etf_daily_sina',
    fund_code: fund.code,
    fund_name: fund.name,
    index_key: fund.indexKey,
    range: {
      start_date: bars[0]?.date || '',
      end_date: bars[bars.length - 1]?.date || '',
      lookback_days: options.lookbackDays
    },
    requested_bars: options.datalen,
    source: 'sina:CN_MarketDataService.getKLineData',
    source_symbol: toSinaSymbol(fund.code),
    fund_list_source: sourceFile,
    generated_at: new Date().toISOString(),
    bars
  };

  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return outputPath;
}

async function main() {
  const options = parseArgs();
  const sourceFile = resolveSourceFile(options.sourceFile);
  const funds = extractFunds(readJson(sourceFile));

  if (!funds.length) {
    throw new Error(`No funds found in ${sourceFile}`);
  }

  console.log(`Using source file: ${sourceFile}`);
  console.log(`Fetching recent ${options.lookbackDays} calendar days of 1d bars from Sina for ${funds.length} funds...`);

  for (const [index, fund] of funds.entries()) {
    const bars = await fetchDailyBarsWithRetry(fund, options);
    const outputPath = writeFundDailyFile(fund, bars, options, sourceFile);
    console.log(`[${index + 1}/${funds.length}] ${fund.code} ${fund.name}: ${bars.length} bars -> ${outputPath}`);

    if (index < funds.length - 1) {
      await sleep(options.sleepMs);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
