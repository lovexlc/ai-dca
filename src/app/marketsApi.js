// Markets API client. Talks to ai-dca-markets worker mounted at /api/markets/* on tools.freebacktrack.tech.

const DEFAULT_BASE = 'https://tools.freebacktrack.tech/api/markets';

function resolveBase() {
  if (typeof window !== 'undefined' && window.__MARKETS_API_BASE__) {
    return String(window.__MARKETS_API_BASE__).replace(/\/$/, '');
  }
  return DEFAULT_BASE;
}

async function getJson(path, { signal } = {}) {
  const url = resolveBase() + path;
  const res = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
    cache: 'no-store'
  });
  if (!res.ok) {
    throw new Error('markets api GET ' + path + ' HTTP ' + res.status);
  }
  return res.json();
}

async function postJson(path, body, { signal } = {}) {
  const url = resolveBase() + path;
  const res = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal,
    cache: 'no-store'
  });
  if (!res.ok) {
    throw new Error('markets api POST ' + path + ' HTTP ' + res.status);
  }
  return res.json();
}

export async function fetchMarketsHealth() {
  return getJson('/health');
}

export async function fetchIndices(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/indices?market=' + encodeURIComponent(market) + q);
}

export async function fetchSectors(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/sectors?market=' + encodeURIComponent(market) + q);
}

export async function fetchQuote(symbol) {
  return getJson('/quote/' + encodeURIComponent(symbol));
}

export async function fetchQuotes(symbols) {
  const list = (symbols || []).map((s) => encodeURIComponent(s)).join(',');
  if (!list) return { quotes: {} };
  return getJson('/quotes?symbols=' + list);
}

export async function searchSymbols(market, query, { limit = 8, signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return { results: [] };
  return getJson('/search?market=' + encodeURIComponent(market) + '&q=' + encodeURIComponent(q) + '&limit=' + encodeURIComponent(limit), { signal });
}

export async function fetchKline(symbol, { timeframe = '1d' } = {}) {
  return getJson('/kline/' + encodeURIComponent(symbol) + '?tf=' + encodeURIComponent(timeframe));
}

export async function fetchMovers(market, { direction = 'mixed', refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/movers?market=' + encodeURIComponent(market) + '&direction=' + encodeURIComponent(direction) + q);
}

export async function fetchSummary(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/summary?market=' + encodeURIComponent(market) + q);
}

export async function fetchNews(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/news?market=' + encodeURIComponent(market) + q);
}

export async function fetchEarnings(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/earnings?market=' + encodeURIComponent(market) + q);
}


export async function fetchFinancials(symbol, { refresh = false } = {}) {
  const q = refresh ? '?refresh=1' : '';
  return getJson('/financials/' + encodeURIComponent(symbol) + q);
}

export async function fetchXueqiuFundData(symbol, { refresh = false, raw = true } = {}) {
  const params = [];
  if (refresh) params.push('refresh=1');
  if (raw) params.push('raw=1');
  const q = params.length ? '?' + params.join('&') : '';
  return getJson('/xueqiu-fund-data/' + encodeURIComponent(symbol) + q);
}

export async function fetchProfile(symbol) {
  return getJson('/profile/' + encodeURIComponent(symbol));
}

export async function askMarkets({ question, symbols = [], depth = 'fast', context = '' }) {
  return postJson('/ask', { question, symbols, depth, context });
}

// M3: 深度问答 SSE 流式调用。
// onEvent({ type, payload }) 会被逐个事件回调，事件类型包括：
//   started / progress / tool_start / tool_end / source / token / reasoning / done / error
// Promise 在 done 事件后 resolve并返回 done payload（含 answer/sources/iterations 等）；
// 在 error 事件后 reject。
// signal ：AbortSignal，需要取消时调用 controller.abort()；上游会依赖 res.on('close') 避免泄露。
export async function askMarketsStream({
  question,
  symbols = [],
  depth = 'deep',
  context = '',
  signal,
  onEvent,
}) {
  const url = resolveBase() + '/ask/stream';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ question, symbols, depth, context }),
    signal,
    cache: 'no-store',
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error('markets stream HTTP ' + res.status + ' ' + (text || ''));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let lastDone = null;
  let lastError = null;
  // 帮助函数：解析单个 SSE frame。
  const parseFrame = (frame) => {
    if (!frame || frame.startsWith(':')) return null; // 注释 / 心跳
    const lines = frame.split(/\r?\n/);
    let event = 'message';
    const dataLines = [];
    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    const dataText = dataLines.join('\n');
    let payload = null;
    if (dataText) {
      try {
        payload = JSON.parse(dataText);
      } catch (_) {
        payload = dataText;
      }
    }
    return { event, payload };
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const parsed = parseFrame(frame);
        if (!parsed) continue;
        const { event, payload } = parsed;
        if (event === 'done') lastDone = payload;
        else if (event === 'error') lastError = payload;
        if (typeof onEvent === 'function') {
          try { onEvent({ type: event, payload }); } catch (_) { /* ignore */ }
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch (_) { /* ignore */ }
  }
  if (lastError) {
    const msg = (lastError && (lastError.message || lastError.detail || lastError.error)) || 'stream error';
    const err = new Error(String(msg));
    err.payload = lastError;
    throw err;
  }
  return lastDone || { answer: '', sources: [], iterations: 0 };
}

// Watchlist (localStorage). Stored per market for convenience.
const WATCHLIST_KEY = 'markets:watchlist:v1';
const WATCHLIST_DEFAULTS_VERSION = 1;
const DEFAULT_WATCHLIST_ID = 'default';

export const CN_ETF_WATCHLIST_PRESETS = [
  // 用户指定的默认 A 股监控列表（以代码覆盖）
  { symbol: '513870', name: '纳指ETF 富国', exchange: '上交所', currency: 'CNY' },
  { symbol: '513390', name: '纳指100ETF', exchange: '上交所', currency: 'CNY' },
  { symbol: '513300', name: '纳斯达克ETF', exchange: '上交所', currency: 'CNY' },
  { symbol: '513110', name: '纳指ETF 华夏', exchange: '上交所', currency: 'CNY' },
  { symbol: '513100', name: '纳指ETF 国泰', exchange: '上交所', currency: 'CNY' },
  { symbol: '159941', name: '纳指ETF 广发', exchange: '深交所', currency: 'CNY' },
  { symbol: '159696', name: '纳指ETF 易方达', exchange: '深交所', currency: 'CNY' },
  { symbol: '159660', name: '纳指ETF 汇添富', exchange: '深交所', currency: 'CNY' },
  { symbol: '159659', name: '纳斯达克100 ETF', exchange: '深交所', currency: 'CNY' },
  { symbol: '159632', name: '纳斯达克ETF 华安', exchange: '深交所', currency: 'CNY' },
  { symbol: '159513', name: '纳斯达克100ETF', exchange: '深交所', currency: 'CNY' },
  { symbol: '159501', name: '纳指ETF 嘉实', exchange: '深交所', currency: 'CNY' },
  { symbol: '161130', name: '纳指ETF 新增1', exchange: '深交所', currency: 'CNY' },
  { symbol: '159577', name: '纳指ETF 新增2', exchange: '深交所', currency: 'CNY' },
];

const DEFAULT_CN_WATCHLIST = CN_ETF_WATCHLIST_PRESETS.map((item) => item.symbol);

function normalizeWatchlist(value = {}) {
  const now = new Date().toISOString();
  const rawUs = Array.isArray(value.us) ? value.us : [];
  const rawCn = Array.isArray(value.cn) ? value.cn : [];
  const hasCnDefaults = Number(value.defaultsVersion) >= WATCHLIST_DEFAULTS_VERSION;
  const cn = hasCnDefaults
    ? rawCn
    : Array.from(new Set([...DEFAULT_CN_WATCHLIST, ...rawCn]));
  const seedList = {
    id: DEFAULT_WATCHLIST_ID,
    name: '默认列表',
    us: rawUs,
    cn,
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
  };
  const rawLists = Array.isArray(value.lists) ? value.lists : [];
  const lists = rawLists.length
    ? rawLists.map((item, index) => ({
      id: String(item.id || (index === 0 ? DEFAULT_WATCHLIST_ID : `list-${index + 1}`)),
      name: String(item.name || (index === 0 ? '默认列表' : `列表 ${index + 1}`)),
      us: Array.isArray(item.us) ? item.us : [],
      cn: Array.isArray(item.cn) ? item.cn : [],
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || now,
    }))
    : [seedList];
  if (!lists.some((item) => item.id === DEFAULT_WATCHLIST_ID)) lists.unshift(seedList);
  let activeListId = String(value.activeListId || DEFAULT_WATCHLIST_ID);
  if (!lists.some((item) => item.id === activeListId)) activeListId = lists[0].id;
  const activeList = lists.find((item) => item.id === activeListId) || lists[0] || seedList;

  return {
    ...value,
    us: activeList.us || [],
    cn: activeList.cn || [],
    lists,
    activeListId,
    defaultsVersion: WATCHLIST_DEFAULTS_VERSION
  };
}

export function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return normalizeWatchlist({ us: [], cn: [] });
    const parsed = JSON.parse(raw);
    return normalizeWatchlist(parsed);
  } catch (err) {
    return normalizeWatchlist({ us: [], cn: [] });
  }
}

export function saveWatchlist(list) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(normalizeWatchlist(list || { us: [], cn: [] })));
  } catch (err) {
    // ignore quota errors
  }
}

export function setActiveWatchlist(listId) {
  const current = loadWatchlist();
  const next = normalizeWatchlist({ ...current, activeListId: listId });
  saveWatchlist(next);
  return next;
}

export function createWatchlist(name = '新列表') {
  const current = loadWatchlist();
  const now = new Date().toISOString();
  const id = `list-${Date.now().toString(36)}`;
  const next = normalizeWatchlist({
    ...current,
    lists: [
      ...(current.lists || []),
      { id, name: String(name || '新列表').trim() || '新列表', us: [], cn: [], createdAt: now, updatedAt: now }
    ],
    activeListId: id,
  });
  saveWatchlist(next);
  return next;
}

export function renameWatchlist(listId, name) {
  const current = loadWatchlist();
  const targetListId = String(listId || current.activeListId || DEFAULT_WATCHLIST_ID);
  const nextName = String(name || '').trim();
  if (!nextName) return current;
  const now = new Date().toISOString();
  const lists = (current.lists || []).map((item) => (
    item.id === targetListId ? { ...item, name: nextName, updatedAt: now } : item
  ));
  const saved = normalizeWatchlist({ ...current, lists });
  saveWatchlist(saved);
  return saved;
}

export function deleteWatchlist(listId) {
  const current = loadWatchlist();
  const targetListId = String(listId || current.activeListId || '');
  const currentLists = current.lists || [];
  if (!targetListId || targetListId === DEFAULT_WATCHLIST_ID || currentLists.length <= 1) return current;
  const lists = currentLists.filter((item) => item.id !== targetListId);
  const activeListId = current.activeListId === targetListId
    ? (lists.find((item) => item.id === DEFAULT_WATCHLIST_ID)?.id || lists[0]?.id || DEFAULT_WATCHLIST_ID)
    : current.activeListId;
  const saved = normalizeWatchlist({ ...current, lists, activeListId });
  saveWatchlist(saved);
  return saved;
}

export function addToWatchlist(market, symbol, listId = null) {
  const next = loadWatchlist();
  const targetListId = String(listId || next.activeListId || DEFAULT_WATCHLIST_ID);
  const lists = (next.lists || []).map((item) => ({ ...item }));
  const target = lists.find((item) => item.id === targetListId) || lists[0];
  const list = target[market] || [];
  if (!list.includes(symbol)) list.unshift(symbol);
  target[market] = list.slice(0, 50);
  target.updatedAt = new Date().toISOString();
  const saved = normalizeWatchlist({ ...next, lists, activeListId: target.id });
  saveWatchlist(saved);
  return saved;
}

export function removeFromWatchlist(market, symbol, listId = null) {
  const next = loadWatchlist();
  const targetListId = String(listId || next.activeListId || DEFAULT_WATCHLIST_ID);
  const lists = (next.lists || []).map((item) => ({ ...item }));
  const target = lists.find((item) => item.id === targetListId) || lists[0];
  target[market] = (target[market] || []).filter((s) => s !== symbol);
  target.updatedAt = new Date().toISOString();
  const saved = normalizeWatchlist({ ...next, lists, activeListId: target.id });
  saveWatchlist(saved);
  return saved;
}
