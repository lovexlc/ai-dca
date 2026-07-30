import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const NOTIFY_ROOT = path.join(ROOT, 'workers/notify/src');
const ALLOWED_CLIENT = path.join(NOTIFY_ROOT, 'marketsClient.js');
const SHARED_BACKTEST_ROOT = path.join(ROOT, 'workers/shared/src/backtest');
const failures = [];

function collectJavaScriptFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(fullPath));
    else if (entry.isFile() && fullPath.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

for (const file of collectJavaScriptFiles(NOTIFY_ROOT)) {
  if (file === ALLOWED_CLIENT) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (/\benv\.(?:MARKETS|OCR_PROXY)\.fetch\b/.test(source)) {
    failures.push(`${path.relative(ROOT, file)}: direct Service Binding fetch must go through marketsClient.js`);
  }
  if (/from ['"][^'"]*shared\/src\/marketsServiceClient\.js['"]/.test(source)) {
    failures.push(`${path.relative(ROOT, file)}: import marketsServiceClient through marketsClient.js`);
  }
}

for (const file of collectJavaScriptFiles(SHARED_BACKTEST_ROOT)) {
  const source = fs.readFileSync(file, 'utf8');
  if (/from ['"][^'"]*(?:src\/app|workers\/notify)[^'"]*['"]/.test(source)) {
    failures.push(`${path.relative(ROOT, file)}: shared backtest core must not depend on an app or Worker implementation`);
  }
}

for (const file of collectJavaScriptFiles(path.join(ROOT, 'workers/shared/src'))) {
  const source = fs.readFileSync(file, 'utf8');
  if (/from ['"][^'"]*(?:workers\/markets\/src|(?:\.\.\/)+markets\/src)[^'"]*['"]/.test(source)) {
    failures.push(`${path.relative(ROOT, file)}: shared code must not import markets internals`);
  }
}

if (failures.length) {
  console.error('Architecture boundary check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Architecture boundary check passed.');
