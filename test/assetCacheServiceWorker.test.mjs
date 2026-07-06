import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../public/asset-cache-sw.js', import.meta.url), 'utf8');

test('asset service worker uses cache-first only for static built assets', () => {
  assert.ok(source.includes('react-assets(?:-v2)?'));
  assert.ok(source.includes('(?:css|js|png|jpg|jpeg|svg|webp|woff2?)'));
  assert.ok(source.includes('url.origin !== self.location.origin'));
  assert.ok(source.includes("request.method !== 'GET'"));
});

test('asset service worker avoids caching the app shell html', () => {
  assert.doesNotMatch(source, /index\.html/);
  assert.doesNotMatch(source, /navigate/);
  assert.match(source, /cache\.match\(event\.request\)/);
  assert.match(source, /cache\.put\(event\.request, response\.clone\(\)\)/);
});

test('asset service worker accepts explicit cache seeding messages', () => {
  assert.ok(source.includes("event?.data?.type !== 'CACHE_ASSET_URLS'"));
  assert.ok(source.includes('cacheAssetUrls(event.data.urls)'));
  assert.ok(source.includes('normalizeCacheableUrl'));
});
