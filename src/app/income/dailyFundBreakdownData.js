import { getExpectedLatestNavDate, normalizeFundKind } from '../holdingsLedgerCore.js';

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function normalizeNavItems(series = []) {
  return (Array.isArray(series) ? series : [])
    .map((item) => ({
      date: String(item?.date || '').slice(0, 10),
      nav: Number(item?.nav)
    }))
    .filter((item) => isIsoDate(item.date) && Number.isFinite(item.nav))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function inferPreviousNavDate(series, latestNavDate, previousNav) {
  let fallback = '';
  let exact = '';
  for (const item of normalizeNavItems(series)) {
    if (item.date >= latestNavDate) continue;
    if (!fallback || item.date > fallback) fallback = item.date;
    if (Number.isFinite(previousNav) && Math.abs(item.nav - previousNav) < 1e-8) {
      exact = item.date;
    }
  }
  return exact || fallback;
}

export function kindNameByCode(txs) {
  const map = new Map();
  for (const tx of txs || []) {
    const code = String(tx?.code || '').trim();
    if (!code) continue;
    const prev = map.get(code) || {};
    map.set(code, {
      kind: prev.kind || tx?.kind || '',
      name: prev.name || String(tx?.name || '').trim()
    });
  }
  return map;
}

export function mergeSnapshotNavForDate(navByCode = {}, snapshotsByCode = {}, txMetaByCode = new Map(), selectedDate = '') {
  const next = { ...(navByCode || {}) };
  for (const [code, snapshot] of Object.entries(snapshotsByCode || {})) {
    if (!code || !snapshot) continue;
    const latestNav = Number(snapshot.latestNav);
    const previousNav = Number(snapshot.previousNav);
    const latestNavDate = String(snapshot.latestNavDate || '').slice(0, 10);
    const series = Array.isArray(next[code]) ? [...next[code]] : [];
    let previousNavDate = String(snapshot.previousNavDate || '').slice(0, 10);
    if (!Number.isFinite(latestNav) || latestNav <= 0) continue;
    if (!Number.isFinite(previousNav) || previousNav <= 0) continue;
    if (!isIsoDate(latestNavDate)) continue;
    if (!isIsoDate(previousNavDate)) {
      previousNavDate = inferPreviousNavDate(series, latestNavDate, previousNav);
    }
    if (!isIsoDate(previousNavDate) || previousNavDate >= selectedDate) continue;
    if (latestNavDate > selectedDate) continue;

    const meta = txMetaByCode.get(code) || {};
    const kind = normalizeFundKind(meta.kind, code, meta.name || snapshot.name || '');
    const expectedDate = getExpectedLatestNavDate(kind, selectedDate);
    if (!expectedDate || latestNavDate < expectedDate) continue;

    const byDate = new Map(normalizeNavItems(series).map((item) => [item.date, item.nav]));
    if (latestNavDate < selectedDate) {
      for (const date of Array.from(byDate.keys())) {
        if (date > previousNavDate && date < selectedDate) byDate.delete(date);
      }
    }
    byDate.set(previousNavDate, previousNav);
    byDate.set(selectedDate, latestNav);
    next[code] = Array.from(byDate.entries())
      .map(([date, nav]) => ({ date, nav }))
      .filter((item) => item.date && Number.isFinite(item.nav))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return next;
}
