import { handleAiChat as handleAiChatRoute } from './aiChatRoutes.js';
import { handleFundFee, handleFundLimit } from './fundRoutes.js';
import {
  handleHoldingsNav,
  handleHoldingsNavHistory,
  handleHoldingsNavHistoryBatch
} from './holdingsNavRoutes.js';
import { handleHoldingsOcr, handleOcr } from './imageOcrRoutes.js';
import { emptyResponse, jsonResponse } from './ocrHttp.js';
import { HOLDINGS_PROMPT_VERSION, PROMPT_VERSION } from './geminiPrompt.js';

export default {
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
      // GET ?code=XXXXXX        → 单 code（向后兼容）
      // POST { codes: [...] }   → 批量，Worker 内部限并发刷 mapLimit，避免 N*3 上游放大
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

    if (url.pathname === '/api/ai-chat') {
      if (request.method !== 'POST') {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'POST, OPTIONS'
        });
      }

      try {
        return await handleAiChatRoute(request, env);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : 'AI 问答代理执行失败。'
        }, 502);
      }
    }

    return jsonResponse({
      error: 'Not found'
    }, 404);
  }
};
