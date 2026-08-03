import assert from 'node:assert/strict';
import test from 'node:test';

import { __internals } from '../src/app/authClient.js';

test('login credential uses PBKDF2 and is deterministic for the same salt', async () => {
  const first = await __internals.deriveLoginCredential('password-123', 'client-salt', 1000);
  const second = await __internals.deriveLoginCredential('password-123', 'client-salt', 1000);
  const differentSalt = await __internals.deriveLoginCredential('password-123', 'other-salt', 1000);

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, differentSalt);
});

test('login credential never equals the old username-password hash shape', async () => {
  const credential = await __internals.deriveLoginCredential('password-123', 'client-salt', 1000);
  assert.notEqual(credential, 'alice:password-123');
});
