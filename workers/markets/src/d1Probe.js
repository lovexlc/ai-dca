/**
 * Minimal D1 smoke route for markets Worker (OTC full-row store).
 *
 * GET /d1-probe  (Authorization: Bearer <MARKETS_ADMIN_TOKEN>)
 *
 * Without env.DB: returns ok:false and setup hints.
 * With D1: SELECT 1, otc_funds count, ORDER BY change_pct sample.
 */
import { errorJson, json, requireMarketsAdminRequest } from './marketRuntime.js';
import { countOtcFunds, hasOtcD1, sampleOtcFunds, upsertOtcFundLimits } from './otcFundD1.js';
import { syncOtcFundLimitsFromCacheTask } from './otcFundLimitSync.js';
import { syncOtcFundsTask } from './otcFundSync.js';
import { OTC_ALL_FUNDS } from './otcFundList.js';

/**
 * @returns {Promise<Response|null>}
 */
export async function matchD1ProbeRequest(request, env, path) {
  if (path !== '/d1-probe' && path !== '/mysql-probe' && path !== '/otc-d1-limits') return null;
  if (request.method !== 'GET' && request.method !== 'POST') {
    return errorJson('method not allowed', 405);
  }

  const denied = requireMarketsAdminRequest(request, env);
  if (denied) return denied;

  // Admin write helpers (not used by public list/read paths)
  if (path === '/otc-d1-limits') {
    if (request.method !== 'POST') return errorJson('method not allowed', 405);
    if (!hasOtcD1(env)) {
      return json({ ok: false, bound: false, message: 'D1 binding DB missing' }, 503);
    }
    const body = await request.json().catch(() => ({}));
    // { "action": "sync-from-cache" } → pull ocr GET cache for all OTC codes into D1
    if (body?.action === 'sync-from-cache' || body?.syncFromCache === true) {
      const codes = Array.isArray(body?.codes) && body.codes.length ? body.codes : undefined;
      const result = await syncOtcFundLimitsFromCacheTask(env, codes);
      return json({ ok: true, mode: 'sync-from-cache', ...result, time: new Date().toISOString() });
    }
    // { "action": "sync-nav" } → pull danjuan → KV + D1 quote columns (scheduled write path)
    if (body?.action === 'sync-nav' || body?.syncNav === true) {
      const codes = Array.isArray(body?.codes) && body.codes.length ? body.codes : OTC_ALL_FUNDS;
      const result = await syncOtcFundsTask(env, codes);
      return json({ ok: true, mode: 'sync-nav', ...result, time: new Date().toISOString() });
    }
    const limits = body?.limits || body?.limitsByCode || null;
    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
      return errorJson('body.limits object required, or { "action": "sync-from-cache" | "sync-nav" }', 400);
    }
    const result = await upsertOtcFundLimits(env.DB, limits);
    return json({ ok: true, mode: 'upsert', okCount: result.okCount, total: result.total, errors: result.errors, time: new Date().toISOString() });
  }

  const db = env.DB;
  if (!db || typeof db.prepare !== 'function') {
    return json({
      ok: false,
      bound: false,
      engine: 'd1',
      message: 'D1 binding DB missing — add [[d1_databases]] to markets wrangler and redeploy',
      setup: [
        'D1 databases: ai-dca-markets-db-test / ai-dca-markets-db',
        'Ensure wrangler has binding = "DB" with the correct database_id',
        'Schema: workers/markets/migrations/0002_otc_funds_full.sql',
        'curl -H "Authorization: Bearer $MARKETS_ADMIN_TOKEN" .../api/markets/d1-probe'
      ],
      deprecatedPath: path === '/mysql-probe' ? 'use /d1-probe; MySQL/Hyperdrive plan deferred' : undefined,
      time: new Date().toISOString()
    });
  }

  const started = Date.now();
  try {
    const ping = await db.prepare('SELECT 1 AS ok').first();
    let otcFundsCount = 0;
    let sample = [];
    let table = 'otc_funds';
    try {
      otcFundsCount = await countOtcFunds(db);
      sample = await sampleOtcFunds(db, 10);
    } catch (tableErr) {
      // Fallback to probe-only table if 0002 not applied yet
      table = 'otc_fund_list';
      const countRow = await db.prepare('SELECT COUNT(*) AS n FROM otc_fund_list').first();
      otcFundsCount = Number(countRow?.n) || 0;
      const sampleResult = await db
        .prepare(
          `SELECT code, name, nav AS latest_nav, change_pct, updated_at
           FROM otc_fund_list
           ORDER BY (change_pct IS NULL), change_pct DESC, code ASC
           LIMIT 10`
        )
        .all();
      sample = Array.isArray(sampleResult?.results) ? sampleResult.results : [];
    }

    return json({
      ok: true,
      bound: true,
      engine: 'd1',
      table,
      latencyMs: Date.now() - started,
      ping: ping?.ok ?? 1,
      otcFundsCount,
      otcFundListCount: otcFundsCount,
      sample,
      note:
        path === '/mysql-probe'
          ? 'alias of /d1-probe; project uses D1 instead of MySQL for this scale'
          : undefined,
      time: new Date().toISOString()
    });
  } catch (err) {
    return json(
      {
        ok: false,
        bound: true,
        engine: 'd1',
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
        hint: 'If no such table: run migrations/0002_otc_funds_full.sql with wrangler d1 execute --remote',
        time: new Date().toISOString()
      },
      502
    );
  }
}

/** @deprecated use matchD1ProbeRequest */
export const matchMysqlProbeRequest = matchD1ProbeRequest;
