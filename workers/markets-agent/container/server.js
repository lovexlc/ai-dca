// M3 容器 HTTP 服务入口。
// 路由：
//   GET  /health        — 健康检查
//   POST /ask           — 同步运行 agent，返回完整 JSON
//   POST /ask/stream    — 以 text/event-stream 流式返回 progress/source/token/done 事件
//   POST /__restart__   — 进程退出 (Cloudflare 会重拉)

import http from 'node:http';
import { runAgent, runAgentStream } from './agent.js';

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

function parseAskBody(raw) {
	let parsed = {};
	try { parsed = raw ? JSON.parse(raw) : {}; } catch { return { error: 'invalid_json' }; }
	const { question, depth, context } = parsed || {};
	if (!question || typeof question !== 'string') return { error: 'question_required' };
	const depthNorm = depth === 'deep' ? 'deep' : 'fast';
	const ctxNorm = typeof context === 'string' ? context.slice(0, 6000) : '';
	return { question, depth: depthNorm, context: ctxNorm };
}

function sseWriter(res) {
	res.writeHead(200, {
		'content-type': 'text/event-stream; charset=utf-8',
		'cache-control': 'no-cache, no-transform',
		'connection': 'keep-alive',
		'x-accel-buffering': 'no',
	});
	if (typeof res.flushHeaders === 'function') res.flushHeaders();
	let closed = false;
	const write = (ev) => {
		if (closed) return;
		const { type, ...payload } = ev || {};
		const eventName = type || 'message';
		let line = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
		try { res.write(line); } catch { closed = true; }
	};
	const end = () => {
		if (closed) return;
		closed = true;
		try { res.end(); } catch {}
	};
	// Heartbeat every 15s so intermediaries don't drop the connection during long thinking.
	const hb = setInterval(() => {
		if (closed) { clearInterval(hb); return; }
		try { res.write(`: ping ${Date.now()}\n\n`); } catch { closed = true; clearInterval(hb); }
	}, 15000);
	res.on('close', () => { closed = true; clearInterval(hb); });
	return { write, end, isClosed: () => closed };
}

const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url, 'http://' + (req.headers.host || 'container'));

		if (url.pathname === '/health' && req.method === 'GET') {
			return jsonResponse(res, 200, {
				ok: true,
				service: 'markets-agent',
				phase: 'M3-stream',
				env: {
					has_openai_key: Boolean(process.env.OPENAI_API_KEY),
					has_openai_base: Boolean(process.env.OPENAI_BASE_URL),
					openai_model: process.env.OPENAI_MODEL || null,
					fallback_model: process.env.OPENAI_FALLBACK_MODEL || 'LongCat-Flash-Chat',
					has_tavily_key: Boolean(process.env.TAVILY_API_KEY),
					has_firecrawl_key: Boolean(process.env.FIRECRAWL_API_KEY),
				},
				node: process.version,
				ts: new Date().toISOString(),
			});
		}

		if (url.pathname === '/ask' && req.method === 'POST') {
			const raw = await readBody(req);
			const parsed = parseAskBody(raw);
			if (parsed.error) return jsonResponse(res, 400, { ok: false, error: parsed.error });
			const result = await runAgent(parsed);
			return jsonResponse(res, result.ok ? 200 : 500, result);
		}

		if (url.pathname === '/ask/stream' && req.method === 'POST') {
			const raw = await readBody(req);
			const parsed = parseAskBody(raw);
			if (parsed.error) return jsonResponse(res, 400, { ok: false, error: parsed.error });
			const sse = sseWriter(res);
			const ctrl = new AbortController();
			res.on('close', () => ctrl.abort());
			sse.write({ type: 'started', depth: parsed.depth });
			try {
				await runAgentStream({ ...parsed, emit: sse.write, signal: ctrl.signal });
			} catch (err) {
				sse.write({ type: 'error', message: String(err?.message || err) });
			} finally {
				sse.end();
			}
			return;
		}

		if (url.pathname === '/__restart__' && req.method === 'POST') {
			jsonResponse(res, 200, { ok: true, action: 'exiting' });
			setTimeout(() => process.exit(0), 100);
			return;
		}

		jsonResponse(res, 404, { ok: false, error: 'not_found', path: url.pathname });
	} catch (err) {
		if (!res.headersSent) jsonResponse(res, 500, { ok: false, error: String((err && err.message) || err) });
		else { try { res.end(); } catch {} }
	}
});

server.listen(PORT, () => {
	console.log(`[markets-agent] M3 listening on :${PORT}`);
});
