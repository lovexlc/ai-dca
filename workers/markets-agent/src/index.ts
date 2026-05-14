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
