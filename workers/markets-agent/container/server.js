// M1: 极简骨架。只提供 /health 和 echo 版 /ask，同时返回环境中是否已注入 LLM
// 和 Tavily 的 key（不返回值，只返回存在性），便于跑通后验证加密鋾打通。
// M2 这个文件会被 OpenClaw + Tavily MCP 运行时替换。

import http from 'node:http';

const PORT = Number(process.env.PORT || 8080);

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
			if (data.length > 256 * 1024) {
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
				phase: 'M1-skeleton',
				env: {
					has_openai_key: Boolean(process.env.OPENAI_API_KEY),
					has_openai_base: Boolean(process.env.OPENAI_BASE_URL),
					openai_model: process.env.OPENAI_MODEL || null,
					has_tavily_key: Boolean(process.env.TAVILY_API_KEY),
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
			return jsonResponse(res, 200, {
				ok: true,
				phase: 'M1-echo',
				echo: parsed,
				note: 'real agent loop will land in M2 (OpenClaw + Tavily MCP)',
			});
		}

		jsonResponse(res, 404, { ok: false, error: 'not_found', path: url.pathname });
	} catch (err) {
		jsonResponse(res, 500, { ok: false, error: String((err && err.message) || err) });
	}
});

server.listen(PORT, () => {
	console.log(`[markets-agent] listening on :${PORT}`);
});
