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

export async function fetchMovers(market, { direction = 'gainers', refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/movers?market=' + encodeURIComponent(market) + '&direction=' + encodeURIComponent(direction) + q);
}

export async function fetchNews(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/news?market=' + encodeURIComponent(market) + q);
}

export async function fetchProfile(symbol) {
  return getJson('/profile/' + encodeURIComponent(symbol));
}

export async function askMarkets({ question, symbols = [], depth = 'fast' }) {
  return postJson('/ask', { question, symbols, depth });
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
