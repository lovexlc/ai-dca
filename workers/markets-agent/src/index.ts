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
		};
	}

	// 允许外层 Worker 主动重启 container。Cloudflare Container 只在实例启动时
	// 注入 envVars，所以 secret 改后需要手动踢一下。
	async fetch(req: Request): Promise<Response> {
		const u = new URL(req.url);
		if (u.pathname === '/__restart__') {
			try {
				await this.stop();
			} catch (err) {
				return new Response(JSON.stringify({ ok: false, error: String((err as any)?.message || err) }), {
					status: 500,
					headers: { 'content-type': 'application/json' },
				});
			}
			return new Response(JSON.stringify({ ok: true, action: 'stopped' }), {
				headers: { 'content-type': 'application/json' },
			});
		}
		return super.fetch(req);
	}
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
			return stub.fetch('http://container/__restart__');
		}

		if (url.pathname === '/internal/ask' && request.method === 'POST') {
			const body = await request.text();
			return stub.fetch('http://container/ask', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body,
			});
		}

		return notFound();
	},
};
