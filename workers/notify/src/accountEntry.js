import notifyWorker from './index.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import {
  authenticateNotifyAccountRequest,
  NotifyAccountAuthError,
  requiresNotifyAccountAuth
} from './notifyAccountAuth.js';

// Durable Object class 必须继续从最终 entry module 导出。
export { WsHub } from './index.js';

export default {
  async fetch(request, env, ctx) {
    if (!requiresNotifyAccountAuth(request)) {
      return notifyWorker.fetch(request, env, ctx);
    }

    const origin = readOrigin(request);
    try {
      const authenticatedRequest = await authenticateNotifyAccountRequest(request, env);
      const response = await notifyWorker.fetch(authenticatedRequest, env, ctx);

      // 旧入口会统一捕获 NotifyClientError；在外层补回前端需要的稳定冲突码。
      if (response.status === 409) {
        const payload = await response.clone().json().catch(() => ({}));
        if (!payload?.code && String(payload?.error || '').includes('通知通道已绑定其他账号')) {
          return jsonResponse({
            ...payload,
            code: 'CHANNEL_ALREADY_BOUND'
          }, {
            status: 409,
            origin
          });
        }
      }

      return response;
    } catch (error) {
      if (error instanceof NotifyAccountAuthError) {
        return jsonResponse({
          error: error.message,
          code: error.code
        }, {
          status: error.status,
          origin
        });
      }
      return jsonResponse({
        error: error instanceof Error ? error.message : '通知账户鉴权失败',
        code: 'AUTH_UNAVAILABLE'
      }, {
        status: 503,
        origin
      });
    }
  },

  async scheduled(controller, env, ctx) {
    return notifyWorker.scheduled(controller, env, ctx);
  }
};
