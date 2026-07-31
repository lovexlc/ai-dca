import { useEffect, useState } from 'react';
import { apiUrl } from '../../app/apiBase.js';

export const SWITCH_COLLECTIONS_CACHE_KEY = 'aiDcaSwitchStrategyCollections_v1';
export const SWITCH_COLLECTIONS_CACHE_TTL_MS = 60_000;

const memoryCache = { value: null, expiresAt: 0 };
let inflightRequest = null;

function readCachedCollections(now = Date.now()) {
  if (memoryCache.value && memoryCache.expiresAt > now) return memoryCache.value;
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage?.getItem(SWITCH_COLLECTIONS_CACHE_KEY) || 'null');
    if (!parsed || Number(parsed.expiresAt) <= now || !Array.isArray(parsed.value)) return null;
    memoryCache.value = parsed.value;
    memoryCache.expiresAt = Number(parsed.expiresAt);
    return parsed.value;
  } catch {
    return null;
  }
}

function writeCachedCollections(value, now = Date.now()) {
  const expiresAt = now + SWITCH_COLLECTIONS_CACHE_TTL_MS;
  memoryCache.value = value;
  memoryCache.expiresAt = expiresAt;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(SWITCH_COLLECTIONS_CACHE_KEY, JSON.stringify({ value, expiresAt }));
  } catch {
    // Local persistence is best-effort only.
  }
}

export async function fetchSwitchStrategyCollections({ force = false } = {}) {
  if (!force) {
    const cached = readCachedCollections();
    if (cached) return cached;
  }
  if (inflightRequest) return inflightRequest;

  inflightRequest = fetch(apiUrl('/api/notify/switch/collections'), {
    headers: { accept: 'application/json' }
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      }
      const collections = Array.isArray(payload?.collections) ? payload.collections : [];
      writeCachedCollections(collections);
      return collections;
    })
    .finally(() => {
      inflightRequest = null;
    });

  return inflightRequest;
}

export function useSwitchStrategyCollections() {
  const cached = readCachedCollections();
  const [state, setState] = useState(() => ({
    collections: cached || [],
    loading: !cached,
    error: ''
  }));

  useEffect(() => {
    let active = true;
    const current = readCachedCollections();
    if (current) {
      setState({ collections: current, loading: false, error: '' });
      return () => { active = false; };
    }

    setState((previous) => ({ ...previous, loading: true, error: '' }));
    fetchSwitchStrategyCollections()
      .then((collections) => {
        if (active) setState({ collections, loading: false, error: '' });
      })
      .catch(() => {
        if (active) setState({ collections: [], loading: false, error: 'collections_unavailable' });
      });

    return () => { active = false; };
  }, []);

  return state;
}
