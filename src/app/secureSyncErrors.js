import { SECURE_VAULT_ERROR_CODES } from './secureVault.js';

const SECURITY_PASSWORD_ERROR_CODES = new Set([
  'SECURITY_PASSWORD_REQUIRED',
  SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD,
  SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY
]);

export function requiresSecurityPassword(error) {
  const code = String(error?.code || error?.data?.code || '');
  return SECURITY_PASSWORD_ERROR_CODES.has(code);
}
