import { handleFundFee, handleFundLimit } from './fundRoutes.js';
import { refreshFundLimitCache } from './fundLimit.js';
import {
  handleHoldingsNav,
  handleHoldingsNavHistory,
  handleHoldingsNavHistoryBatch
} from './holdingsNavRoutes.js';
import { handleHoldingsOcr, handleOcr } from './imageOcrRoutes.js';
import { emptyResponse, jsonResponse } from './ocrHttp.js';
import { HOLDINGS_PROMPT_VERSION, PROMPT_VERSION } from './geminiPrompt.js';

export default {
  async scheduled(controller, env, ctx) {
    const cron = String(controller?.cron || '').trim();
    // 北京 20:00：批量刷新场外限额 KV，并 dual-write 到 markets D1（写路径；读接口不写库）
    if (cron === '0 12 * * *') {
      ctx.waitUntil((async () => {
        try {
          const summary = await refreshFundLimitCache({ env, ctx, force: true, concurrency: 4 });
          console.log(
            '[fund-limit-cron] total=' + summary.total
            + ' success=' + summary.success
            + ' failed=' + summary.failed
            + ' d1=' + JSON.stringify(summary.d1 || {})
          );
        } catch (err) {
          console.error('[fund-limit-cron] failed', err instanceof Error ? err.message : err);
        }
      })());
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return emptyResponse();
    }

    if (url.pathname === '/api/health') {
      return jsonResponse({
        ok: true,
        service: 'ocr-proxy',
        fundSwitchPromptVersion: PROMPT_VERSION,
        fundHoldingsPromptVersion: HOLDINGS_PROMPT_VERSION
      });
    }

    if (url.pathname === '/api/ocr') {
      if (request.method !== 'POST') {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'POST, OPTIONS'
        });
      }

      try {
        return await handleOcr(request, env);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : 'OCR 代理执行失败。'
        }, 502);
      }
    }

    if (url.pathname === '/api/holdings/ocr') {
      if (request.method !== 'POST') {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'POST, OPTIONS'
        });
      }

      try {
        return await handleHoldingsOcr(request, env);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : '持仓 OCR 代理执行失败。'
        }, 502);
      }
    }

    if (url.pathname === '/api/holdings/nav') {
      if (!['GET', 'POST'].includes(request.method)) {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'GET, POST, OPTIONS'
        });
      }

      try {
        return await handleHoldingsNav(request, env);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : '持仓净值代理执行失败。'
        }, 502);
      }
    }

    if (url.pathname === '/api/holdings/nav-history') {
      // GET ?code=XXXXXX            → 单 code（兼容）
      // POST { codes:[], from?, to?, days?, force? }   → 批量
      if (request.method !== 'GET' && request.method !== 'POST') {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'GET, POST, OPTIONS'
        });
      }

      try {
        if (request.method === 'POST') {
          return await handleHoldingsNavHistoryBatch(request, env);
        }
        return await handleHoldingsNavHistory(request, env);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : '净值历史代理执行失败。'
        }, 502);
      }
    }

    if (url.pathname === '/api/fund-limit') {
      // GET ?code=XXXXXX        → 只读 FUND_LIMIT_KV
      // POST { code: XXXXXX }  → 单 code 手动刷新并写入 FUND_LIMIT_KV
      if (request.method !== 'GET' && request.method !== 'POST') {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'GET, POST, OPTIONS'
        });
      }

      try {
        return await handleFundLimit(request, env, ctx, url.searchParams);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : '基金限额代理执行失败。'
        }, 502);
      }
    }

    if (url.pathname === '/api/fund-fee') {
      // GET ?code=XXXXXX        → 单 code
      // POST { codes: [...] }   → 批量，场外走蛋卷，场内 ETF 自动降级 F10
      if (request.method !== 'GET' && request.method !== 'POST') {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'GET, POST, OPTIONS'
        });
      }

      try {
        return await handleFundFee(request, env, ctx, url.searchParams);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : '基金费率代理执行失败。'
        }, 502);
      }
    }

    return jsonResponse({
      error: 'Not found'
    }, 404);
  }
};
