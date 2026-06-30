/**
 * Smoke test: LOF 场内 kind 提示能正确传到行情接口。
 */
import assert from 'node:assert/strict';
import { normalizeTransaction } from '../src/app/holdingsLedgerBasics.js';
import { fetchFundMetrics } from '../src/app/marketsApi.js';

// 1. 用户选择场内后，交易记录 kind 应为 exchange
const tx = normalizeTransaction({
  code: '161130',
  name: '易方达纳斯达克100ETF联接(QDII-LOF)A人民币',
  kind: 'exchange',
  type: 'BUY',
  date: '2026-06-30',
  price: '6.5',
  shares: '100'
});
assert.equal(tx.kind, 'exchange', '用户选择的场内 kind 应被保留');

// 2. fetchFundMetrics 把调用方传入的 fundKinds 透传给 Worker
let capturedBody = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/fund-metrics')) {
    capturedBody = JSON.parse(init.body || '{}');
    return new Response(JSON.stringify({ items: [], successCount: 0, failureCount: 0, generatedAt: '', tradingSession: false, cachePolicy: '' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  return originalFetch(url, init);
};

await fetchFundMetrics(['161130'], { fundKinds: { '161130': 'exchange' } });
assert.ok(capturedBody, '应发出 fund-metrics 请求');
assert.equal(capturedBody.fundKinds?.['161130'], 'exchange', 'LOF 场内 kind 应透传到 Worker');

// 3. 未传 fundKinds 时，默认仍按代码前缀/QDII 表分类为 qdii
await fetchFundMetrics(['161130'], {});
assert.equal(capturedBody.fundKinds?.['161130'], 'qdii', '无提示时 LOF 应归类为 qdii');

globalThis.fetch = originalFetch;
console.log('smoke-lof-exchange-kind: passed');
