#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const INDICES = [
  {
    key: 'shanghai',
    name: '上证指数',
    symbol: '000001.SS',
    currency: '',
    timezone: 'Asia/Shanghai'
  },
  {
    key: 'nasdaq100',
    name: '纳斯达克100指数',
    symbol: '^NDX',
    currency: '',
    timezone: 'America/New_York'
  },
  {
    key: 'sp500',
    name: '标普500指数',
    symbol: '^GSPC',
    currency: '',
    timezone: 'America/New_York'
  }
];

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    outputDir: 'data',
    outputFile: 'market_indices.json'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--output-dir' && next) {
      options.outputDir = next;
      index += 1;
      continue;
    }

    if (arg === '--output-file' && next) {
      options.outputFile = next;
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/fetch_market_indices.mjs [options]

Options:
  --output-dir <path>   Root output directory. Default: data
  --output-file <file>  Output JSON file. Default: market_indices.json
`);
      process.exit(0);
    }
  }

  return options;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function formatYahooChartUrl(symbol) {
  const encoded = encodeURIComponent(symbol);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=5d&includePrePost=false&events=div%2Csplits`;
}

async function fetchMarketIndexSnapshot(index) {
  const response = await fetch(formatYahooChartUrl(index.symbol), {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`${index.symbol} HTTP ${response.status}`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0] || {};
  const meta = result.meta || {};
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(result.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
  const dailyBars = timestamps
    .map((timestamp, entryIndex) => ({
      timestamp,
      close: toNumber(closes[entryIndex])
    }))
    .filter((bar) => Number.isFinite(bar.close));
  const latestBar = dailyBars.at(-1) || null;
  const previousBar = dailyBars.at(-2) || null;
  const currentPrice = toNumber(latestBar?.close ?? meta.regularMarketPrice ?? meta.postMarketPrice ?? meta.preMarketPrice);
  const previousClose = toNumber(previousBar?.close ?? meta.previousClose);
  const price = currentPrice ?? previousClose ?? 0;
  const baseline = previousClose ?? null;
  const change = baseline !== null ? round(price - baseline, 2) : 0;
  const changePercent = baseline ? round((change / baseline) * 100, 2) : 0;

  return {
    key: index.key,
    name: index.name,
    symbol: index.symbol,
    currency: index.currency,
    timezone: meta.exchangeTimezoneName || index.timezone || '',
    current_price: round(price, 2),
    previous_close: baseline !== null ? round(baseline, 2) : null,
    change,
    change_percent: changePercent
  };
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const options = parseArgs();
  const outputPath = resolve(process.cwd(), options.outputDir, options.outputFile);
  const indexes = [];

  for (const index of INDICES) {
    indexes.push(await fetchMarketIndexSnapshot(index));
  }

  const payload = {
    dataset: 'market_indices_latest',
    source: 'yahoo:chart',
    generated_at: new Date().toISOString(),
    indexes
  };

  writeJson(outputPath, payload);
  console.log(JSON.stringify({ outputPath, count: indexes.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});