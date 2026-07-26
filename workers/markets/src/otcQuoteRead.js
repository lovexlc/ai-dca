/**
 * OTC quote read path helpers (D1-first when enabled).
 * Writes stay in cron/admin (otcFundSync / otcFundLimitSync).
 */
import { hasOtcD1, loadOtcQuotesFromD1 } from './otcFundD1.js';
import { OTC_ALL_FUNDS } from './otcFundList.js';

/** Test (or OTC_READ_FROM_D1=1): list/quote OTC reads prefer D1 full rows. */
export function preferOtcReadFromD1(env = {}) {
  if (!hasOtcD1(env)) return false;
  const flag = String(env.OTC_READ_FROM_D1 || '').trim().toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'd1') return true;
  return String(env.MARKETS_ENV || '').trim().toLowerCase() === 'test';
}

export function isKnownOtcCode(raw, code) {
  const digits = String(raw || code || '').replace(/^(sh|sz|bj|jj)/i, '').replace(/\D/g, '').slice(0, 6);
  return /^\d{6}$/.test(digits) && OTC_ALL_FUNDS.includes(digits) ? digits : null;
}

/**
 * Batch-load D1 OTC quotes when preferOtcReadFromD1.
 * @returns {Promise<Record<string, object>|null>}
 */
export async function loadOtcD1QuotesIfEnabled(env, codes = []) {
  if (!preferOtcReadFromD1(env)) return null;
  const list = [];
  const seen = new Set();
  for (const raw of codes || []) {
    const c = String(raw || '').replace(/^(sh|sz|bj|jj)/i, '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(c) || seen.has(c)) continue;
    seen.add(c);
    list.push(c);
  }
  if (!list.length) return null;
  try {
    return await loadOtcQuotesFromD1(env.DB, list);
  } catch {
    return null;
  }
}

/**
 * Pick one D1 quote from a batch map.
 */
export function pickOtcD1Quote(d1Map, code, raw) {
  if (!d1Map) return null;
  const digits = String(code || raw || '').replace(/^(sh|sz|bj|jj)/i, '').replace(/\D/g, '').slice(0, 6);
  const q = d1Map[digits] || d1Map[raw] || d1Map[code];
  if (q && (q.latestNav != null || q.name)) return q;
  return null;
}
