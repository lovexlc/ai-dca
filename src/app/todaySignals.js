import { buildSellPlan, evaluateSellSignals } from './sellStrategy.js';

function normalizeCode(value = '') {
  return String(value || '').trim().toUpperCase();
}

function addCode(set, value) {
  const code = normalizeCode(value);
  if (code) set.add(code);
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
      addCode(codes, signal?.from);
      addCode(codes, signal?.to);
      signalRows.push({
        type: 'intra',
        rule: signal?.kind || '',
        from: normalizeCode(signal?.from),
        fromName: signal?.fromName || '',
        to: normalizeCode(signal?.to),
        toName: signal?.toName || '',
        description: signal?.description || '',
      });
    });
    const otc = entry?.otcSignal;
    if (otc?.ready && otc?.triggered) {
      addCode(codes, otc.benchCode);
      addCode(codes, otc.lowestCode);
      signalRows.push({
        type: 'otc',
        rule: otc.rule || '',
        from: normalizeCode(otc.benchCode),
        fromName: otc.benchName || '',
        to: normalizeCode(otc.lowestCode),
        toName: otc.lowestName || '',
        description: `${otc.level || '场外信号'}：卖 ${otc.benchCode || '基准'}，观察场外 QDII 申购机会`,
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
