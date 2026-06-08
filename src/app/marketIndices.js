import { fetchIndices } from './marketsApi.js';

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

function normalizeMarketIndicesPayload(payloads = []) {
  const list = Array.isArray(payloads) ? payloads : [payloads];
  const rawIndexes = list.flatMap((payload) => {
    if (Array.isArray(payload?.indexes)) return payload.indexes;
    if (Array.isArray(payload?.indices)) return payload.indices;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
  });

  return {
    dataset: 'market_indices_latest',
    source: 'markets-worker',
    generated_at: list.map((payload) => String(payload?.generatedAt || payload?.generated_at || '').trim()).filter(Boolean).sort().at(-1) || '',
    indexes: rawIndexes.map((entry) => normalizeMarketIndexEntry(entry)).filter((entry) => entry.key && entry.name)
  };
}

export async function loadLatestMarketIndices() {
  const payloads = await Promise.all([
    fetchIndices('cn'),
    fetchIndices('us')
  ]);
  return normalizeMarketIndicesPayload(payloads);
}
