import { fetchFundLimit, readFundLimitCache } from './fundLimit.js';
import { fetchFundFee, fetchFundFeesBatch } from './fundFee.js';
import { jsonResponse } from './ocrHttp.js';

function readCodesPayload(payload = {}) {
  if (Array.isArray(payload?.codes)) return payload.codes;
  if (typeof payload?.codes === 'string') return payload.codes.split(',');
  return [];
}

export async function handleFundLimit(request, env, ctx, searchParams = new URLSearchParams()) {
  if (request.method === 'POST') {
    let payload = {};
    try {
      payload = await request.json();
    } catch (_e) {
      payload = {};
    }
    if (Array.isArray(payload?.codes)) {
      return jsonResponse({ error: '基金限额手动刷新一次只能提交一个 code。' }, 400);
    }
    const code = String(payload?.code || '').trim();
    const result = await fetchFundLimit({ code, force: true, env, ctx });
    if (!result.ok) {
      return jsonResponse({ error: result.error, code: result.code, tried: result.tried || [] }, result.status || 502);
    }
    return jsonResponse(result.data);
  }

  const code = (searchParams.get('code') || '').trim();
  const result = await readFundLimitCache({ code, env });
  if (!result.ok) {
    return jsonResponse({ error: result.error, code: result.code }, result.status || 404);
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
