export const VERIFIED_NOTIFY_USER_ID_HEADER = 'x-notify-verified-user-id';
export const VERIFIED_NOTIFY_USERNAME_HEADER = 'x-notify-verified-username';

const PROTECTED_NOTIFY_ROUTES = new Set([
  'GET /api/notify/email/status', 'POST /api/notify/email/send-code', 'POST /api/notify/email/verify',
  'POST /api/notify/email/save', 'POST /api/notify/email/disable', 'POST /api/notify/email/enable',
  'POST /api/notify/ws/register', 'POST /api/notify/ws/unregister',
  'GET /api/notify/status', 'GET /api/notify/status/summary', 'GET /api/notify/status/details',
  'GET /api/notify/events', 'POST /api/notify/sync', 'POST /api/notify/test',
  'POST /api/notify/settings', 'DELETE /api/notify/settings',
  'GET /api/notify/holdings-rule', 'POST /api/notify/holdings-rule',
  'GET /api/notify/switch/config', 'POST /api/notify/switch/config',
  'GET /api/notify/switch/snapshot', 'POST /api/notify/switch/run', 'GET /api/notify/switch/test-nav'
]);
const AUTH_CACHE_TTL_MS = 60_000;
const AUTH_CACHE_MAX = 256;
const authCache = new Map();
const authInflight = new Map();

export class NotifyAccountAuthError extends Error {
  constructor(message, status = 401, code = 'AUTH_REQUIRED') { super(message); this.name = 'NotifyAccountAuthError'; this.status = status; this.code = code; }
}
function normalizeUserId(value = '') { return String(value || '').trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 96); }
function normalizeUsername(value = '') { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 48); }
export function readVerifiedNotifyAccount(request) {
  const userId = normalizeUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER));
  const username = normalizeUsername(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER));
  if (!userId || !username) throw new NotifyAccountAuthError('请先登录账户后配置通知。', 401, 'AUTH_REQUIRED');
  return { userId, username };
}
async function sha256Hex(value = '') { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || ''))); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''); }
function readBearerToken(request) { const match = String(request.headers.get('authorization') || '').trim().match(/^Bearer\s+(.+)$/i); return match ? match[1].trim() : ''; }
export function requiresNotifyAccountAuth(request) {
  const url = new URL(request.url); const routeKey = `${String(request.method || 'GET').toUpperCase()} ${url.pathname}`;
  if (PROTECTED_NOTIFY_ROUTES.has(routeKey)) return true;
  if (routeKey === 'POST /api/notify/run') return Boolean(url.searchParams.get('clientId'));
  return false;
}
function cacheAuth(tokenHash, user) {
  if (authCache.size >= AUTH_CACHE_MAX) authCache.delete(authCache.keys().next().value);
  authCache.set(tokenHash, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  return user;
}
async function loadAuthenticatedUser(env, tokenHash) {
  const cached = authCache.get(tokenHash);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  if (cached) authCache.delete(tokenHash);
  const pending = authInflight.get(tokenHash);
  if (pending) return pending;
  const query = env.SYNC_DB.prepare(`SELECT users.id AS userId, users.username AS username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).bind(tokenHash, new Date().toISOString()).first()
    .then((row) => cacheAuth(tokenHash, { userId: normalizeUserId(row?.userId), username: normalizeUsername(row?.username) }))
    .finally(() => authInflight.delete(tokenHash));
  authInflight.set(tokenHash, query);
  return query;
}
export async function authenticateNotifyAccountRequest(request, env) {
  const token = readBearerToken(request);
  if (!token) throw new NotifyAccountAuthError('请先登录账户后配置通知。', 401, 'AUTH_REQUIRED');
  if (!env?.SYNC_DB) throw new NotifyAccountAuthError('通知账户鉴权服务暂不可用。', 503, 'AUTH_UNAVAILABLE');
  const tokenHash = await sha256Hex(token);
  const user = await loadAuthenticatedUser(env, tokenHash);
  if (!user.userId || !user.username) throw new NotifyAccountAuthError('登录状态已失效，请重新登录后再试。', 401, 'AUTH_INVALID');
  const headers = new Headers(request.headers);
  headers.delete('x-notify-account-username'); headers.delete(VERIFIED_NOTIFY_USER_ID_HEADER); headers.delete(VERIFIED_NOTIFY_USERNAME_HEADER);
  headers.set(VERIFIED_NOTIFY_USER_ID_HEADER, user.userId); headers.set(VERIFIED_NOTIFY_USERNAME_HEADER, user.username);
  return new Request(request, { headers });
}
