import test from 'node:test';
import assert from 'node:assert/strict';

import { SECURE_VAULT_ERROR_CODES } from '../src/app/secureVault.js';
import { requiresSecurityPassword } from '../src/app/secureSyncErrors.js';

test('secure sync exposes a password prompt for all unlock-related errors', () => {
  assert.equal(requiresSecurityPassword({ code: SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD }), true);
  assert.equal(requiresSecurityPassword({ code: SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY }), true);
  assert.equal(requiresSecurityPassword({ code: 'SECURITY_PASSWORD_REQUIRED' }), true);
  assert.equal(requiresSecurityPassword({ code: SECURE_VAULT_ERROR_CODES.CORRUPTED }), false);
  assert.equal(requiresSecurityPassword({ code: 'OFFLINE' }), false);
});
