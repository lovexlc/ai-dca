import { useEffect, useState } from 'react';
import { apiUrl } from '../../app/apiBase.js';
import { CLOUD_SYNC_SESSION_EVENT, loadCloudSession } from '../../app/authSession.js';
import { readNotifyClientConfig } from '../../app/notifySync.js';

export const PORTAL_SUMMARY_CACHE_KEY = 'aiDcaPortalSummaryPublic_v1';
export const PORTAL_SUMMARY_CACHE_TTL_MS = 60_000;

const memoryCache = new Map();
const inflightRequests = new Map();

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

export function normalizePortalSummary({ notify = {}, sync = {} } = {}) {
  return {
    scope: notify?.scope === 'personal' || sync?.scope === 'personal' ? 'personal' : 'public',
    configuredStrategyCount: finiteCount(notify?.configuredStrategyCount),
    notifiedStrategyCount: finiteCount(notify?.notifiedStrategyCount),
    todayTriggeredStrategyCount: finiteCount(sync?.todayTriggeredStrategyCount ?? sync?.strategyCount),
    todayTriggerCount: finiteCount(sync?.todayTriggerCount ?? sync?.triggerCount),
    generatedAt: String(sync?.generatedAt || notify?.generatedAt || '')
  };
}

export function readPortalSummaryIdentity() {
  const session = loadCloudSession();
  if (!session?.accessToken || !session?.username) {
    return { scope: 'public', key: 'public', session: null, clientId: '', clientSecret: '', username: '' };
  }
  const config = readNotifyClientConfig();
  const username = String(session.username || '').trim().toLowerCase();
  const clientId = String(config.notifyClientId || '').trim();
  return {
    scope: 'personal',
    key: `personal:${username}:${clientId}`,
    session,
    clientId,
    clientSecret: String(config.notifyClientSecret || '').trim(),
    username
  };
}

function storageKeyFor(identity) {
  return `${PORTAL_SUMMARY_CACHE_KEY}:${encodeURIComponent(identity?.key || 'public')}`;
}

function readLocalCache(identity, now = Date.now()) {
  const cacheKey = storageKeyFor(identity);
  const current = memoryCache.get(cacheKey);
  if (current && current.expiresAt > now) return current.value;
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(cacheKey) || 'null');
    if (!parsed || Number(parsed.expiresAt) <= now || !parsed.value) return null;
    memoryCache.set(cacheKey, parsed);
    return parsed.value;
  } catch {
    return null;
  }
}

function writeLocalCache(identity, value, now = Date.now()) {
  const cacheKey = storageKeyFor(identity);
  const entry = { value, expiresAt: now + PORTAL_SUMMARY_CACHE_TTL_MS };
  memoryCache.set(cacheKey, entry);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(cacheKey, JSON.stringify(entry));
  } catch {
    // A full or unavailable localStorage must not block the public summary.
  }
}

async function fetchJson(path, { query = {}, headers = {} } = {}) {
  const response = await fetch(apiUrl(path, query), {
    headers: { accept: 'application/json', ...headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function fetchPersonalPortalSummary(identity) {
  const notify = await fetchJson('/api/notify/switch/summary/personal', {
    query: { clientId: identity.clientId },
    headers: {
      'x-notify-client-secret': identity.clientSecret,
      'x-notify-account-username': identity.username
    }
  });
  try {
    const sync = await fetchJson('/api/sync/analytics/switch-today-summary', {
      query: {
        scope: 'personal',
        clientIds: Array.isArray(notify?.clientIds) ? notify.clientIds.join(',') : ''
      },
      headers: { authorization: `Bearer ${identity.session.accessToken}` }
    });
    return normalizePortalSummary({ notify, sync });
  } catch {
    return { ...normalizePortalSummary({ notify }), partial: true };
  }
}

async function fetchPublicPortalSummary() {
  const results = await Promise.allSettled([
    fetchJson('/api/notify/switch/summary'),
    fetchJson('/api/sync/analytics/switch-today-summary')
  ]);
  const notifyResult = results[0];
  const syncResult = results[1];
  const hasNotify = notifyResult.status === 'fulfilled';
  const hasSync = syncResult.status === 'fulfilled';
  if (!hasNotify && !hasSync) {
    throw notifyResult.reason || syncResult.reason || new Error('summary_unavailable');
  }
  const summary = normalizePortalSummary({
    notify: hasNotify ? notifyResult.value : {},
    sync: hasSync ? syncResult.value : {}
  });
  return hasNotify && hasSync ? summary : { ...summary, partial: true };
}

export async function fetchPortalSummary({ force = false, identity = readPortalSummaryIdentity() } = {}) {
  const cacheKey = storageKeyFor(identity);
  if (!force) {
    const cached = readLocalCache(identity);
    if (cached) return cached;
  }
  if (inflightRequests.has(cacheKey)) return inflightRequests.get(cacheKey);

  const request = (identity.scope === 'personal'
    ? fetchPersonalPortalSummary(identity)
    : fetchPublicPortalSummary())
    .then((summary) => {
      writeLocalCache(identity, summary);
      return summary;
    })
    .finally(() => {
      inflightRequests.delete(cacheKey);
    });

  inflightRequests.set(cacheKey, request);
  return request;
}

export function usePortalSummary() {
  const [identityKey, setIdentityKey] = useState(() => readPortalSummaryIdentity().key);
  const identity = readPortalSummaryIdentity();
  const cached = readLocalCache(identity);
  const [state, setState] = useState({
    data: cached,
    loading: !cached,
    error: cached?.partial ? 'summary_partial' : ''
  });

  useEffect(() => {
    const refreshIdentity = () => setIdentityKey(readPortalSummaryIdentity().key);
    window.addEventListener(CLOUD_SYNC_SESSION_EVENT, refreshIdentity);
    window.addEventListener('storage', refreshIdentity);
    return () => {
      window.removeEventListener(CLOUD_SYNC_SESSION_EVENT, refreshIdentity);
      window.removeEventListener('storage', refreshIdentity);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const currentIdentity = readPortalSummaryIdentity();
    const current = readLocalCache(currentIdentity);
    if (current) setState({ data: current, loading: false, error: current.partial ? 'summary_partial' : '' });
    else setState((previous) => ({ ...previous, loading: true, error: '' }));

    fetchPortalSummary({ identity: currentIdentity })
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: data?.partial ? 'summary_partial' : '' });
      })
      .catch(() => {
        if (!cancelled) setState((previous) => ({ ...previous, loading: false, error: 'summary_unavailable' }));
      });

    return () => { cancelled = true; };
  }, [identityKey]);

  return state;
}
