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

export async function fetchQuote(symbol) {
  return getJson('/quote/' + encodeURIComponent(symbol));
}

export async function fetchQuotes(symbols) {
  const list = (symbols || []).map((s) => encodeURIComponent(s)).join(',');
  if (!list) return { quotes: {} };
  return getJson('/quotes?symbols=' + list);
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
    const msg = (lastError && (lastError.message || lastError.error)) || 'stream error';
    const err = new Error(String(msg));
    err.payload = lastError;
    throw err;
  }
  return lastDone || { answer: '', sources: [], iterations: 0 };
}

// Watchlist (localStorage). Stored per market for convenience.
const WATCHLIST_KEY = 'markets:watchlist:v1';

export function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return { us: [], cn: [] };
    const parsed = JSON.parse(raw);
    return {
      us: Array.isArray(parsed.us) ? parsed.us : [],
      cn: Array.isArray(parsed.cn) ? parsed.cn : []
    };
  } catch (err) {
    return { us: [], cn: [] };
  }
}

export function saveWatchlist(list) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list || { us: [], cn: [] }));
  } catch (err) {
    // ignore quota errors
  }
}

export function addToWatchlist(market, symbol) {
  const next = loadWatchlist();
  const list = next[market] || [];
  if (!list.includes(symbol)) list.unshift(symbol);
  next[market] = list.slice(0, 50);
  saveWatchlist(next);
  return next;
}

export function removeFromWatchlist(market, symbol) {
  const next = loadWatchlist();
  next[market] = (next[market] || []).filter((s) => s !== symbol);
  saveWatchlist(next);
  return next;
}
