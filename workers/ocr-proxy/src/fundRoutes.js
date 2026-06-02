import { fetchFundLimit, fetchFundLimitsBatch } from './fundLimit.js';
import { fetchFundFee, fetchFundFeesBatch } from './fundFee.js';
import { jsonResponse } from './ocrHttp.js';

function readCodesPayload(payload = {}) {
  if (Array.isArray(payload?.codes)) return payload.codes;
  if (typeof payload?.codes === 'string') return payload.codes.split(',');
  return [];
}

export async function handleFundLimit(request, env, ctx, searchParams = new URLSearchParams()) {
  const force = searchParams.get('refresh') === '1' || searchParams.get('force') === '1';

  if (request.method === 'POST') {
    let payload = {};
    try {
      payload = await request.json();
    } catch (_e) {
      payload = {};
    }
    const rawCodes = readCodesPayload(payload);
    // 上限 60（与 holdings/nav 对齐）；防忖意传上千个 code。
    if (rawCodes.length > 60) {
      return jsonResponse({ error: '单次最多查询 60 个基金代码。' }, 400);
    }
    const batch = await fetchFundLimitsBatch({ codes: rawCodes, force, env, ctx, concurrency: 4 });
    if (!batch.ok) {
      return jsonResponse({ error: batch.error, items: [], successCount: 0, failureCount: 0 }, batch.status || 400);
    }
    return jsonResponse({
      items: batch.items,
      successCount: batch.successCount,
      failureCount: batch.failureCount,
      generatedAt: new Date().toISOString()
    });
  }

  const code = (searchParams.get('code') || '').trim();
  const result = await fetchFundLimit({ code, force, env, ctx });
  if (!result.ok) {
    return jsonResponse({
      error: result.error,
      code: result.code,
      tried: result.tried
    }, result.status || 502);
  }
  return jsonResponse(result.data);
}

export async function handleFundFee(request, env, ctx, searchParams = new URLSearchParams()) {
  const force = searchParams.get('refresh') === '1' || searchParams.get('force') === '1';

  if (request.method === 'POST') {
    let payload = {};
    try {
      payload = await request.json();
    } catch (_e) {
      payload = {};
    }
    const rawCodes = readCodesPayload(payload);
    if (rawCodes.length > 60) {
      return jsonResponse({ error: '单次最多查询 60 个基金代码。' }, 400);
    }
    const batch = await fetchFundFeesBatch({ codes: rawCodes, force, env, ctx, concurrency: 4 });
    if (!batch.ok) {
      return jsonResponse({ error: batch.error, items: [], successCount: 0, failureCount: 0 }, batch.status || 400);
    }
    return jsonResponse({
      items: batch.items,
      successCount: batch.successCount,
      failureCount: batch.failureCount,
      generatedAt: new Date().toISOString()
    });
  }

  const code = (searchParams.get('code') || '').trim();
  const result = await fetchFundFee({ code, force, env, ctx });
  if (!result.ok) {
    return jsonResponse({
      error: result.error,
      code: result.code,
      tried: result.tried
    }, result.status || 502);
  }
  return jsonResponse(result.data);
}
