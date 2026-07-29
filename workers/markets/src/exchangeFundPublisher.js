import { EXCHANGE_FUND_HUB_NAME, normalizeExchangeFundItem } from './exchangeFundSnapshot.js';

export async function publishExchangeFundSnapshot(env, items = [], generatedAt = new Date().toISOString()) {
  if (!env?.EXCHANGE_FUND_HUB || typeof env.EXCHANGE_FUND_HUB.getByName !== 'function') {
    return { ok: false, skipped: true, reason: 'EXCHANGE_FUND_HUB binding missing' };
  }
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => normalizeExchangeFundItem(item))
    .filter((item) => item && Number.isFinite(Number(item.price)) && Number(item.price) > 0);
  if (!normalized.length) return { ok: false, skipped: true, reason: 'empty exchange snapshot' };
  const hub = env.EXCHANGE_FUND_HUB.getByName(EXCHANGE_FUND_HUB_NAME);
  return hub.updateSnapshot({
    source: 'cn-batch-quotes',
    generatedAt,
    items: normalized,
  });
}
