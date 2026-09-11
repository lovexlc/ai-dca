import notifyWorker from './index.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import {
  authenticateNotifyAccountRequest,
  NotifyAccountAuthError,
  requiresNotifyAccountAuth
} from './notifyAccountAuth.js';
import { handleFastSync } from './notifySyncRoute.js';

const CLIENT_SECRET_HEADER = 'x-notify-client-secret';

export { WsHub } from './index.js';

// A signed-in account is already authenticated by its bearer token. Older browser
// state may still send a legacy device clientId without the matching local secret
// (for example after localStorage was cleared or migrated). For the test route,
// fall back to the account-scoped notification record instead of rejecting a valid
// account session as an unauthenticated browser device.
export async function normalizeAccountNotifyTestRequest(request) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/notify/test') return request;
  if (String(request.headers.get(CLIENT_SECRET_HEADER) || '').trim()) return request;

  url.searchParams.delete('clientId');
  const payload = await request.clone().json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return new Request(url.toString(), request);
  }

  const nextPayload = { ...payload };
  delete nextPayload.clientId;
  delete nextPayload.notifyClientId;
  delete nextPayload.clientSecret;
  delete nextPayload.notifyClientSecret;
  const headers = new Headers(request.headers);
  headers.delete('content-length');

  return new Request(url.toString(), {
    method: request.method,
    headers,
    body: JSON.stringify(nextPayload),
    redirect: request.redirect
  });
}

export default {
  async fetch(request, env, ctx) {
    if (!requiresNotifyAccountAuth(request)) {
      return notifyWorker.fetch(request, env, ctx);
    }

    const origin = readOrigin(request);
    try {
      const authenticatedRequest = await authenticateNotifyAccountRequest(request, env);
      const routedRequest = await normalizeAccountNotifyTestRequest(authenticatedRequest);
      const url = new URL(routedRequest.url);
      if (routedRequest.method === 'POST' && url.pathname === '/api/notify/sync') {
        return await handleFastSync(routedRequest, env, ctx);
      }
      const response = await notifyWorker.fetch(routedRequest, env, ctx);

      if (response.status === 409) {
        const payload = await response.clone().json().catch(() => ({}));
        if (!payload?.code && String(payload?.error || '').includes('通知通道已绑定其他账号')) {
          return jsonResponse({ ...payload, code: 'CHANNEL_ALREADY_BOUND' }, { status: 409, origin });
        }
      }

      return response;
    } catch (error) {
      if (error instanceof NotifyAccountAuthError) {
        return jsonResponse({ error: error.message, code: error.code }, { status: error.status, origin });
      }
      const status = Number(error?.status) || 0;
      if (status >= 400 && status < 500) {
        const payload = { error: error instanceof Error ? error.message : '通知请求无效' };
        if (error?.code) payload.code = String(error.code);
        return jsonResponse(payload, { status, origin });
      }
      return jsonResponse({
        error: error instanceof Error ? error.message : '通知账户鉴权失败',
        code: 'AUTH_UNAVAILABLE'
      }, { status: 503, origin });
    }
  },

  async scheduled(controller, env, ctx) {
    return notifyWorker.scheduled(controller, env, ctx);
  }
};
