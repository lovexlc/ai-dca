#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { fetchSinaKline } from '../workers/markets/src/fetchers.js';
import { attachKlineHighPoint } from '../workers/markets/src/klineHighPoint.js';
import { classifySymbol } from '../workers/markets/src/symbols.js';

const SINA_MAX_CANDLES = 1970;
const DEFAULT_CODES = [
  '513870', '513390', '513300', '513110', '513100',
  '159941', '159696', '159660', '159659', '159632',
  '159513', '159509', '159501', '159577'
];
const DEFAULT_TIMEFRAMES = ['5m', '15m', '30m', '60m', '1d'];
const ENVIRONMENTS = {
  test: {
    bucket: 'ai-dca-markets-test',
    origin: 'https://test.freebacktrack.tech'
  },
  prod: {
    bucket: 'ai-dca-markets',
    origin: 'https://api.freebacktrack.tech'
  }
};
const WRANGLER_BIN = process.env.WRANGLER_BIN || '/usr/local/bin/wrangler';

function parseList(value, fallback) {
  if (!value) return fallback;
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const options = { execute: false, target: 'both', codes: DEFAULT_CODES, timeframes: DEFAULT_TIMEFRAMES };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--target') options.target = argv[++index];
    else if (arg.startsWith('--target=')) options.target = arg.slice('--target='.length);
    else if (arg === '--codes') options.codes = parseList(argv[++index], DEFAULT_CODES);
    else if (arg.startsWith('--codes=')) options.codes = parseList(arg.slice('--codes='.length), DEFAULT_CODES);
    else if (arg === '--timeframes') options.timeframes = parseList(argv[++index], DEFAULT_TIMEFRAMES);
    else if (arg.startsWith('--timeframes=')) options.timeframes = parseList(arg.slice('--timeframes='.length), DEFAULT_TIMEFRAMES);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/backfill_sina_kline_r2.mjs [--execute] [--target test|prod|both] [--codes 513100,...] [--timeframes 5m,...]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!['test', 'prod', 'both'].includes(options.target)) throw new Error(`Invalid target: ${options.target}`);
  if (!options.codes.length || !options.timeframes.length) throw new Error('At least one code and timeframe are required');
  return options;
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function retry(label, operation, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(attempt * 750);
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError?.message || lastError}`);
}

function taskKey(task) {
  return `${task.code}:${task.timeframe}`;
}

function r2Key(task) {
  const { code } = classifySymbol(task.code);
  return `kline/cn/${code}/${task.timeframe}.json`;
}

function candleDigest(candles) {
  return createHash('sha256').update(JSON.stringify(candles)).digest('hex');
}

function summarizeCandles(candles = []) {
  return {
    count: candles.length,
    first: candles[0]?.t ?? null,
    last: candles.at(-1)?.t ?? null,
    digest: candleDigest(candles)
  };
}

async function fetchExisting(environment, task) {
  const url = new URL(`/api/markets/kline/${encodeURIComponent(task.code)}`, environment.origin);
  url.searchParams.set('tf', task.timeframe);
  url.searchParams.set('limit', 'all');
  url.searchParams.set('session', 'all');
  url.searchParams.set('opsVerify', String(Date.now()));
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`${environment.origin} ${taskKey(task)} HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.candles)) throw new Error(`${environment.origin} ${taskKey(task)} invalid payload`);
  return payload;
}

function mergePayload(existing, fresh, task) {
  const byTimestamp = new Map();
  for (const candle of existing.candles || []) {
    const timestamp = Number(candle?.t);
    if (Number.isFinite(timestamp) && timestamp > 0) byTimestamp.set(timestamp, { ...candle, t: timestamp });
  }
  for (const candle of fresh.candles || []) {
    const timestamp = Number(candle?.t);
    if (Number.isFinite(timestamp) && timestamp > 0) byTimestamp.set(timestamp, { ...candle, t: timestamp });
  }
  const candles = Array.from(byTimestamp.values()).sort((left, right) => left.t - right.t);
  if (candles.length < existing.candles.length) {
    throw new Error(`${taskKey(task)} merge would shorten ${existing.candles.length} candles to ${candles.length}`);
  }
  const payload = attachKlineHighPoint({
    ...existing,
    ...fresh,
    market: 'cn',
    interval: task.timeframe,
    candles,
    batchSaved: true,
    generatedAt: new Date().toISOString(),
    source: 'sina-kline'
  }, {
    interval: task.timeframe,
    source: 'daily-kline-365d',
    forceDerive: true
  });
  delete payload.cached;
  delete payload.r2Key;
  return payload;
}

function runWranglerPut(bucket, key, payload) {
  return new Promise((resolvePut, rejectPut) => {
    const child = spawn(WRANGLER_BIN, [
      'r2', 'object', 'put', `${bucket}/${key}`,
      '--remote', '--pipe', '--content-type', 'application/json; charset=utf-8', '--force'
    ], {
      cwd: resolve('.'),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectPut);
    child.on('close', (code) => {
      if (code === 0) resolvePut();
      else rejectPut(new Error(`wrangler exited ${code}: ${(stderr || stdout).trim()}`));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function verifyPayload(environment, task, expected) {
  const actual = await retry(`verify ${environment.bucket} ${taskKey(task)}`, () => fetchExisting(environment, task), 3);
  const actualSummary = summarizeCandles(actual.candles);
  const expectedSummary = summarizeCandles(expected.candles);
  if (actualSummary.count !== expectedSummary.count
    || actualSummary.first !== expectedSummary.first
    || actualSummary.last !== expectedSummary.last
    || actualSummary.digest !== expectedSummary.digest) {
    throw new Error(`${environment.bucket} ${taskKey(task)} verification mismatch: expected ${JSON.stringify(expectedSummary)}, got ${JSON.stringify(actualSummary)}`);
  }
  return actualSummary;
}

async function prepareEnvironment(environmentName, environment, tasks, freshByTask) {
  let completed = 0;
  const prepared = await mapLimit(tasks, 4, async (task) => {
    const existing = await retry(`read ${environmentName} ${taskKey(task)}`, () => fetchExisting(environment, task));
    const payload = mergePayload(existing, freshByTask.get(taskKey(task)), task);
    completed += 1;
    if (completed % 10 === 0 || completed === tasks.length) {
      console.log(`[${environmentName}] prepared ${completed}/${tasks.length}`);
    }
    return { task, existingCount: existing.candles.length, payload };
  });
  return prepared;
}

async function writeAndVerifyEnvironment(environmentName, environment, prepared) {
  let written = 0;
  await mapLimit(prepared, 3, async ({ task, payload }) => {
    await retry(`write ${environmentName} ${taskKey(task)}`, () => runWranglerPut(environment.bucket, r2Key(task), payload), 3);
    written += 1;
    if (written % 10 === 0 || written === prepared.length) {
      console.log(`[${environmentName}] wrote ${written}/${prepared.length}`);
    }
  });

  let verified = 0;
  const results = await mapLimit(prepared, 4, async ({ task, existingCount, payload }) => {
    const summary = await verifyPayload(environment, task, payload);
    verified += 1;
    if (verified % 10 === 0 || verified === prepared.length) {
      console.log(`[${environmentName}] verified ${verified}/${prepared.length}`);
    }
    return {
      code: task.code,
      timeframe: task.timeframe,
      existingCount,
      finalCount: summary.count,
      first: summary.first,
      last: summary.last
    };
  });
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tasks = options.codes.flatMap((code) => options.timeframes.map((timeframe) => ({ code, timeframe })));
  const targetNames = options.target === 'both' ? ['test', 'prod'] : [options.target];
  console.log(`Fetching ${tasks.length} Sina series with datalen=${SINA_MAX_CANDLES}, concurrency=2`);

  let fetched = 0;
  const freshResults = await mapLimit(tasks, 2, async (task) => {
    const payload = await retry(`Sina ${taskKey(task)}`, () => fetchSinaKline(task.code, {
      intervalLabel: task.timeframe,
      limit: SINA_MAX_CANDLES
    }));
    fetched += 1;
    if (fetched % 10 === 0 || fetched === tasks.length) console.log(`[sina] fetched ${fetched}/${tasks.length}`);
    return [taskKey(task), payload];
  });
  const freshByTask = new Map(freshResults);

  const allResults = {};
  for (const environmentName of targetNames) {
    const environment = ENVIRONMENTS[environmentName];
    const prepared = await prepareEnvironment(environmentName, environment, tasks, freshByTask);
    if (!options.execute) {
      allResults[environmentName] = prepared.map(({ task, existingCount, payload }) => ({
        code: task.code,
        timeframe: task.timeframe,
        existingCount,
        finalCount: payload.candles.length,
        first: payload.candles[0]?.t ?? null,
        last: payload.candles.at(-1)?.t ?? null
      }));
      continue;
    }
    allResults[environmentName] = await writeAndVerifyEnvironment(environmentName, environment, prepared);
  }

  const totals = Object.fromEntries(Object.entries(allResults).map(([environmentName, results]) => [
    environmentName,
    {
      series: results.length,
      candlesBefore: results.reduce((sum, item) => sum + item.existingCount, 0),
      candlesAfter: results.reduce((sum, item) => sum + item.finalCount, 0),
      increasedSeries: results.filter((item) => item.finalCount > item.existingCount).length
    }
  ]));
  console.log(JSON.stringify({ mode: options.execute ? 'execute' : 'dry-run', totals, results: allResults }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
