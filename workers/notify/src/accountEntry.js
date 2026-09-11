import notifyWorker from './index.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import { authenticateNotifyAccountRequest, NotifyAccountAuthError, requiresNotifyAccountAuth } from './notifyAccountAuth.js';
import { handleFastSync } from './notifySyncRoute.js';
import { AccountSettingsError, handleAccountSettings } from './accountSettingsRoute.js';
import { detectChannelDeletes, handleAccountChannelDelete } from './accountChannelDeleteRoute.js';
import { handleAccountEvents, handleAccountStatus } from './accountReadRoutes.js';
import { handleFastHoldingsRule, handleFastSwitchConfig, handleFastSwitchSnapshot } from './accountRuleRoutes.js';
import { handleFastEmailRoute } from './accountEmailRoutes.js';
import { handleDirectAccountTest } from './accountDeliveryRoute.js';
import { handleFastWebSocketConnect, handleFastWebWsRegistration } from './accountWebWsRoutes.js';
import { deferAccountOperation, requestFromNotifyJob } from './deferredAccountRoutes.js';

export { WsHub } from './index.js';
export async function stripDeviceIdentityFromAccountTestRequest(request) {
  const payload = await request.clone().json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return request;
  const nextPayload = { ...payload }; delete nextPayload.clientId; delete nextPayload.notifyClientId; delete nextPayload.clientSecret; delete nextPayload.notifyClientSecret;
  const headers = new Headers(request.headers); headers.delete('content-length');
  return new Request(request, { headers, body: JSON.stringify(nextPayload) });
}
async function processNotifyJob(job, env, ctx) {
  if (job?.type === 'notify-index-key') {
    if (!env?.NOTIFY_STATE?.put || !job.key) throw new Error('notify index storage unavailable');
    await env.NOTIFY_STATE.put(String(job.key), String(job.marker || '{}'));
    return new Response(null, { status: 204 });
  }
  const request = requestFromNotifyJob(job);
  if (job?.type === 'notify-sync') return handleFastSync(request, env, ctx);
  if (job?.type === 'notify-test') return handleDirectAccountTest(await stripDeviceIdentityFromAccountTestRequest(request), env);
  if (job?.type === 'notify-switch-run') return notifyWorker.fetch(request, env, ctx);
  if (job?.type === 'notify-email-code') return handleFastEmailRoute(request, env, new URL(request.url).pathname);
  throw new Error(`unsupported notify job: ${String(job?.type || '')}`);
}
export default {
  async fetch(request, env, ctx) {
    const fastSocket = await handleFastWebSocketConnect(request, env);
    if (fastSocket) return fastSocket;
    if (!requiresNotifyAccountAuth(request)) return notifyWorker.fetch(request, env, ctx);
    const origin = readOrigin(request);
    try {
      const authenticatedRequest = await authenticateNotifyAccountRequest(request, env);
      const url = new URL(authenticatedRequest.url); const method = authenticatedRequest.method;
      if (method === 'GET' && url.pathname.startsWith('/api/notify/status')) return await handleAccountStatus(authenticatedRequest, env);
      if (method === 'GET' && url.pathname === '/api/notify/events') return await handleAccountEvents(authenticatedRequest, env);
      if (method === 'POST' && url.pathname === '/api/notify/email/send-code') {
        const queuedRequest = authenticatedRequest.clone();
        return await deferAccountOperation(queuedRequest, env, ctx, () => handleFastEmailRoute(queuedRequest.clone(), env, url.pathname), { type: 'notify-email-code' });
      }
      if (url.pathname.startsWith('/api/notify/email/')) return await handleFastEmailRoute(authenticatedRequest, env, url.pathname);
      if (method === 'POST' && url.pathname === '/api/notify/ws/register') return await handleFastWebWsRegistration(authenticatedRequest, env, false);
      if (method === 'POST' && url.pathname === '/api/notify/ws/unregister') return await handleFastWebWsRegistration(authenticatedRequest, env, true);
      if ((method === 'GET' || method === 'POST') && url.pathname === '/api/notify/holdings-rule') return await handleFastHoldingsRule(authenticatedRequest, env);
      if ((method === 'GET' || method === 'POST') && url.pathname === '/api/notify/switch/config') return await handleFastSwitchConfig(authenticatedRequest, env);
      if (method === 'GET' && url.pathname === '/api/notify/switch/snapshot') return await handleFastSwitchSnapshot(authenticatedRequest, env);
      if (method === 'POST' && url.pathname === '/api/notify/switch/run') {
        const queuedRequest = authenticatedRequest.clone();
        return await deferAccountOperation(queuedRequest, env, ctx, () => notifyWorker.fetch(queuedRequest.clone(), env, ctx), { type: 'notify-switch-run' });
      }
      if (method === 'DELETE' && url.pathname === '/api/notify/settings') return await handleAccountChannelDelete(authenticatedRequest, env, null, ctx);
      if (method === 'POST' && url.pathname === '/api/notify/settings') {
        const payload = await authenticatedRequest.clone().json().catch(() => ({}));
        if (detectChannelDeletes(payload).length) return await handleAccountChannelDelete(authenticatedRequest, env, payload, ctx);
        return await handleAccountSettings(authenticatedRequest, env, ctx);
      }
      if (method === 'POST' && url.pathname === '/api/notify/sync') {
        const queuedRequest = authenticatedRequest.clone();
        return await deferAccountOperation(queuedRequest, env, ctx, () => handleFastSync(queuedRequest.clone(), env, ctx), { type: 'notify-sync' });
      }
      if (method === 'POST' && url.pathname === '/api/notify/test') {
        const queuedRequest = await stripDeviceIdentityFromAccountTestRequest(authenticatedRequest);
        return await deferAccountOperation(queuedRequest, env, ctx, () => handleDirectAccountTest(queuedRequest.clone(), env), { type: 'notify-test' });
      }
      return await notifyWorker.fetch(authenticatedRequest, env, ctx);
    } catch (error) {
      if (error instanceof NotifyAccountAuthError || error instanceof AccountSettingsError) {
        const payload = { error: error.message, code: error.code };
        if (error.code === 'CHANNEL_REBIND_REQUIRED') payload.canRebind = true;
        if (error.code === 'CHANNEL_BINDING_MISMATCH') payload.canRebind = false;
        return jsonResponse(payload, { status: error.status, origin });
      }
      const status = Number(error?.status) || 0;
      if (status >= 400 && status < 500) return jsonResponse({ error: error instanceof Error ? error.message : '通知请求无效', ...(error?.code ? { code: String(error.code) } : {}) }, { status, origin });
      return jsonResponse({ error: error instanceof Error ? error.message : '通知账户请求失败', code: error?.code || 'AUTH_UNAVAILABLE' }, { status: status >= 500 ? status : 503, origin });
    }
  },
  async queue(batch, env, ctx) {
    for (const message of batch.messages || []) {
      try {
        const response = await processNotifyJob(message.body || {}, env, ctx);
        if (!response?.ok) throw new Error(`notify job returned ${Number(response?.status) || 0}`);
        message.ack();
      } catch (error) {
        console.log('[notify-queue-failed]', JSON.stringify({ id: message.body?.id || '', type: message.body?.type || '', message: error instanceof Error ? error.message : String(error) }));
        message.retry();
      }
    }
  },
  async scheduled(controller, env, ctx) { return notifyWorker.scheduled(controller, env, ctx); }
};
