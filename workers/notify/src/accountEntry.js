import notifyWorker from './index.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import { authenticateNotifyAccountRequest, NotifyAccountAuthError, requiresNotifyAccountAuth } from './notifyAccountAuth.js';
import { handleFastSync } from './notifySyncRoute.js';
import { AccountSettingsError, handleAccountSettings } from './accountSettingsRoute.js';
import { detectChannelDeletes, handleAccountChannelDelete } from './accountChannelDeleteRoute.js';
import { handleAccountEvents, handleAccountStatus } from './accountReadRoutes.js';
import { handleFastHoldingsRule, handleFastSwitchConfig, handleFastSwitchSnapshot } from './accountRuleRoutes.js';
import { handleFastEmailRoute } from './accountEmailRoutes.js';
import { deferAccountOperation } from './deferredAccountRoutes.js';

export { WsHub } from './index.js';
export async function stripDeviceIdentityFromAccountTestRequest(request) {
  const payload = await request.clone().json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return request;
  const nextPayload = { ...payload }; delete nextPayload.clientId; delete nextPayload.notifyClientId; delete nextPayload.clientSecret; delete nextPayload.notifyClientSecret;
  const headers = new Headers(request.headers); headers.delete('content-length');
  return new Request(request, { headers, body: JSON.stringify(nextPayload) });
}
export default {
  async fetch(request, env, ctx) {
    if (!requiresNotifyAccountAuth(request)) return notifyWorker.fetch(request, env, ctx);
    const origin = readOrigin(request);
    try {
      const authenticatedRequest = await authenticateNotifyAccountRequest(request, env);
      const url = new URL(authenticatedRequest.url); const method = authenticatedRequest.method;
      if (method === 'GET' && url.pathname === '/api/notify/status') return await handleAccountStatus(authenticatedRequest, env);
      if (method === 'GET' && url.pathname === '/api/notify/events') return await handleAccountEvents(authenticatedRequest, env);
      if (url.pathname.startsWith('/api/notify/email/')) return await handleFastEmailRoute(authenticatedRequest, env, url.pathname);
      if ((method === 'GET' || method === 'POST') && url.pathname === '/api/notify/holdings-rule') return await handleFastHoldingsRule(authenticatedRequest, env);
      if ((method === 'GET' || method === 'POST') && url.pathname === '/api/notify/switch/config') return await handleFastSwitchConfig(authenticatedRequest, env);
      if (method === 'GET' && url.pathname === '/api/notify/switch/snapshot') return await handleFastSwitchSnapshot(authenticatedRequest, env);
      if (method === 'DELETE' && url.pathname === '/api/notify/settings') return await handleAccountChannelDelete(authenticatedRequest, env, null, ctx);
      if (method === 'POST' && url.pathname === '/api/notify/settings') {
        const payload = await authenticatedRequest.clone().json().catch(() => ({}));
        if (detectChannelDeletes(payload).length) return await handleAccountChannelDelete(authenticatedRequest, env, payload, ctx);
        return await handleAccountSettings(authenticatedRequest, env);
      }
      if (method === 'POST' && url.pathname === '/api/notify/sync') {
        const queuedRequest = authenticatedRequest.clone();
        return deferAccountOperation(authenticatedRequest, ctx, () => handleFastSync(queuedRequest, env, ctx), { type: 'notify-sync' });
      }
      if (method === 'POST' && url.pathname === '/api/notify/test') {
        const queuedRequest = await stripDeviceIdentityFromAccountTestRequest(authenticatedRequest);
        return deferAccountOperation(authenticatedRequest, ctx, () => notifyWorker.fetch(queuedRequest, env, ctx), { type: 'notify-test' });
      }
      const response = await notifyWorker.fetch(authenticatedRequest, env, ctx);
      if (response.status === 409) {
        const payload = await response.clone().json().catch(() => ({}));
        if (!payload?.code && String(payload?.error || '').includes('通知通道已绑定其他账号')) return jsonResponse({ ...payload, code: 'CHANNEL_ALREADY_BOUND' }, { status: 409, origin });
      }
      return response;
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
  async scheduled(controller, env, ctx) { return notifyWorker.scheduled(controller, env, ctx); }
};
