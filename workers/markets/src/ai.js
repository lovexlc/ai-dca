// AI 问答：Tavily 检索 + Workers AI 生成，返回带引用的 Markdown。

const SYSTEM_PROMPT = `你是一个专注于金融市场的助手，服务对象是中文投资者。
请严格遵守：
1. 只使用用户提供的“参考资料”和“行情快照”给出结论；不胏测、不编造数字。
2. 回答采用中文，结论放在最前，后面用小标题 + 简短要点列表说明理由。
3. 涉及价格 / 涨跌幅 / 交易代码时，一定从“行情快照”取数，并标明数据时间点。
4. 不提供个股买卖建议。可以描述估值、趋势、风险点，但不给买/卖/持有的明确指令。
5. 【重要】不要在回答里追加“参考来源”/“引用”/“来源”/“sources”区块，也不要在文末重复列出 URL；前端会单独展示来源列表。如需引用可在正文用[1][2]这样的角标对应组号即可。`;

export async function tavilySearch({ query, key, maxResults = 5 }) {
  if (!key) throw new Error('missing TAVILY_API_KEY');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      max_results: maxResults,
      topic: 'finance'
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`tavily HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function buildContext(searchResults, quoteSnapshots) {
  const lines = [];
  if (Array.isArray(quoteSnapshots) && quoteSnapshots.length) {
    lines.push('## 行情快照');
    for (const q of quoteSnapshots) {
      const pct = q.changePercent != null ? `${q.changePercent >= 0 ? '+' : ''}${q.changePercent}%` : '—';
      lines.push(`- ${q.name || q.symbol} (${q.symbol}): 现价 ${q.price ?? '—'}，涨跌 ${pct}，数据时间 ${q.asOf || ''}`);
    }
    lines.push('');
  }
  if (Array.isArray(searchResults) && searchResults.length) {
    lines.push('## 参考资料（Tavily）');
    searchResults.forEach((item, idx) => {
      const title = item.title || '无标题';
      const url = item.url || '';
      const content = String(item.content || '').replace(/\s+/g, ' ').trim().slice(0, 800);
      lines.push(`### [${idx + 1}] ${title}`);
      lines.push(`URL: ${url}`);
      lines.push(content);
      lines.push('');
    });
  }
  return lines.join('\n');
}

export async function askWithGrounding({ env, question, quoteSnapshots = [], depth = 'fast' }) {
  const tavilyKey = env.TAVILY_API_KEY;
  let searchResults = [];
  let searchError = '';
  try {
    const data = await tavilySearch({ query: question, key: tavilyKey, maxResults: 5 });
    searchResults = Array.isArray(data?.results) ? data.results : [];
  } catch (err) {
    searchError = String(err?.message || err);
  }

  const context = buildContext(searchResults, quoteSnapshots);
  const model = depth === 'deep' ? (env.CHAT_MODEL_DEEP || '@cf/moonshotai/kimi-k2.6') : (env.CHAT_MODEL_FAST || '@cf/zai-org/glm-4.7-flash');
  const maxTokens = Number(env.CHAT_MAX_TOKENS || 2048);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${context}\n\n## 问题\n${question}`
    }
  ];

  let aiResp;
  let aiError = '';
  try {
    aiResp = await env.AI.run(model, { messages, max_tokens: maxTokens });
  } catch (err) {
    aiError = String(err?.message || err);
  }
  let answer = '';
  if (typeof aiResp === 'string') {
    answer = aiResp;
  } else if (aiResp) {
    answer = aiResp.response
      || aiResp?.result?.response
      || aiResp?.choices?.[0]?.message?.content
      || aiResp?.output?.[0]?.content?.[0]?.text
      || aiResp?.output_text
      || '';
  }

  // 防模型偷加参考来源区块：裁掉最后一个“参考来源 / 来源 / 引用 / Sources”标题之后的所有内容。
  const HEADING_RE = /(?:^|\n)\s*(?:#{1,6}\s*)?\**\s*(?:参考来源|来源|引用|资料来源|sources|references)\s*\**\s*[:。：]?\s*\n/gi;
  let cleaned = String(answer);
  let lastIdx = -1;
  let m;
  while ((m = HEADING_RE.exec(cleaned)) !== null) lastIdx = m.index;
  if (lastIdx >= 0) cleaned = cleaned.slice(0, lastIdx).replace(/\s+$/, '');

  return {
    answer: cleaned.trim(),
    model,
    aiError,
    sources: searchResults.map((r) => ({ title: r.title, url: r.url, score: r.score })),
    searchError,
    quoteSnapshots
  };
}

// =====================================================================
// 主题摘要：读入今日新闻 + 涨跌榜，交 AI 归纳为 4 条主题。
// =====================================================================

const SUMMARY_SYSTEM = `你是一名面向中文投资者的美股市场编辑。给定今日新闻标题和涨跌榜，你需要提炼出正好 4 个「今日主题」。
要求：
- 每个主题输出一个简短 title（8-14 个字） + 一段 detail（60-120 个字）。
- title 要能点明主题 (例如「AI 芯片报价拉升纳指」)。
- detail 要给事实依据（股票涨跌 / 标题关键词），不主观推荐买卖。
- 输出严格 JSON：{"themes": [{"title": "...", "detail": "..."}, ...]} 共 4 个。不要包裹 \u0060\u0060\u0060 代码块，不要附加任何说明文字。`;

function buildSummaryUserMsg({ market, news, movers }) {
  const lines = [];
  lines.push(`市场：${market.toUpperCase()}`);
  lines.push(`时间：${new Date().toISOString()}`);
  lines.push('');
  if (Array.isArray(news) && news.length) {
    lines.push('## 今日新闻 (标题 + 来源)');
    news.slice(0, 25).forEach((it, idx) => {
      const title = (it.title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const src = it.source || '';
      lines.push(`${idx + 1}. ${title}${src ? ' 【' + src + '】' : ''}`);
    });
    lines.push('');
  }
  if (Array.isArray(movers) && movers.length) {
    lines.push('## 今日涨跌榜 (top)');
    movers.slice(0, 20).forEach((r) => {
      const pct = r.changePercent != null ? `${r.changePercent >= 0 ? '+' : ''}${Number(r.changePercent).toFixed(2)}%` : '—';
      const ind = r.industry ? ` [${r.industry}]` : '';
      lines.push(`- ${r.name || r.symbol} (${r.symbol}): ${pct}${ind}`);
    });
    lines.push('');
  }
  lines.push('请输出正好 4 个主题的 JSON。');
  return lines.join('\n');
}

function extractJson(text) {
  if (!text) return null;
  // 去掉 \u0060\u0060\u0060json ... \u0060\u0060\u0060 代码栅栏。
  const stripped = String(text).replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

export async function summarizeMarkets({ env, market = 'us', news = [], movers = [] }) {
  const model = env.SUMMARY_MODEL || env.CHAT_MODEL_FAST || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const maxTokens = Number(env.SUMMARY_MAX_TOKENS || 1024);
  const userMsg = buildSummaryUserMsg({ market, news, movers });
  let aiResp;
  let aiError = '';
  try {
    aiResp = await env.AI.run(model, {
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM },
        { role: 'user', content: userMsg }
      ],
      max_tokens: maxTokens
    });
  } catch (err) {
    aiError = String(err?.message || err);
  }
  let raw = '';
  if (typeof aiResp === 'string') raw = aiResp;
  else if (aiResp) {
    raw = aiResp.response
      || aiResp?.result?.response
      || aiResp?.choices?.[0]?.message?.content
      || aiResp?.output?.[0]?.content?.[0]?.text
      || aiResp?.output_text || '';
  }
  const parsed = extractJson(raw);
  let themes = [];
  if (parsed && Array.isArray(parsed.themes)) {
    themes = parsed.themes
      .map((t) => ({ title: String(t?.title || '').trim(), detail: String(t?.detail || '').trim() }))
      .filter((t) => t.title && t.detail)
      .slice(0, 4);
  }
  return {
    themes,
    model,
    aiError,
    raw: raw.slice(0, 4000)
  };
}
