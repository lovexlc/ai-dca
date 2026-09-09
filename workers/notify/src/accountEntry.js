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
      return notifyWorker.fetch(authenticatedRequest, env, ctx);
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
