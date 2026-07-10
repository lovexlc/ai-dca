import { apiUrl } from '../../app/apiBase.js';
import { normalizeCnFundCode } from './marketDisplayUtils.js';
import { normalizeFundLimitEntries, readCachedFundLimits, writeCachedFundLimits } from './marketsWatchData.js';

function visibleFundCodes(symbols = []) {
  return Array.from(new Set((symbols || [])
    .map((symbol) => normalizeCnFundCode(symbol))
    .filter((code) => /^[0-9]{6}$/.test(code))));
}

export function loadFundLimitsForVisibleCodes({ symbols = [], inflightRef, onData }) {
  const codes = visibleFundCodes(symbols);
  if (!codes.length) return undefined;

  const cached = readCachedFundLimits(codes);
  if (Object.keys(cached.dataByCode).length) onData(cached.dataByCode);

  if (cached.missing.length) {
    onData({}, cached.missing);
  }
  const missing = cached.missing.filter((code) => !inflightRef.current.has(code));
  if (!missing.length) return undefined;

  const requests = missing.map((code) => {
    const request = fetch(apiUrl('/api/fund-limit', { code }), { cache: 'no-store' });
    inflightRef.current.set(code, request);
    return request
      .then(async (response) => {
        if (!response.ok) return {};
        return normalizeFundLimitEntries([{ ok: true, code, data: await response.json() }]);
      })
      .catch(() => ({}))
      .finally(() => {
        if (inflightRef.current.get(code) === request) inflightRef.current.delete(code);
      });
  });

  Promise.all(requests).then((parts) => {
    const next = Object.assign({}, ...parts);
    if (!Object.keys(next).length) return;
    writeCachedFundLimits(next);
    onData(next);
  });
  return undefined;
}

export async function refreshFundLimitsForVisibleCodes({ symbols = [], onData }) {
  const codes = visibleFundCodes(symbols);
  if (!codes.length) return;
  const entries = await Promise.all(codes.map(async (code) => {
    try {
      const response = await fetch(apiUrl('/api/fund-limit'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
        cache: 'no-store',
      });
      if (!response.ok) return {};
      return normalizeFundLimitEntries([{ ok: true, code, data: await response.json() }]);
    } catch {
      return {};
    }
  }));
  const next = Object.assign({}, ...entries);
  if (!Object.keys(next).length) return;
  writeCachedFundLimits(next);
  onData(next);
}
