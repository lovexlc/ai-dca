import { OTC_ALL_FUNDS } from './otcFundList.js';
import { upsertOtcFundFee } from './otcFundD1.js';

const MAX_SOURCE_BATCH_SIZE = 60;

function normalizeCode(raw) {
  return String(raw || '').replace(/^(sh|sz|bj|jj)/i, '').trim();
}

function normalizeCodes(values) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const code = normalizeCode(raw);
    if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result;
}

function chunk(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || 'invalid source response' };
  }
}

/**
 * Fill the OTC fee snapshot in D1 through the internal OCR service binding.
 * This is an admin/write path; list-rows never calls it.
 */
export async function refreshOtcFundFees(env = {}, { codes = OTC_ALL_FUNDS, force = true } = {}) {
  const requestedCodes = normalizeCodes(codes);
  if (!requestedCodes.length) {
    return { ok: false, target: 'cn-otc-fees', error: 'no valid OTC fund codes', requested: 0 };
  }
  if (!env?.DB || typeof env.DB.prepare !== 'function') {
    return { ok: false, target: 'cn-otc-fees', error: 'D1 binding unavailable', requested: requestedCodes.length };
  }
  if (!env?.OCR || typeof env.OCR.fetch !== 'function') {
    return { ok: false, target: 'cn-otc-fees', error: 'OCR service binding unavailable', requested: requestedCodes.length };
  }

  const failures = [];
  let sourceSuccessCount = 0;
  let d1WriteCount = 0;
  let sourceBatchCount = 0;

  // Keep source batches sequential. The OCR batch already limits its upstream
  // concurrency and serial batches avoid multiplying that load.
  for (const batchCodes of chunk(requestedCodes, MAX_SOURCE_BATCH_SIZE)) {
    sourceBatchCount += 1;
    let payload;
    try {
      const response = await env.OCR.fetch(
        `https://internal/api/fund-fee?refresh=${force ? '1' : '0'}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ codes: batchCodes })
        }
      );
      payload = await readJson(response);
      if (!response.ok) {
        failures.push({ codes: batchCodes, error: payload?.error || `OCR HTTP ${response.status}` });
        continue;
      }
    } catch (error) {
      failures.push({ codes: batchCodes, error: error instanceof Error ? error.message : String(error) });
      continue;
    }

    const itemsByCode = new Map(
      (Array.isArray(payload?.items) ? payload.items : [])
        .map((item) => [normalizeCode(item?.code), item])
        .filter(([code]) => code)
    );
    for (const code of batchCodes) {
      const item = itemsByCode.get(code);
      if (!item?.ok || !item.data) {
        failures.push({ code, error: item?.error || 'fee source returned no data', tried: item?.tried || [] });
        continue;
      }
      sourceSuccessCount += 1;
      try {
        const result = await upsertOtcFundFee(env.DB, { ...item.data, code }, { preserveExisting: true });
        if (result.ok) d1WriteCount += 1;
        else failures.push({ code, error: result.reason || 'D1 fee write skipped' });
      } catch (error) {
        failures.push({ code, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return {
    ok: failures.length === 0,
    target: 'cn-otc-fees',
    requested: requestedCodes.length,
    sourceBatchCount,
    sourceSuccessCount,
    d1WriteCount,
    failureCount: failures.length,
    failures: failures.slice(0, 100)
  };
}

export { normalizeCodes };
