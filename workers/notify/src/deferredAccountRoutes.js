import { jsonResponse, readOrigin } from './notifyHttp.js';

function jobId(prefix = 'notify') {
  return `${prefix}:${Date.now().toString(36)}:${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
}

export function deferAccountOperation(request, ctx, operation, { type = 'notify-operation' } = {}) {
  const id = jobId(type);
  const startedAt = Date.now();
  const task = Promise.resolve().then(operation).then(async (response) => {
    const body = response?.clone ? await response.clone().text().catch(() => '') : '';
    console.log('[notify-deferred-complete]', JSON.stringify({ id, type, status: Number(response?.status) || 0, totalMs: Date.now() - startedAt, responseBytes: body.length }));
  }).catch((error) => {
    console.log('[notify-deferred-failed]', JSON.stringify({ id, type, totalMs: Date.now() - startedAt, message: error instanceof Error ? error.message : String(error) }));
  });
  if (ctx?.waitUntil) ctx.waitUntil(task);
  else task.catch(() => {});
  const response = jsonResponse({ ok: true, accepted: true, deferred: true, jobId: id }, { status: 202, origin: readOrigin(request) });
  const headers = new Headers(response.headers);
  headers.set('server-timing', 'accepted;dur=0');
  return new Response(response.body, { status: 202, headers });
}
