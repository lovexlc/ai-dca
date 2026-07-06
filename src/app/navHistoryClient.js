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
//
// === NAV 分层语义 (Phase 1) ===
// 本模块返回的 items[] 是「公布单位净值」序列。
// **序列末端语义 = T-1**（交易日 18:00 后才会出现当日净值；A 股场内 ETF、QDII 另论）。
// **交易时段内 NOT 等于** ocr-proxy `/api/holdings/nav` 返回的「实时 latestNav」。
//
// 调用者必须遵守：
//   - 实时态 KPI / 今日盈亏 / TopN / Notify digest → 请走 `latestNav`（持仓 ledger / requestHoldingsNav），不要从这里取末端。
//   - 历史/累计图（收益看板曲线 / Return·Chart / Sparkline）→ 走本模块，接受末端 T-1 漂移。
//   - UI 给末端加“截至 YYYY-MM-DD 公布净值”提示，避免跟持仓页实时数字对不上。
// 详见 docs/nav-source-stratification-plan.md 、 docs/data-consistency-audit-plan.md。

import { apiUrl } from './apiBase.js';

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

function recordCoversRange(record, code, from, to) {
  if (!record || record.code !== code) return false;
  if (!isValidIsoDate(record.from) || !isValidIsoDate(record.to)) return false;
  return record.from <= from && record.to >= to && Array.isArray(record.items) && record.items.length > 0;
}

function dateOfNavItem(item = {}) {
  const date = String(item?.date || item?.navDate || item?.day || '').slice(0, 10);
  return isValidIsoDate(date) ? date : '';
}

function sliceNavItemsByRange(items = [], from, to) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    const date = dateOfNavItem(item);
    return date && date >= from && date <= to;
  });
}

function pickBestCoveringRecord(records = [], { code, from, to } = {}) {
  const covering = (Array.isArray(records) ? records : [])
    .filter((record) => recordCoversRange(record, code, from, to))
    .sort((a, b) => {
      const lenA = Date.parse(a.to) - Date.parse(a.from);
      const lenB = Date.parse(b.to) - Date.parse(b.from);
      return lenA - lenB || Number(b.storedAt || 0) - Number(a.storedAt || 0);
    });
  return covering[0] || null;
}

async function idbFindCoveringRecord({ code, from, to } = {}) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE_NAME, 'readonly');
    } catch (_e) {
      resolve(null);
      return;
    }
    const records = [];
    const req = tx.objectStore(STORE_NAME).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      const value = cur.value;
      if (recordCoversRange(value, code, from, to)) records.push(value);
      cur.continue();
    };
    req.onerror = () => resolve(null);
    tx.oncomplete = () => resolve(pickBestCoveringRecord(records, { code, from, to }));
    tx.onerror = () => resolve(null);
    tx.onabort = () => resolve(null);
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
  const url = apiUrl(NAV_HISTORY_ENDPOINT, Object.fromEntries(params.entries()));
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

function isFresh(record, nowMs, queryToDate) {
  if (!record) return false;
  const exp = Date.parse(String(record.expiresAt || ''));
  if (!Number.isFinite(exp) || exp - FRESH_MARGIN_MS <= nowMs) return false;

  // 如果查询范围包含"今天"，缓存必须是今天生成的，否则跨天后立即失效
  if (queryToDate) {
    const today = todayIsoDateShanghai();
    if (queryToDate >= today) {
      const cachedDate = String(record.generatedAt || '').slice(0, 10);
      // 如果没有 generatedAt（旧缓存）或日期早于今天，都视为过期
      if (!cachedDate || cachedDate < today) return false;
    }
  }

  return true;
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
      if (isFresh(cached, nowMs, args.to)) {
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
      const covering = await idbFindCoveringRecord(args).catch(() => null);
      if (isFresh(covering, nowMs, args.to)) {
        return {
          code: args.code,
          from: args.from,
          to: args.to,
          items: sliceNavItemsByRange(covering.items || [], args.from, args.to),
          generatedAt: covering.generatedAt,
          expiresAt: covering.expiresAt,
          cache: { hit: true, source: 'indexeddb-range', stale: false },
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
      const stale = cached
        || (await idbGet(key).catch(() => null))
        || (await idbFindCoveringRecord(args).catch(() => null));
      if (stale && Array.isArray(stale.items) && stale.items.length) {
        return {
          code: args.code,
          from: args.from,
          to: args.to,
          items: recordCoversRange(stale, args.code, args.from, args.to)
            ? sliceNavItemsByRange(stale.items, args.from, args.to)
            : stale.items,
          generatedAt: stale.generatedAt,
          expiresAt: stale.expiresAt,
          cache: { hit: true, source: recordCoversRange(stale, args.code, args.from, args.to) ? 'indexeddb-range' : 'indexeddb', stale: true, fallback: true },
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

// 批量拉取 N 只基金同一区间的净值序列。
// 限于一个页面有多个收益组件（ReturnChart / ReturnCalendar / DailyFundBreakdown / IncomeDetailPage）
// 同时调用、冷缓存时同时发 N 个 fetchNavHistory 问题，这里先查 L1/L2，漏掉的 code
// 走单次 POST /api/holdings/nav-history { codes: [...] }，Worker 内部 mapLimit(6) 复用现有
// caches.default + KV 路径。老 Worker 未上线返 405 时回退到逐 code fetchNavHistory 兜底。
//
// 返回：{ navByCode: Record<code, items>, stale: bool, errors: Record<code, string>, generatedAt }
export async function fetchNavHistoryBatch({ codes, from, to, days, forceLive } = {}) {
  const inputCodes = Array.from(new Set(
    (Array.isArray(codes) ? codes : [])
      .map((c) => String(c || '').trim())
      .filter((c) => /^\d{6}$/.test(c))
  ));
  if (!inputCodes.length) {
    return { navByCode: {}, stale: false, errors: {}, generatedAt: new Date().toISOString() };
  }

  // 复用 normalizeArgs 的 from/to/days 规范逻辑（随便拿一个 code 走接口得到区间同。）
  const args = normalizeArgs({ code: inputCodes[0], from, to, days, forceLive });
  const fromDate = args.from;
  const toDate = args.to;
  const force = forceLive === true;
  const nowMs = Date.now();

  const navByCode = {};
  const errors = {};
  let anyStale = false;

  // L2 查命中；未命中进入 missing。
  const missing = [];
  await Promise.all(inputCodes.map(async (code) => {
    if (force) { missing.push(code); return; }
    const key = makeCacheKey(code, fromDate, toDate);
    const cached = await idbGet(key).catch(() => null);
    if (isFresh(cached, nowMs, toDate)) {
      navByCode[code] = cached.items || [];
      return;
    }
    const covering = await idbFindCoveringRecord({ code, from: fromDate, to: toDate }).catch(() => null);
    if (isFresh(covering, nowMs, toDate)) {
      navByCode[code] = sliceNavItemsByRange(covering.items || [], fromDate, toDate);
      return;
    }
    missing.push(code);
  }));

  if (!missing.length) {
    return { navByCode, stale: false, errors, generatedAt: new Date().toISOString() };
  }

  // 一次 POST 批量。
  let payload = null;
  let httpStatus = 0;
  try {
    const resp = await fetch(apiUrl(NAV_HISTORY_ENDPOINT), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codes: missing, from: fromDate, to: toDate, force: force ? 1 : 0 }),
      cache: 'no-store'
    });
    httpStatus = resp.status;
    if (resp.ok) {
      payload = await resp.json();
    }
  } catch (err) {
    // 网络错： payload 保持 null，后面走 stale 兜底。
    errors.__network = err instanceof Error ? err.message : String(err);
  }

  if (httpStatus === 405 || (!payload && httpStatus && httpStatus !== 0)) {
    // 老 Worker 未上线（405） 或 高中间件 返非 2xx 但不是 405 → 均回退逐 code fetchNavHistory。
    const fallback = await Promise.all(missing.map(async (code) => {
      try {
        const res = await fetchNavHistory({ code, from: fromDate, to: toDate, forceLive: force });
        return [code, res, null];
      } catch (err) {
        return [code, null, err];
      }
    }));
    for (const [code, res, err] of fallback) {
      if (err) {
        errors[code] = err.message || String(err);
        navByCode[code] = navByCode[code] || [];
        continue;
      }
      navByCode[code] = res.items || [];
      if (res.stale) anyStale = true;
    }
    return { navByCode, stale: anyStale, errors, generatedAt: new Date().toISOString() };
  }

  if (!payload) {
    // 纯网络错：全部走 IDB stale 兜底。
    for (const code of missing) {
      const key = makeCacheKey(code, fromDate, toDate);
      const stale = (await idbGet(key).catch(() => null))
        || (await idbFindCoveringRecord({ code, from: fromDate, to: toDate }).catch(() => null));
      if (stale && Array.isArray(stale.items) && stale.items.length) {
        navByCode[code] = recordCoversRange(stale, code, fromDate, toDate)
          ? sliceNavItemsByRange(stale.items, fromDate, toDate)
          : stale.items;
        anyStale = true;
      } else {
        navByCode[code] = [];
        if (!errors[code]) errors[code] = errors.__network || 'network error';
      }
    }
    return { navByCode, stale: anyStale, errors, generatedAt: new Date().toISOString() };
  }

  // 批量返回：逐项写回 L2。
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const idbWrites = [];
  for (const it of items) {
    if (!it || !it.code) continue;
    const code = it.code;
    if (it.ok === true && it.data) {
      const data = it.data;
      navByCode[code] = data.items || [];
      const key = makeCacheKey(code, fromDate, toDate);
      idbWrites.push(idbPut({
        key,
        code,
        from: fromDate,
        to: toDate,
        items: data.items || [],
        generatedAt: data.generatedAt,
        expiresAt: data.expiresAt,
        storedAt: Date.now()
      }).catch(() => false));
    } else {
      errors[code] = it.error || 'unknown';
      const key = makeCacheKey(code, fromDate, toDate);
      const stale = (await idbGet(key).catch(() => null))
        || (await idbFindCoveringRecord({ code, from: fromDate, to: toDate }).catch(() => null));
      if (stale && Array.isArray(stale.items) && stale.items.length) {
        navByCode[code] = recordCoversRange(stale, code, fromDate, toDate)
          ? sliceNavItemsByRange(stale.items, fromDate, toDate)
          : stale.items;
        anyStale = true;
      } else {
        navByCode[code] = [];
      }
    }
  }
  // 容量清理不阻塞。
  Promise.all(idbWrites).then(() => idbClearExpired().catch(() => {})).catch(() => {});

  return { navByCode, stale: anyStale, errors, generatedAt: payload?.generatedAt || new Date().toISOString() };
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
  recordCoversRange,
  sliceNavItemsByRange,
  pickBestCoveringRecord,
  NAV_HISTORY_ENDPOINT,
  DB_NAME,
  STORE_NAME,
  FRESH_MARGIN_MS
};
