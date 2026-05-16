// navHistoryClient.js
//
// 收益看板按区间拉取「单只基金日级 NAV 序列」的统一客户端。
//
// 两层缓存：
//   L1 内存：Map<key, Promise>，同步去重 in-flight 请求（避免 React 多组件并发触发同一拉取）。
//   L2 IndexedDB：DB "aiDcaNavHistory" → store "navHistory"，key = `${code}|${from}|${to}`。
//
// 命中条件：现在时间 < expiresAt - 60s（留 1 分钟安全余量，让 Worker 端 TTL 占主导）。
// Worker 那边已经分了「纯历史段 24h / 含今天动态 TTL」，前端直接信任 Worker 给的 expiresAt。
//
// API：
//   fetchNavHistory({ code, from?, to?, days?, forceLive? }) → Promise<{ items, generatedAt, expiresAt, cache, stale? }>
//   - 单只基金一段区间。多只基金请由调用方 fan-out（Promise.all）。
//   - 失败降级：网络/Worker 出错时，若 IndexedDB 有任意（哪怕过期）历史数据，回退它并标 stale:true。
//   - forceLive=true 跳过 L2 并向 Worker 加 ?force=1。
//
// 这个文件刻意不依赖业务计算（Modified Dietz 等），只负责「拉一段 NAV 序列」。
// 计算逻辑放在 portfolioSeries.js（下一刀）。

const NAV_HISTORY_ENDPOINT = '/api/holdings/nav-history';
const DB_NAME = 'aiDcaNavHistory';
const DB_VERSION = 1;
const STORE_NAME = 'navHistory';
const FRESH_MARGIN_MS = 60 * 1000; // 1 分钟安全余量
const DEFAULT_DAYS = 365;
const MAX_DAYS = 3650;

// L1：进程内 in-flight 去重
const inflight = new Map();

function makeCacheKey(code, from, to) {
  return `${code}|${from}|${to}`;
}

function todayIsoDateShanghai() {
  // 用 sv-SE locale 在 Asia/Shanghai 时区拿 YYYY-MM-DD（最简洁、零依赖）。
  try {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch (_e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function shiftIsoDateDays(isoDate, deltaDays) {
  const [y, m, d] = String(isoDate).split('-').map((n) => Number(n));
  if (!y || !m || !d) return isoDate;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function isValidIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normalizeArgs({ code, from, to, days, forceLive }) {
  const rawCode = String(code || '').trim();
  if (!/^\d{6}$/.test(rawCode)) {
    throw new Error('navHistoryClient: code 必须是 6 位数字基金代码。');
  }
  const today = todayIsoDateShanghai();
  const toDate = isValidIsoDate(to) ? to : today;
  let fromDate;
  if (isValidIsoDate(from)) {
    fromDate = from;
  } else {
    const daysNum = Math.max(1, Math.min(Number(days) || DEFAULT_DAYS, MAX_DAYS));
    fromDate = shiftIsoDateDays(toDate, -daysNum);
  }
  if (fromDate > toDate) {
    throw new Error('navHistoryClient: from 必须早于或等于 to。');
  }
  return { code: rawCode, from: fromDate, to: toDate, forceLive: forceLive === true };
}

// ---------------------------------------------------------------------------
// IndexedDB 适配层：所有调用都封装 Promise + try/catch，浏览器隐身/磁盘满时静默降级到
// 「只走内存 + Worker 边缘缓存」模式，绝不让缓存层把上层流程拖死。
// ---------------------------------------------------------------------------

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (_e) {
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

function idbGet(key) {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(STORE_NAME, 'readonly');
      } catch (_e) {
        resolve(null);
        return;
      }
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  });
}

function idbPut(record) {
  return openDb().then((db) => {
    if (!db) return false;
    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(STORE_NAME, 'readwrite');
      } catch (_e) {
        resolve(false);
        return;
      }
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  });
}

async function idbClearExpired(maxRecords = 200) {
  // 简易清理：保留 maxRecords 条最新的（按 storedAt 倒序），其余删除。
  // 当 store 超过阈值才触发，避免每次拉数据都开 readwrite 事务。
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE_NAME, 'readwrite');
    } catch (_e) {
      resolve();
      return;
    }
    const store = tx.objectStore(STORE_NAME);
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result <= maxRecords) {
        resolve();
        return;
      }
      const all = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (cur) {
          all.push({ key: cur.key, storedAt: cur.value?.storedAt || 0 });
          cur.continue();
        } else {
          all.sort((a, b) => b.storedAt - a.storedAt);
          for (const entry of all.slice(maxRecords)) {
            store.delete(entry.key);
          }
        }
      };
      cursorReq.onerror = () => { /* ignore */ };
    };
    countReq.onerror = () => resolve();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

// ---------------------------------------------------------------------------
// 网络层
// ---------------------------------------------------------------------------

async function fetchFromWorker({ code, from, to, forceLive }) {
  const params = new URLSearchParams({ code, from, to });
  if (forceLive) params.set('force', '1');
  const url = `${NAV_HISTORY_ENDPOINT}?${params.toString()}`;
  const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } });
  const rawText = await response.text();
  let payload;
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch (_e) {
    throw new Error('净值历史接口返回了非 JSON 响应。');
  }
  if (!response.ok || payload?.ok === false) {
    const msg = payload?.error || `净值历史接口请求失败：HTTP ${response.status}`;
    throw new Error(msg);
  }
  if (!Array.isArray(payload?.items)) {
    throw new Error('净值历史接口返回缺少 items 字段。');
  }
  return payload;
}

function isFresh(record, nowMs) {
  if (!record) return false;
  const exp = Date.parse(String(record.expiresAt || ''));
  return Number.isFinite(exp) && exp - FRESH_MARGIN_MS > nowMs;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

export async function fetchNavHistory(opts = {}) {
  const args = normalizeArgs(opts);
  const key = makeCacheKey(args.code, args.from, args.to);

  // L1 命中（同一 tick 内 in-flight 去重）
  if (!args.forceLive && inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = (async () => {
    const nowMs = Date.now();

    // L2 命中（仅在非 forceLive 时尝试）
    let cached = null;
    if (!args.forceLive) {
      cached = await idbGet(key).catch(() => null);
      if (isFresh(cached, nowMs)) {
        return {
          code: args.code,
          from: args.from,
          to: args.to,
          items: cached.items || [],
          generatedAt: cached.generatedAt,
          expiresAt: cached.expiresAt,
          cache: { hit: true, source: 'indexeddb', stale: false },
          stale: false
        };
      }
    }

    // L3：上游 Worker
    try {
      const payload = await fetchFromWorker(args);
      const record = {
        key,
        code: args.code,
        from: args.from,
        to: args.to,
        items: payload.items,
        generatedAt: payload.generatedAt,
        expiresAt: payload.expiresAt,
        storedAt: Date.now()
      };
      idbPut(record).catch(() => { /* ignore put failures */ });
      // 异步触发一次容量清理（不阻塞返回）
      Promise.resolve().then(() => idbClearExpired().catch(() => {}));
      return {
        code: args.code,
        from: args.from,
        to: args.to,
        items: payload.items,
        generatedAt: payload.generatedAt,
        expiresAt: payload.expiresAt,
        cache: {
          hit: false,
          source: payload?.cache?.source || 'live',
          stale: false,
          worker: payload?.cache || null
        },
        stale: false
      };
    } catch (error) {
      // 网络/Worker 失败：尝试用 IndexedDB 的 stale 数据兜底
      const stale = cached || (await idbGet(key).catch(() => null));
      if (stale && Array.isArray(stale.items) && stale.items.length) {
        return {
          code: args.code,
          from: args.from,
          to: args.to,
          items: stale.items,
          generatedAt: stale.generatedAt,
          expiresAt: stale.expiresAt,
          cache: { hit: true, source: 'indexeddb', stale: true, fallback: true },
          stale: true,
          error: error instanceof Error ? error.message : String(error)
        };
      }
      throw error;
    }
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

// 仅供测试 / 用户主动清缓存
export async function clearNavHistoryCache() {
  inflight.clear();
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE_NAME, 'readwrite');
    } catch (_e) {
      resolve();
      return;
    }
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

export const __internals = {
  makeCacheKey,
  todayIsoDateShanghai,
  shiftIsoDateDays,
  isValidIsoDate,
  normalizeArgs,
  isFresh,
  NAV_HISTORY_ENDPOINT,
  DB_NAME,
  STORE_NAME,
  FRESH_MARGIN_MS
};
