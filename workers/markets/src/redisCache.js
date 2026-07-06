const DEFAULT_PREFIX = 'ai-dca:markets:';

// Upstash REST fallback (HTTP pipeline)
function redisBaseUrl(env = {}) {
  return String(env.MARKETS_REDIS_REST_URL || env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
}

function redisToken(env = {}) {
  return String(env.MARKETS_REDIS_REST_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '').trim();
}

// Redis Cloud TCP direct connection
function redisTcpUrl(env = {}) {
  return String(env.REDIS_URL || env.MARKETS_REDIS_URL || '').trim();
}

function redisTcpPassword(env = {}) {
  return String(env.REDIS_PASSWORD || env.MARKETS_REDIS_PASSWORD || '').trim();
}

function useTcpRedis(env = {}) {
  return Boolean(redisTcpUrl(env));
}

export function hasRedis(env = {}) {
  return Boolean(redisTcpUrl(env) || (redisBaseUrl(env) && redisToken(env)));
}

export function redisKey(env = {}, key = '') {
  const prefix = String(env.MARKETS_REDIS_PREFIX || DEFAULT_PREFIX).trim() || DEFAULT_PREFIX;
  return `${prefix}${String(key || '').trim()}`;
}

// ── RESP protocol encode/decode ──────────────────────────────

const _enc = new TextEncoder();

function encodeBulkString(str) {
  const buf = _enc.encode(str);
  const header = _enc.encode(`$${buf.length}\r\n`);
  const tail = _enc.encode('\r\n');
  const out = new Uint8Array(header.length + buf.length + tail.length);
  out.set(header, 0);
  out.set(buf, header.length);
  out.set(tail, header.length + buf.length);
  return out;
}

function encodeCommand(parts = []) {
  const chunks = [_enc.encode(`*${parts.length}\r\n`)];
  for (const part of parts) {
    chunks.push(encodeBulkString(String(part)));
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function encodePipeline(commands = []) {
  const chunks = [];
  for (const cmd of commands) {
    chunks.push(encodeCommand(cmd));
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// Buffered reader: accumulates stream chunks and supports line / fixed-size reads
// that correctly span chunk boundaries.
class RespReader {
  constructor(reader) {
    this._reader = reader;
    this._dec = new TextDecoder();
    this._buf = '';
    this._done = false;
  }

  async _fill() {
    if (this._done) return false;
    const { done, value } = await this._reader.read();
    if (done) { this._done = true; return false; }
    this._buf += typeof value === 'string' ? value : this._dec.decode(value, { stream: true });
    return true;
  }

  async readLine() {
    while (true) {
      const idx = this._buf.indexOf('\n');
      if (idx >= 0) {
        const line = this._buf.slice(0, idx);
        this._buf = this._buf.slice(idx + 1);
        return line.endsWith('\r') ? line.slice(0, -1) : line;
      }
      if (!(await this._fill())) {
        if (this._buf) {
          const line = this._buf;
          this._buf = '';
          return line.endsWith('\r') ? line.slice(0, -1) : line;
        }
        return null;
      }
    }
  }

  async readExact(n) {
    while (this._buf.length < n) {
      if (!(await this._fill())) break;
    }
    if (this._buf.length < n) throw new Error('redis: unexpected EOF in bulk read');
    const data = this._buf.slice(0, n);
    this._buf = this._buf.slice(n);
    return data;
  }
}

async function readResp(reader) {
  const line = await reader.readLine();
  if (!line) return null;
  const type = line[0];
  const rest = line.slice(1);

  if (type === '+') return rest;
  if (type === '-') throw new Error('redis error: ' + rest);
  if (type === ':') return Number(rest);
  if (type === '$') {
    const len = Number(rest);
    if (len < 0) return null;
    const data = await reader.readExact(len);
    await reader.readLine(); // trailing \r\n
    return data;
  }
  if (type === '*') {
    const count = Number(rest);
    if (count < 0) return null;
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push(await readResp(reader));
    }
    return arr;
  }
  return null;
}

// ── TCP socket connection ────────────────────────────────────

function parseRedisUrl(url) {
  // redis://[username:password@]host:port[/db]  (rediss:// for TLS)
  const u = new URL(url);
  const tls = u.protocol === 'rediss:';
  const username = u.username || '';
  return { host: u.hostname, port: u.port || '6379', password: u.password || '', username, db: u.pathname && u.pathname !== '/' ? u.pathname.slice(1) : '', tls };
}

// Connection pool: per-isolate single connection, lazily created.
let _tcpSocket = null;
let _tcpWriter = null;
let _tcpReader = null;
let _tcpInitialized = false;

async function getTcpConnection(env) {
  if (_tcpSocket && _tcpInitialized) return { socket: _tcpSocket, writer: _tcpWriter, reader: _tcpReader };

  const { connect } = await import('cloudflare:sockets');
  const url = redisTcpUrl(env);
  const { host, port, password, username, db, tls } = parseRedisUrl(url);

  const socket = connect({ hostname: host, port: Number(port) }, {
    secureTransport: tls ? 'on' : 'off',
    allowHalfOpen: false,
  });

  const writer = socket.writable.getWriter();
  const rawReader = socket.readable.getReader();
  const reader = new RespReader(rawReader);

  // AUTH if password present (from URL or env)
  // Redis 6+ ACL: AUTH username password; legacy: AUTH password
  const authPassword = password || redisTcpPassword(env);
  if (authPassword) {
    const authCmd = username
      ? encodeCommand(['AUTH', username, authPassword])
      : encodeCommand(['AUTH', authPassword]);
    await writer.write(authCmd);
    const reply = await readResp(reader);
    if (reply !== 'OK') throw new Error('redis AUTH failed: ' + reply);
  }

  // SELECT database if specified
  if (db) {
    const selectCmd = encodeCommand(['SELECT', db]);
    await writer.write(selectCmd);
    const reply = await readResp(reader);
    if (reply !== 'OK') throw new Error('redis SELECT failed: ' + reply);
  }

  _tcpSocket = socket;
  _tcpWriter = writer;
  _tcpReader = reader;
  _tcpInitialized = true;

  return { socket, writer, reader };
}

async function execTcpPipeline(env, commands = []) {
  const { writer, reader } = await getTcpConnection(env);
  const payload = encodePipeline(commands);
  await writer.write(payload);

  const results = [];
  for (let i = 0; i < commands.length; i++) {
    results.push(await readResp(reader));
  }
  return results;
}

async function execTcpCommand(env, command = []) {
  const results = await execTcpPipeline(env, [command]);
  return results[0];
}

// ── Unified command interface (TCP or REST) ──────────────────

async function redisCommand(env, command = []) {
  if (!hasRedis(env)) return null;
  if (useTcpRedis(env)) {
    return await execTcpCommand(env, command).catch(() => null);
  }
  const response = await fetch(`${redisBaseUrl(env)}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${redisToken(env)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify([command])
  });
  if (!response.ok) throw new Error(`redis HTTP ${response.status}`);
  const data = await response.json();
  const item = Array.isArray(data) ? data[0] : null;
  if (item?.error) throw new Error(String(item.error));
  return item?.result ?? null;
}

async function execPipeline(env, commands = []) {
  if (!hasRedis(env) || !commands.length) return [];
  if (useTcpRedis(env)) {
    return await execTcpPipeline(env, commands).catch(() => []);
  }
  // Upstash REST pipeline
  const response = await fetch(`${redisBaseUrl(env)}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${redisToken(env)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(commands)
  }).catch(() => null);
  if (!response || !response.ok) return [];
  const data = await response.json().catch(() => []);
  return Array.isArray(data) ? data.map((item) => item?.result ?? null) : [];
}

export async function redisGetJson(env, key) {
  const value = await redisCommand(env, ['GET', redisKey(env, key)]).catch(() => null);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function redisSetJson(env, key, value, { ttlSeconds = 300 } = {}) {
  if (!hasRedis(env) || !key || value == null) return false;
  const fullKey = redisKey(env, key);
  const payload = JSON.stringify(value);
  const ttl = Math.max(1, Number.parseInt(String(ttlSeconds || '0'), 10) || 0);
  const command = ttl > 0
    ? ['SET', fullKey, payload, 'EX', ttl]
    : ['SET', fullKey, payload];
  await redisCommand(env, command);
  return true;
}

export async function redisMGetJson(env, keys = []) {
  const list = Array.from(new Set((Array.isArray(keys) ? keys : []).map((key) => String(key || '').trim()).filter(Boolean)));
  if (!list.length || !hasRedis(env)) return {};
  const fullKeys = list.map((key) => redisKey(env, key));
  if (useTcpRedis(env)) {
    const results = await execTcpPipeline(env, [fullKeys.length > 1 ? ['MGET', ...fullKeys] : ['GET', fullKeys[0]]]).catch(() => []);
    const values = Array.isArray(results) ? (fullKeys.length > 1 ? results : [results]) : [];
    const out = {};
    list.forEach((key, index) => {
      const value = values[index];
      if (!value) return;
      try { out[key] = JSON.parse(value); } catch { /* ignore */ }
    });
    return out;
  }
  const response = await fetch(`${redisBaseUrl(env)}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${redisToken(env)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(list.map((key) => ['GET', redisKey(env, key)]))
  }).catch(() => null);
  if (!response || !response.ok) return {};
  const data = await response.json().catch(() => []);
  const out = {};
  list.forEach((key, index) => {
    const value = data?.[index]?.result;
    if (!value) return;
    try {
      out[key] = JSON.parse(value);
    } catch {
      // ignore malformed cache entries
    }
  });
  return out;
}

export async function redisMSetJson(env, entries = [], { ttlSeconds = 300 } = {}) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.key && entry.value != null);
  if (!normalized.length || !hasRedis(env)) return false;
  const ttl = Math.max(1, Number.parseInt(String(ttlSeconds || '0'), 10) || 0);
  if (useTcpRedis(env)) {
    // Use pipeline of SET commands for atomic multi-set with TTL
    const commands = normalized.map((entry) => (
      ttl > 0
        ? ['SET', redisKey(env, entry.key), JSON.stringify(entry.value), 'EX', String(ttl)]
        : ['SET', redisKey(env, entry.key), JSON.stringify(entry.value)]
    ));
    await execTcpPipeline(env, commands).catch(() => {});
    return true;
  }
  const commands = normalized.map((entry) => (
    ttl > 0
      ? ['SET', redisKey(env, entry.key), JSON.stringify(entry.value), 'EX', ttl]
      : ['SET', redisKey(env, entry.key), JSON.stringify(entry.value)]
  ));
  const response = await fetch(`${redisBaseUrl(env)}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${redisToken(env)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(commands)
  }).catch(() => null);
  return Boolean(response?.ok);
}

export function marketsReadMode(env = {}) {
  const mode = String(env.MARKETS_DATA_READ_MODE || env.MARKETS_API_READ_MODE || 'cache-first').trim().toLowerCase();
  if (mode === 'cache-only' || mode === 'redis-only') return 'cache-only';
  if (mode === 'cache-first' || mode === 'redis-first') return 'cache-first';
  return 'live';
}

export function shouldReadCacheFirst(env = {}) {
  const mode = marketsReadMode(env);
  return mode === 'cache-first' || mode === 'cache-only';
}

export function shouldFetchLiveOnMiss(env = {}) {
  return marketsReadMode(env) !== 'cache-only';
}

export function isRedisEnabled(env = {}) {
  return hasRedis(env) && marketsReadMode(env) !== 'live';
}

export const REDIS_TTL = {
  quote: 120,
  quoteClosed: 24 * 3600,
  fundMetricLive: 120,
  fundMetricClosed: 24 * 3600,
  indices: 120,
  sectors: 120,
  movers: 1800,
  search: 3600,
  news: 1800,
  earnings: 1800,
  summary: 7200,
  profile: 7 * 24 * 3600,
  financials: 6 * 3600,
  kline: 24 * 3600
};
