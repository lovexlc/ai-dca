import { DurableObject } from 'cloudflare:workers';
import {
  EXCHANGE_FUND_HUB_NAME,
  filterExchangeFundRows,
  normalizeExchangeFundItems,
  normalizeExchangeFundOrderBy,
  sortExchangeFundRows,
} from './exchangeFundSnapshot.js';

const SNAPSHOT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS exchange_fund_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    generated_at TEXT NOT NULL,
    source TEXT NOT NULL,
    payload TEXT NOT NULL
  )
`;
const FRAME_TYPE = 'exchange_fund_snapshot';
const PATCH_TYPE = 'exchange_fund_patch';
const WS_TAG = 'exchange-fund-list';

function emptySnapshot() {
  return { generatedAt: '', source: '', items: [] };
}

function parseSnapshot(row) {
  if (!row?.payload) return emptySnapshot();
  try {
    const parsed = JSON.parse(String(row.payload));
    return {
      generatedAt: String(parsed?.generatedAt || row.generated_at || ''),
      source: String(parsed?.source || row.source || ''),
      items: normalizeExchangeFundItems(parsed?.items),
    };
  } catch {
    return emptySnapshot();
  }
}

function itemChanged(previous, next) {
  if (!previous) return true;
  const keys = Object.keys(next || {});
  return keys.some((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
}

function buildPatch(previousItems, nextItems) {
  const previousByCode = new Map(previousItems.map((item) => [item.code, item]));
  const nextByCode = new Map(nextItems.map((item) => [item.code, item]));
  const items = nextItems.filter((item) => itemChanged(previousByCode.get(item.code), item));
  const removed = previousItems.map((item) => item.code).filter((code) => !nextByCode.has(code));
  return { items, removed };
}

function withHeldState(items, heldSymbols = []) {
  const heldCodes = new Set(
    (Array.isArray(heldSymbols) ? heldSymbols : [])
      .map((symbol) => String(symbol || '').replace(/^(sh|sz|bj)/i, ''))
      .filter(Boolean)
  );
  return items.map((item) => ({ ...item, isHeld: heldCodes.has(item.code) }));
}

function parseWebSocketMessage(message) {
  if (typeof message === 'string') return message;
  if (message instanceof ArrayBuffer) return new TextDecoder().decode(message);
  if (ArrayBuffer.isView(message)) return new TextDecoder().decode(message);
  return '';
}

export class ExchangeFundHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.snapshot = emptySnapshot();
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(SNAPSHOT_SCHEMA);
      const rows = this.ctx.storage.sql.exec('SELECT generated_at, source, payload FROM exchange_fund_snapshot WHERE id = 1').toArray();
      this.snapshot = parseSnapshot(rows[0]);
    });
  }

  async getSnapshot() {
    return this.snapshot;
  }

  async updateSnapshot(payload = {}) {
    const incomingItems = normalizeExchangeFundItems(payload.items);
    if (!incomingItems.length) {
      return { ok: false, updated: false, count: this.snapshot.items.length, reason: 'empty snapshot' };
    }
    const previous = this.snapshot;
    const previousByCode = new Map(previous.items.map((item) => [item.code, item]));
    incomingItems.forEach((item) => previousByCode.set(item.code, item));
    const next = {
      generatedAt: String(payload.generatedAt || new Date().toISOString()),
      source: String(payload.source || 'cn-batch-quotes'),
      items: Array.from(previousByCode.values()).sort((a, b) => a.code.localeCompare(b.code)),
    };
    const patch = buildPatch(previous.items, next.items);
    const serialized = JSON.stringify(next);

    // Persist before changing in-memory state or broadcasting to clients.
    this.ctx.storage.sql.exec(
      `INSERT INTO exchange_fund_snapshot (id, generated_at, source, payload)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET generated_at = excluded.generated_at, source = excluded.source, payload = excluded.payload`,
      next.generatedAt,
      next.source,
      serialized,
    );
    this.snapshot = next;
    if (patch.items.length || patch.removed.length) this.broadcastPatch(next, patch);
    return {
      ok: true,
      updated: Boolean(patch.items.length || patch.removed.length),
      count: next.items.length,
      changedCount: patch.items.length,
      removedCount: patch.removed.length,
      generatedAt: next.generatedAt,
    };
  }

  async getSortedSnapshot({ symbols = [], heldSymbols = [], query = '', heldOnly = false, orderBy = [], sortBy = '', order = '', limit = 100, offset = 0 } = {}) {
    const filtered = filterExchangeFundRows(this.snapshot.items, { symbols, query, heldSymbols, heldOnly });
    const sorted = sortExchangeFundRows(filtered, normalizeExchangeFundOrderBy(orderBy, { sortBy, order }), heldSymbols);
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const safeLimit = Math.min(500, Math.max(1, Math.floor(Number(limit) || 100)));
    return {
      ok: true,
      ready: Boolean(this.snapshot.items.length),
      generatedAt: this.snapshot.generatedAt,
      source: this.snapshot.source,
      total: sorted.length,
      items: withHeldState(sorted.slice(safeOffset, safeOffset + safeLimit), heldSymbols),
    };
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    const url = new URL(request.url);
    const symbols = url.searchParams.get('symbols')?.split(',').filter(Boolean) || [];
    const heldSymbols = url.searchParams.get('heldSymbols')?.split(',').filter(Boolean) || [];
    this.ctx.acceptWebSocket(server, [WS_TAG]);
    server.serializeAttachment({ symbols, heldSymbols });
    this.sendSnapshot(server, { symbols, heldSymbols });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, message) {
    const raw = parseWebSocketMessage(message);
    if (!raw) return;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload?.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', generatedAt: new Date().toISOString() }));
      return;
    }
    if (payload?.type !== 'subscribe') return;
    const attachment = {
      symbols: Array.isArray(payload.symbols) ? payload.symbols : [],
      heldSymbols: Array.isArray(payload.heldSymbols) ? payload.heldSymbols : [],
    };
    ws.serializeAttachment(attachment);
    this.sendSnapshot(ws, attachment);
  }

  webSocketClose() {}

  webSocketError() {}

  sendSnapshot(ws, { symbols = [], heldSymbols = [] } = {}) {
    const items = filterExchangeFundRows(this.snapshot.items, { symbols, heldSymbols });
    ws.send(JSON.stringify({
      type: FRAME_TYPE,
      generatedAt: this.snapshot.generatedAt,
      source: this.snapshot.source,
      items: withHeldState(items, heldSymbols),
    }));
  }

  broadcastPatch(snapshot, patch) {
    for (const ws of this.ctx.getWebSockets(WS_TAG)) {
      try {
        const attachment = ws.deserializeAttachment() || {};
        const items = withHeldState(
          filterExchangeFundRows(patch.items, { symbols: attachment.symbols }),
          attachment.heldSymbols
        );
        const requestedCodes = new Set(
          (Array.isArray(attachment.symbols) ? attachment.symbols : [])
            .map((symbol) => String(symbol || '').replace(/^(sh|sz|bj)/i, ''))
            .filter(Boolean)
        );
        const removed = requestedCodes.size
          ? patch.removed.filter((code) => requestedCodes.has(code))
          : patch.removed;
        if (!items.length && !removed.length) continue;
        ws.send(JSON.stringify({
          type: PATCH_TYPE,
          generatedAt: snapshot.generatedAt,
          source: snapshot.source,
          items,
          removed,
        }));
      } catch {
        try { ws.close(1011, 'broadcast failed'); } catch {}
      }
    }
  }
}

export { EXCHANGE_FUND_HUB_NAME };
