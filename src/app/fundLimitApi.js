import { apiUrl } from './apiBase.js';

function normalizeFundLimitCode(value = '') {
  const raw = String(value || '').trim();
  const prefixed = /^(sh|sz|bj|jj)(\d{6})$/i.exec(raw);
  if (prefixed) return prefixed[2];
  const match = raw.match(/(\d{6})/);
  return match ? match[1] : '';
}

export function normalizeFundLimitEntries(items = []) {
  const dataByCode = {};
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.ok || !item?.data || typeof item.data !== 'object') continue;
    const code = normalizeFundLimitCode(item.data.code || item.code);
    if (!/^\d{6}$/.test(code)) continue;
    dataByCode[code] = { ...item.data, code };
  }
  return dataByCode;
}

function normalizeFundLimitPayload(payload, fallbackCode = '') {
  if (!payload || typeof payload !== 'object') return null;
  const code = normalizeFundLimitCode(payload.code || fallbackCode);
  if (!/^\d{6}$/.test(code)) return null;
  return { ...payload, code };
}

/**
 * The browser-side contract for the OCR fund-limit proxy.
 * GET is cache-only; refresh uses the proxy's explicit POST path.
 */
export async function fetchFundLimit(code, { refresh = false, signal } = {}) {
  const normalizedCode = normalizeFundLimitCode(code);
  if (!normalizedCode) return null;
  const response = await fetch(
    refresh ? apiUrl('/api/fund-limit') : apiUrl('/api/fund-limit', { code: normalizedCode }),
    {
      method: refresh ? 'POST' : 'GET',
      headers: refresh ? { accept: 'application/json', 'content-type': 'application/json' } : { accept: 'application/json' },
      ...(refresh ? { body: JSON.stringify({ code: normalizedCode }) } : {}),
      signal,
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('fund limit api HTTP ' + response.status);
  return normalizeFundLimitPayload(await response.json(), normalizedCode);
}
