// 交易台账存储（PR 3 / D8 / D9 / D14）。
//   · aiDcaTradeLedger        — 活跳记录（按 symbol 限制 100 条）
//   · aiDcaTradeLedgerArchive — 溢出后归档
//
// 每条记录结构：{ id, symbol, side: 'buy'|'sell', shares, price, date, fee?, note? }

export const LEDGER_KEY = 'aiDcaTradeLedger';
export const LEDGER_ARCHIVE_KEY = 'aiDcaTradeLedgerArchive';
export const MAX_LEDGER_PER_SYMBOL = 100;
export const TRADE_LEDGER_UPDATED_EVENT = 'trade-ledger:updated';

function safeStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function readArray(key) {
  const ls = safeStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function writeArray(key, value) {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.setItem(key, JSON.stringify(value));
    if (typeof window !== 'undefined' && key === LEDGER_KEY) {
      window.dispatchEvent(new CustomEvent(TRADE_LEDGER_UPDATED_EVENT, { detail: { entries: value } }));
    }
  } catch (_e) { /* ignore */ }
}

function newId() {
  return `trade-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function readTradeLedger() {
  return readArray(LEDGER_KEY);
}

export function readTradeArchive() {
  return readArray(LEDGER_ARCHIVE_KEY);
}

export function clearTradeLedger() {
  writeArray(LEDGER_KEY, []);
}

export function clearTradeArchive() {
  writeArray(LEDGER_ARCHIVE_KEY, []);
}

export function deleteTrade(id) {
  const list = readTradeLedger().filter((t) => t.id !== id);
  writeArray(LEDGER_KEY, list);
  return list;
}

export function appendTrade(trade) {
  const normalized = normalizeTrade(trade);
  if (!normalized) return { ok: false, reason: 'invalid_trade', list: readTradeLedger() };
  const list = readTradeLedger();
  list.push(normalized);
  const { kept, archived } = applyOverflowLimit(list);
  writeArray(LEDGER_KEY, kept);
  if (archived.length) {
    const archive = readTradeArchive().concat(archived);
    writeArray(LEDGER_ARCHIVE_KEY, archive);
  }
  return { ok: true, trade: normalized, list: kept, archivedCount: archived.length };
}

export function bulkReplaceTrades(trades) {
  const list = (Array.isArray(trades) ? trades : []).map(normalizeTrade).filter(Boolean);
  const { kept, archived } = applyOverflowLimit(list);
  writeArray(LEDGER_KEY, kept);
  if (archived.length) {
    const archive = readTradeArchive().concat(archived);
    writeArray(LEDGER_ARCHIVE_KEY, archive);
  }
  return { list: kept, archivedCount: archived.length };
}

export function normalizeTrade(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const side = raw.side === 'sell' ? 'sell' : raw.side === 'buy' ? 'buy' : null;
  if (!side) return null;
  const symbol = String(raw.symbol || '').trim().toUpperCase();
  if (!symbol) return null;
  const shares = Number(raw.shares);
  const price = Number(raw.price);
  if (!Number.isFinite(shares) || shares <= 0) return null;
  if (!Number.isFinite(price) || price < 0) return null;
  return {
    id: raw.id || newId(),
    symbol,
    side,
    shares: Number(shares.toFixed(6)),
    price: Number(price.toFixed(6)),
    date: raw.date || new Date().toISOString().slice(0, 10),
    fee: Number(raw.fee) > 0 ? Number(raw.fee) : 0,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 200) : ''
  };
}

/**
 * 对每个 symbol 最多保留 MAX_LEDGER_PER_SYMBOL 条。多出的按日期升序被归档。
 */
export function applyOverflowLimit(list) {
  const buckets = new Map();
  for (const t of list) {
    if (!buckets.has(t.symbol)) buckets.set(t.symbol, []);
    buckets.get(t.symbol).push(t);
  }
  const kept = [];
  const archived = [];
  for (const arr of buckets.values()) {
    arr.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    if (arr.length > MAX_LEDGER_PER_SYMBOL) {
      const cut = arr.length - MAX_LEDGER_PER_SYMBOL;
      archived.push(...arr.slice(0, cut));
      kept.push(...arr.slice(cut));
    } else {
      kept.push(...arr);
    }
  }
  // 最终的保留列表统一按 date、symbol 排序。
  kept.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.symbol.localeCompare(b.symbol));
  return { kept, archived };
}

export function listSymbolsInLedger() {
  const seen = new Set();
  for (const t of readTradeLedger()) seen.add(t.symbol);
  return Array.from(seen).sort();
}
