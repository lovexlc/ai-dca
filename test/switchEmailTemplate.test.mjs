import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSwitchEmailContent } from '../workers/notify/src/channels/email.js';

const notification = {
  eventId: 'switch:rule-1:159632:159659:RA:2026-09-17T02:33',
  eventType: 'switch-strategy-trigger',
  symbol: '159632',
  title: '切换 A 低→高 | 159632→159659',
  summary: '切换 A 159632→159659 -0.01%',
  body: [
    'H−L -0.01% < 0.1% · NAV 2026-09-16',
    '卖 159632 纳斯达克ETF华安 → 买 159659 纳斯达克100ETF招商',
    '下单前请以基金软件实时溢价为准。'
  ].join('\n'),
  strategyName: '场内切换 · 招商-华安切换',
  triggerCondition: '规则 A 低→高：H溢价 − L溢价 < 0.1%（溢价差收窄，从持仓 L 换到 H）',
  params: {
    trigger: 'switch-threshold',
    code: '159632',
    targetCode: '159659',
    rule: 'A'
  },
  detailUrl: 'https://tools.freebacktrack.tech/index.html?tab=fundSwitch'
};

const orderBookSnapshot = {
  generatedAt: '2026-09-17T02:33:54.000Z',
  books: {
    '159632': {
      code: '159632',
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
      code: '159659',
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
};

test('switch email highlights sell bid1 and buy ask1 with source and trigger time', () => {
  const rendered = buildSwitchEmailContent(notification, orderBookSnapshot);

  assert.equal(rendered.subjectText, '【切换提醒】159632 → 159659｜溢价差 -0.01%｜10:33');
  assert.match(rendered.plainBody, /切换 A 低→高：159632 → 159659/);
  assert.match(rendered.plainBody, /策略溢价差：H-L -0\.01%/);
  assert.match(rendered.plainBody, /触发时间：09-17 10:33/);
  assert.match(rendered.plainBody, /卖出参考 159632：买一 1\.233，挂单量 12\.00万/);
  assert.match(rendered.plainBody, /买入参考 159659：卖一 1\.103，挂单量 8\.80万/);
  assert.match(rendered.plainBody, /盘口快照：09-17 10:33:54/);
  assert.match(rendered.plainBody, /盘口来源：159632 腾讯 · 159659 新浪备用/);

  assert.match(rendered.html, /场内切换 · 招商-华安切换/);
  assert.match(rendered.html, /H-L -0\.01%/);
  assert.match(rendered.html, /买一/);
  assert.match(rendered.html, /卖一/);
  assert.match(rendered.html, /腾讯/);
  assert.match(rendered.html, /新浪备用/);
  assert.match(rendered.html, /查看策略详情/);
});

test('switch email still renders when order book is unavailable', () => {
  const rendered = buildSwitchEmailContent(notification, {
    generatedAt: '2026-09-17T02:33:55.000Z',
    books: {}
  });

  assert.match(rendered.plainBody, /盘口暂不可用，切换提醒仍正常发送。/);
  assert.match(rendered.html, /盘口暂不可用，切换提醒仍正常发送。/);
  assert.match(rendered.plainBody, /盘口只作为触发时附近的成交参考/);
});
