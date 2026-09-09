import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeEmailHtml,
  normalizeEmailAddress,
  normalizeEmailConfig,
  sendVerifiedEmailNotification
} from '../workers/notify/src/channels/email.js';
import {
  clearEmailVerification,
  createEmailVerification,
  enforceEmailCodeRateLimits,
  getVerifiedEmailVerification,
  verifyEmailCode
} from '../workers/notify/src/emailVerification.js';
import { requiresNotifyAccountAuth } from '../workers/notify/src/notifyAccountAuth.js';

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

const userId = 'user_123';

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

test('verification is keyed by authenticated user and remains pending until save', async () => {
  const { env, sends } = buildEmailEnv();
  await createEmailVerification(env, {
    userId,
    email: 'Verify@Example.com',
    ip: '203.0.113.10'
  });
  assert.equal(sends.length, 1);
  const code = sends[0].subject.match(/(\d{6})/)?.[1];
  assert.match(code || '', /^\d{6}$/);
  const stored = await env.NOTIFY_STATE.get(`email-verification:${userId}`);
  assert.ok(stored);
  assert.equal(stored.includes(code), false);

  const result = await verifyEmailCode(env, {
    userId,
    email: 'verify@example.com',
    code
  });
  assert.equal(result.email, 'verify@example.com');
  assert.ok(result.verifiedAt);
  assert.ok(await env.NOTIFY_STATE.get(`email-verification:${userId}`));

  const pending = await getVerifiedEmailVerification(env, { userId, email: 'verify@example.com' });
  assert.equal(pending.email, 'verify@example.com');
  await clearEmailVerification(env, userId);
  assert.equal(await env.NOTIFY_STATE.get(`email-verification:${userId}`), null);
});

test('expired verification code is rejected', async () => {
  const { env, sends } = buildEmailEnv();
  await createEmailVerification(env, {
    userId: 'expired-user',
    email: 'expired@example.com',
    ip: '203.0.113.11'
  });
  const code = sends[0].subject.match(/(\d{6})/)?.[1];
  const key = 'email-verification:expired-user';
  const record = JSON.parse(await env.NOTIFY_STATE.get(key));
  record.expiresAt = new Date(Date.now() - 1000).toISOString();
  await env.NOTIFY_STATE.put(key, JSON.stringify(record));
  await assert.rejects(
    () => verifyEmailCode(env, { userId: 'expired-user', email: 'expired@example.com', code }),
    /验证码已过期/
  );
});

test('verification is invalidated after five wrong attempts', async () => {
  const { env, sends } = buildEmailEnv();
  await createEmailVerification(env, {
    userId: 'attempt-user',
    email: 'attempt@example.com',
    ip: '203.0.113.12'
  });
  const actualCode = sends[0].subject.match(/(\d{6})/)?.[1] || '';
  const wrongCode = actualCode === '000000' ? '111111' : '000000';
  for (let index = 0; index < 4; index += 1) {
    await assert.rejects(
      () => verifyEmailCode(env, { userId: 'attempt-user', email: 'attempt@example.com', code: wrongCode }),
      /验证码错误/
    );
  }
  await assert.rejects(
    () => verifyEmailCode(env, { userId: 'attempt-user', email: 'attempt@example.com', code: wrongCode }),
    /错误次数过多/
  );
  assert.equal(await env.NOTIFY_STATE.get('email-verification:attempt-user'), null);
});

test('rate limiter blocks a second code within two minutes for the same user', async () => {
  const { env } = buildEmailEnv();
  const params = {
    userId: 'rate-user',
    email: 'rate@example.com',
    ip: '203.0.113.20',
    now: 1_000_000
  };
  await enforceEmailCodeRateLimits(env, params);
  await assert.rejects(
    () => enforceEmailCodeRateLimits(env, { ...params, now: params.now + 1000 }),
    /2 分钟/
  );
});

test('rate limiter caps one email at three requests per ten minutes', async () => {
  const { env } = buildEmailEnv();
  const email = 'shared@example.com';
  const now = 2_000_000;
  await enforceEmailCodeRateLimits(env, { userId: 'user-a', email, ip: '203.0.113.31', now });
  await enforceEmailCodeRateLimits(env, { userId: 'user-b', email, ip: '203.0.113.32', now: now + 1000 });
  await enforceEmailCodeRateLimits(env, { userId: 'user-c', email, ip: '203.0.113.33', now: now + 2000 });
  await assert.rejects(
    () => enforceEmailCodeRateLimits(env, { userId: 'user-d', email, ip: '203.0.113.34', now: now + 3000 }),
    /该邮箱验证码发送过于频繁/
  );
});

test('all email account routes require bearer-backed account authentication', () => {
  const routes = [
    ['GET', '/api/notify/email/status'],
    ['POST', '/api/notify/email/send-code'],
    ['POST', '/api/notify/email/verify'],
    ['POST', '/api/notify/email/save'],
    ['POST', '/api/notify/email/disable'],
    ['POST', '/api/notify/email/enable']
  ];
  for (const [method, path] of routes) {
    assert.equal(requiresNotifyAccountAuth(new Request(`https://api.freebacktrack.tech${path}`, { method })), true);
  }
});
