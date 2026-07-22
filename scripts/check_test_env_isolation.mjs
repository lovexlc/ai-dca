#!/usr/bin/env node
/**
 * Guard: test Worker configs must not share storage IDs with production.
 * Run from repo root: node scripts/check_test_env_isolation.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const PAIRS = [
  {
    name: 'markets',
    prod: 'workers/markets/wrangler.toml',
    test: 'workers/markets/wrangler.test.toml'
  },
  {
    name: 'notify',
    prod: 'workers/notify/wrangler.toml',
    test: 'workers/notify/wrangler.test.toml'
  },
  {
    name: 'sync',
    prod: 'workers/sync/wrangler.toml',
    test: 'workers/sync/wrangler.test.toml'
  },
  {
    name: 'ocr-proxy',
    prod: 'workers/ocr-proxy/wrangler.toml',
    test: 'workers/ocr-proxy/wrangler.test.toml'
  }
];

/** @param {string} text */
function extractKvIds(text) {
  const ids = [];
  const re = /\[\[kv_namespaces\]\]([\s\S]*?)(?=\n\[\[|\n\[(?!\[)|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const block = m[1];
    const id = block.match(/^\s*id\s*=\s*"([^"]+)"/m)?.[1];
    const binding = block.match(/^\s*binding\s*=\s*"([^"]+)"/m)?.[1];
    if (id) ids.push({ binding: binding || '?', id });
  }
  return ids;
}

/** @param {string} text */
function extractD1Ids(text) {
  const ids = [];
  const re = /\[\[d1_databases\]\]([\s\S]*?)(?=\n\[\[|\n\[(?!\[)|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const block = m[1];
    const id = block.match(/^\s*database_id\s*=\s*"([^"]+)"/m)?.[1];
    const name = block.match(/^\s*database_name\s*=\s*"([^"]+)"/m)?.[1];
    if (id) ids.push({ name: name || '?', id });
  }
  return ids;
}

/** @param {string} text */
function extractR2Buckets(text) {
  const names = [];
  const re = /\[\[r2_buckets\]\]([\s\S]*?)(?=\n\[\[|\n\[(?!\[)|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const block = m[1];
    const name = block.match(/^\s*bucket_name\s*=\s*"([^"]+)"/m)?.[1];
    if (name) names.push(name);
  }
  return names;
}

/** @param {string} text */
function extractVectorize(text) {
  const names = [];
  const re = /\[\[vectorize\]\]([\s\S]*?)(?=\n\[\[|\n\[(?!\[)|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const block = m[1];
    const name = block.match(/^\s*index_name\s*=\s*"([^"]+)"/m)?.[1];
    if (name) names.push(name);
  }
  return names;
}

/** @param {string} text */
function extractWorkerName(text) {
  return text.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] || null;
}

/** @param {string} text */
function extractRoutes(text) {
  const routes = [];
  const re = /pattern\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) routes.push(m[1]);
  return routes;
}

const errors = [];
const notes = [];

for (const pair of PAIRS) {
  const prodPath = path.join(ROOT, pair.prod);
  const testPath = path.join(ROOT, pair.test);
  if (!fs.existsSync(prodPath) || !fs.existsSync(testPath)) {
    errors.push(`missing config for ${pair.name}`);
    continue;
  }
  const prod = fs.readFileSync(prodPath, 'utf8');
  const test = fs.readFileSync(testPath, 'utf8');

  const prodName = extractWorkerName(prod);
  const testName = extractWorkerName(test);
  if (!testName || !String(testName).endsWith('-test')) {
    errors.push(`${pair.name}: test worker name must end with -test (got ${testName})`);
  }
  if (prodName && testName && prodName === testName) {
    errors.push(`${pair.name}: test worker name collides with prod (${prodName})`);
  }

  const prodKv = new Set(extractKvIds(prod).map((x) => x.id));
  for (const { binding, id } of extractKvIds(test)) {
    if (prodKv.has(id)) {
      errors.push(`${pair.name}: KV ${binding} id ${id} is shared with production`);
    }
  }

  const prodD1 = new Set(extractD1Ids(prod).map((x) => x.id));
  for (const { name, id } of extractD1Ids(test)) {
    if (prodD1.has(id)) {
      errors.push(`${pair.name}: D1 ${name} id ${id} is shared with production`);
    }
  }

  const prodR2 = new Set(extractR2Buckets(prod));
  for (const bucket of extractR2Buckets(test)) {
    if (prodR2.has(bucket)) {
      errors.push(`${pair.name}: R2 bucket ${bucket} is shared with production`);
    }
  }

  const prodVz = new Set(extractVectorize(prod));
  for (const index of extractVectorize(test)) {
    if (prodVz.has(index)) {
      errors.push(`${pair.name}: Vectorize index ${index} is shared with production`);
    }
  }

  for (const route of extractRoutes(test)) {
    if (route.includes('api.freebacktrack.tech')) {
      errors.push(`${pair.name}: test route points at prod host: ${route}`);
    }
    if (!route.includes('test.freebacktrack.tech')) {
      notes.push(`${pair.name}: test route not on test.freebacktrack.tech: ${route}`);
    }
  }

  // Hard-code known production IDs as a second line of defense.
  const PROD_FORBIDDEN = new Set([
    '604823eb1497431bb8a13f895a0d68e3', // MARKETS_KV
    '1537be1895404cc4a8286ae2aead9d52', // NAV_HISTORY_KV
    'd3d7cf8351b24070a156649fdd50790d', // NOTIFY_STATE
    '633d193bdcb045e3bdbc098ff6249224', // FUND_LIMIT_KV
    '34af9b7435a84b5290e179875d272f27', // SYNC_BACKUPS
    'b0e5feab-dbcf-4ba7-9f3f-2e5169e8d868' // sync D1
  ]);
  const allTestIds = [
    ...extractKvIds(test).map((x) => x.id),
    ...extractD1Ids(test).map((x) => x.id)
  ];
  for (const id of allTestIds) {
    if (PROD_FORBIDDEN.has(id)) {
      errors.push(`${pair.name}: forbidden production resource id ${id}`);
    }
  }
  if (extractR2Buckets(test).includes('ai-dca-markets')) {
    errors.push(`${pair.name}: R2 must not use production bucket ai-dca-markets`);
  }
}

if (notes.length) {
  for (const n of notes) console.warn('note:', n);
}

if (errors.length) {
  console.error('test env isolation check FAILED:');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}

console.log('test env isolation check passed (%d worker pairs).', PAIRS.length);
