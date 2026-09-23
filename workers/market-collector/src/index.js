// ai-dca-market-collector — Cloudflare-native port of lovexlc/fund_collector
// for the 23 CN exchange-fund snapshots (premium-switch workflow).
// No dependency on the cn host. Not wired into main flows yet (validation only).

import { collectOnce, classifySession, SYMBOLS } from './collect.js';

const KV_LATEST = 'mc:latest';
const KV_HEALTH = 'mc:health';

const KV_ABCHECK = 'mc:abcheck';
const CN_FUND_METRICS_URL = 'https://cn.freebacktrack.tech:5000/api/market-collector/fund-metrics';

async function readJson(env, key) {
  try {
    const raw = await env.MC_KV.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function runCollection(env) {
  const previous = await readJson(env, KV_LATEST);
  const { latest, health } = await collectOnce(SYMBOLS, previous);
  await env.MC_KV.put(KV_LATEST, JSON.stringify(latest), { expirationTtl: 86400 });
  await env.MC_KV.put(KV_HEALTH, JSON.stringify(health), { expirationTtl: 86400 });
  return { latest, health };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

async function runAbCheck(env) {
  // A/B: cn host API vs this worker, compared on CF's network; result -> KV.
  const latest = await readJson(env, KV_LATEST);
  const codes = (latest?.symbols || []).map((s) => s.symbol).filter(Boolean);
  let cnItems = null, cnError = null, cnStatus = null;
  try {
    const r = await fetch(CN_FUND_METRICS_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codes }),
      signal: AbortSignal.timeout(20000),
    });
    cnStatus = r.status;
    const j = await r.json().catch(() => null);
    cnItems = j?.items || null;
  } catch (e) { cnError = String(e?.message || e); }
  const cfByCode = new Map((latest?.symbols || []).map((s) => [s.symbol || s.code, s]));
  const cnByCode = new Map((cnItems || []).map((i) => [i.code || i.symbol, i]));
  const pick = (o, ...ks) => { for (const k of ks) if (o?.[k] != null) return o[k]; return null; };
  const rows = codes.map((c) => {
    const a = cfByCode.get(c) || {}, b = cnByCode.get(c) || {};
    const num = (x) => (x == null ? null : Math.round(Number(x) * 1e4) / 1e4);
    return {
      code: c,
      price: { cf: num(a.price), cn: num(pick(b, 'price')) },
      iopv: { cf: num(a.iopv), cn: num(pick(b, 'iopv')) },
      premium: { cf: num(a.computed_premium_percent), cn: num(pick(b, 'computed_premium_percent', 'premiumPercent')) },
      quality: { cf: a.quality?.status || null, cn: b.quality?.status || pick(b, 'qualityStatus') || null },
    };
  });
  const report = {
    at: new Date().toISOString(), cn_reachable: cnError == null, cn_error: cnError, cn_status: cnStatus,
    cn_items: (cnItems || []).length, rows,
  };
  await env.MC_KV.put(KV_ABCHECK, JSON.stringify(report), { expirationTtl: 86400 });
  return report;
}

async function handleFundMetrics(request, env) {
  let body = {};
  try { body = await request.json(); } catch {}
  const codes = [...new Set((body.codes || []).map((c) => String(c || '').trim()).filter((c) => /^\d{6}$/.test(c)))].slice(0, 60);
  if (!codes.length) return json({ error: 'codes_required' }, 400);
  const latest = await readJson(env, KV_LATEST);
  if (!latest) return json({ error: 'no_snapshot', codes }, 503);
  const byCode = new Map((latest.symbols || []).map((s) => [s.symbol || s.code, s]));
  const items = codes.map((c) => byCode.get(c)).filter(Boolean);
  if (!items.length) return json({ error: 'codes_not_found', codes }, 404);
  return json({
    items,
    successCount: items.length,
    failureCount: codes.length - items.length,
    generatedAt: items.map((i) => i.collected_at || '').sort().pop() || latest.generated_at || '',
    source: 'fund-collector',
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname.replace(/\/+$/, '') || '/';
    // tolerate being mounted under a zone-route prefix (e.g. /api/mc-preview, /api/mc)
    for (const prefix of ['/api/mc-preview', '/api/mc']) {
      if (path === prefix) path = '/';
      else if (path.startsWith(prefix + '/')) path = path.slice(prefix.length);
    }
    if (path === '/health' && request.method === 'GET') {
      const health = await readJson(env, KV_HEALTH);
      return json(health || { kind: 'market-collector-shadow-health', status: 'no_snapshot' });
    }
    if (path === '/fund-metrics' && request.method === 'POST') {
      return handleFundMetrics(request, env);
    }
    if (path === '/collect' && request.method === 'POST') {
      // manual trigger (validation); cron is the production path
      try {
        const { health } = await runCollection(env);
        return json({ ok: true, health });
      } catch (e) {
        return json({ ok: false, error: String(e?.message || e) }, 500);
      }
    }
    if (path === '/ab-check' && request.method === 'POST') {
      try {
        const report = await runAbCheck(env);
        return json({ ok: true, report });
      } catch (e) {
        return json({ ok: false, error: String(e?.message || e) }, 500);
      }
    }
    return json({ error: 'not_found', routes: ['GET /health', 'POST /fund-metrics', 'POST /collect', 'POST /ab-check'] }, 404);
  },

  async scheduled(event, env, ctx) {
    // heartbeat first: proves the cron fired even if collection throws
    ctx.waitUntil((async () => {
      try { await env.MC_KV.put('mc:tick', new Date().toISOString(), { expirationTtl: 3600 }); } catch {}
      // collect only during trading sessions; otherwise keep last snapshot.
      // FORCE_COLLECT=1 overrides the gate (validation / backfill).
      // AB_CHECK=1 also runs the cn A/B comparison (writes mc:abcheck).
      if (env.FORCE_COLLECT !== '1' && classifySession(new Date()) !== 'trading') return;
      try { await runCollection(env); }
      catch (e) {
        try { await env.MC_KV.put('mc:collect_error', String(e?.message || e).slice(0, 500), { expirationTtl: 3600 }); } catch {}
      }
      if (env.AB_CHECK === '1') {
        try { await runAbCheck(env); }
        catch (e) {
          try { await env.MC_KV.put('mc:abcheck_error', String(e?.message || e).slice(0, 500), { expirationTtl: 3600 }); } catch {}
        }
      }
    })());
  },
};
