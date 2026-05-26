import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IGNORE_DIRS = new Set(['.git', 'node_modules', '.frontend-build', 'frontend-dist', 'react-assets', 'dist', 'coverage', 'test-results', 'playwright-report']);

const ALLOW_DIRECT_NAV_SOURCE = new Set([
  'src/app/navService.js',
  'src/app/navHistoryClient.js',
  'workers/notify/src/getNav.js',
  'workers/ocr-proxy/src/index.js',
  'workers/notify/src/index.js',
  'workers/notify/src/switchStrategy.js',
  'workers/markets-agent/container/skills/fund-backtest/lib/eastmoney.js',
  'scripts/fetch_etf_latest_nav.mjs',
  'tests/e2e/acceptance-helpers.js',
  'scripts/check_nav_access.mjs'
]);

const ALLOW_COMPAT_WRAPPERS = new Set([
  'src/app/holdings.js',
  'src/app/holdingsLedger.js',
  'src/app/navHistoryClient.js',
  'scripts/check_nav_access.mjs'
]);

const DIRECT_NAV_PATTERNS = [
  '/api/holdings/nav',
  '/api/holdings/nav-history',
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

const violations = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (const pattern of DIRECT_NAV_PATTERNS) {
    if (ALLOW_DIRECT_NAV_SOURCE.has(rel)) continue;
    lines.forEach((line, idx) => {
      if (line.includes(pattern)) violations.push(`${rel}:${idx + 1}: direct NAV source usage: ${pattern}`);
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
