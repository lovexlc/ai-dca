const DEFAULT_NOTIFY_PUSH_GRAY_ACCOUNTS = ['lovexl'];

export function normalizeNotifyAccountUsername(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 48);
}

function parseAccountList(value = '') {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveNotifyPushGrayAccounts(env = {}) {
  const configured = parseAccountList(
    env.NOTIFY_PUSH_GRAY_ACCOUNTS
      || env.NOTIFY_PUSH_ACCOUNT_ALLOWLIST
      || env.NOTIFY_PUSH_ALLOWLIST
      || ''
  );
  const accounts = configured.length ? configured : DEFAULT_NOTIFY_PUSH_GRAY_ACCOUNTS;
  return new Set(accounts.map((account) => account === '*' ? '*' : normalizeNotifyAccountUsername(account)).filter(Boolean));
}

function normalizeIdentity(value = '') {
  return String(value || '').trim().toLowerCase();
}

function identityMatchesAccount(identity = '', account = '') {
  const normalizedIdentity = normalizeIdentity(identity);
  const normalizedAccount = normalizeNotifyAccountUsername(account);
  if (!normalizedIdentity || !normalizedAccount) return false;
  return normalizedIdentity === normalizedAccount
    || normalizedIdentity.startsWith(`${normalizedAccount}-`)
    || normalizedIdentity.startsWith(`${normalizedAccount}:`)
    || normalizedIdentity.startsWith(`${normalizedAccount}_`);
}

export function isNotifyPushAllowed(env = {}, settings = {}) {
  const grayAccounts = resolveNotifyPushGrayAccounts(env);
  if (grayAccounts.has('*')) return true;

  const accountUsername = normalizeNotifyAccountUsername(settings.accountUsername || settings.username || '');
  if (accountUsername) {
    return grayAccounts.has(accountUsername);
  }

  const fallbackIdentities = [
    settings.clientLabel,
    settings.clientId,
    env.__notifyCurrentClientId
  ];
  for (const account of grayAccounts) {
    if (fallbackIdentities.some((identity) => identityMatchesAccount(identity, account))) {
      return true;
    }
  }
  return false;
}
