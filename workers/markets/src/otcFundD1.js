/**
 * D1 storage for OTC (场外) funds — full quote + fund-limit columns.
 * KV remains the live quote cache; D1 is the SQL list / full-row store.
 */

function normalizeCode(raw) {
  return String(raw || '').replace(/^(sh|sz|bj|jj)/i, '').trim();
}

function asFinite(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /%$/.test(value.trim())) {
    const n = Number(String(value).replace('%', '').trim());
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asText(value, max = 512) {
  if (value == null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function parseJsonColumn(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

/** @returns {boolean} */
export function hasOtcD1(env = {}) {
  return !!(env && env.DB && typeof env.DB.prepare === 'function');
}

/**
 * Upsert danjuan-transformed quote (+ optional raw fullData) into otc_funds.
 * Does not clear limit_* columns.
 */
export async function upsertOtcFundQuote(db, quote, rawFullData = null) {
  if (!db || !quote) return { ok: false, reason: 'missing' };
  const code = normalizeCode(quote.code || quote.symbol);
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'bad_code' };

  const name = asText(quote.name || '', 128) || code;
  const syncedAt = nowIso();
  const quoteJson = safeJsonStringify(quote);
  const rawJson = rawFullData != null ? safeJsonStringify(rawFullData) : null;

  await db
    .prepare(
      `INSERT INTO otc_funds (
        code, name, symbol,
        latest_nav, latest_nav_date, change_pct,
        ytd_return, return_1w, return_1m, return_3m, return_6m, return_1y, return_base,
        max_drawdown, fund_size, fund_type_code,
        source, as_of, quote_updated_at, quote_synced_at,
        quote_json, raw_json, updated_at
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, datetime('now')
      )
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        symbol = excluded.symbol,
        latest_nav = excluded.latest_nav,
        latest_nav_date = excluded.latest_nav_date,
        change_pct = excluded.change_pct,
        ytd_return = excluded.ytd_return,
        return_1w = excluded.return_1w,
        return_1m = excluded.return_1m,
        return_3m = excluded.return_3m,
        return_6m = excluded.return_6m,
        return_1y = excluded.return_1y,
        return_base = excluded.return_base,
        max_drawdown = excluded.max_drawdown,
        fund_size = excluded.fund_size,
        fund_type_code = excluded.fund_type_code,
        source = excluded.source,
        as_of = excluded.as_of,
        quote_updated_at = excluded.quote_updated_at,
        quote_synced_at = excluded.quote_synced_at,
        quote_json = excluded.quote_json,
        raw_json = COALESCE(excluded.raw_json, otc_funds.raw_json),
        updated_at = datetime('now')`
    )
    .bind(
      code,
      name,
      code,
      asFinite(quote.latestNav),
      asText(quote.latestNavDate || '', 32) || null,
      asFinite(quote.changePercent),
      asFinite(quote.ytdReturn),
      asFinite(quote.return1w),
      asFinite(quote.return1m),
      asFinite(quote.return3m),
      asFinite(quote.return6m),
      asFinite(quote.return1y),
      asFinite(quote.returnBase),
      asFinite(quote.maxDrawdown),
      asFinite(quote.fundSize),
      asText(quote.fundTypeCode, 32),
      asText(quote.source || 'danjuan', 64),
      asText(quote.asOf || syncedAt, 64),
      asFinite(quote.updatedAt) ?? null,
      syncedAt,
      quoteJson,
      rawJson
    )
    .run();

  return { ok: true, code };
}

/**
 * Partial upsert of fund-limit fields onto otc_funds.
 */
export async function upsertOtcFundLimit(db, limitPayload) {
  if (!db || !limitPayload) return { ok: false, reason: 'missing' };
  const code = normalizeCode(limitPayload.code);
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'bad_code' };

  const syncedAt = nowIso();
  const limitJson = safeJsonStringify({ ...limitPayload, code });

  await db
    .prepare(
      `INSERT INTO otc_funds (
        code, name,
        buy_status, buy_status_text, min_purchase, max_purchase_per_day,
        limit_channel, redeem_status, fixed_invest, fixed_invest_min, confirm_days,
        limit_source, limit_json, limit_synced_at, updated_at
      ) VALUES (
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, datetime('now')
      )
      ON CONFLICT(code) DO UPDATE SET
        buy_status = excluded.buy_status,
        buy_status_text = excluded.buy_status_text,
        min_purchase = excluded.min_purchase,
        max_purchase_per_day = excluded.max_purchase_per_day,
        limit_channel = excluded.limit_channel,
        redeem_status = excluded.redeem_status,
        fixed_invest = excluded.fixed_invest,
        fixed_invest_min = excluded.fixed_invest_min,
        confirm_days = excluded.confirm_days,
        limit_source = excluded.limit_source,
        limit_json = excluded.limit_json,
        limit_synced_at = excluded.limit_synced_at,
        updated_at = datetime('now')`
    )
    .bind(
      code,
      asText(limitPayload.name, 128) || code,
      asText(limitPayload.buyStatus, 32),
      asText(limitPayload.buyStatusText, 128),
      asFinite(limitPayload.minPurchase),
      asFinite(limitPayload.maxPurchasePerDay),
      asText(limitPayload.limitChannel, 64),
      asText(limitPayload.redeemStatus, 64),
      asText(limitPayload.fixedInvest, 64),
      asFinite(limitPayload.fixedInvestMin),
      asFinite(limitPayload.confirmDays),
      asText(limitPayload.source || limitPayload.limitSource, 64),
      limitJson,
      syncedAt
    )
    .run();

  return { ok: true, code };
}

/**
 * Batch upsert limits (sequential; ~80 codes is fine).
 */
export async function upsertOtcFundLimits(db, limitsByCode = {}) {
  const codes = Object.keys(limitsByCode || {});
  let okCount = 0;
  const errors = [];
  for (const code of codes) {
    try {
      const payload = limitsByCode[code];
      if (!payload || typeof payload !== 'object') continue;
      const r = await upsertOtcFundLimit(db, { ...payload, code: payload.code || code });
      if (r.ok) okCount += 1;
    } catch (err) {
      errors.push({ code, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { okCount, total: codes.length, errors };
}

/**
 * Map a D1 row → quote-shaped object (compatible with transformOtcFundData / list rows).
 */
export function d1RowToOtcQuote(row) {
  if (!row || !row.code) return null;
  const fromJson = parseJsonColumn(row.quote_json);
  if (fromJson && typeof fromJson === 'object' && (fromJson.latestNav != null || fromJson.name)) {
    return {
      ...fromJson,
      code: normalizeCode(fromJson.code || row.code),
      symbol: normalizeCode(fromJson.symbol || fromJson.code || row.code),
      fundLimit: d1RowToFundLimit(row) || fromJson.fundLimit || null,
      _d1: true,
    };
  }

  const code = normalizeCode(row.code);
  return {
    code,
    symbol: code,
    name: row.name || code,
    price: null,
    currentPrice: null,
    close: null,
    changePercent: asFinite(row.change_pct),
    latestNav: asFinite(row.latest_nav),
    latestNavDate: row.latest_nav_date || '',
    ytdReturn: asFinite(row.ytd_return),
    return1w: asFinite(row.return_1w),
    return1m: asFinite(row.return_1m),
    return3m: asFinite(row.return_3m),
    return6m: asFinite(row.return_6m),
    return1y: asFinite(row.return_1y),
    returnBase: asFinite(row.return_base),
    maxDrawdown: asFinite(row.max_drawdown),
    fundSize: asFinite(row.fund_size),
    fundTypeCode: row.fund_type_code || null,
    source: row.source || 'd1',
    asOf: row.as_of || row.quote_synced_at || row.updated_at || '',
    updatedAt: asFinite(row.quote_updated_at) ?? 0,
    fundLimit: d1RowToFundLimit(row),
    fundKind: 'otc',
    kind: 'otc',
    _d1: true,
    _cached: true,
  };
}

export function d1RowToFundLimit(row) {
  if (!row) return null;
  const fromJson = parseJsonColumn(row.limit_json);
  if (fromJson && typeof fromJson === 'object' && (fromJson.buyStatus != null || fromJson.maxPurchasePerDay != null || fromJson.minPurchase != null)) {
    return { ...fromJson, code: normalizeCode(fromJson.code || row.code) };
  }
  if (
    row.buy_status == null
    && row.max_purchase_per_day == null
    && row.min_purchase == null
    && !row.buy_status_text
  ) {
    return null;
  }
  return {
    code: normalizeCode(row.code),
    buyStatus: row.buy_status || null,
    buyStatusText: row.buy_status_text || null,
    minPurchase: asFinite(row.min_purchase),
    maxPurchasePerDay: asFinite(row.max_purchase_per_day),
    limitChannel: row.limit_channel || null,
    redeemStatus: row.redeem_status || null,
    fixedInvest: row.fixed_invest || null,
    fixedInvestMin: asFinite(row.fixed_invest_min),
    confirmDays: asFinite(row.confirm_days),
    source: row.limit_source || null,
  };
}

/**
 * Load OTC rows by codes. Returns Map<code, d1Row>.
 */
export async function loadOtcFundRowsByCodes(db, codes = []) {
  const list = [];
  const seen = new Set();
  for (const raw of codes) {
    const c = normalizeCode(raw);
    if (!/^\d{6}$/.test(c) || seen.has(c)) continue;
    seen.add(c);
    list.push(c);
  }
  const map = new Map();
  if (!db || !list.length) return map;

  // D1: chunk IN clauses (keep well under bind limits).
  const CHUNK = 80;
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await db
      .prepare(`SELECT * FROM otc_funds WHERE code IN (${placeholders})`)
      .bind(...chunk)
      .all();
    const rows = Array.isArray(result?.results) ? result.results : [];
    for (const row of rows) {
      if (row?.code) map.set(normalizeCode(row.code), row);
    }
  }
  return map;
}

/**
 * Quotes map keyed by original symbol string (and by bare code).
 */
export async function loadOtcQuotesFromD1(db, symbols = []) {
  const rows = await loadOtcFundRowsByCodes(db, symbols);
  const out = {};
  for (const raw of symbols) {
    const code = normalizeCode(raw);
    const row = rows.get(code);
    if (!row) continue;
    const quote = d1RowToOtcQuote(row);
    if (!quote) continue;
    out[raw] = quote;
    out[code] = quote;
  }
  return out;
}

export async function countOtcFunds(db) {
  if (!db) return 0;
  const row = await db.prepare('SELECT COUNT(*) AS n FROM otc_funds').first();
  return Number(row?.n) || 0;
}

export async function sampleOtcFunds(db, limit = 10) {
  if (!db) return [];
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  const result = await db
    .prepare(
      `SELECT code, name, latest_nav, change_pct, return_1m, return_1y,
              max_purchase_per_day, buy_status, quote_synced_at, limit_synced_at
       FROM otc_funds
       ORDER BY (change_pct IS NULL), change_pct DESC, code ASC
       LIMIT ?`
    )
    .bind(n)
    .all();
  return Array.isArray(result?.results) ? result.results : [];
}

export { normalizeCode as normalizeOtcFundCode };
