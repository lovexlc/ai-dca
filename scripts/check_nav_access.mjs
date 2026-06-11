import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.frontend-build', 'frontend-dist', 'react-assets', 'react-assets-v2', 'dist', 'coverage', 'test-results', 'playwright-report']);

const ALLOW_NAV_API_ENDPOINTS = new Set([
  'src/app/navService.js',
  'src/app/navHistoryClient.js',
  'workers/ocr-proxy/src/index.js',
  'workers/ocr-proxy/src/holdingsNavRoutes.js',
  'tests/e2e/acceptance-helpers.js',
  'tests/e2e/holdings-nav-refresh-regression.spec.js',
  'tests/e2e/markets-otc-compare.spec.js',
  'scripts/check_nav_access.mjs'
]);

const ALLOW_NAV_UPSTREAM_SOURCE = new Set([
  'workers/notify/src/getNav.js',
  'workers/notify/src/index.js',
  'workers/notify/src/holdingsSnapshotFetch.js',
  'workers/notify/src/switchStrategy.js',
  'workers/ocr-proxy/src/holdingsNavRoutes.js',
  'workers/markets-agent/container/skills/fund-backtest/lib/eastmoney.js',
  'scripts/check_nav_access.mjs'
]);

const ALLOW_COMPAT_WRAPPERS = new Set([
  'src/app/holdings.js',
  'src/app/holdingsLedger.js',
  'src/app/navHistoryClient.js',
  'scripts/check_nav_access.mjs'
]);

const NAV_API_PATTERNS = [
  '/api/holdings/nav',
  '/api/holdings/nav-history'
];

const NAV_UPSTREAM_PATTERNS = [
  'api.fund.eastmoney.com/f10/lsjz',
  'latest-nav.json',
  'fetchFundNavSnapshot',
  'fetchFundNavHistory('
];

const COMPAT_NAV_PATTERNS = [
  'requestHoldingsNav(',
  'requestHoldingsNavHistory(',
  'requestLedgerNav('
];

function extName(file) {
  const match = file.match(/\.[^.]+$/);
  return match ? match[0] : '';
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(extName(full))) out.push(full);
  }
  return out;
}

function getNotifyGetNavImportLines(rel, lines) {
  if (rel !== 'workers/ocr-proxy/src/index.js') return new Set();
  const skip = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('import {')) continue;
    for (let j = i; j < Math.min(lines.length, i + 12); j += 1) {
      if (lines[j].includes("from '../../notify/src/getNav.js'")) {
        for (let k = i; k <= j; k += 1) skip.add(k);
        break;
      }
    }
  }
  return skip;
}

const violations = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const notifyGetNavImportLines = getNotifyGetNavImportLines(rel, lines);

  for (const pattern of NAV_API_PATTERNS) {
    if (ALLOW_NAV_API_ENDPOINTS.has(rel)) continue;
    lines.forEach((line, idx) => {
      if (line.includes(pattern)) violations.push(`${rel}:${idx + 1}: direct NAV API usage: ${pattern}`);
    });
  }

  for (const pattern of NAV_UPSTREAM_PATTERNS) {
    if (ALLOW_NAV_UPSTREAM_SOURCE.has(rel)) continue;
    lines.forEach((line, idx) => {
      if (notifyGetNavImportLines.has(idx)) return;
      if (line.includes(pattern)) violations.push(`${rel}:${idx + 1}: direct NAV upstream usage: ${pattern}`);
    });
  }

  for (const pattern of COMPAT_NAV_PATTERNS) {
    if (ALLOW_COMPAT_WRAPPERS.has(rel)) continue;
    lines.forEach((line, idx) => {
      if (line.includes(pattern)) violations.push(`${rel}:${idx + 1}: use navService instead of ${pattern}`);
    });
  }
}

if (violations.length) {
  console.error('NAV access guard failed. Use src/app/navService.js or workers/notify/src/getNav.js as the centralized NAV entry.');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('NAV access guard passed.');
