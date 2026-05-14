// markets-agent Worker.
//
// 走 Cloudflare Container 的标准 binding 模式：一个 Durable Object 包装一个 Container。
// 这个 Worker 仅暴露 /internal/*（bearer = INTERNAL_TOKEN），供同账号的
// markets Worker 通过 service binding 调用。不对公网提供任何服务。

// @ts-ignore: 包须要 npm install 后才能解析类型；部署时 wrangler 会拉到依赖。
import { Container } from '@cloudflare/containers';

type Env = {
	MARKETS_AGENT: DurableObjectNamespace;
	INTERNAL_TOKEN?: string;
	OPENAI_BASE_URL?: string;
	OPENAI_API_KEY?: string;
	OPENAI_MODEL?: string;
	TAVILY_API_KEY?: string;
};

export class MarketsAgentContainer extends Container<Env> {
	defaultPort = 8080;
	sleepAfter = '10m';

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		// 注入 container 内可见的环境变量。Cloudflare Containers 会以这些值
		// 作为 process.env.* 启动 container。
		this.envVars = {
			OPENAI_BASE_URL: env.OPENAI_BASE_URL ?? '',
			OPENAI_API_KEY: env.OPENAI_API_KEY ?? '',
			OPENAI_MODEL: env.OPENAI_MODEL ?? '',
			TAVILY_API_KEY: env.TAVILY_API_KEY ?? '',
			FIRECRAWL_API_KEY: env.FIRECRAWL_API_KEY ?? '',
		};
	}

	// 重启逻辑不在这里管。Container helper 的 stop()/destroy() 状态机不可靠；
	// 改为由容器内部 process.exit(0)，Cloudflare 检到进程退出后会拉起
	// 一个新实例，启动时重新注入最新 envVars。
}

function unauthorized() {
	return new Response('Unauthorized', { status: 401 });
}

function notFound() {
	return new Response('Not Found', { status: 404 });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// 只服务 /internal/*。公网 / 子域 / dev tunnel 上的其他路径都返回 404。
		if (!url.pathname.startsWith('/internal/')) return notFound();

		const expected = env.INTERNAL_TOKEN ? `Bearer ${env.INTERNAL_TOKEN}` : '';
		const auth = request.headers.get('authorization') || '';
		if (!expected || auth !== expected) return unauthorized();

		const id = env.MARKETS_AGENT.idFromName('singleton');
		const stub = env.MARKETS_AGENT.get(id);

		if (url.pathname === '/internal/ping' && request.method === 'GET') {
			return stub.fetch('http://container/health');
		}

		if (url.pathname === '/internal/restart' && request.method === 'POST') {
			return stub.fetch('http://container/__restart__', { method: 'POST' });
		}

		if (url.pathname === '/internal/ask' && request.method === 'POST') {
			const body = await request.text();
			return stub.fetch('http://container/ask', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body,
			});
		}

		if (url.pathname === '/internal/ask/stream' && request.method === 'POST') {
			const body = await request.text();
			const upstream = await stub.fetch('http://container/ask/stream', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
				body,
				// M4: 接力取消。客户端 abort -> markets worker close -> 这里 signal aborted
				// -> container HTTP 连接关闭 -> container 里 res.on('close', ctrl.abort()) 处理工具/LLM 中断。
				signal: request.signal,
			});
			// Pipe the container's SSE body straight through to the client.
			return new Response(upstream.body, {
				status: upstream.status,
				headers: {
					'content-type': 'text/event-stream; charset=utf-8',
					'cache-control': 'no-cache, no-transform',
					'connection': 'keep-alive',
					'x-accel-buffering': 'no',
				},
			});
		}

		// Diagnostic: list models from the OpenAI-compatible upstream.
		// Worker fetches directly, bypassing the container.
		if (url.pathname === '/internal/diag/models' && request.method === 'GET') {
			const base = (env.OPENAI_BASE_URL || '').replace(/\/$/, '');
			if (!base || !env.OPENAI_API_KEY) {
				return new Response(JSON.stringify({ error: 'OPENAI_BASE_URL or OPENAI_API_KEY not configured' }), {
					status: 500,
					headers: { 'content-type': 'application/json' },
				});
			}
			const t0 = Date.now();
			try {
				const r = await fetch(`${base}/models`, {
					headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
					signal: AbortSignal.timeout(15000),
				});
				const text = await r.text();
				return new Response(JSON.stringify({
					status: r.status,
					elapsed_ms: Date.now() - t0,
					base,
					body: (() => { try { return JSON.parse(text); } catch { return text; } })(),
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			} catch (e: any) {
				return new Response(JSON.stringify({
					error: String(e?.message || e),
					elapsed_ms: Date.now() - t0,
					base,
				}), { status: 502, headers: { 'content-type': 'application/json' } });
			}
		}

		// Diagnostic: minimal chat completion probe (non-stream).
		// Body: { model?: string, prompt?: string }. Defaults to env.OPENAI_MODEL and 'ping'.
		if (url.pathname === '/internal/diag/chat' && request.method === 'POST') {
			const base = (env.OPENAI_BASE_URL || '').replace(/\/$/, '');
			if (!base || !env.OPENAI_API_KEY) {
				return new Response(JSON.stringify({ error: 'OPENAI_BASE_URL or OPENAI_API_KEY not configured' }), {
					status: 500,
					headers: { 'content-type': 'application/json' },
				});
			}
			let body: any = {};
			try { body = await request.json(); } catch {}
			const model = body.model || env.OPENAI_MODEL || 'auto';
			const prompt = body.prompt || 'ping';
			const t0 = Date.now();
			try {
				const r = await fetch(`${base}/chat/completions`, {
					method: 'POST',
					headers: {
						authorization: `Bearer ${env.OPENAI_API_KEY}`,
						'content-type': 'application/json',
					},
					body: JSON.stringify({
						model,
						messages: [{ role: 'user', content: prompt }],
						max_tokens: 32,
						temperature: 0,
					}),
					signal: AbortSignal.timeout(30000),
				});
				const text = await r.text();
				return new Response(JSON.stringify({
					status: r.status,
					elapsed_ms: Date.now() - t0,
					model_requested: model,
					body: (() => { try { return JSON.parse(text); } catch { return text; } })(),
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			} catch (e: any) {
				return new Response(JSON.stringify({
					error: String(e?.message || e),
					elapsed_ms: Date.now() - t0,
					model_requested: model,
				}), { status: 502, headers: { 'content-type': 'application/json' } });
			}
		}

		return notFound();
	},
};
