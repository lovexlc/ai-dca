// 旧设备首次接入 v2 时使用的一次性归集逻辑。
// 日常同步不调用这里：日常写入始终是单写端的完整快照替换。

function parseValue(value) {
  try { return JSON.parse(String(value || '')); } catch { return null; }
}

function stringifyValue(value) {
  return JSON.stringify(value);
}

function meaningfulValue(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  const parsed = parseValue(text);
  if (parsed === null) return text !== 'null';
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (typeof parsed === 'object') return Object.keys(parsed).length > 0;
  return true;
}

export function hasMeaningfulLocalData(envelope = {}) {
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  return Object.entries(payload).some(([key, value]) => {
    if (key === 'aiDcaFundHoldingsLedger') {
      const parsed = parseValue(value);
      return Boolean(parsed && typeof parsed === 'object' && Array.isArray(parsed.transactions) && parsed.transactions.length > 0);
    }
    return meaningfulValue(value);
  });
}

function mergeRecords(remote = [], local = []) {
  const byId = new Map();
  const noId = [];
  for (const record of [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])]) {
    if (!record || typeof record !== 'object') continue;
    const id = String(record.id || '').trim();
    if (!id) {
      noId.push(record);
      continue;
    }
    // 归集阶段以当前设备的本地记录为准；重复 id 不会产生两条流水。
    const previous = byId.get(id);
    byId.set(id, previous && (Array.isArray(previous.us) || Array.isArray(record.us) || Array.isArray(previous.cn) || Array.isArray(record.cn))
      ? {
        ...previous,
        ...record,
        us: [...new Set([...(previous.us || []), ...(record.us || [])])],
        cn: [...new Set([...(previous.cn || []), ...(record.cn || [])])]
      }
      : record);
  }
  return [...byId.values(), ...noId];
}

function mergeJsonValues(remoteValue, localValue) {
  if (remoteValue == null) return localValue;
  if (localValue == null) return remoteValue;
  const remote = parseValue(remoteValue);
  const local = parseValue(localValue);
  if (Array.isArray(remote) && Array.isArray(local)) return stringifyValue(mergeRecords(remote, local));
  if (!remote || typeof remote !== 'object' || !local || typeof local !== 'object') return localValue;

  const merged = { ...remote, ...local };
  for (const key of ['transactions', 'switchChains', 'plans', 'lists']) {
    if (Array.isArray(remote[key]) || Array.isArray(local[key])) merged[key] = mergeRecords(remote[key], local[key]);
  }
  if (remote.snapshotsByCode && typeof remote.snapshotsByCode === 'object' || local.snapshotsByCode && typeof local.snapshotsByCode === 'object') {
    merged.snapshotsByCode = { ...(remote.snapshotsByCode || {}), ...(local.snapshotsByCode || {}) };
  }
  if (Array.isArray(remote.us) || Array.isArray(local.us)) merged.us = [...new Set([...(remote.us || []), ...(local.us || [])])];
  if (Array.isArray(remote.cn) || Array.isArray(local.cn)) merged.cn = [...new Set([...(remote.cn || []), ...(local.cn || [])])];
  return stringifyValue(merged);
}

function rebuildLegacyHoldingsState(ledger = {}, previous = {}) {
  const transactions = Array.isArray(ledger.transactions) ? ledger.transactions : [];
  const byCode = new Map();
  const sorted = [...transactions].sort((left, right) => {
    const dateOrder = String(left?.date || '').localeCompare(String(right?.date || ''));
    return dateOrder || String(left?.id || '').localeCompare(String(right?.id || ''));
  });
  for (const transaction of sorted) {
    const code = String(transaction?.code || '').trim();
    const shares = Number(transaction?.shares) || 0;
    const price = Number(transaction?.price) || 0;
    if (!code || !(shares > 0)) continue;
    const lots = byCode.get(code) || [];
    if (String(transaction?.type || '').toUpperCase() === 'SELL') {
      let remaining = shares;
      while (remaining > 0 && lots.length) {
        const lot = lots[0];
        const consumed = Math.min(remaining, lot.shares);
        lot.shares -= consumed;
        remaining -= consumed;
        if (lot.shares <= 0.000001) lots.shift();
      }
    } else if (price > 0) {
      lots.push({ shares, price, name: String(transaction?.name || '').trim() });
    }
    byCode.set(code, lots);
  }
  const rows = [];
  for (const [code, lots] of byCode) {
    const shares = lots.reduce((sum, lot) => sum + lot.shares, 0);
    if (!(shares > 0)) continue;
    const cost = lots.reduce((sum, lot) => sum + lot.shares * lot.price, 0);
    rows.push({
      id: 'sync-derived-' + code,
      code,
      name: lots.find((lot) => lot.name)?.name || '',
      avgCost: Math.round((cost / shares) * 10000) / 10000,
      shares: Math.round(shares * 10000) / 10000
    });
  }
  rows.sort((left, right) => left.code.localeCompare(right.code));
  return stringifyValue({
    ...(previous && typeof previous === 'object' ? previous : {}),
    fileName: '',
    rows,
    snapshotsByCode: ledger.snapshotsByCode && typeof ledger.snapshotsByCode === 'object' ? ledger.snapshotsByCode : {},
    lastNavMeta: ledger.lastNavMeta && typeof ledger.lastNavMeta === 'object' ? ledger.lastNavMeta : {}
  });
}

export function mergeMigrationEnvelopes(remoteEnvelope = {}, localEnvelope = {}) {
  const remotePayload = remoteEnvelope?.payload && typeof remoteEnvelope.payload === 'object' ? remoteEnvelope.payload : {};
  const localPayload = localEnvelope?.payload && typeof localEnvelope.payload === 'object' ? localEnvelope.payload : {};
  const keys = [...new Set([...Object.keys(remotePayload), ...Object.keys(localPayload)])].sort();
  const payload = {};
  for (const key of keys) payload[key] = mergeJsonValues(remotePayload[key], localPayload[key]);
  const mergedLedger = parseValue(payload.aiDcaFundHoldingsLedger);
  if (mergedLedger && typeof mergedLedger === 'object' && Array.isArray(mergedLedger.transactions)) {
    const previousState = parseValue(payload.aiDcaFundHoldingsState);
    payload.aiDcaFundHoldingsState = rebuildLegacyHoldingsState(mergedLedger, previousState);
    if (!keys.includes('aiDcaFundHoldingsState')) keys.push('aiDcaFundHoldingsState');
    keys.sort();
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: 'ai-dca',
    keyCount: keys.length,
    keys,
    payload
  };
}
