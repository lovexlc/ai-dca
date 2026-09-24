import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dailyLimit,
  isProviderConfigured,
  providerOrder,
  resolveEmailProviders,
  sendEmailViaProviders
} from '../src/channels/emailProviders.js';

const DATE_KEY = '2026-09-24';

function fakeKV() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, String(value)); },
    async delete(key) { store.delete(key); },
    _store: store
  };
}

function baseEnv(overrides = {}) {
  return {
    NOTIFY_STATE: fakeKV(),
    EMAIL: { send: async () => ({ messageId: 'cf-1' }) },
    ...overrides
  };
}

function payload(overrides = {}) {
  return {
    fromEmail: 'notify@freebacktrack.tech',
    fromName: '美股策略助手',
    to: 'user@example.com',
    subject: '测试',
    text: 'hello',
    html: '<p>hello</p>',
    ...overrides
  };
}

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('resend 优先且成功后配额 +1', async () => {
  const env = baseEnv({ RESEND_TOKEN: 're_test', BREVO_API_KEY: 'brevo_test' });
  const calls = [];
  const restore = mockFetch(async (url, init) => {
    calls.push(String(url));
    return jsonResponse(200, { id: 're_123' });
  });
  try {
    const result = await sendEmailViaProviders(env, payload(), DATE_KEY);
    assert.equal(result.provider, 'resend');
    assert.equal(result.messageId, 're_123');
    assert.deepEqual(calls, ['https://api.resend.com/emails']);
    assert.equal(await env.NOTIFY_STATE.get(`emailq:resend:${DATE_KEY}`), '1');
  } finally {
    restore();
  }
});

test('resend 失败时降级到 brevo', async () => {
  const env = baseEnv({ RESEND_TOKEN: 're_test', BREVO_API_KEY: 'brevo_test' });
  const calls = [];
  const restore = mockFetch(async (url) => {
    calls.push(String(url));
    if (String(url).includes('resend')) return jsonResponse(500, { message: 'boom' });
    return new Response(JSON.stringify({ messageId: 'brevo-1' }), { status: 201 });
  });
  try {
    const result = await sendEmailViaProviders(env, payload(), DATE_KEY);
    assert.equal(result.provider, 'brevo');
    assert.equal(result.messageId, 'brevo-1');
    assert.deepEqual(calls, ['https://api.resend.com/emails', 'https://api.brevo.com/v3/smtp/email']);
    assert.equal(await env.NOTIFY_STATE.get('emailq:resend:2026-09-24'), null);
    assert.equal(await env.NOTIFY_STATE.get(`emailq:brevo:${DATE_KEY}`), '1');
  } finally {
    restore();
  }
});

test('429 会标记通道当日耗尽，后续直接跳过', async () => {
  const env = baseEnv({ RESEND_TOKEN: 're_test', BREVO_API_KEY: 'brevo_test' });
  const restore = mockFetch(async (url) => {
    if (String(url).includes('resend')) return jsonResponse(429, { message: 'rate limited' });
    return new Response(JSON.stringify({ messageId: 'brevo-1' }), { status: 201 });
  });
  try {
    await sendEmailViaProviders(env, payload(), DATE_KEY);
    assert.equal(await env.NOTIFY_STATE.get(`emailq:resend:${DATE_KEY}:exhausted`), '1');
    const providers = await resolveEmailProviders(env, DATE_KEY);
    assert.deepEqual(providers.map((p) => p.name), ['brevo', 'cloudflare']);
  } finally {
    restore();
  }
});

test('无 token 时只用 cloudflare 绑定', async () => {
  const env = baseEnv();
  const restore = mockFetch(async () => { throw new Error('must not call fetch'); });
  try {
    const result = await sendEmailViaProviders(env, payload(), DATE_KEY);
    assert.equal(result.provider, 'cloudflare');
    assert.equal(result.messageId, 'cf-1');
  } finally {
    restore();
  }
});

test('达到日上限的通道会被跳过', async () => {
  const env = baseEnv({ RESEND_TOKEN: 're_test', RESEND_DAILY_LIMIT: '2' });
  await env.NOTIFY_STATE.put(`emailq:resend:${DATE_KEY}`, '2');
  const providers = await resolveEmailProviders(env, DATE_KEY);
  assert.deepEqual(providers.map((p) => p.name), ['cloudflare']);
});

test('全部通道失败时抛合并错误', async () => {
  const env = baseEnv({ RESEND_TOKEN: 're_test', BREVO_API_KEY: 'brevo_test' });
  env.EMAIL = { send: async () => { throw new Error('cf down'); } };
  const restore = mockFetch(async () => jsonResponse(500, { message: 'nope' }));
  try {
    await assert.rejects(
      () => sendEmailViaProviders(env, payload(), DATE_KEY),
      /全部邮件通道发送失败/
    );
  } finally {
    restore();
  }
});

test('EMAIL_PROVIDER_ORDER 可覆盖优先级', async () => {
  const env = baseEnv({
    RESEND_TOKEN: 're_test',
    BREVO_API_KEY: 'brevo_test',
    EMAIL_PROVIDER_ORDER: 'cloudflare,resend'
  });
  assert.deepEqual(providerOrder(env), ['cloudflare', 'resend', 'brevo']);
  const restore = mockFetch(async () => { throw new Error('must not call fetch'); });
  try {
    const result = await sendEmailViaProviders(env, payload(), DATE_KEY);
    assert.equal(result.provider, 'cloudflare');
  } finally {
    restore();
  }
});

test('isProviderConfigured 按凭证/绑定判断', () => {
  assert.equal(isProviderConfigured(baseEnv(), 'resend'), false);
  assert.equal(isProviderConfigured(baseEnv({ RESEND_TOKEN: 'x' }), 'resend'), true);
  assert.equal(isProviderConfigured(baseEnv(), 'brevo'), false);
  assert.equal(isProviderConfigured(baseEnv({ BREVO_API_KEY: 'x' }), 'brevo'), true);
  assert.equal(isProviderConfigured(baseEnv(), 'cloudflare'), true);
  assert.equal(isProviderConfigured({ NOTIFY_STATE: fakeKV() }, 'cloudflare'), false);
});

test('dailyLimit 读取 env 覆盖与默认值', () => {
  assert.equal(dailyLimit({}, 'resend'), 100);
  assert.equal(dailyLimit({}, 'brevo'), 300);
  assert.equal(dailyLimit({}, 'cloudflare'), 200);
  assert.equal(dailyLimit({ RESEND_DAILY_LIMIT: '50' }, 'resend'), 50);
  assert.equal(dailyLimit({ RESEND_DAILY_LIMIT: '0' }, 'resend'), 100);
});
