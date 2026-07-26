/**
 * Scheduled write path: pull ocr-proxy fund-limit *cache* (GET only) into D1.
 * Does not scrape Eastmoney/LLM here — ocr-proxy cron owns source refresh.
 * Read paths (list-rows / quotes) never call this.
 */
import { hasOtcD1, upsertOtcFundLimit } from './otcFundD1.js';
import { OTC_ALL_FUNDS } from './otcFundList.js';
import { mapLimit } from './marketRuntime.js';

function normalizeCode(raw) {
  return String(raw || '').replace(/^(sh|sz|bj|jj)/i, '').replace(/\D/g, '').slice(0, 6);
}

/**
 * Public fund-limit base (ocr-proxy). Override with env.FUND_LIMIT_API_BASE.
 */
export function fundLimitApiBase(env = {}) {
  const raw = String(env.FUND_LIMIT_API_BASE || env.PUBLIC_API_BASE || '').trim().replace(/\/$/, '');
  if (raw) return raw;
  // Default production host; test workers should set FUND_LIMIT_API_BASE in wrangler vars.
  return 'https://api.freebacktrack.tech';
}

export function limitRowFromFundLimitResponse(data, code) {
  if (!data || typeof data !== 'object') return null;
  const c = normalizeCode(data.code || code);
  if (!/^\d{6}$/.test(c)) return null;
  // Cache miss / error shapes from ocr
  if (data.error && data.buyStatus == null && data.maxPurchasePerDay == null && data.minPurchase == null) {
    return null;
  }
  return {
    code: c,
    name: data.name || undefined,
    buyStatus: data.buyStatus ?? null,
    buyStatusText: data.buyStatusText ?? null,
    minPurchase: data.minPurchase ?? null,
    maxPurchasePerDay: data.maxPurchasePerDay ?? null,
    limitChannel: data.limitChannel ?? null,
    redeemStatus: data.redeemStatus ?? null,
    fixedInvest: data.fixedInvest ?? null,
    fixedInvestMin: data.fixedInvestMin ?? null,
    confirmDays: data.confirmDays ?? null,
    source: data.source || 'fund-limit-cache',
    sourceTitle: data.sourceTitle,
    sourceUrl: data.sourceUrl,
    publishDate: data.publishDate,
    effectiveDate: data.effectiveDate,
    artCode: data.artCode,
    notice: data.notice,
    fetchedAt: data.fetchedAt,
  };
}

/**
 * GET one code from ocr cache-only endpoint (no force refresh).
 * Prefer env.OCR service binding (same-account, no public hop); fall back to HTTP.
 */
export async function fetchFundLimitCacheHttp(env, code) {
  const c = normalizeCode(code);
  if (!/^\d{6}$/.test(c)) return { ok: false, code: c, reason: 'bad_code' };
  // Service binding must use a stable internal host; public hostname can mis-route
  // when the Worker is only bound on a path pattern.
  const publicUrl = `${fundLimitApiBase(env)}/api/fund-limit?code=${encodeURIComponent(c)}`;
  const serviceUrl = `https://internal/api/fund-limit?code=${encodeURIComponent(c)}`;
  const init = {
    method: 'GET',
    headers: { accept: 'application/json' },
  };
  try {
    let res;
    if (env?.OCR && typeof env.OCR.fetch === 'function') {
      res = await env.OCR.fetch(new Request(serviceUrl, init));
    } else {
      res = await fetch(publicUrl, { ...init, cf: { cacheTtl: 0, cacheEverything: false } });
    }
    const textBody = await res.text();
    let body = null;
    try {
      body = textBody ? JSON.parse(textBody) : null;
    } catch {
      body = null;
    }
    if (res.status === 404) return { ok: false, code: c, reason: 'cache_miss', status: 404 };
    if (!res.ok) {
      return {
        ok: false,
        code: c,
        reason: 'http_' + res.status,
        status: res.status,
        error: (body && body.error) || textBody.slice(0, 120) || null,
      };
    }
    const row = limitRowFromFundLimitResponse(body, c);
    if (!row) {
      return {
        ok: false,
        code: c,
        reason: 'empty_payload',
        status: res.status,
        error: textBody.slice(0, 160) || null,
      };
    }
    return { ok: true, code: c, data: row };
  } catch (err) {
    return {
      ok: false,
      code: c,
      reason: 'fetch_error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Batch: ocr FUND_LIMIT_KV (via HTTP GET) → D1 otc_funds limit columns.
 * @returns {{ total, cacheHit, d1Ok, d1Failed, miss, errors }}
 */
export async function syncOtcFundLimitsFromCache(env, fundCodes = OTC_ALL_FUNDS, { concurrency = 6 } = {}) {
  const codes = [];
  const seen = new Set();
  for (const raw of fundCodes || []) {
    const c = normalizeCode(raw);
    if (!/^\d{6}$/.test(c) || seen.has(c)) continue;
    seen.add(c);
    codes.push(c);
  }

  const summary = {
    total: codes.length,
    cacheHit: 0,
    miss: 0,
    d1Ok: 0,
    d1Failed: 0,
    skippedNoDb: false,
    errors: [],
  };

  if (!codes.length) return summary;
  if (!hasOtcD1(env)) {
    summary.skippedNoDb = true;
    return summary;
  }

  const db = env.DB;
  const fetched = await mapLimit(codes, concurrency, (code) => fetchFundLimitCacheHttp(env, code));

  for (const item of fetched) {
    if (!item || item.__error) {
      summary.miss += 1;
      summary.errors.push({ code: '?', error: item?.__error || 'unknown' });
      continue;
    }
    if (!item.ok || !item.data) {
      summary.miss += 1;
      if (item.reason && item.reason !== 'cache_miss') {
        summary.errors.push({ code: item.code, error: item.reason, detail: item.error || null });
      }
      continue;
    }
    summary.cacheHit += 1;
    try {
      const r = await upsertOtcFundLimit(db, item.data);
      if (r.ok) summary.d1Ok += 1;
      else summary.d1Failed += 1;
    } catch (err) {
      summary.d1Failed += 1;
      summary.errors.push({
        code: item.code,
        error: err instanceof Error ? err.message : String(err),
        stage: 'd1',
      });
    }
  }

  return summary;
}

export async function syncOtcFundLimitsFromCacheTask(env, fundCodes = OTC_ALL_FUNDS) {
  console.log('[otc-limit-d1] pull cache → D1 for', (fundCodes || []).length, 'codes base=' + fundLimitApiBase(env));
  const results = await syncOtcFundLimitsFromCache(env, fundCodes, { concurrency: 6 });
  console.log(
    '[otc-limit-d1] done cacheHit=' + results.cacheHit
    + ' d1Ok=' + results.d1Ok
    + ' d1Failed=' + results.d1Failed
    + ' miss=' + results.miss
    + ' skippedNoDb=' + results.skippedNoDb
  );
  if (results.errors.length) {
    console.warn('[otc-limit-d1] errors sample', JSON.stringify(results.errors.slice(0, 8)));
  }
  return results;
}
