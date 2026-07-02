import assert from 'node:assert/strict';
import test from 'node:test';

import { __internals } from '../src/app/authClient.js';

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
