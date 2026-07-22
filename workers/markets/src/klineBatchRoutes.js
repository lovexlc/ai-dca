import { errorJson, json, requireMarketsAdminRequest } from './marketRuntime.js';
import { runAfterMarketCloseTask, saveKlineDataBatch } from './klineBatchSaver.js';

export async function handleKlineBatchSave(env, request, body, ctx) {
  const unauthorized = requireMarketsAdminRequest(request, env);
  if (unauthorized) return unauthorized;
  const market = String((body && body.market) || '').toLowerCase();
  if (market !== 'us' && market !== 'cn') {
    return errorJson('market must be "us" or "cn"', 400);
  }

  const symbols = Array.isArray(body?.symbols)
    ? body.symbols.map((s) => String(s || '').trim()).filter(Boolean)
    : null;
  const intervals = Array.isArray(body?.intervals)
    ? body.intervals.map((s) => String(s || '').trim()).filter(Boolean)
    : null;
  const preferSina = body?.preferSina === true || body?.preferSina === 1 || body?.preferSina === '1';
  const wait = body?.wait === true || body?.wait === 1 || body?.wait === '1';
  const concurrency = Math.max(1, Math.min(Number(body?.concurrency) || 3, 8));
  const skipExisting = body?.skipExisting === true || body?.skipExisting === 1 || body?.skipExisting === '1';
  const hasScopedJob = Boolean((symbols && symbols.length) || (intervals && intervals.length) || preferSina);

  // Scoped jobs (symbols/intervals/preferSina) run saveKlineDataBatch directly.
  // Full-market jobs keep the after-close entry for history KV logging.
  if (hasScopedJob) {
    const options = {
      concurrency,
      skipExisting,
      preferSina,
      details: wait,
      ...(symbols && symbols.length ? { symbols } : {}),
      ...(intervals && intervals.length ? { intervals } : {})
    };
    if (wait) {
      try {
        const results = await saveKlineDataBatch(env, market, options);
        return json({
          ok: true,
          mode: 'scoped-wait',
          market,
          preferSina,
          results,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error(`[kline-batch] Scoped wait failed for ${market}:`, err);
        return errorJson((err && err.message) || err, 500);
      }
    }
    ctx.waitUntil(
      saveKlineDataBatch(env, market, options).catch((err) => {
        console.error(`[kline-batch] Scoped trigger failed for ${market}:`, err);
      })
    );
    return json({
      ok: true,
      mode: 'scoped-async',
      message: `Scoped kline batch started for ${market}`,
      market,
      preferSina,
      symbols: symbols || 'default-tracking',
      intervals: intervals || 'default-intervals',
      timestamp: new Date().toISOString()
    });
  }

  // 在后台运行，立即返回
  ctx.waitUntil(
    runAfterMarketCloseTask(env, market).catch((err) => {
      console.error(`[kline-batch] Manual trigger failed for ${market}:`, err);
    })
  );

  return json({
    ok: true,
    mode: 'full-async',
    message: `K-line batch save task started for ${market} market`,
    market,
    timestamp: new Date().toISOString()
  });
}
