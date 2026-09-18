import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  prepareSwitchEmailNotification,
  sendVerifiedEmailNotification
} from '../workers/notify/src/channels/email.js';

function notification() {
  return {
    eventId: 'switch:rule-1:159632:159659:RA:2026-09-17T02:33',
    eventType: 'switch-strategy-trigger',
    symbol: '159632',
    title: '切换 A 低→高 | 159632→159659',
    summary: '切换 A 159632→159659 -0.01%',
    body: 'H−L -0.01% < 0.1%\n卖 159632 纳斯达克ETF华安 → 买 159659 纳斯达克100ETF招商',
    strategyName: '场内切换 · 招商-华安切换',
    triggerCondition: '规则 A 低→高：H溢价 − L溢价 < 0.1%',
    params: {
      trigger: 'switch-threshold',
      code: '159632',
      targetCode: '159659',
      rule: 'A'
    },
    detailUrl: 'https://tools.freebacktrack.tech/index.html?tab=fundSwitch'
  };
}

function tencentPayload(codes = ['159632', '159659']) {
  return codes.map((code, codeIndex) => {
    const base = codeIndex === 0 ? 1.233 : 1.102;
    const fields = Array(41).fill('');
    fields[0] = '51';
    fields[1] = 'ETF';
    fields[2] = code;
    fields[3] = String(base);
    fields[30] = '20260917103352';
    for (let level = 1; level <= 5; level += 1) {
      const bidIndex = 9 + (level - 1) * 2;
      const askIndex = 19 + (level - 1) * 2;
      fields[bidIndex] = (base - (level - 1) * 0.001).toFixed(3);
      fields[bidIndex + 1] = String(120000 - (level - 1) * 1000);
      fields[askIndex] = (base + 0.001 + (level - 1) * 0.001).toFixed(3);
      fields[askIndex + 1] = String(98000 - (level - 1) * 1000);
    }
    return `v_sz${code}="${fields.join('~')}";`;
  }).join('\n');
}

function textResponse(value, status = 200) {
  return new Response(new TextEncoder().encode(value), { status });
}

test('prepareSwitchEmailNotification captures Tencent depth before queued delivery', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (!url.includes('qt.gtimg.cn')) throw new Error(`unexpected fetch ${url}`);
    calls += 1;
    return textResponse(tencentPayload());
  };
  try {
    const prepared = await prepareSwitchEmailNotification(notification());
    assert.equal(calls, 1);
    assert.ok(prepared.marketSnapshot?.capturedAt);
    assert.equal(prepared.marketSnapshot?.books?.['159632']?.source, 'tencent');
    assert.equal(prepared.marketSnapshot?.books?.['159659']?.source, 'tencent');
    assert.equal(prepared.marketSnapshot?.books?.['159632']?.orderBook?.bidPrice, 1.233);
    assert.equal(prepared.marketSnapshot?.books?.['159659']?.orderBook?.askPrice, 1.103);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('email renderer reuses embedded trigger snapshot without refetching market data', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('market data should not be refetched'); };
  const sent = [];
  const prepared = {
    ...notification(),
    marketSnapshot: {
      capturedAt: '2026-09-17T02:33:54.000Z',
      source: 'tencent+sina-fallback',
      successCount: 2,
      failureCount: 0,
      books: {
        '159632': {
          source: 'tencent',
          orderBook: {
            bidPrice: 1.233,
            bidVolume: 120000,
            askPrice: 1.234,
            askVolume: 98000,
            levels: [{ level: 1, bidPrice: 1.233, bidVolume: 120000, askPrice: 1.234, askVolume: 98000 }]
          }
        },
        '159659': {
          source: 'sina',
          orderBook: {
            bidPrice: 1.102,
            bidVolume: 76000,
            askPrice: 1.103,
            askVolume: 88000,
            levels: [{ level: 1, bidPrice: 1.102, bidVolume: 76000, askPrice: 1.103, askVolume: 88000 }]
          }
        }
      }
    }
  };
  const env = {
    EMAIL: {
      async send(message) {
        sent.push(message);
        return { messageId: 'message-1' };
      }
    }
  };
  try {
    const result = await sendVerifiedEmailNotification({
      ...prepared,
      email: { address: 'test@example.com', verified: true, enabled: true }
    }, env);
    assert.equal(result.status, 'delivered');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].subject, '【切换提醒】159632 → 159659｜价差 -0.01%｜10:33');
    assert.match(sent[0].text, /买一 1\.233/);
    assert.match(sent[0].text, /卖一 1\.103/);
    assert.match(sent[0].html, /腾讯/);
    assert.match(sent[0].html, /新浪备用/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
