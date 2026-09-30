import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCollectorPremiumBatch } from '../workers/markets/src/collectorPremium.js';

test('collector batches IOPV by ten, requests NAV once and starts both upstreams concurrently', async () => {
  const original = globalThis.fetch;
  const calls = [];
  let release;
  const navStarted = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    calls.push(url);
    assert.match(options.headers['user-agent'], /Mozilla/);
    assert.ok(options.signal);
    if (url.hostname.startsWith('push2delay')) {
      await navStarted;
      const codes = url.searchParams.get('secids').split(',').map((value) => value.split('.')[1]);
      assert.ok(codes.length <= 10);
      return Response.json({ data: { diff: codes.map((code) => ({ f12: code, f441: 2, f402: -8 })) } });
    }
    release();
    assert.equal(url.searchParams.get('Fcodes').split(',').length, 11);
    assert.equal(url.searchParams.get('deviceid'), 'ai-dca-markets');
    return Response.json({ Datas: [] });
  };
  try {
    const result = await fetchCollectorPremiumBatch(Array.from({ length: 11 }, (_, index) => ({ code: String(513500 + index), price: 3 })));
    assert.equal(calls.filter((url) => url.hostname.startsWith('push2delay')).length, 2);
    assert.equal(calls.filter((url) => url.hostname.startsWith('fundmobapi')).length, 1);
    assert.equal(result['513500'].premiumSource, 'iopv');
    assert.equal(result['513500'].premiumPercent, 50);
  } finally { globalThis.fetch = original; }
});

test('collector falls back to NAV/vendor and returns null when both upstreams fail', async () => {
  const original = globalThis.fetch;
  try {
    for (const allFailed of [false, true]) {
      globalThis.fetch = async (input) => {
        if (String(input).includes('push2delay') || allFailed) throw new Error('network unavailable');
        return Response.json({ Datas: [{ FCODE: '513500', NAV: 2.4, HQDATE: '2026-09-30', ZJL: -8 }, { FCODE: '159659', NAV: '-', ZJL: -9 }] });
      };
      const result = await fetchCollectorPremiumBatch([{ code: '513500', price: 3 }, { code: '159659', price: 3 }]);
      assert.equal(result['513500'].premiumSource, allFailed ? null : 'nav');
      assert.equal(result['513500'].premiumPercent, allFailed ? null : 25);
      assert.equal(result['159659'].premiumSource, allFailed ? null : 'vendor');
      assert.equal(result['159659'].premiumPercent, allFailed ? null : 9);
    }
  } finally { globalThis.fetch = original; }
});

test('collector retries a transient 502 and uses the recovered IOPV', async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (input) => {
    if (!String(input).includes('push2delay')) return Response.json({ Datas: [] });
    attempts += 1;
    return attempts === 1 ? new Response('', { status: 502 }) : Response.json({ data: { diff: [{ f12: '513500', f441: 2 }] } });
  };
  try {
    const result = await fetchCollectorPremiumBatch([{ code: '513500', price: 3 }]);
    assert.equal(attempts, 2);
    assert.equal(result['513500'].premiumSource, 'iopv');
  } finally { globalThis.fetch = original; }
});
