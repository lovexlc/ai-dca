import test from 'node:test';
import assert from 'node:assert/strict';

import { hasAnyNotifyChannel } from '../src/pages/holdings/useHoldingsDailyPush.js';

test('hasAnyNotifyChannel: 新版 channels 形态', () => {
  assert.equal(hasAnyNotifyChannel({ channels: { bark: { configured: true } } }), true);
  assert.equal(hasAnyNotifyChannel({ channels: { email: { configured: true } } }), true);
  assert.equal(hasAnyNotifyChannel({ channels: { webWs: { configured: true } } }), true);
  assert.equal(
    hasAnyNotifyChannel({ channels: { bark: { configured: false }, serverChan3: { configured: false }, email: { configured: false }, webWs: { configured: false } } }),
    false
  );
});

test('hasAnyNotifyChannel: 兼容旧版 configured / setup 形态', () => {
  assert.equal(hasAnyNotifyChannel({ configured: { bark: true } }), true);
  assert.equal(hasAnyNotifyChannel({ configured: { serverChan3: true } }), true);
  assert.equal(hasAnyNotifyChannel({ setup: { serverChan3: { configured: true } } }), true);
  assert.equal(hasAnyNotifyChannel({ configured: {}, setup: {} }), false);
});

test('hasAnyNotifyChannel: 空输入不抛异常且返回 false', () => {
  assert.equal(hasAnyNotifyChannel(null), false);
  assert.equal(hasAnyNotifyChannel(undefined), false);
  assert.equal(hasAnyNotifyChannel({}), false);
});
