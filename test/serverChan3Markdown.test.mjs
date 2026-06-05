import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildServerChan3MessagePayload,
  sendServerChan3Notification
} from '../workers/notify/src/channels/serverChan3.js';

const SWITCH_NOTIFICATION = {
  eventId: 'switch:513100:159501',
  eventType: 'switch-strategy-trigger',
  title: '切换 B 高→低 | 513100→159501',
  body: 'plain text fallback should not be used when body_md exists',
  body_md: '**H-L +4.20%** > 3%\n\n卖 **513100 纳指ETF** → 买 **159501 纳指ETF**',
  summary: '切换 B 513100→159501 +4.20%',
  symbol: '513100',
  strategyName: '场内切换',
  triggerCondition: '规则 B 高→低：H溢价 − L溢价 > 3%',
  detailUrl: 'https://tools.freebacktrack.tech/index.html?tab=tradePlans#switch'
};

test('buildServerChan3MessagePayload uses Markdown body and WeChat-style metadata', () => {
  const payload = buildServerChan3MessagePayload(SWITCH_NOTIFICATION);

  assert.equal(payload.title, SWITCH_NOTIFICATION.title);
  assert.equal(payload.short, SWITCH_NOTIFICATION.summary);
  assert.equal(payload.tags, 'AI-DCA|切换提醒');
  assert.match(payload.desp, /^# 切换 B 高→低 \| 513100→159501/);
  assert.match(payload.desp, /> 切换 B 513100→159501 \+4\.20%/);
  assert.match(payload.desp, /\| 策略 \| 场内切换 \|/);
  assert.match(payload.desp, /\| 标的 \| 513100 \|/);
  assert.match(payload.desp, /\*\*H-L \+4\.20%\*\* > 3%/);
  assert.match(payload.desp, /\[打开 AI-DCA 查看详情\]\(https:\/\/tools\.freebacktrack\.tech\/index\.html\?tab=tradePlans#switch\)/);
  assert.doesNotMatch(payload.desp, /plain text fallback/);
});

test('sendServerChan3Notification posts Markdown payload fields', async () => {
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response('ok', { status: 200 });
  };

  try {
    const result = await sendServerChan3Notification({
      ...SWITCH_NOTIFICATION,
      uid: 'uid-123',
      sendKey: 'send-key-456'
    });

    assert.equal(result.channel, 'serverchan3');
    assert.equal(result.status, 'delivered');
    assert.equal(captured.url, 'https://uid-123.push.ft07.com/send/send-key-456.send');
    assert.equal(captured.init.method, 'POST');

    const form = new URLSearchParams(captured.init.body);
    assert.equal(form.get('title'), SWITCH_NOTIFICATION.title);
    assert.equal(form.get('short'), SWITCH_NOTIFICATION.summary);
    assert.equal(form.get('tags'), 'AI-DCA|切换提醒');
    assert.match(form.get('desp'), /\| 触发条件 \| 规则 B 高→低：H溢价 − L溢价 > 3% \|/);
    assert.match(form.get('desp'), /卖 \*\*513100 纳指ETF\*\* → 买 \*\*159501 纳指ETF\*\*/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
