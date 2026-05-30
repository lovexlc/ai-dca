import { getExpectedLatestNavDate, normalizeFundKind } from '../holdingsLedgerCore.js';

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
    const previousNavDate = String(snapshot.previousNavDate || '').slice(0, 10);
    if (!Number.isFinite(latestNav) || latestNav <= 0) continue;
    if (!Number.isFinite(previousNav) || previousNav <= 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(latestNavDate)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(previousNavDate)) continue;
    if (latestNavDate > selectedDate) continue;

    const meta = txMetaByCode.get(code) || {};
    const kind = normalizeFundKind(meta.kind, code, meta.name || snapshot.name || '');
    const expectedDate = getExpectedLatestNavDate(kind, selectedDate);
    if (!expectedDate || latestNavDate < expectedDate) continue;

    const series = Array.isArray(next[code]) ? [...next[code]] : [];
    const byDate = new Map(series.map((item) => [String(item?.date || '').slice(0, 10), Number(item?.nav)]));
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
