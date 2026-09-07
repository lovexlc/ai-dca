import { REMOTE_DATA_KEYS, exchangeRemoteSession, importLegacyRemoteRecords, loadRemoteBootstrap, logoutRemoteSession, writeRemoteRecords } from './remoteUserData.js';
import { CLOUD_SYNC_SESSION_EVENT, hydrateCloudSession, loadCloudSession } from './authSession.js';

const remoteKeys = new Set(REMOTE_DATA_KEYS);
const storage = typeof window !== 'undefined' ? window.localStorage : null;
const native = typeof Storage !== 'undefined' ? {
  getItem: Storage.prototype.getItem,
  setItem: Storage.prototype.setItem,
  removeItem: Storage.prototype.removeItem,
  clear: Storage.prototype.clear,
  key: Storage.prototype.key
} : null;
let installed = false;
let ready = false;
let authenticated = false;
let token = '';
let userId = '';
let values = new Map();
let revisions = new Map();
let pending = new Map();
let timer = null;
let flushPromise = null;
let bootstrapPromise = null;
const isRemoteKey = (key) => remoteKeys.has(String(key || ''));
const isLocal = (target) => Boolean(storage && target === storage);
const emit = (name, detail = {}) => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail })); };
function legacy(key) { try { return native.getItem.call(storage, key); } catch { return null; } }
function legacyRecords() { return REMOTE_DATA_KEYS.map((key) => ({ key, value: legacy(key), baseRevision: 0 })).filter((row) => row.value !== null && row.value !== ''); }
function install() {
  if (installed || !storage || !native || typeof Storage === 'undefined') return;
  installed = true;
  Storage.prototype.getItem = function getItem(key) { return isLocal(this) && ready && isRemoteKey(key) ? (values.has(String(key)) ? values.get(String(key)) : null) : native.getItem.call(this, key); };
  Storage.prototype.setItem = function setItem(key, value) { if (!(isLocal(this) && ready && isRemoteKey(key))) return native.setItem.call(this, key, value); const name = String(key); const row = { key: name, value: String(value), baseRevision: pending.get(name)?.baseRevision ?? revisions.get(name) ?? 0 }; values.set(name, row.value); pending.set(name, row); emit('ai-dca:data-changed', { key: name, remote: true }); schedule(); };
  Storage.prototype.removeItem = function removeItem(key) { if (!(isLocal(this) && ready && isRemoteKey(key))) return native.removeItem.call(this, key); const name = String(key); const row = { key: name, value: null, baseRevision: pending.get(name)?.baseRevision ?? revisions.get(name) ?? 0 }; values.delete(name); pending.set(name, row); emit('ai-dca:data-changed', { key: name, remote: true }); schedule(); };
  Storage.prototype.clear = function clear() { if (!(isLocal(this) && ready)) return native.clear.call(this); for (const key of REMOTE_DATA_KEYS) if (values.has(key)) this.removeItem(key); };
  Storage.prototype.key = function key(index) { if (!(isLocal(this) && ready)) return native.key.call(this, index); const keys = []; for (let i = 0; i < storage.length; i += 1) { const name = native.key.call(this, i); if (name && !isRemoteKey(name)) keys.push(name); } return keys.concat(Array.from(values.keys()))[Number(index)] || null; };
  try { Object.defineProperty(Storage.prototype, 'length', { configurable: true, get() { if (!(isLocal(this) && ready)) return storage.length; let count = 0; for (let i = 0; i < storage.length; i += 1) { const name = native.key.call(this, i); if (name && !isRemoteKey(name)) count += 1; } return count + values.size; } }); } catch { /* browser may expose non-configurable length */ }
  window.addEventListener(CLOUD_SYNC_SESSION_EVENT, (event) => { const session = event?.detail?.session; if (!session) { const had = authenticated; resetRemoteStorage(); if (had) void logoutRemoteSession(); return; } if (session.accessToken && !authenticated) void bootstrapRemoteStorage({ token: session.accessToken, reloadAfterHydration: true }).catch((error) => emit('remote-data:error', { error })); });
  window.addEventListener('pagehide', () => { void flushRemoteUserData(); });
}
function schedule() { if (!timer && authenticated) timer = setTimeout(() => { timer = null; void flushRemoteUserData().catch(() => {}); }, 450); }
function hydrate(records = []) { values = new Map(); revisions = new Map(); for (const row of records) { const key = String(row?.key || ''); if (!isRemoteKey(key) || row?.value == null) continue; values.set(key, String(row.value)); revisions.set(key, Number(row.revision) || 0); } ready = true; emit('remote-data:hydrated', { userId, keys: Array.from(values.keys()) }); }
export async function flushRemoteUserData() { if (!authenticated || !pending.size) return { skipped: true }; if (flushPromise) return flushPromise; const batch = Array.from(pending.values()); batch.forEach((row) => pending.delete(row.key)); flushPromise = writeRemoteRecords(batch, { token, mutationId: `web:${Date.now()}` }).then((result) => { (result.records || batch).forEach((row) => { if (row.value == null) values.delete(row.key); else values.set(row.key, String(row.value)); revisions.set(row.key, Number(row.revision) || 0); }); return result; }).catch((error) => { batch.forEach((row) => { if (!pending.has(row.key)) pending.set(row.key, row); }); emit('remote-data:error', { error }); throw error; }).finally(() => { flushPromise = null; if (pending.size) schedule(); }); return flushPromise; }
export function resetRemoteStorage() { ready = false; authenticated = false; token = ''; userId = ''; values = new Map(); revisions = new Map(); pending.clear(); if (timer) clearTimeout(timer); timer = null; emit('remote-data:reset'); }
export function isRemoteStorageReady() { return ready && authenticated; }
export async function bootstrapRemoteStorage({ token: requestedToken = '', reloadAfterHydration = false } = {}) { install(); if (bootstrapPromise) return bootstrapPromise; bootstrapPromise = (async () => { let session = loadCloudSession(); let data; const accessToken = String(requestedToken || session?.accessToken || '').trim(); if (accessToken) { try { await exchangeRemoteSession({ accessToken }); } catch (error) { if (error?.status !== 401) throw error; } try { data = await loadRemoteBootstrap({ token: accessToken }); } catch (error) { if (error?.status !== 401) throw error; data = await loadRemoteBootstrap(); } } else { try { data = await loadRemoteBootstrap(); } catch (error) { if (error?.status === 401) { resetRemoteStorage(); return { authenticated: false, ready: false }; } throw error; } } session = data?.user || session; if (!session?.userId && !session?.id) { resetRemoteStorage(); return { authenticated: false, ready: false }; } userId = String(session.userId || session.id); token = accessToken; authenticated = true; hydrateCloudSession({ userId, username: String(session.username || ''), accessToken: token, isAdmin: Boolean(session.isAdmin), cookieSession: !token }); const old = legacyRecords(); let migrated = false; if (!data.initialized && !data.records?.length && old.length) { await importLegacyRemoteRecords(old, { token, mutationId: `legacy:${userId}` }); data = await loadRemoteBootstrap({ token }); migrated = true; } hydrate(data?.records || []); if (reloadAfterHydration && typeof window !== 'undefined') setTimeout(() => window.location.reload(), 0); return { authenticated: true, ready: true, migratedLegacy: migrated }; })(); try { return await bootstrapPromise; } finally { bootstrapPromise = null; } }
install();
