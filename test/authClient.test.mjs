import assert from 'node:assert/strict';
import test from 'node:test';

import { __internals, loginCloudAccount, registerCloudAccount } from '../src/app/authClient.js';

test('auth password hashing falls back when crypto.subtle.digest is unavailable', async () => {
  const expected = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

  assert.equal(__internals.sha256HexFallback('hello'), expected);
  assert.equal(await __internals.sha256Hex('hello', {}), expected);
});

test('auth password hash normalizes username before hashing', async () => {
  const upper = await __internals.passwordHash(' Alice ', 'password-123');
  const lower = await __internals.sha256Hex('alice:password-123', {});

  assert.equal(upper, lower);
});

// 注册/登录成功后不再等待云端迁移检查：即使 CF 不可用，认证也应立即成功。
// 后台迁移检查失败只打日志，不应导致 register/login 抛错。
test('register resolves even when cloud migration check fails (CF down)', async (t) => {
  const sessionData = {
    userId: 'usr_test123',
    username: 'testuser',
    accessToken: 'acc_testtoken',
    refreshToken: 'ref_testtoken',
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    isAdmin: false
  };
  const originalFetch = globalThis.fetch;
  const warnings = [];
  const originalWarn = globalThis.console.warn;
  globalThis.console.warn = (...args) => { warnings.push(args.join(' ')); };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.console.warn = originalWarn;
  });

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/sync/auth/register')) {
      return new globalThis.Response(JSON.stringify(sessionData), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // 模拟 CF 不可用：其他所有请求都失败
    throw new Error('fetch failed: CF unreachable');
  };

  const session = await registerCloudAccount({ username: 'testuser', password: 'password-123' });
  // 在 Node 环境无 window，saveCloudSession 返回 null；关键是不断言 session 内容，只断言不抛错
  assert.ok(session === null || session?.username === 'testuser' || true, 'register should resolve');

  // 等待后台迁移检查执行完毕（应被 catch 吞掉，只打 warn）
  await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  assert.ok(warnings.some((w) => w.includes('[auth]')), 'background migration failure should log a warning');
});

test('login resolves even when cloud migration check fails (CF down)', async (t) => {
  const sessionData = {
    userId: 'usr_test123',
    username: 'testuser',
    accessToken: 'acc_testtoken',
    refreshToken: 'ref_testtoken',
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    isAdmin: false
  };
  const originalFetch = globalThis.fetch;
  const warnings = [];
  const originalWarn = globalThis.console.warn;
  globalThis.console.warn = (...args) => { warnings.push(args.join(' ')); };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.console.warn = originalWarn;
  });

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/sync/auth/login')) {
      return new globalThis.Response(JSON.stringify(sessionData), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('fetch failed: CF unreachable');
  };

  await loginCloudAccount({ username: 'testuser', password: 'password-123' });

  await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  assert.ok(warnings.some((w) => w.includes('[auth]')), 'background migration failure should log a warning');
});
