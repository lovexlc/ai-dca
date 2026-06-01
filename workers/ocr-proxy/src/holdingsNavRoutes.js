import { mapLimit } from './fundLimit.js';
import { jsonResponse } from './ocrHttp.js';
import { parseIntegerEnv } from './ocrModelResponse.js';
import {
  fetchFundNavHistoryWithMonthlyKv as getNavFundNavHistoryWithMonthlyKv,
  fetchFundNavSnapshot as getNavFundNavSnapshot,
  fetchHoldingSnapshot as getNavHoldingSnapshot
} from '../../notify/src/getNav.js';

function normalizeRequestedHoldingCodes(input = []) {
  const values = Array.isArray(input) ? input : String(input || '').split(',');
  const codeSet = new Set();

  for (const value of values) {
    const digits = String(value || '').trim().replace(/\D/g, '');
    if (/^\d{6}$/.test(digits)) {
      codeSet.add(digits);
    }
  }

  return [...codeSet].sort();
}

async function buildHoldingsCacheKey(codes = []) {
  const normalized = normalizeRequestedHoldingCodes(codes);
  const cacheBust = 'v3';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${cacheBust}|${normalized.join(',')}`)
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

function getHoldingsNavCacheTtlMs(env) {
  const ttlMinutes = Math.max(1, parseIntegerEnv(env.HOLDINGS_NAV_CACHE_TTL_MINUTES, 180));
  return ttlMinutes * 60 * 1000;
}

function isHoldingsPayloadFresh(payload = {}, ttlMs = 0) {
  const expiresAt = Date.parse(String(payload?.expiresAt || ''));
  if (Number.isFinite(expiresAt)) {
    return expiresAt > Date.now();
  }

  const generatedAt = Date.parse(String(payload?.generatedAt || ''));
  return Number.isFinite(generatedAt) ? (generatedAt + ttlMs) > Date.now() : false;
}

function withHoldingsCacheMeta(payload = {}, override = {}) {
  const nextCache = {
    key: String(override.key || payload?.cache?.key || '').trim(),
    hit: override.hit === true,
    source: String(override.source || payload?.cache?.source || '').trim(),
    stale: override.stale === true,
    codeCount: Math.max(Number(override.codeCount || payload?.cache?.codeCount) || 0, 0)
  };

  return {
    ...payload,
    cache: nextCache,
    items: (Array.isArray(payload?.items) ? payload.items : []).map((item) => ({
      ...item,
      cacheHit: nextCache.hit,
      cacheSource: nextCache.source,
      cacheKey: nextCache.key
    }))
  };
}

function buildHoldingsCacheRequest(url, key, codes) {
  const cacheUrl = new URL(url.origin);
  cacheUrl.pathname = '/api/holdings/nav';
  cacheUrl.searchParams.set('codes', normalizeRequestedHoldingCodes(codes).join(','));
  cacheUrl.searchParams.set('cacheKey', key);
  return new Request(cacheUrl.toString(), {
    method: 'GET'
  });
}

function resolveHoldingsBaselineOrigin(request, env) {
  const explicitOrigin = String(env.HOLDINGS_BASELINE_ORIGIN || '').trim();
  if (explicitOrigin) {
    return explicitOrigin;
  }

  const requestOrigin = new URL(request.url).origin;
  if (/(127\.0\.0\.1|localhost):8787$/i.test(requestOrigin)) {
    return '';
  }

  return requestOrigin;
}

async function readHoldingsBaselinePayload(request, env, key, ttlMs, codes) {
  const baselineOrigin = resolveHoldingsBaselineOrigin(request, env);
  if (!baselineOrigin) {
    return null;
  }

  const baselinePath = String(env.HOLDINGS_BASELINE_PATH || '/holdings-nav-cache').trim().replace(/\/+$/, '') || '/holdings-nav-cache';

  try {
    const indexUrl = new URL(`${baselinePath}/index.json`, baselineOrigin);
    const indexResponse = await fetch(indexUrl.toString(), {
      headers: {
        accept: 'application/json'
      }
    });

    if (!indexResponse.ok) {
      return null;
    }

    const indexPayload = await indexResponse.json();
    const entries = Array.isArray(indexPayload?.entries) ? indexPayload.entries : [];
    const matchedEntry = entries.find((entry) => String(entry?.key || '').trim() === key);
    if (!matchedEntry) {
      return null;
    }

    const fileName = String(matchedEntry?.file || `${key}.json`).trim() || `${key}.json`;
    const entryUrl = new URL(`${baselinePath}/${fileName}`, baselineOrigin);
    const entryResponse = await fetch(entryUrl.toString(), {
      headers: {
        accept: 'application/json'
      }
    });

    if (!entryResponse.ok) {
      return null;
    }

    const payload = await entryResponse.json();
    if (!isHoldingsPayloadFresh(payload, ttlMs)) {
      return null;
    }

    return withHoldingsCacheMeta(payload, {
      key,
      hit: true,
      source: 'repo-baseline',
      stale: false,
      codeCount: codes.length
    });
  } catch (_error) {
    return null;
  }
}

export async function readFundNavSnapshot(code, generatedAt) {
  return getNavFundNavSnapshot(code, generatedAt);
}

async function readFundNavHistoryWithMonthlyKv(code, fromDate, toDate, env, options = {}) {
  return getNavFundNavHistoryWithMonthlyKv(code, fromDate, toDate, env, options);
}

async function buildNavHistoryCacheKey(code, fromDate, toDate) {
  const text = `${code}|${fromDate}|${toDate}`;
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function todayShanghaiIsoDate() {
  return epochMsToShanghaiIso(Date.now()).slice(0, 10);
}

export async function handleHoldingsNavHistory(request, env) {
  return handleHoldingsNavHistorySingle(request, env);
}

export async function handleHoldingsNavHistoryBatch(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_e) { body = {}; }
  const rawCodes = Array.isArray(body?.codes) ? body.codes
    : typeof body?.codes === 'string' ? body.codes.split(',')
    : [];
  const codes = Array.from(new Set(rawCodes.map((c) => String(c || '').trim()).filter((c) => /^\d{6}$/.test(c))));
  if (!codes.length) return jsonResponse({ error: '请求中缺少有效的 6 位基金代码。' }, 400);
  if (codes.length > 60) return jsonResponse({ error: '单次最多查询 60 个基金代码。' }, 400);

  const today = todayShanghaiIsoDate();
  const toRaw = typeof body?.to === 'string' ? body.to.trim() : '';
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : today;
  let fromDate;
  const fromRaw = typeof body?.from === 'string' ? body.from.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) {
    fromDate = fromRaw;
  } else {
    const daysNum = Number(body?.days);
    const days = Number.isFinite(daysNum)
      ? Math.max(1, Math.min(Math.floor(daysNum), 3650))
      : 365;
    fromDate = shiftIsoDateDays(toDate, -days);
  }
  if (fromDate > toDate) return jsonResponse({ error: 'from 必须早于或等于 to。' }, 400);
  const forceBypass = body?.force === true || body?.force === 1
    || body?.refresh === true || body?.refresh === 1;

  const generatedAt = nowShanghaiIso();
  const baseTtlMs = getHoldingsNavCacheTtlMs(env);
  const includesToday = toDate >= today;
  const ttlMs = includesToday
    ? computeNonExchangeNavTtlMs(baseTtlMs, new Date())
    : Math.max(baseTtlMs, 24 * 60 * 60 * 1000);
  const origin = new URL(request.url).origin;

  const items = await mapLimit(codes, 6, async (code) => {
    try {
      const cacheKey = await buildNavHistoryCacheKey(code, fromDate, toDate);
      const cacheUrl = new URL(origin);
      cacheUrl.pathname = '/api/holdings/nav-history';
      cacheUrl.searchParams.set('code', code);
      cacheUrl.searchParams.set('from', fromDate);
      cacheUrl.searchParams.set('to', toDate);
      cacheUrl.searchParams.set('cacheKey', cacheKey);
      const cacheRequest = new Request(cacheUrl.toString(), { method: 'GET' });

      if (forceBypass) {
        try { await caches.default.delete(cacheRequest); } catch (_e) { /* ignore */ }
      } else {
        const cachedResponse = await caches.default.match(cacheRequest);
        if (cachedResponse) {
          try {
            const cached = await cachedResponse.json();
            if (isHoldingsPayloadFresh(cached, ttlMs)) {
              return {
                code,
                ok: true,
                data: { ...cached, cache: { ...(cached.cache || {}), hit: true, source: 'edge-cache', stale: false } }
              };
            }
          } catch (_e) { /* fall through */ }
        }
      }

      const navHistoryResult = await readFundNavHistoryWithMonthlyKv(code, fromDate, toDate, env, {
        today,
        ttlMs,
        forceBypass,
        generatedAt
      });
      const itemsList = navHistoryResult.items || [];
      const expiresAt = epochMsToShanghaiIso(Date.parse(generatedAt) + ttlMs);
      const itemPayload = {
        ok: true,
        code,
        from: fromDate,
        to: toDate,
        count: itemsList.length,
        items: itemsList,
        generatedAt,
        expiresAt,
        cache: {
          key: cacheKey,
          hit: navHistoryResult.cache?.hit === true,
          source: navHistoryResult.cache?.source || 'live',
          stale: false,
          ttlMs,
          kv: navHistoryResult.cache?.kv || null
        }
      };
      try {
        const cachePut = new Response(JSON.stringify(itemPayload), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `max-age=${Math.floor(ttlMs / 1000)}`
          }
        });
        await caches.default.put(cacheRequest, cachePut);
      } catch (_e) { /* ignore cache put failures */ }
      return { code, ok: true, data: itemPayload };
    } catch (error) {
      return {
        code,
        ok: false,
        error: error instanceof Error ? error.message : `${code} 净值历史拉取失败。`
      };
    }
  });

  const successCount = items.filter((it) => it && it.ok === true).length;
  return jsonResponse({
    ok: true,
    from: fromDate,
    to: toDate,
    items,
    successCount,
    failureCount: items.length - successCount,
    generatedAt
  });
}

async function handleHoldingsNavHistorySingle(request, env) {
  const url = new URL(request.url);
  const rawCode = String(url.searchParams.get('code') || '').trim();
  if (!/^\d{6}$/.test(rawCode)) {
    return jsonResponse({ error: '请求中缺少有效的 6 位基金代码（参数 code）。' }, 400);
  }
  const today = todayShanghaiIsoDate();
  const toDate = String(url.searchParams.get('to') || '').trim() || today;
  let fromDate = String(url.searchParams.get('from') || '').trim();
  if (!fromDate) {
    const daysRaw = url.searchParams.get('days');
    const days = Math.max(1, Math.min(parseIntegerEnv(daysRaw, 365), 3650));
    fromDate = shiftIsoDateDays(toDate, -days);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return jsonResponse({ error: 'from / to 必须是 YYYY-MM-DD 格式。' }, 400);
  }
  if (fromDate > toDate) {
    return jsonResponse({ error: 'from 必须早于或等于 to。' }, 400);
  }

  const forceBypass = url.searchParams.get('force') === '1' || url.searchParams.get('refresh') === '1';
  const cacheKey = await buildNavHistoryCacheKey(rawCode, fromDate, toDate);

  const cacheUrl = new URL(url.origin);
  cacheUrl.pathname = '/api/holdings/nav-history';
  cacheUrl.searchParams.set('code', rawCode);
  cacheUrl.searchParams.set('from', fromDate);
  cacheUrl.searchParams.set('to', toDate);
  cacheUrl.searchParams.set('cacheKey', cacheKey);
  const cacheRequest = new Request(cacheUrl.toString(), { method: 'GET' });

  const baseTtlMs = getHoldingsNavCacheTtlMs(env);
  const cacheNow = new Date();
  const includesToday = toDate >= today;
  const ttlMs = includesToday
    ? computeNonExchangeNavTtlMs(baseTtlMs, cacheNow)
    : Math.max(baseTtlMs, 24 * 60 * 60 * 1000);

  if (forceBypass) {
    try { await caches.default.delete(cacheRequest); } catch (_e) { /* ignore */ }
  } else {
    const cachedResponse = await caches.default.match(cacheRequest);
    if (cachedResponse) {
      try {
        const payload = await cachedResponse.json();
        if (isHoldingsPayloadFresh(payload, ttlMs)) {
          return jsonResponse({
            ...payload,
            cache: { ...(payload.cache || {}), hit: true, source: 'edge-cache', stale: false }
          });
        }
      } catch (_e) { /* fall through to live fetch */ }
    }
  }

  const generatedAt = nowShanghaiIso();
  let navHistoryResult;
  try {
    navHistoryResult = await readFundNavHistoryWithMonthlyKv(rawCode, fromDate, toDate, env, {
      today,
      ttlMs,
      forceBypass,
      generatedAt
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      code: rawCode,
      from: fromDate,
      to: toDate,
      error: error instanceof Error ? error.message : `${rawCode} 净值历史拉取失败。`,
      generatedAt
    }, 502);
  }

  const items = navHistoryResult.items || [];
  const expiresAt = epochMsToShanghaiIso(Date.parse(generatedAt) + ttlMs);
  const payload = {
    ok: true,
    code: rawCode,
    from: fromDate,
    to: toDate,
    count: items.length,
    items,
    generatedAt,
    expiresAt,
    cache: {
      key: cacheKey,
      hit: navHistoryResult.cache?.hit === true,
      source: navHistoryResult.cache?.source || 'live',
      stale: false,
      ttlMs,
      kv: navHistoryResult.cache?.kv || null
    }
  };

  try {
    const cachePut = new Response(JSON.stringify(payload), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `max-age=${Math.floor(ttlMs / 1000)}`
      }
    });
    await caches.default.put(cacheRequest, cachePut);
  } catch (_e) { /* ignore cache put failures */ }

  return jsonResponse(payload);
}

const EXCHANGE_FUND_CODE_PREFIXES = ['15', '50', '51', '52', '53', '54', '56', '58'];

function isExchangeFundCode(code) {
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  return EXCHANGE_FUND_CODE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function epochMsToShanghaiIso(ms) {
  const t = Number.isFinite(ms) ? ms : Date.now();
  const shifted = new Date(t + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const M = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  const H = String(shifted.getUTCHours()).padStart(2, '0');
  const m = String(shifted.getUTCMinutes()).padStart(2, '0');
  const s = String(shifted.getUTCSeconds()).padStart(2, '0');
  const ms3 = String(shifted.getUTCMilliseconds()).padStart(3, '0');
  return `${y}-${M}-${d}T${H}:${m}:${s}.${ms3}+08:00`;
}

export function nowShanghaiIso() {
  return epochMsToShanghaiIso(Date.now());
}

function isAshareTradingNow(now) {
  const { hour, minute, dayOfWeek } = getShanghaiHourMinuteDow(now);
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const total = hour * 60 + minute;
  const morningOpen = 9 * 60 + 30;
  const morningClose = 11 * 60 + 30;
  const afternoonOpen = 13 * 60;
  const afternoonClose = 15 * 60;
  return (total >= morningOpen && total < morningClose)
      || (total >= afternoonOpen && total < afternoonClose);
}

function computeExchangeNavTtlMs(envBaseMs, now) {
  const base = Math.max(60_000, Number(envBaseMs) || 0);
  if (isAshareTradingNow(now)) return 60_000;
  const { hour, minute, dayOfWeek } = getShanghaiHourMinuteDow(now);
  const total = hour * 60 + minute;
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return Math.max(base, 24 * 60 * 60 * 1000);
  }
  const openMin = 9 * 60 + 30;
  const closeMin = 15 * 60;
  let untilOpenMin;
  if (total >= closeMin) {
    untilOpenMin = (24 * 60 - total) + openMin;
  } else if (total < openMin) {
    untilOpenMin = openMin - total;
  } else {
    untilOpenMin = (13 * 60) - total;
  }
  return Math.max(base, untilOpenMin * 60 * 1000);
}

function getShanghaiHourMinuteDow(now) {
  const t = now instanceof Date ? now : new Date();
  const shifted = new Date(t.getTime() + 8 * 60 * 60 * 1000);
  return {
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayOfWeek: shifted.getUTCDay()
  };
}

function computeNonExchangeNavTtlMs(envBaseMs, now) {
  const base = Math.max(60_000, Number(envBaseMs) || 0);
  const { hour, minute, dayOfWeek } = getShanghaiHourMinuteDow(now);
  const totalMin = hour * 60 + minute;

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return Math.max(base, 8 * 60 * 60 * 1000);
  }

  const noUpdateUntilMin = 17 * 60 + 30;
  const publishWindowEndMin = 23 * 60 + 30;
  const nextDayQuietStartMin = 9 * 60 + 30;

  if (totalMin < noUpdateUntilMin) {
    const remainingMs = (noUpdateUntilMin - totalMin) * 60 * 1000;
    return Math.max(base, remainingMs);
  }

  if (totalMin < publishWindowEndMin) {
    return Math.min(base, 30 * 60 * 1000);
  }

  const remainingTodayMin = 24 * 60 - totalMin;
  const nextDayMs = (remainingTodayMin + nextDayQuietStartMin) * 60 * 1000;
  return Math.max(base, nextDayMs);
}

function shiftIsoDateDays(isoDate, deltaDays) {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const parts = isoDate.split('-').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return '';
  const ref = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  ref.setUTCDate(ref.getUTCDate() + deltaDays);
  const y = ref.getUTCFullYear();
  const m = String(ref.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ref.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function readHoldingSnapshot(code, generatedAt, env) {
  return getNavHoldingSnapshot(code, generatedAt, env);
}

async function fetchLiveHoldingsNavPayload(codes, env, key, ttlMsOverride) {
  const generatedAt = nowShanghaiIso();
  const ttlMs = Number.isFinite(ttlMsOverride) && ttlMsOverride > 0
    ? ttlMsOverride
    : getHoldingsNavCacheTtlMs(env);
  const items = await mapLimit(codes, 6, async (code) => {
    try {
      const snapshot = await readHoldingSnapshot(code, generatedAt, env);
      return {
        ...snapshot,
        cacheHit: false,
        cacheSource: 'live',
        cacheKey: key
      };
    } catch (error) {
      return {
        ok: false,
        code,
        error: error instanceof Error ? error.message : `${code} 净值更新失败。`,
        updatedAt: generatedAt,
        cacheHit: false,
        cacheSource: 'live',
        cacheKey: key
      };
    }
  });

  const successCount = items.filter((item) => item.ok === true).length;
  const failureCount = items.length - successCount;

  return {
    ok: true,
    generatedAt,
    expiresAt: epochMsToShanghaiIso(Date.parse(generatedAt) + ttlMs),
    successCount,
    failureCount,
    cache: {
      key,
      hit: false,
      source: 'live',
      stale: false,
      codeCount: codes.length
    },
    items
  };
}

async function readRequestedHoldingCodes(request) {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    return normalizeRequestedHoldingCodes(url.searchParams.get('codes') || '');
  }

  if (request.method === 'POST') {
    let payload = {};
    try {
      payload = await request.json();
    } catch (_error) {
      payload = {};
    }
    return normalizeRequestedHoldingCodes(payload?.codes || []);
  }

  return [];
}

export async function handleHoldingsNav(request, env) {
  const codes = await readRequestedHoldingCodes(request);
  if (!codes.length) {
    return jsonResponse({
      error: '请求中缺少有效的 6 位基金代码。'
    }, 400);
  }

  if (codes.length > 60) {
    return jsonResponse({
      error: '单次最多查询 60 个基金代码。'
    }, 400);
  }

  const reqUrl = new URL(request.url);
  const forceBypass = reqUrl.searchParams.get('force') === '1' || reqUrl.searchParams.get('refresh') === '1';
  const cacheNow = new Date();
  const baseTtlMs = getHoldingsNavCacheTtlMs(env);

  const exchangeCodes = codes.filter((c) => isExchangeFundCode(c));
  const otcCodes = codes.filter((c) => !isExchangeFundCode(c));

  const exchangeTtlMs = computeExchangeNavTtlMs(baseTtlMs, cacheNow);
  const otcTtlMs = computeNonExchangeNavTtlMs(baseTtlMs, cacheNow);

  const [exchangePayload, otcPayload] = await Promise.all([
    exchangeCodes.length
      ? resolveHoldingsGroup({ request, env, codes: exchangeCodes, ttlMs: exchangeTtlMs, forceBypass })
      : Promise.resolve(null),
    otcCodes.length
      ? resolveHoldingsGroup({ request, env, codes: otcCodes, ttlMs: otcTtlMs, forceBypass })
      : Promise.resolve(null)
  ]);

  const itemsByCode = new Map();
  if (exchangePayload && Array.isArray(exchangePayload.items)) {
    for (const it of exchangePayload.items) itemsByCode.set(it.code, it);
  }
  if (otcPayload && Array.isArray(otcPayload.items)) {
    for (const it of otcPayload.items) itemsByCode.set(it.code, it);
  }
  const items = codes.map((c) => itemsByCode.get(c)).filter(Boolean);
  const successCount = items.filter((i) => i && i.ok === true).length;
  const failureCount = items.length - successCount;
  const generatedAt = (exchangePayload && exchangePayload.generatedAt)
    || (otcPayload && otcPayload.generatedAt)
    || nowShanghaiIso();
  const expCandidates = [exchangePayload, otcPayload]
    .filter(Boolean)
    .map((p) => Date.parse(String(p.expiresAt || '')))
    .filter((n) => Number.isFinite(n));
  const expiresAt = expCandidates.length
    ? epochMsToShanghaiIso(Math.min(...expCandidates))
    : generatedAt;
  const groups = [exchangePayload, otcPayload].filter(Boolean);
  const allHit = groups.length > 0 && groups.every((g) => g && g.cache && g.cache.hit === true);
  const anyLive = groups.some((g) => g && g.cache && g.cache.source === 'live');
  const cacheSource = anyLive ? 'live' : ((groups[0] && groups[0].cache && groups[0].cache.source) || 'edge-cache');

  return jsonResponse({
    ok: true,
    generatedAt,
    expiresAt,
    successCount,
    failureCount,
    cache: {
      key: [exchangePayload && exchangePayload.cache && exchangePayload.cache.key,
            otcPayload && otcPayload.cache && otcPayload.cache.key].filter(Boolean).join('+'),
      hit: allHit,
      source: cacheSource,
      stale: false,
      codeCount: codes.length,
      groups: {
        exchange: exchangePayload ? {
          count: (exchangePayload.items && exchangePayload.items.length) || 0,
          source: (exchangePayload.cache && exchangePayload.cache.source) || '',
          hit: !!(exchangePayload.cache && exchangePayload.cache.hit === true),
          ttlMs: exchangeTtlMs
        } : null,
        otc: otcPayload ? {
          count: (otcPayload.items && otcPayload.items.length) || 0,
          source: (otcPayload.cache && otcPayload.cache.source) || '',
          hit: !!(otcPayload.cache && otcPayload.cache.hit === true),
          ttlMs: otcTtlMs
        } : null
      }
    },
    items
  });
}

async function resolveHoldingsGroup({ request, env, codes, ttlMs, forceBypass }) {
  const key = await buildHoldingsCacheKey(codes);
  const cacheRequest = buildHoldingsCacheRequest(new URL(request.url), key, codes);

  if (forceBypass) {
    try { await caches.default.delete(cacheRequest); } catch (_e) { /* ignore */ }
  } else {
    const cachedResponse = await caches.default.match(cacheRequest);
    if (cachedResponse) {
      try {
        const payload = await cachedResponse.json();
        if (isHoldingsPayloadFresh(payload, ttlMs)) {
          return withHoldingsCacheMeta(payload, {
            key, hit: true, source: 'edge-cache', stale: false, codeCount: codes.length
          });
        }
      } catch (_error) { /* fall through */ }
    }
    const baselinePayload = await readHoldingsBaselinePayload(request, env, key, ttlMs, codes);
    if (baselinePayload) return baselinePayload;
  }

  const livePayload = await fetchLiveHoldingsNavPayload(codes, env, key, ttlMs);
  if (livePayload.failureCount === 0) {
    const cacheResponse = jsonResponse(livePayload, 200, {
      'cache-control': `public, max-age=${Math.max(Math.floor(ttlMs / 1000), 60)}`
    });
    await caches.default.put(cacheRequest, cacheResponse.clone());
  }
  return livePayload;
}
