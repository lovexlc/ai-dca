export function isTestHostname(hostname = '') {
  const value = String(hostname || '').trim().toLowerCase();
  return value === 'test.freebacktrack.tech' || value.startsWith('test.');
}

export function isTestEnvironment() {
  if (typeof document !== 'undefined' && document.documentElement?.dataset?.environment === 'test') {
    return true;
  }
  if (typeof window === 'undefined') return false;
  return isTestHostname(window.location.hostname);
}
