import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFundMetricFromQuote } from '../workers/markets/src/fundMetricsRoutes.js';
import { fetchTencentCnQuotesBatch, parseTencentCnQuoteText } from '../workers/markets/src/fetchers.js';

// 腾讯行情原始格式：买档位于 9–18，卖档位于 19–28，29 为空字段。
const quoteLine = 'v_sz159659="51~纳斯达克100ETF招商~159659~2.423~2.456~2.424~707536~359598~347938~2.423~1837~2.422~3260~2.421~2350~2.420~11425~2.419~1913~2.424~556~2.425~1692~2.426~7784~2.427~832~2.428~1058~~20260924161418~-0.033~-1.34~2.432~2.417";';

test('Tencent quote parses all five bid and ask levels and spread', () => {
  const quote = parseTencentCnQuoteText(quoteLine).sz159659;
  const book = quote.orderBook;
  assert.equal(quote.source, 'tencent-quote');
  assert.equal(book.source, 'tencent-pankou');
  assert.equal(book.bidPrice, 2.423);
  assert.equal(book.bidVolume, 1837);
  assert.equal(book.askPrice, 2.424);
  assert.equal(book.askVolume, 556);
  assert.equal(book.spread, 0.001);
  assert.equal(book.spreadPercent, 0.0413);
  const metric = normalizeFundMetricFromQuote('159659', quote, { exchange: true });
  assert.deepEqual(metric.orderBook, book);
  assert.deepEqual(book.levels, [
    { level: 1, bidPrice: 2.423, bidVolume: 1837, askPrice: 2.424, askVolume: 556 },
    { level: 2, bidPrice: 2.422, bidVolume: 3260, askPrice: 2.425, askVolume: 1692 },
    { level: 3, bidPrice: 2.421, bidVolume: 2350, askPrice: 2.426, askVolume: 7784 },
    { level: 4, bidPrice: 2.420, bidVolume: 11425, askPrice: 2.427, askVolume: 832 },
    { level: 5, bidPrice: 2.419, bidVolume: 1913, askPrice: 2.428, askVolume: 1058 }
  ]);
});

test('Tencent missing or zero book prices do not create a spread', () => {
  assert.equal(parseTencentCnQuoteText('v_sh501312="51~LOF~501312~1.234~1.2~1.2";').sh501312.orderBook, null);
  const fields = quoteLine.match(/="([^"]*)"/)[1].split('~');
  fields[9] = '0';
  fields[10] = '';
  fields[20] = '0';
  const book = parseTencentCnQuoteText(`v_sz159659="${fields.join('~')}";`).sz159659.orderBook;
  assert.equal(book.bidPrice, null);
  assert.equal(book.bidVolume, null);
  assert.equal(book.askVolume, 0);
  assert.equal(book.spread, null);
  assert.equal(book.spreadPercent, null);
  assert.equal(book.levels.length, 5);
});

test('Tencent batch obtains quotes and order books in one request without cookie', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(init.headers.cookie, undefined);
    return new Response(quoteLine);
  };
  try {
    const quotes = await fetchTencentCnQuotesBatch(['sz159659', '159659']);
    assert.equal(quotes.sz159659.orderBook.levels.length, 5);
    assert.equal(quotes['159659'].price, 2.423);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /qt\.gtimg\.cn/);
  } finally {
    globalThis.fetch = original;
  }
});
