import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeEmailHtml,
  normalizeEmailAddress,
  normalizeEmailConfig,
  sendVerifiedEmailNotification
} from '../workers/notify/src/channels/email.js';
import {
  createEmailVerification,
  enforceEmailCodeRateLimits,
  verifyEmailCode
} from '../workers/notify/src/emailVerification.js';

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }

  async delete(key) {
    this.values.delete(key);
  }
}

function buildEmailEnv() {
  const sends = [];
  return {
    env: {
      NOTIFY_STATE: new MemoryKv(),
      EMAIL_FROM: 'notify@freebacktrack.tech',
      EMAIL_FROM_NAME: '美股策略助手',
      EMAIL: {
        async send(message) {
          sends.push(message);
          return { messageId: `mail-${sends.length}` };
        }
      }
    },
    sends
  };
}

test('email helpers normalize addresses and escape HTML', () => {
  assert.equal(normalizeEmailAddress('  User.Name@Example.COM '), 'user.name@example.com');
  assert.equal(normalizeEmailAddress('bad-address'), '');
  assert.equal(normalizeEmailAddress('a@b'), '');
  assert.equal(escapeEmailHtml('<img src=x onerror="boom">'), '&lt;img src=x onerror=&quot;boom&quot;&gt;');
  assert.deepEqual(normalizeEmailConfig({ address: 'A@Example.com', verified: false, enabled: true }), {
    address: 'a@example.com',
    verified: false,
    verifiedAt: '',
    enabled: false
  });
});

test('unverified email is never delivered', async () => {
  const { env, sends } = buildEmailEnv();
  const result = await sendVerifiedEmailNotification({
    email: { address: 'user@example.com', verified: false, enabled: true },
    title: '测试',
    body: '测试正文'
  }, env);
  assert.equal(result.status, 'skipped');
  assert.equal(sends.length, 0);
});

test('verified and enabled email is delivered with escaped HTML', async () => {
  const { env, sends } = buildEmailEnv();
  const result = await sendVerifiedEmailNotification({
    email: { address: 'User@Example.com', verified: true, verifiedAt: new Date().toISOString(), enabled: true },
    title: '<策略提醒>',
    body: '<script>alert(1)</script>',
    detailUrl: 'https://freebacktrack.tech/?x=1&y=2'
  }, env);
  assert.equal(result.status, 'delivered');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].to, 'user@example.com');
  assert.match(sends[0].subject, /^【美股策略助手】/);
  assert.doesNotMatch(sends[0].html, /<script>/);
  assert.match(sends[0].html, /&lt;script&gt;/);
});

test('verification stores only a salted hash and accepts the emailed code', async () => {
  const { env, sends } = buildEmailEnv();
  await createEmailVerification(env, {
    clientId: 'web:email-test',
    email: 'Verify@Example.com',
    ip: '203.0.113.10'
  });
  assert.equal(sends.length, 1);
  const code = sends[0].subject.match(/(\d{6})/)?.[1];
  assert.match(code || '', /^\d{6}$/);
  const stored = await env.NOTIFY_STATE.get('email-verification:web:email-test');
  assert.ok(stored);
  assert.equal(stored.includes(code), false);

  const result = await verifyEmailCode(env, {
    clientId: 'web:email-test',
    email: 'verify@example.com',
    code
  });
  assert.equal(result.email, 'verify@example.com');
  assert.equal(await env.NOTIFY_STATE.get('email-verification:web:email-test'), null);
});

test('expired verification code is rejected', async () => {
  const { env, sends } = buildEmailEnv();
  await createEmailVerification(env, {
    clientId: 'web:expired-test',
    email: 'expired@example.com',
    ip: '203.0.113.11'
  });
  const code = sends[0].subject.match(/(\d{6})/)?.[1];
  const key = 'email-verification:web:expired-test';
  const record = JSON.parse(await env.NOTIFY_STATE.get(key));
  record.expiresAt = new Date(Date.now() - 1000).toISOString();
  await env.NOTIFY_STATE.put(key, JSON.stringify(record));
  await assert.rejects(
    () => verifyEmailCode(env, { clientId: 'web:expired-test', email: 'expired@example.com', code }),
    /验证码已过期/
  );
});

test('verification is invalidated after five wrong attempts', async () => {
  const { env, sends } = buildEmailEnv();
  await createEmailVerification(env, {
    clientId: 'web:attempt-test',
    email: 'attempt@example.com',
    ip: '203.0.113.12'
  });
  const actualCode = sends[0].subject.match(/(\d{6})/)?.[1] || '';
  const wrongCode = actualCode === '000000' ? '111111' : '000000';
  for (let index = 0; index < 4; index += 1) {
    await assert.rejects(
      () => verifyEmailCode(env, { clientId: 'web:attempt-test', email: 'attempt@example.com', code: wrongCode }),
      /验证码错误/
    );
  }
  await assert.rejects(
    () => verifyEmailCode(env, { clientId: 'web:attempt-test', email: 'attempt@example.com', code: wrongCode }),
    /错误次数过多/
  );
  assert.equal(await env.NOTIFY_STATE.get('email-verification:web:attempt-test'), null);
});

test('rate limiter blocks a second code within 60 seconds for the same client', async () => {
  const { env } = buildEmailEnv();
  const params = {
    clientId: 'web:rate-client',
    email: 'rate@example.com',
    ip: '203.0.113.20',
    now: 1_000_000
  };
  await enforceEmailCodeRateLimits(env, params);
  await assert.rejects(
    () => enforceEmailCodeRateLimits(env, { ...params, now: params.now + 1000 }),
    /60 秒/
  );
});

test('rate limiter caps one email at three requests per ten minutes', async () => {
  const { env } = buildEmailEnv();
  const email = 'shared@example.com';
  const now = 2_000_000;
  await enforceEmailCodeRateLimits(env, { clientId: 'web:a', email, ip: '203.0.113.31', now });
  await enforceEmailCodeRateLimits(env, { clientId: 'web:b', email, ip: '203.0.113.32', now: now + 1000 });
  await enforceEmailCodeRateLimits(env, { clientId: 'web:c', email, ip: '203.0.113.33', now: now + 2000 });
  await assert.rejects(
    () => enforceEmailCodeRateLimits(env, { clientId: 'web:d', email, ip: '203.0.113.34', now: now + 3000 }),
    /该邮箱验证码发送过于频繁/
  );
});
