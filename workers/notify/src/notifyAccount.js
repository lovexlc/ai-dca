export function normalizeNotifyAccountUsername(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 48);
}
