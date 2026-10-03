import assert from 'node:assert/strict';
import test from 'node:test';

// 浏览器环境替身：saveCloudSession / 协调器事件都依赖 window。
class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }
  setItem(key, value) {
    this.values.set(String(key), String(value));
  }
  removeItem(key) {
    this.values.delete(String(key));
  }
}

function installWindow() {
  const listeners = new Map();
  const events = [];
  const storage = new MemoryStorage();
  globalThis.window = {
    localStorage: storage,
    Storage: MemoryStorage,
    location: { origin: 'http://localhost', hostname: 'localhost', pathname: '/', search: '', hash: '' },
    navigator: {},
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatchEvent(event) {
      events.push(event);
      for (const fn of listeners.get(event.type) ?? []) fn(event);
      return true;
    }
  };
  // trackAnalyticsEvent 读取裸全局 document.referrer；Node 环境下需要替身。
  if (typeof globalThis.document === 'undefined') globalThis.document = { referrer: '' };
  return { storage, events };
}

const sessionData = {
  userId: 'usr_test123',
  username: 'testuser',
  accessToken: 'acc_testtoken',
  refreshToken: 'ref_testtoken',
  expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  isAdmin: false
};

test('auth password hashing falls back when crypto.subtle.digest is unavailable', async () => {
  const { __internals } = await import('../src/app/authClient.js');
  const expected = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

  assert.equal(__internals.sha256HexFallback('hello'), expected);
  assert.equal(await __internals.sha256Hex('hello', {}), expected);
});

test('auth password hash normalizes username before hashing', async () => {
  const { __internals } = await import('../src/app/authClient.js');
  const upper = await __internals.passwordHash(' Alice ', 'password-123');
  const lower = await __internals.sha256Hex('alice:password-123', {});

  assert.equal(upper, lower);
});

test('requestSync aborts with AUTH_TIMEOUT after the bounded timeout', async () => {
  const { __internals } = await import('../src/app/authClient.js');
  const originalFetch = globalThis.fetch;
  // 永不返回的认证服务：真实 fetch 会在 signal abort 时 reject，mock 也必须如此，否则测试会永久挂起。
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal.reason || new DOMException('Aborted', 'AbortError')), { once: true });
  });
  try {
    await assert.rejects(
      __internals.requestSync('/auth/login', { method: 'POST', timeoutMs: 40, body: '{}' }),
      (error) => {
        assert.equal(error.code, 'AUTH_TIMEOUT');
        assert.match(error.message, /超时/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requestSync wraps network failure with AUTH_NETWORK_ERROR', async () => {
  const { __internals } = await import('../src/app/authClient.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    await assert.rejects(
      __internals.requestSync('/auth/login', { method: 'POST', body: '{}' }),
      (error) => {
        assert.equal(error.code, 'AUTH_NETWORK_ERROR');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requestSync surfaces 401 with status for wrong credentials', async () => {
  const { __internals } = await import('../src/app/authClient.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: '用户名或密码不正确' }), { status: 401 });
  try {
    await assert.rejects(
      __internals.requestSync('/auth/login', { method: 'POST', body: '{}' }),
      (error) => {
        assert.equal(error.status, 401);
        assert.equal(error.message, '用户名或密码不正确');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('login rejects a 2xx response without a valid session shape and saves nothing', async () => {
  installWindow();
  const { loginCloudAccount } = await import('../src/app/authClient.js');
  const { loadCloudSession } = await import('../src/app/authSession.js');
  const originalFetch = globalThis.fetch;
  // 异常 2xx：网关返回 HTML 而非 JSON session。
  globalThis.fetch = async () => new Response('<html>login page</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  try {
    await assert.rejects(
      loginCloudAccount({ username: 'testuser', password: 'password-123' }),
      (error) => {
        assert.equal(error.code, 'AUTH_INVALID_RESPONSE');
        return true;
      }
    );
    assert.equal(loadCloudSession(), null, '异常 2xx 绝不能保存 session');
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.window;
  }
});

test('register rejects a 200 response missing accessToken', async () => {
  installWindow();
  const { registerCloudAccount } = await import('../src/app/authClient.js');
  const { loadCloudSession } = await import('../src/app/authSession.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ userId: 'usr_x', username: 'testuser' }), { status: 200 });
  try {
    await assert.rejects(
      registerCloudAccount({ username: 'testuser', password: 'password-123' }),
      (error) => {
        assert.equal(error.code, 'AUTH_INVALID_RESPONSE');
        return true;
      }
    );
    assert.equal(loadCloudSession(), null);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.window;
  }
});

// 认证结果与同步结果分离：注册成功即使 CF 完全不可用也必须完成登录态保存，
// 后台迁移/首次同步失败只通过 cloud-sync 事件报告，绝不把注册变失败。
test('register completes login UI state even when the cloud is fully unreachable', async () => {
  const { storage, events } = installWindow();
  const { registerCloudAccount } = await import('../src/app/authClient.js');
  const { loadCloudSession } = await import('../src/app/authSession.js');
  const originalFetch = globalThis.fetch;
  const warnings = [];
  const originalWarn = globalThis.console.warn;
  globalThis.console.warn = (...args) => { warnings.push(args.join(' ')); };
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/sync/auth/register')) {
      return new Response(JSON.stringify(sessionData), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // 模拟 CF 不可用：迁移检查等所有后续请求全部失败。
    throw new Error('fetch failed: CF unreachable');
  };
  try {
    const session = await registerCloudAccount({ username: 'testuser', password: 'password-123' });
    assert.equal(session?.username, 'testuser');
    assert.equal(loadCloudSession()?.accessToken, 'acc_testtoken', '注册成功必须立即保存 session，不等云同步');
    assert.equal(JSON.parse(storage.values.get('aiDcaCloudSyncSession')).username, 'testuser');

    // 等待后台协调器结束：迁移检查失败只报同步状态，不改写登录结果。
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(warnings.some((w) => w.includes('[post-auth-sync]')), '同步失败应留下可诊断日志');
    const syncError = events.find((event) => event.type === 'cloud-sync:auto-error');
    assert.ok(syncError, '同步失败应通过 cloud-sync:auto-error 事件上报');
    assert.equal(loadCloudSession()?.username, 'testuser', '同步失败不能登出用户');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.console.warn = originalWarn;
    delete globalThis.window;
  }
});

test('login resolves and session survives a later cloud migration outage', async () => {
  const { events } = installWindow();
  const { loginCloudAccount } = await import('../src/app/authClient.js');
  const { loadCloudSession } = await import('../src/app/authSession.js');
  const originalFetch = globalThis.fetch;
  const originalWarn = globalThis.console.warn;
  const warnings = [];
  globalThis.console.warn = (...args) => { warnings.push(args.join(' ')); };
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/sync/auth/login')) {
      return new Response(JSON.stringify(sessionData), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('fetch failed: CF unreachable');
  };
  try {
    const session = await loginCloudAccount({ username: 'testuser', password: 'password-123' });
    assert.equal(session?.username, 'testuser');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(loadCloudSession()?.username, 'testuser');
    assert.ok(events.some((event) => event.type === 'cloud-sync:auto-error' || event.type === 'cloud-sync:preparing'));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.console.warn = originalWarn;
    delete globalThis.window;
  }
});

test('login surfaces a 401 as an auth error, not a sync error', async () => {
  installWindow();
  const { loginCloudAccount } = await import('../src/app/authClient.js');
  const { loadCloudSession } = await import('../src/app/authSession.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: '用户名或密码不正确' }), { status: 401 });
  try {
    await assert.rejects(
      loginCloudAccount({ username: 'testuser', password: 'wrong-password' }),
      (error) => {
        assert.equal(error.status, 401);
        assert.equal(error.message, '用户名或密码不正确');
        return true;
      }
    );
    assert.equal(loadCloudSession(), null, '密码错误绝不能保存 session');
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.window;
  }
});
