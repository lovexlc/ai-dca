function marketIndicesPath({ inPagesDir = false } = {}) {
  return inPagesDir ? '../data/market_indices.json' : './data/market_indices.json';
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function normalizeMarketIndexEntry(entry = {}) {
  const currentPrice = toNumber(entry.current_price ?? entry.currentPrice ?? entry.price ?? entry.value);
  const previousClose = toNumber(entry.previous_close ?? entry.previousClose);
  const change = toNumber(entry.change) ?? (currentPrice !== null && previousClose !== null ? round(currentPrice - previousClose, 2) : null);
  const changePercent = toNumber(entry.change_percent ?? entry.changePercent)
    ?? (previousClose ? round((change / previousClose) * 100, 2) : null);

  return {
    key: String(entry.key ?? entry.code ?? entry.symbol ?? '').trim(),
    name: String(entry.name ?? '').trim(),
    symbol: String(entry.symbol ?? '').trim(),
    currency: String(entry.currency ?? '').trim(),
    timezone: String(entry.timezone ?? '').trim(),
    date: String(entry.date ?? '').trim(),
    datetime: String(entry.datetime ?? '').trim(),
    current_price: currentPrice,
    previous_close: previousClose,
    change,
    change_percent: changePercent
  };
}

function normalizeMarketIndicesPayload(payload = {}) {
  const rawIndexes = Array.isArray(payload.indexes)
    ? payload.indexes
    : Array.isArray(payload.indices)
      ? payload.indices
      : Array.isArray(payload.items)
        ? payload.items
        : [];

  return {
    dataset: String(payload.dataset ?? payload.datasetName ?? 'market_indices_latest').trim() || 'market_indices_latest',
    source: String(payload.source ?? '').trim(),
    generated_at: String(payload.generated_at ?? payload.generatedAt ?? '').trim(),
    indexes: rawIndexes.map((entry) => normalizeMarketIndexEntry(entry)).filter((entry) => entry.key && entry.name)
  };
}

export async function loadLatestMarketIndices({ inPagesDir = false } = {}) {
  const response = await fetch(marketIndicesPath({ inPagesDir }), {
    headers: {
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (response.status === 404) {
    return {
      dataset: 'market_indices_latest',
      source: '',
      generated_at: '',
      indexes: []
    };
  }

  if (!response.ok) {
    throw new Error(`指数行情加载失败: HTTP ${response.status}`);
  }

  const payload = await response.json();
  return normalizeMarketIndicesPayload(payload);
}