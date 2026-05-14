// 工具集合：直接 HTTP 调用 Tavily / Firecrawl / 自家 markets Worker。
// 不走 stdio MCP 子进程，因为 (a) 容器内冷启更快，(b) 错误处理更直接，
// (c) 不需要 spawn 额外 npx 包。

const MARKETS_BASE = process.env.MARKETS_BASE_URL || 'https://tools.freebacktrack.tech/api/markets';
const TAVILY_BASE = 'https://api.tavily.com';
const FIRECRAWL_BASE = 'https://api.firecrawl.dev';

async function fetchJson(url, init = {}, opts = {}) {
	const timeoutMs = opts.timeoutMs || 25000;
	const ctrl = new AbortController();
	const tid = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, { ...init, signal: ctrl.signal });
		const text = await res.text();
		let data;
		try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 2000) }; }
		if (!res.ok) return { ok: false, status: res.status, error: data?.error || text.slice(0, 300) || `HTTP ${res.status}` };
		return { ok: true, status: res.status, data };
	} catch (err) {
		return { ok: false, error: String(err?.message || err) };
	} finally {
		clearTimeout(tid);
	}
}

// ============ 工具定义（OpenAI tools schema 形态）============
export const TOOL_DEFS = [
	{
		type: 'function',
		function: {
			name: 'tavily_search',
			description: '用 Tavily 检索金融 / 财经相关网页，返回 title/url/snippet/score 列表。适合发现报道、研报、官方公告。',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: '搜索 query，可中文可英文，例如 “LongCat-Flash-Thinking 2026 发布” 或 “NVDA Q1 earnings”。' },
					max_results: { type: 'integer', description: '最多返回结果数，默认 6，最大 10。' },
					topic: { type: 'string', enum: ['finance', 'news', 'general'], description: '搜索主题，默认 finance。' },
					days: { type: 'integer', description: '只返回 N 天内的结果，可选。' },
				},
				required: ['query'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'tavily_extract',
			description: '用 Tavily 抓取一组 URL 的正文（轻量，速度快但可能缺失复杂 SPA 内容）。',
			parameters: {
				type: 'object',
				properties: {
					urls: { type: 'array', items: { type: 'string' }, description: '要抓取的 URL 列表，最多 4 个。' },
				},
				required: ['urls'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'firecrawl_scrape',
			description: '用 Firecrawl 抓取单个 URL 的正文，比 tavily_extract 更适合复杂的现代页面（含 JS 渲染、付费墙绕过等）。返回 markdown 正文。',
			parameters: {
				type: 'object',
				properties: {
					url: { type: 'string' },
					only_main_content: { type: 'boolean', description: '默认 true，只抓主内容区。' },
				},
				required: ['url'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'firecrawl_search',
			description: '用 Firecrawl 同时做检索 + 抓取（一步到位）。返回每条结果的 markdown 正文。比 tavily_search + scrape 慢但更深。',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string' },
					limit: { type: 'integer', description: '默认 5，最大 10。' },
				},
				required: ['query'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'get_indices',
			description: '获取主要指数当前行情快照。市场 us 返回 ^GSPC/^IXIC/^DJI/^RUT/^VIX + CNN Fear&Greed；市场 cn 返回 000001/399001/399006 等。',
			parameters: {
				type: 'object',
				properties: {
					market: { type: 'string', enum: ['us', 'cn'] },
				},
				required: ['market'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'get_quote',
			description: '获取单只 ticker 的现价、涨跌幅、市值、52 周高低等。',
			parameters: {
				type: 'object',
				properties: {
					symbol: { type: 'string', description: '美股传 ticker (例如 NVDA / AAPL)，A 股传 6 位代码 (例如 600519 或 000001)。' },
				},
				required: ['symbol'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'get_movers',
			description: '获取涨跌榜（gainers / losers / mixed）。',
			parameters: {
				type: 'object',
				properties: {
					market: { type: 'string', enum: ['us', 'cn'] },
					direction: { type: 'string', enum: ['gainers', 'losers', 'mixed'], description: '默认 mixed。' },
				},
				required: ['market'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'get_news',
			description: '从 Finnhub + Tavily 拉今日财经新闻列表（带 title / url / source / publishedAt / summary）。',
			parameters: {
				type: 'object',
				properties: {
					market: { type: 'string', enum: ['us', 'cn'] },
				},
				required: ['market'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'get_kline',
			description: '获取单只 ticker 的 K 线 (timeframe: 1d / 1w / 1mo)，仅取近 60 根用于趋势判断。',
			parameters: {
				type: 'object',
				properties: {
					symbol: { type: 'string' },
					tf: { type: 'string', enum: ['1d', '1w', '1mo'], description: '默认 1d。' },
				},
				required: ['symbol'],
			},
		},
	},
];

// ============ 工具实现 ============
// 每个 handler 返回 { ok, data?, error?, sources? }；sources 用于聚合到最终响应。

async function tavilySearch(args) {
	const key = process.env.TAVILY_API_KEY;
	if (!key) return { ok: false, error: 'TAVILY_API_KEY missing' };
	const body = {
		query: args.query,
		search_depth: 'basic',
		include_answer: false,
		include_raw_content: false,
		max_results: Math.min(Math.max(Number(args.max_results) || 6, 1), 10),
		topic: args.topic || 'finance',
	};
	if (args.days) body.days = Number(args.days);
	const r = await fetchJson(`${TAVILY_BASE}/search`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
		body: JSON.stringify(body),
	});
	if (!r.ok) return r;
	const results = Array.isArray(r.data?.results) ? r.data.results : [];
	return {
		ok: true,
		data: {
			results: results.map((x) => ({ title: x.title, url: x.url, snippet: String(x.content || '').slice(0, 800), score: x.score, source: hostFromUrl(x.url) })),
		},
		sources: results.map((x) => ({ title: x.title, url: x.url, source: hostFromUrl(x.url) })),
	};
}

async function tavilyExtract(args) {
	const key = process.env.TAVILY_API_KEY;
	if (!key) return { ok: false, error: 'TAVILY_API_KEY missing' };
	const urls = (Array.isArray(args.urls) ? args.urls : []).slice(0, 4);
	if (!urls.length) return { ok: false, error: 'urls empty' };
	const r = await fetchJson(`${TAVILY_BASE}/extract`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
		body: JSON.stringify({ urls }),
	}, { timeoutMs: 40000 });
	if (!r.ok) return r;
	const results = Array.isArray(r.data?.results) ? r.data.results : [];
	return {
		ok: true,
		data: {
			results: results.map((x) => ({ url: x.url, content: String(x.raw_content || x.content || '').slice(0, 6000) })),
		},
	};
}

async function firecrawlScrape(args) {
	const key = process.env.FIRECRAWL_API_KEY;
	if (!key) return { ok: false, error: 'FIRECRAWL_API_KEY missing' };
	if (!args.url) return { ok: false, error: 'url missing' };
	const body = {
		url: args.url,
		formats: ['markdown'],
		onlyMainContent: args.only_main_content !== false,
	};
	const r = await fetchJson(`${FIRECRAWL_BASE}/v1/scrape`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
		body: JSON.stringify(body),
	}, { timeoutMs: 45000 });
	if (!r.ok) return r;
	const d = r.data?.data || r.data || {};
	return {
		ok: true,
		data: {
			url: args.url,
			title: d.metadata?.title || d.title || null,
			markdown: String(d.markdown || d.content || '').slice(0, 8000),
		},
		sources: d.metadata?.sourceURL || d.url ? [{ title: d.metadata?.title || null, url: d.metadata?.sourceURL || d.url || args.url, source: hostFromUrl(d.metadata?.sourceURL || d.url || args.url) }] : [],
	};
}

async function firecrawlSearch(args) {
	const key = process.env.FIRECRAWL_API_KEY;
	if (!key) return { ok: false, error: 'FIRECRAWL_API_KEY missing' };
	const body = {
		query: args.query,
		limit: Math.min(Math.max(Number(args.limit) || 5, 1), 10),
		scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
	};
	const r = await fetchJson(`${FIRECRAWL_BASE}/v1/search`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
		body: JSON.stringify(body),
	}, { timeoutMs: 60000 });
	if (!r.ok) return r;
	const arr = Array.isArray(r.data?.data) ? r.data.data : Array.isArray(r.data?.results) ? r.data.results : [];
	const results = arr.map((x) => ({
		url: x.url || x.metadata?.sourceURL,
		title: x.title || x.metadata?.title || null,
		source: hostFromUrl(x.url || x.metadata?.sourceURL),
		markdown: String(x.markdown || x.content || '').slice(0, 4000),
	}));
	return { ok: true, data: { results }, sources: results.map((x) => ({ title: x.title, url: x.url, source: x.source })) };
}

async function getIndices(args) {
	const market = (args.market || 'us').toLowerCase();
	const r = await fetchJson(`${MARKETS_BASE}/indices?market=${encodeURIComponent(market)}`);
	if (!r.ok) return r;
	return { ok: true, data: { market, asOf: r.data?.updatedAt || null, indexes: r.data?.indexes || [] } };
}

async function getQuote(args) {
	if (!args.symbol) return { ok: false, error: 'symbol missing' };
	const r = await fetchJson(`${MARKETS_BASE}/quote/${encodeURIComponent(args.symbol)}`);
	if (!r.ok) return r;
	return { ok: true, data: r.data };
}

async function getMovers(args) {
	const market = (args.market || 'us').toLowerCase();
	const dir = args.direction || 'mixed';
	const r = await fetchJson(`${MARKETS_BASE}/movers?market=${encodeURIComponent(market)}&direction=${encodeURIComponent(dir)}`);
	if (!r.ok) return r;
	return { ok: true, data: { market, direction: dir, rows: r.data?.rows || r.data?.movers || [] } };
}

async function getNews(args) {
	const market = (args.market || 'us').toLowerCase();
	const r = await fetchJson(`${MARKETS_BASE}/news?market=${encodeURIComponent(market)}`);
	if (!r.ok) return r;
	const news = (r.data?.news || r.data?.items || []).slice(0, 20).map((n) => ({
		title: n.title,
		url: n.url,
		source: n.source || hostFromUrl(n.url),
		publishedAt: n.publishedAt || n.datetime || null,
		summary: String(n.summary || '').slice(0, 400),
	}));
	return { ok: true, data: { market, news }, sources: news.map((x) => ({ title: x.title, url: x.url, source: x.source })) };
}

async function getKline(args) {
	if (!args.symbol) return { ok: false, error: 'symbol missing' };
	const tf = args.tf || '1d';
	const r = await fetchJson(`${MARKETS_BASE}/kline/${encodeURIComponent(args.symbol)}?tf=${encodeURIComponent(tf)}`);
	if (!r.ok) return r;
	const all = Array.isArray(r.data?.candles) ? r.data.candles : Array.isArray(r.data?.kline) ? r.data.kline : [];
	return { ok: true, data: { symbol: args.symbol, tf, candles: all.slice(-60) } };
}

export const TOOL_HANDLERS = {
	tavily_search: tavilySearch,
	tavily_extract: tavilyExtract,
	firecrawl_scrape: firecrawlScrape,
	firecrawl_search: firecrawlSearch,
	get_indices: getIndices,
	get_quote: getQuote,
	get_movers: getMovers,
	get_news: getNews,
	get_kline: getKline,
};

export function hostFromUrl(u) {
	if (!u) return null;
	try { return new URL(u).host.replace(/^www\./, ''); } catch { return null; }
}
