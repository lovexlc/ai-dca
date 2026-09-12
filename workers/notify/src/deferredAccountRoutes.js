import { jsonResponse, readOrigin } from './notifyHttp.js';
import { VERIFIED_NOTIFY_USER_ID_HEADER, VERIFIED_NOTIFY_USERNAME_HEADER } from './notifyAccountAuth.js';

function jobId(prefix = 'notify') { return `${prefix}:${Date.now().toString(36)}:${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`; }
function accepted(request, id, queued) {
  const response = jsonResponse({ ok: true, accepted: true, deferred: true, queued, jobId: id }, { status: 202, origin: readOrigin(request) });
  const headers = new Headers(response.headers); headers.set('server-timing', 'accepted;dur=0');
  return new Response(response.body, { status: 202, headers });
}

export async function deferAccountOperation(request, env, ctx, operation, { type = 'notify-operation' } = {}) {
  const id = jobId(type);
  const body = await request.clone().text().catch(() => '');
  if (env?.NOTIFY_JOBS?.send) {
    await env.NOTIFY_JOBS.send({
      id,
      type,
      url: request.url,
      method: request.method,
      body,
      headers: {
        'content-type': request.headers.get('content-type') || 'application/json',
        [VERIFIED_NOTIFY_USER_ID_HEADER]: request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER) || '',
        [VERIFIED_NOTIFY_USERNAME_HEADER]: request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER) || ''
      },
      createdAt: new Date().toISOString()
    });
    return accepted(request, id, true);
  }
  const startedAt = Date.now();
  const task = Promise.resolve().then(operation).then((response) => {
    console.log('[notify-deferred-complete]', JSON.stringify({ id, type, status: Number(response?.status) || 0, totalMs: Date.now() - startedAt, fallback: true }));
  }).catch((error) => {
    console.log('[notify-deferred-failed]', JSON.stringify({ id, type, totalMs: Date.now() - startedAt, fallback: true, message: error instanceof Error ? error.message : String(error) }));
  });
  if (ctx?.waitUntil) ctx.waitUntil(task); else task.catch(() => {});
  return accepted(request, id, false);
}

export function requestFromNotifyJob(job = {}) {
  const headers = new Headers(job.headers || {});
  headers.delete('authorization');
  return new Request(String(job.url || 'https://queue.invalid/api/notify/test'), {
    method: String(job.method || 'POST').toUpperCase(),
    headers,
    body: ['GET', 'HEAD'].includes(String(job.method || '').toUpperCase()) ? undefined : String(job.body || '')
  });
}
