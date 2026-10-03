import { openDb, closeDb } from './db.js';
import { registerUser, loginUser } from './auth.js';
import { outboxStats } from './outbox.js';

const MAX_BODY_BYTES = 10 * 1024;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(),
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function normalizeResult(result) {
  if (result?.error) {
    const { error, status, ...rest } = result;
    return { status: status || 400, body: { message: error, ...rest } };
  }
  const { status, ...body } = result;
  return { status: status || 200, body };
}

export function createApp(db) {
  return async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, outbox: outboxStats(db) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sync/auth/register') {
      try {
        const body = await readJsonBody(req);
        const result = registerUser(db, {
          username: body.username,
          clientPasswordHash: body.passwordHash,
        });
        const { status, body: responseBody } = normalizeResult(result);
        sendJson(res, status, responseBody);
      } catch (err) {
        sendJson(res, err.status || 500, { message: err.message || '服务器内部错误' });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sync/auth/login') {
      try {
        const body = await readJsonBody(req);
        const result = loginUser(db, {
          username: body.username,
          clientPasswordHash: body.passwordHash,
        });
        const { status, body: responseBody } = normalizeResult(result);
        sendJson(res, status, responseBody);
      } catch (err) {
        sendJson(res, err.status || 500, { message: err.message || '服务器内部错误' });
      }
      return;
    }

    sendJson(res, 404, { message: 'Not found' });
  };
}

const HOST = '127.0.0.1';
const PORT = Number(process.env.AUTH_PORT || 8080);

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const db = openDb();
  const { createServer } = await import('node:http');
  const server = createServer(createApp(db));
  server.listen(PORT, HOST, () => {
    console.log(`[auth-service] listening on http://${HOST}:${PORT}`);
  });
  const shutdown = () => {
    console.log('[auth-service] shutting down');
    server.close(() => closeDb(db));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
