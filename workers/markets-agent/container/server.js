// M2 容器 HTTP 服务入口。路由：
// - GET  /health                — 返回带 phase 的诊断信息
// - POST /ask                    — 运行一次完整的 LLM 工具调用循环 (同步)
// - POST /__restart__            — 仅调试用；本进程在返回后退出。
// LLM / Tavily / Firecrawl / Markets 的 key 从环境变量读取。

import http from 'node:http';
import { runAgent } from './agent.js';

const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_BYTES = 256 * 1024;

function jsonResponse(res, status, body) {
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
	});
	res.end(JSON.stringify(body));
}

async function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (chunk) => {
			data += chunk;
			if (data.length > MAX_BODY_BYTES) {
				req.destroy();
				reject(new Error('payload too large'));
			}
		});
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
}

const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url, 'http://' + (req.headers.host || 'container'));

		if (url.pathname === '/health' && req.method === 'GET') {
			return jsonResponse(res, 200, {
				ok: true,
				service: 'markets-agent',
				phase: 'M2-agent',
				env: {
					has_openai_key: Boolean(process.env.OPENAI_API_KEY),
					has_openai_base: Boolean(process.env.OPENAI_BASE_URL),
					openai_model: process.env.OPENAI_MODEL || null,
					has_tavily_key: Boolean(process.env.TAVILY_API_KEY),
					has_firecrawl_key: Boolean(process.env.FIRECRAWL_API_KEY),
				},
				node: process.version,
				ts: new Date().toISOString(),
			});
		}

		if (url.pathname === '/ask' && req.method === 'POST') {
			const raw = await readBody(req);
			let parsed = {};
			try {
				parsed = raw ? JSON.parse(raw) : {};
			} catch {
				return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
			}
			const { question, depth, context } = parsed || {};
			if (!question || typeof question !== 'string') {
				return jsonResponse(res, 400, { ok: false, error: 'question_required' });
			}
			const depthNorm = depth === 'deep' ? 'deep' : 'fast';
			const ctxNorm = typeof context === 'string' ? context.slice(0, 6000) : '';
			const result = await runAgent({ question, depth: depthNorm, context: ctxNorm });
			return jsonResponse(res, result.ok ? 200 : 500, result);
		}

		if (url.pathname === '/__restart__' && req.method === 'POST') {
			jsonResponse(res, 200, { ok: true, action: 'exiting' });
			setTimeout(() => process.exit(0), 100);
			return;
		}

		jsonResponse(res, 404, { ok: false, error: 'not_found', path: url.pathname });
	} catch (err) {
		jsonResponse(res, 500, { ok: false, error: String((err && err.message) || err) });
	}
});

server.listen(PORT, () => {
	console.log(`[markets-agent] M2 listening on :${PORT}`);
});
