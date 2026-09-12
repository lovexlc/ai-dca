const DEFAULT_COLLECTOR_BASE_URL = 'https://api.freebacktrack.tech/api/market-collector';
const MAX_QUOTE_AGE_MS = 120_000;
function text(value = '', max = 1000) { return String(value ?? '').trim().slice(0, max); }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : null; }
function baseUrl(env) { return text(env?.MARKET_COLLECTOR_BASE_URL || DEFAULT_COLLECTOR_BASE_URL).replace(/\/+$/, ''); }
function timestamp(value) { const parsed = Date.parse(text(value, 80)); return Number.isFinite(parsed) ? parsed : 0; }
function isCollectorSource(value = '') { const source = text(value, 120).toLowerCase(); return source.includes('market-collector') || source.includes('fund-collector'); }
function normalizeItem(item = {}, now = Date.now()) {
  const code = text(item.code || item.symbol, 12); const price = number(item.price ?? item.close); const iopv = number(item.iopv); const premiumPct = number(item.premiumPercent ?? item.computed_premium_percent); const asOf = text(item.asOf || item.collected_at || item.updatedAt, 80); const asOfMs = timestamp(asOf); const expiresAtMs = timestamp(item.expiresAt || item.expires_at); const quality = item.quality && typeof item.quality === 'object' ? item.quality : {}; const source = text(item.source, 120);
  const issues = Array.isArray(quality.issues) ? [...quality.issues] : [];
  if (!/^\d{6}$/.test(code)) issues.push('invalid_code');
  if (!(price > 0)) issues.push('missing_price');
  if (!Number.isFinite(premiumPct)) issues.push('missing_premium');
  if (item.suspended === true) issues.push('suspended');
  if (!isCollectorSource(source)) issues.push('invalid_source');
  if (!asOfMs || now - asOfMs > MAX_QUOTE_AGE_MS) issues.push('stale_quote');
  if (expiresAtMs && expiresAtMs <= now) issues.push('expired_quote');
  return { code, name: text(item.name || code, 80), price, iopv, premiumPct, asOf, expiresAt: text(item.expiresAt || item.expires_at, 80), source, orderBook: item.orderBook || null, valid: issues.length === 0 && quality.status !== 'missing', invalidReasons: Array.from(new Set(issues)) };
}
export async function fetchSwitchCollectorSnapshot(env, codes = []) {
  const requested = Array.from(new Set((codes || []).map((code) => text(code, 12)).filter((code) => /^\d{6}$/.test(code))));
  if (!requested.length) return { generatedAt: '', funds: {}, source: 'market-collector', successCount: 0, failureCount: 0 };
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  if (env?.MARKET_COLLECTOR_TOKEN) headers.authorization = `Bearer ${env.MARKET_COLLECTOR_TOKEN}`;
  const response = await fetch(`${baseUrl(env)}/fund-metrics`, { method: 'POST', headers, body: JSON.stringify({ codes: requested }), signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`market collector fund-metrics failed: HTTP ${response.status}`);
  const payload = await response.json().catch(() => ({}));
  if (!isCollectorSource(payload.source || 'market-collector')) throw new Error('market collector returned an unexpected source');
  const now = Date.now(); const funds = {};
  for (const raw of Array.isArray(payload.items) ? payload.items : []) { const item = normalizeItem(raw, now); if (requested.includes(item.code)) funds[item.code] = item; }
  for (const code of requested) if (!funds[code]) funds[code] = { code, name: code, price: null, iopv: null, premiumPct: null, asOf: '', expiresAt: '', source: 'market-collector', orderBook: null, valid: false, invalidReasons: ['missing_from_collector'] };
  return { generatedAt: text(payload.generatedAt || payload.generated_at, 80), funds, source: 'market-collector', successCount: Object.values(funds).filter((item) => item.valid).length, failureCount: Object.values(funds).filter((item) => !item.valid).length };
}
