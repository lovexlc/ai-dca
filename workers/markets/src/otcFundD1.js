/**
 * D1 storage for OTC (场外) funds — full quote + fund-limit columns.
 * KV remains the live quote cache; D1 is the SQL list / full-row store.
 */

import {
  decodeListCursor,
  encodeListCursor,
  normalizeOrderBy,
  normalizeFilters,
} from './listQuery.js';
import { OTC_FUND_NAME_BY_CODE } from './otcFundList.js';

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
 * Upsert the normalized fund-fee payload. Fee syncs and admin edits share the
 * same columns; quote/limit upserts intentionally leave them untouched.
 */
export async function upsertOtcFundFee(db, feePayload = {}) {
  if (!db || !feePayload) return { ok: false, reason: 'missing' };
  const code = normalizeCode(feePayload.code);
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: 'bad_code' };

  const syncedAt = nowIso();
  const feeJson = safeJsonStringify({ ...feePayload, code });
  await db.prepare(`
    INSERT INTO otc_funds (
      code, name, fee_fund_type,
      annual_fee_rate, management_fee_rate, custody_fee_rate,
      sales_service_fee_rate, redeem_fee_rate,
      fee_source, fee_notice, fee_json, fee_synced_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(code) DO UPDATE SET
      fee_fund_type = excluded.fee_fund_type,
      annual_fee_rate = excluded.annual_fee_rate,
      management_fee_rate = excluded.management_fee_rate,
      custody_fee_rate = excluded.custody_fee_rate,
      sales_service_fee_rate = excluded.sales_service_fee_rate,
      redeem_fee_rate = excluded.redeem_fee_rate,
      fee_source = excluded.fee_source,
      fee_notice = excluded.fee_notice,
      fee_json = excluded.fee_json,
      fee_synced_at = excluded.fee_synced_at,
      updated_at = datetime('now')
  `).bind(
    code,
    asText(feePayload.name, 128) || code,
    asText(feePayload.fundType, 32) || 'unknown',
    asFinite(feePayload.annualFeeRate),
    asFinite(feePayload.managementFeeRate),
    asFinite(feePayload.custodyFeeRate),
    asFinite(feePayload.salesServiceFeeRate),
    asFinite(feePayload.redeemFeeRate),
    asText(feePayload.source || 'fund-fee', 64),
    asText(feePayload.notice, 1000),
    feeJson,
    syncedAt
  ).run();
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
  const fundFee = d1RowToFundFee(row);
  const fromJson = parseJsonColumn(row.quote_json);
  if (fromJson && typeof fromJson === 'object' && (fromJson.latestNav != null || fromJson.name)) {
    return {
      ...fromJson,
      code: normalizeCode(fromJson.code || row.code),
      symbol: normalizeCode(fromJson.symbol || fromJson.code || row.code),
      fundLimit: d1RowToFundLimit(row) || fromJson.fundLimit || null,
      fundFee: fundFee || fromJson.fundFee || null,
      feeRate: fundFee?.annualFeeRate ?? fromJson.feeRate ?? null,
      redeemFeeRate: fundFee?.redeemFeeRate ?? fromJson.redeemFeeRate ?? null,
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
    fundFee,
    feeRate: fundFee?.annualFeeRate ?? null,
    redeemFeeRate: fundFee?.redeemFeeRate ?? null,
    fundKind: 'otc',
    kind: 'otc',
    _d1: true,
    _cached: true,
  };
}

export function d1RowToFundFee(row) {
  if (!row) return null;
  const fromJson = parseJsonColumn(row.fee_json);
  const hasFeeColumns = [
    row.annual_fee_rate,
    row.management_fee_rate,
    row.custody_fee_rate,
    row.sales_service_fee_rate,
    row.redeem_fee_rate,
    row.fee_json,
  ].some((value) => value != null && value !== '');
  if (!hasFeeColumns && !fromJson) return null;
  return {
    ...(fromJson && typeof fromJson === 'object' ? fromJson : {}),
    code: normalizeCode(row.code),
    fundType: row.fee_fund_type || fromJson?.fundType || 'unknown',
    annualFeeRate: asFinite(row.annual_fee_rate) ?? asFinite(fromJson?.annualFeeRate),
    managementFeeRate: asFinite(row.management_fee_rate) ?? asFinite(fromJson?.managementFeeRate),
    custodyFeeRate: asFinite(row.custody_fee_rate) ?? asFinite(fromJson?.custodyFeeRate),
    salesServiceFeeRate: asFinite(row.sales_service_fee_rate) ?? asFinite(fromJson?.salesServiceFeeRate),
    redeemFeeRate: asFinite(row.redeem_fee_rate) ?? asFinite(fromJson?.redeemFeeRate),
    source: row.fee_source || fromJson?.source || '',
    notice: row.fee_notice || fromJson?.notice || '',
    fetchedAt: row.fee_synced_at || fromJson?.fetchedAt || '',
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

export function d1RowToOtcListRow(row, heldSymbols = []) {
  const quote = d1RowToOtcQuote(row);
  if (!quote) return null;
  const code = normalizeCode(row.code);
  const heldCodes = new Set(normalizeListCodes(heldSymbols));
  const fallbackName = OTC_FUND_NAME_BY_CODE[code] || code;
  const name = quote.name && quote.name !== code ? quote.name : fallbackName;
  return {
    symbol: code,
    code,
    name,
    price: quote.latestNav ?? null,
    latestNav: quote.latestNav ?? null,
    latestNavDate: quote.latestNavDate || '',
    changePercent: quote.changePercent ?? null,
    ytdReturn: quote.ytdReturn ?? null,
    currentYearPercent: quote.ytdReturn ?? null,
    return1w: quote.return1w ?? null,
    return1m: quote.return1m ?? null,
    return3m: quote.return3m ?? null,
    return6m: quote.return6m ?? null,
    return1y: quote.return1y ?? null,
    returnBase: quote.returnBase ?? null,
    maxDrawdown: quote.maxDrawdown ?? null,
    fundSize: quote.fundSize ?? null,
    fundLimit: quote.fundLimit || null,
    fundFee: quote.fundFee || null,
    feeRate: quote.feeRate ?? quote.fundFee?.annualFeeRate ?? null,
    redeemFeeRate: quote.redeemFeeRate ?? quote.fundFee?.redeemFeeRate ?? null,
    fundKind: 'otc',
    kind: 'otc',
    assetType: 'otc_fund',
    exchange: '场外基金',
    market: 'cn',
    isHeld: heldCodes.has(code),
    source: quote.source || 'd1',
    asOf: quote.asOf || row.quote_synced_at || row.updated_at || '',
    quoteSyncedAt: row.quote_synced_at || '',
    limitSyncedAt: row.limit_synced_at || '',
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

const OTC_LIST_SELECT = `
  code, name, symbol,
  latest_nav, latest_nav_date, change_pct,
  ytd_return, return_1w, return_1m, return_3m, return_6m, return_1y, return_base,
  max_drawdown, fund_size, fund_type_code,
  source, as_of, quote_updated_at, quote_synced_at,
  buy_status, buy_status_text, min_purchase, max_purchase_per_day,
  limit_channel, redeem_status, fixed_invest, fixed_invest_min, confirm_days,
  limit_source, limit_synced_at
  , fee_fund_type, annual_fee_rate, management_fee_rate, custody_fee_rate,
  sales_service_fee_rate, redeem_fee_rate, fee_source, fee_notice, fee_json, fee_synced_at
`;

const OTC_LIST_ORDER_FIELDS = Object.freeze({
  changePercent: { expression: 'change_pct', kind: 'number' },
  price: { expression: 'latest_nav', kind: 'number' },
  currentYearPercent: { expression: 'ytd_return', kind: 'number' },
  ytdReturn: { expression: 'ytd_return', kind: 'number' },
  return1w: { expression: 'return_1w', kind: 'number' },
  return1m: { expression: 'return_1m', kind: 'number' },
  return3m: { expression: 'return_3m', kind: 'number' },
  return6m: { expression: 'return_6m', kind: 'number' },
  return1y: { expression: 'return_1y', kind: 'number' },
  returnBase: { expression: 'return_base', kind: 'number' },
  maxDrawdown: { expression: 'max_drawdown', kind: 'number' },
  fundSize: { expression: 'fund_size', kind: 'number' },
  feeRate: { expression: 'annual_fee_rate', kind: 'number' },
  redeemFeeRate: { expression: 'redeem_fee_rate', kind: 'number' },
  limit: {
    expression: `CASE
      WHEN buy_status = 'open' AND (max_purchase_per_day IS NULL OR max_purchase_per_day = 0) THEN 1000000000000000000
      WHEN buy_status IN ('suspended', 'closed') THEN 0
      ELSE COALESCE(max_purchase_per_day, 0)
    END`,
    kind: 'number',
  },
  name: { expression: 'name COLLATE NOCASE', kind: 'text' },
  symbol: { expression: 'code COLLATE NOCASE', kind: 'text' },
});

export const OTC_D1_LIST_SORT_FIELDS = Object.freeze([
  'heldRank',
  ...Object.keys(OTC_LIST_ORDER_FIELDS),
]);

function normalizeListCode(raw) {
  return normalizeCode(raw).replace(/\D/g, '').slice(0, 6);
}

function normalizeListCodes(values = []) {
  const result = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const code = normalizeListCode(raw);
    if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result;
}

function asListNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cursorValueForRow(row, field, heldCodes) {
  if (field === 'heldRank') return heldCodes.has(normalizeListCode(row?.code)) ? 1 : 0;
  if (field === 'limit') {
    const status = String(row?.buy_status || '').toLowerCase();
    if (status === 'open' && (row?.max_purchase_per_day == null || Number(row.max_purchase_per_day) === 0)) {
      return Number.POSITIVE_INFINITY;
    }
    if (status === 'suspended' || status === 'closed') return 0;
    return asListNumber(row?.max_purchase_per_day);
  }
  const mapping = OTC_LIST_ORDER_FIELDS[field];
  if (!mapping) return null;
  if (mapping.kind === 'text') return String(field === 'symbol' ? row?.code : row?.name || '').toLowerCase();
  return asListNumber(row?.[mapping.expression]);
}

function reviveCursorValue(value) {
  if (value && typeof value === 'object' && value.__num === 'inf') return Number.POSITIVE_INFINITY;
  if (value && typeof value === 'object' && value.__num === '-inf') return Number.NEGATIVE_INFINITY;
  return value;
}

function bindableCursorValue(value) {
  const revived = reviveCursorValue(value);
  if (revived === Number.POSITIVE_INFINITY) return 1000000000000000000;
  if (revived === Number.NEGATIVE_INFINITY) return -1000000000000000000;
  return revived == null ? null : revived;
}

function filterExpression(field) {
  if (field === 'price') return 'latest_nav';
  if (field === 'changePercent') return 'change_pct';
  if (field === 'currentYearPercent' || field === 'ytdReturn') return 'ytd_return';
  if (field === 'return1w') return 'return_1w';
  if (field === 'return1m') return 'return_1m';
  if (field === 'return3m') return 'return_3m';
  if (field === 'return6m') return 'return_6m';
  if (field === 'return1y') return 'return_1y';
  if (field === 'returnBase') return 'return_base';
  if (field === 'maxDrawdown') return 'max_drawdown';
  if (field === 'fundSize') return 'fund_size';
  if (field === 'feeRate') return 'annual_fee_rate';
  if (field === 'redeemFeeRate') return 'redeem_fee_rate';
  if (field === 'name') return 'name';
  if (field === 'symbol') return 'code';
  return null;
}

function appendFilterSql(filters, heldCodes, where, bindings) {
  for (const filter of normalizeFilters(filters)) {
    const field = String(filter.field || '').trim();
    const value = filter.value;
    if (field === 'q' || field === 'query' || field === 'search') {
      const query = `%${String(value || '').trim()}%`;
      if (query === '%%') continue;
      where.push('(code LIKE ? OR name LIKE ?)');
      bindings.push(query, query);
      continue;
    }
    if (field === 'held' || field === 'isHeld' || field === 'heldRank') {
      if (!heldCodes.size) {
        if (filter.op === 'eq' && Boolean(value)) where.push('1 = 0');
        continue;
      }
      const placeholders = Array.from(heldCodes, () => '?').join(',');
      if (filter.op === 'eq' && Boolean(value)) {
        where.push(`code IN (${placeholders})`);
        bindings.push(...heldCodes);
      } else if (filter.op === 'eq' && !Boolean(value)) {
        where.push(`code NOT IN (${placeholders})`);
        bindings.push(...heldCodes);
      }
      continue;
    }
    if (field === 'limit') {
      const values = Array.isArray(value) ? value.map((item) => String(item)) : [String(value || '')];
      if (filter.op === 'in' && values.length) {
        const clauses = [];
        for (const item of values) {
          if (item === 'app') clauses.push("limit_channel = 'app'");
          else if (item === 'none') clauses.push('(buy_status IS NULL AND max_purchase_per_day IS NULL)');
          else clauses.push('buy_status = ?');
        }
        where.push(`(${clauses.join(' OR ')})`);
        values.forEach((item) => {
          if (!['app', 'none'].includes(item)) bindings.push(item);
        });
      }
      continue;
    }
    const expression = filterExpression(field);
    if (!expression) continue;
    if (filter.op === 'contains') {
      where.push(`${expression} LIKE ?`);
      bindings.push(`%${String(value || '').trim()}%`);
      continue;
    }
    if (filter.op === 'in' && Array.isArray(value) && value.length) {
      where.push(`${expression} IN (${value.map(() => '?').join(',')})`);
      bindings.push(...value);
      continue;
    }
    if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(filter.op)) {
      const operator = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' }[filter.op];
      where.push(`${expression} ${operator} ?`);
      bindings.push(value);
    }
  }
}

function buildCursorPredicate(orderBy, cursor, bindings) {
  const tuple = Array.isArray(cursor?.tuple) ? cursor.tuple : [];
  if (!tuple.length) return '';
  const prefix = [];
  const prefixBindings = [];
  const terms = [];
  for (let index = 0; index < orderBy.length; index += 1) {
    const spec = orderBy[index];
    const mapping = spec.field === 'heldRank'
      ? { expression: 'held_rank', kind: 'number' }
      : OTC_LIST_ORDER_FIELDS[spec.field];
    if (!mapping) continue;
    const value = reviveCursorValue(tuple[index]?.value);
    const isNull = value == null || value === '';
    const nullExpr = `(${mapping.expression} IS NULL)`;
    if (!isNull) {
      const comparison = spec.dir === 'desc' ? '<' : '>';
      terms.push({
        sql: `(${prefix.length ? `${prefix.join(' AND ')} AND ` : ''}(${nullExpr} = 1 OR (${nullExpr} = 0 AND ${mapping.expression} ${comparison} ?)))`,
        bindings: [...prefixBindings, bindableCursorValue(value)],
      });
    }
    prefix.push(isNull ? `${nullExpr} = 1` : `(${nullExpr} = 0 AND ${mapping.expression} = ?)`);
    if (!isNull) prefixBindings.push(bindableCursorValue(value));
  }
  terms.forEach((term) => bindings.push(...term.bindings));
  return terms.length ? `(${terms.map((term) => term.sql).join(' OR ')})` : '';
}

function orderBySql(orderBy) {
  const clauses = [];
  for (const spec of orderBy) {
    const mapping = spec.field === 'heldRank'
      ? { expression: 'held_rank' }
      : OTC_LIST_ORDER_FIELDS[spec.field];
    if (!mapping) continue;
    clauses.push(`(${mapping.expression} IS NULL) ASC`);
    clauses.push(`${mapping.expression} ${spec.dir === 'desc' ? 'DESC' : 'ASC'}`);
  }
  return clauses.join(', ');
}

/**
 * Query the OTC list directly in D1. This is the actual SQL ORDER BY path;
 * quote KV/D1 enrichment is intentionally not performed on a read miss here.
 */
export async function queryOtcFundListPage(db, {
  symbols = [],
  heldSymbols = [],
  orderBy,
  filters = [],
  limit = 20,
  cursor = null,
} = {}) {
  if (!db || typeof db.prepare !== 'function') return null;
  const requestedCodes = normalizeListCodes(symbols);
  const heldCodesList = normalizeListCodes(heldSymbols);
  const heldCodes = new Set(heldCodesList);
  const requestedOrderFields = Array.isArray(orderBy)
    ? orderBy.map((item) => String(item?.field || item?.id || '').trim()).filter(Boolean)
    : [];
  const normalizedOrder = normalizeOrderBy(orderBy).filter((spec) => (
    spec.field === 'heldRank' || Object.prototype.hasOwnProperty.call(OTC_LIST_ORDER_FIELDS, spec.field)
  ));
  const hasExplicitSupportedOrder = requestedOrderFields.some((field) => (
    field === 'heldRank' || Object.prototype.hasOwnProperty.call(OTC_LIST_ORDER_FIELDS, field)
  ));
  const effectiveOrder = hasExplicitSupportedOrder && normalizedOrder.length
    ? normalizedOrder
    : normalizeOrderBy([{ field: 'heldRank', dir: 'desc' }, { field: 'changePercent', dir: 'desc' }]);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  const where = [];
  const whereBindings = [];
  if (requestedCodes.length) {
    where.push(`code IN (${requestedCodes.map(() => '?').join(',')})`);
    whereBindings.push(...requestedCodes);
  }
  appendFilterSql(filters, heldCodes, where, whereBindings);

  const heldRankExpression = heldCodesList.length
    ? `CASE WHEN code IN (${heldCodesList.map(() => '?').join(',')}) THEN 1 ELSE 0 END`
    : '0';
  const baseFrom = `WITH base AS (
    SELECT ${OTC_LIST_SELECT}, ${heldRankExpression} AS held_rank
    FROM otc_funds
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  )`;
  const baseBindings = [...heldCodesList, ...whereBindings];
  const decodedCursor = decodeListCursor(cursor);
  const cursorBindings = [];
  const cursorSql = buildCursorPredicate(effectiveOrder, decodedCursor, cursorBindings);
  const selectSql = `${baseFrom}
    SELECT ${OTC_LIST_SELECT}, held_rank
    FROM base
    ${cursorSql ? `WHERE ${cursorSql}` : ''}
    ORDER BY ${orderBySql(effectiveOrder)}
    LIMIT ?`;
  const countSql = `${baseFrom}
    SELECT COUNT(*) AS n
    FROM base`;
  const [pageResult, countRow] = await Promise.all([
    db.prepare(selectSql).bind(...baseBindings, ...cursorBindings, safeLimit + 1).all(),
    db.prepare(countSql).bind(...baseBindings).first(),
  ]);
  const resultRows = Array.isArray(pageResult?.results) ? pageResult.results : [];
  const hasMore = resultRows.length > safeLimit;
  const rows = hasMore ? resultRows.slice(0, safeLimit) : resultRows;
  const nextCursor = hasMore && rows.length
    ? encodeListCursor({
        tuple: effectiveOrder.map((spec) => ({
          field: spec.field,
          dir: spec.dir,
          value: cursorValueForRow(rows[rows.length - 1], spec.field, heldCodes),
        })),
        symbol: rows[rows.length - 1].code,
      })
    : null;
  return {
    rows,
    total: Number(countRow?.n) || 0,
    nextCursor,
    hasMore,
    orderBy: effectiveOrder,
    source: 'd1',
  };
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
