import { buildSellPlan, evaluateSellSignals } from './sellStrategy.js';

function normalizeCode(value = '') {
  return String(value || '').trim().toUpperCase();
}

function addCode(set, value) {
  const code = normalizeCode(value);
  if (code) set.add(code);
}

function buildSwitchSignalKey(type, rule, from, to) {
  return ['switch', type, rule, from, to].map((part) => String(part || '').trim()).join(':');
}

function buildExitSignalKey(planId, code, highestTier) {
  const tierId = String(highestTier?.id || highestTier?.label || '').trim();
  const gainPct = Number.isFinite(Number(highestTier?.gainPct)) ? Number(highestTier.gainPct) : '';
  return ['exit', planId || code, code, tierId, gainPct].map((part) => String(part || '').trim()).join(':');
}

function collectSnapshotEntries(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const entries = [];
  if (Array.isArray(snapshot.signals) || snapshot.otcSignal) entries.push(snapshot);
  if (Array.isArray(snapshot.rules)) {
    snapshot.rules.forEach((entry) => {
      const nested = entry?.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : entry;
      if (nested && nested !== snapshot) entries.push(...collectSnapshotEntries(nested));
    });
  }
  return entries;
}

export function summarizeSwitchSignals(snapshot) {
  const entries = collectSnapshotEntries(snapshot);
  const signalRows = [];
  const codes = new Set();

  entries.forEach((entry) => {
    (Array.isArray(entry?.signals) ? entry.signals : []).forEach((signal) => {
      const from = normalizeCode(signal?.from);
      const to = normalizeCode(signal?.to);
      addCode(codes, from);
      addCode(codes, to);
      signalRows.push({
        key: buildSwitchSignalKey('intra', signal?.kind || '', from, to),
        type: 'intra',
        rule: signal?.kind || '',
        from,
        fromName: signal?.fromName || '',
        to,
        toName: signal?.toName || '',
        description: signal?.description || '',
      });
    });
    const otc = entry?.otcSignal;
    if (otc?.ready && otc?.triggered) {
      addCode(codes, otc.benchCode);
      addCode(codes, otc.lowestCode);
      const from = normalizeCode(otc.benchCode);
      const to = normalizeCode(otc.lowestCode);
      signalRows.push({
        key: buildSwitchSignalKey('otc', otc.rule || '', from, to),
        type: 'otc',
        rule: otc.rule || '',
        from,
        fromName: otc.benchName || '',
        to,
        toName: otc.lowestName || '',
        description: `${otc.level || '场外信号'}：卖 ${otc.benchCode || '持仓'}，观察场外 QDII 申购机会`,
      });
    }
  });

  return {
    count: codes.size,
    signalCount: signalRows.length,
    codes: [...codes],
    rows: signalRows,
  };
}

export function summarizeExitSignals(sellPlans = [], aggregates = []) {
  const priceByCode = new Map();
  (Array.isArray(aggregates) ? aggregates : []).forEach((agg) => {
    const code = normalizeCode(agg?.code);
    const price = Number(agg?.currentPrice ?? agg?.latestNav ?? agg?.price);
    if (code && Number.isFinite(price) && price > 0) {
      priceByCode.set(code, price);
    }
  });

  const rows = [];
  const codes = new Set();
  (Array.isArray(sellPlans) ? sellPlans : []).forEach((rawPlan) => {
    const plan = buildSellPlan(rawPlan);
    const code = normalizeCode(plan.symbol || rawPlan?.symbol);
    const price = priceByCode.get(code);
    const result = evaluateSellSignals(plan, price);
    if (!result.triggered.length) return;
    addCode(codes, code);
    const highest = result.triggered[result.triggered.length - 1];
    rows.push({
      key: buildExitSignalKey(rawPlan?.id || '', code, highest),
      id: rawPlan?.id || '',
      code,
      name: rawPlan?.name || '',
      currentPrice: price,
      tierCount: result.triggered.length,
      highestTier: highest,
      next: result.next,
    });
  });

  return {
    count: codes.size,
    codes: [...codes],
    rows,
  };
}

export function filterDismissedSwitchSignals(summary = {}, dismissedKeys = new Set()) {
  const dismissed = dismissedKeys instanceof Set ? dismissedKeys : new Set(dismissedKeys || []);
  const rows = (Array.isArray(summary.rows) ? summary.rows : []).filter((row) => !dismissed.has(row?.key));
  const codes = new Set();
  rows.forEach((row) => {
    addCode(codes, row?.from);
    addCode(codes, row?.to);
  });
  return {
    ...summary,
    count: codes.size,
    signalCount: rows.length,
    codes: [...codes],
    rows,
  };
}

export function filterDismissedExitSignals(summary = {}, dismissedKeys = new Set()) {
  const dismissed = dismissedKeys instanceof Set ? dismissedKeys : new Set(dismissedKeys || []);
  const rows = (Array.isArray(summary.rows) ? summary.rows : []).filter((row) => !dismissed.has(row?.key));
  const codes = new Set();
  rows.forEach((row) => addCode(codes, row?.code));
  return {
    ...summary,
    count: codes.size,
    codes: [...codes],
    rows,
  };
}

export function collectTodaySignalKeys(...summaries) {
  return summaries
    .flatMap((summary) => Array.isArray(summary?.rows) ? summary.rows : [])
    .map((row) => String(row?.key || '').trim())
    .filter(Boolean);
}
