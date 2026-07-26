const DB_NAME = 'aiDcaMarketHistory';
const DB_VERSION = 2;
const STORE_NAME = 'history';
const MAX_RECORDS = 300;
const CACHE_SCHEMA_VERSION = 3;

const CACHE_STATUS = Object.freeze({ FRESH: 'fresh', DELAYED: 'delayed', STALE: 'stale', MISS: 'miss' });
const DAILY_VALID_MS = 24 * 3600 * 1000;
const DAILY_STALE_MS = 7 * 24 * 3600 * 1000;
const INTRADAY_VALID_MS = 60 * 1000;
const INTRADAY_STALE_MS = 24 * 3600 * 1000;
const VALID_KLINE_SOURCES = new Set([
  'r2-batch', 'r2-cache', 'r2-fallback', 'realtime', 'markets-worker', 'markets-kline'
]);

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function cacheKey({ type = 'kline', symbol = '', timeframe = '1d' } = {}) {
  return `${type}|${String(symbol || '').trim()}|${String(timeframe || '1d').trim()}`;
}

async function idbGet(key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE_NAME, 'readonly');
    } catch {
      resolve(null);
      return;
    }
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function idbPut(record) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE_NAME, 'readwrite');
    } catch {
      resolve(false);
      return;
    }
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

async function trimCache() {
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE_NAME, 'readwrite');
    } catch {
      resolve();
      return;
    }
    const store = tx.objectStore(STORE_NAME);
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result <= MAX_RECORDS) {
        resolve();
        return;
      }
      const rows = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur) {
          rows.sort((a, b) => b.storedAt - a.storedAt);
          for (const row of rows.slice(MAX_RECORDS)) store.delete(row.key);
          return;
        }
        rows.push({ key: cur.key, storedAt: cur.value?.storedAt || 0 });
        cur.continue();
      };
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

function normalizeDate(value = '') {
  const date = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function shanghaiDateFromEpochSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date(n * 1000 + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

function normalizeCandles(candles = []) {
  const byTimestamp = new Map();
  for (const raw of Array.isArray(candles) ? candles : []) {
    const t = Number(raw?.t ?? raw?.timestamp ?? 0);
    const date = normalizeDate(raw?.date || raw?.day) || shanghaiDateFromEpochSec(t);
    if (!date) continue;
    // Intraday series contain many candles per date. Deduplicate only identical
    // timestamps so a 5m cache does not collapse into one candle per day.
    const key = Number.isFinite(t) && t > 0 ? `t:${t}` : `d:${date}`;
    byTimestamp.set(key, { ...raw, t, date });
  }
  return Array.from(byTimestamp.values()).sort((a, b) => a.date.localeCompare(b.date) || Number(a.t) - Number(b.t));
}

function isIntradayTimeframe(timeframe = '') {
  return /^(1m|5m|15m|30m|60m)(?:\||$)/.test(String(timeframe || '').trim());
}

function resolveLocalCacheStatus(record, { now = Date.now(), allowStale = false } = {}) {
  if (!record || record.schemaVersion !== CACHE_SCHEMA_VERSION) {
    return allowStale && record?.candles?.length ? CACHE_STATUS.STALE : CACHE_STATUS.MISS;
  }
  const source = String(record.source || record.payload?.source || '').trim();
  if (!source || source === 'eastmoney-direct' || !VALID_KLINE_SOURCES.has(source)) return CACHE_STATUS.MISS;
  const validUntil = Date.parse(String(record.validUntil || ''));
  const staleUntil = Date.parse(String(record.staleUntil || ''));
  if (!Number.isFinite(validUntil) || !Number.isFinite(staleUntil) || Number(now) > staleUntil) return CACHE_STATUS.MISS;
  if (Number(now) <= validUntil) return CACHE_STATUS.FRESH;
  return allowStale ? CACHE_STATUS.STALE : CACHE_STATUS.MISS;
}

function coversRange(candles = [], startDate = '', endDate = '', { minCandles = 0 } = {}) {
  if (!Array.isArray(candles) || !candles.length) return false;
  const requiredCount = Number(minCandles);
  if (Number.isFinite(requiredCount) && requiredCount > 0 && candles.length < requiredCount) return false;
  const first = candles[0]?.date;
  const last = candles[candles.length - 1]?.date;
  return Boolean(first && last && (!startDate || first <= startDate) && (!endDate || last >= endDate));
}

export async function readCachedKline({ symbol, timeframe = '1d', startDate = '', endDate = '', minCandles = 0, allowStale = false, now = Date.now() } = {}) {
  const key = cacheKey({ type: 'kline', symbol, timeframe });
  const record = await idbGet(key).catch(() => null);
  const dataSource = String(record?.payload?.source || record?.source || '').trim();
  // Ignore browser-side Eastmoney candles left by the old direct-source path.
  // The markets page now uses the markets Worker as its only K-line source.
  if (dataSource === 'eastmoney-direct') return null;
  const candles = normalizeCandles(record?.candles || []);
  if (!coversRange(candles, startDate, endDate, { minCandles })) return null;
  const status = resolveLocalCacheStatus({ ...record, candles }, { now, allowStale });
  if (status === CACHE_STATUS.MISS) return null;
  return {
    ...record?.payload,
    candles,
    dataSource,
    cached: true,
    source: 'indexeddb',
    cache: { hit: true, source: 'indexeddb', stale: status === CACHE_STATUS.STALE, status },
    cacheStatus: status
  };
}

export async function writeCachedKline({ symbol, timeframe = '1d', payload = {} } = {}) {
  const candles = normalizeCandles(payload?.candles || payload?.bars || []);
  if (!symbol || !candles.length) return false;
  const key = cacheKey({ type: 'kline', symbol, timeframe });
  const storedAt = Date.now();
  const source = String(payload?.source || '').trim();
  if (!source || source === 'eastmoney-direct' || !VALID_KLINE_SOURCES.has(source)) return false;
  const isIntraday = isIntradayTimeframe(timeframe);
  const generatedAt = Date.parse(String(payload?.generatedAt || ''));
  const fetchedAt = Number.isFinite(generatedAt) ? generatedAt : storedAt;
  const validMs = isIntraday ? INTRADAY_VALID_MS : DAILY_VALID_MS;
  const staleMs = isIntraday ? INTRADAY_STALE_MS : DAILY_STALE_MS;
  const ok = await idbPut({
    key,
    type: 'kline',
    symbol: String(symbol || '').trim(),
    timeframe: String(timeframe || '1d').trim(),
    schemaVersion: CACHE_SCHEMA_VERSION,
    source,
    fetchedAt: new Date(fetchedAt).toISOString(),
    asOf: candles.at(-1)?.date || '',
    validUntil: new Date(fetchedAt + validMs).toISOString(),
    staleUntil: new Date(fetchedAt + staleMs).toISOString(),
    candles,
    payload: { ...payload, candles },
    storedAt
  }).catch(() => false);
  Promise.resolve().then(() => trimCache().catch(() => {}));
  return ok;
}

export async function clearMarketHistoryCache() {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE_NAME, 'readwrite');
    } catch {
      resolve(false);
      return;
    }
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export const __internals = {
  cacheKey,
  normalizeCandles,
  coversRange,
  isIntradayTimeframe,
  resolveLocalCacheStatus,
  CACHE_STATUS,
  CACHE_SCHEMA_VERSION,
  DB_NAME,
  STORE_NAME
};
