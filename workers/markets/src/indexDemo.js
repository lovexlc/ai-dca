/* global Response, URL, console */
import worker, { ExchangeFundHub } from './index.js';
import { handleFundReport } from './fundReportRoutes.js';
import { syncFundReports } from './fundReportSync.js';
import { errorJson } from './marketRuntime.js';

export { ExchangeFundHub };

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return worker.fetch(request, env, ctx);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/markets/, '');
    if (path === '/fund-report') {
      if (request.method !== 'GET') return errorJson('method not allowed', 405);
      try {
        const code = String(url.searchParams.get('code') || '').trim();
        if (url.searchParams.get('force') === '1') {
          if (code !== '270042') return errorJson('fund report demo force sync only supports 270042', 400);
          const sync = await syncFundReports(env, [code], { force: true });
          const result = sync.results?.[0];
          if (!result?.ok) return errorJson('fund report sync failed', 502, { sync: result || sync });
        }
        return await handleFundReport(env, url);
      } catch (error) {
        console.error('fund report route error', error);
        return errorJson((error && error.message) || error);
      }
    }
    return worker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    worker.scheduled(event, env, ctx);
    if (event.cron === '30 12 * * MON-FRI') {
      ctx.waitUntil(syncFundReports(env, ['270042']).catch((error) => {
        console.error('[scheduled] fund periodic report demo sync failed', error);
      }));
    }
  }
};
