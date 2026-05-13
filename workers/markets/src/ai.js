// AI 问答：Tavily 检索 + Workers AI 生成，返回带引用的 Markdown。

const SYSTEM_PROMPT = `你是一个专注于金融市场的助手，服务对象是中文投资者。
请严格遵守：
1. 只使用用户提供的“参考资料”和“行情快照”给出结论；不胏测、不编造数字。
2. 回答采用中文，结论放在最前，后面用小标题 + 简短要点列表说明理由。
3. 涉及价格 / 涨跌幅 / 交易代码时，一定从“行情快照”取数，并标明数据时间点。
4. 不提供个股买卖建议。可以描述估值、趋势、风险点，但不给买/卖/持有的明确指令。
5. 在文末加一个“参考来源”区块，列出所引用的网站标题 + URL。如果用了多个，编号。`;

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

  return {
    answer: String(answer).trim(),
    model,
    aiError,
    sources: searchResults.map((r) => ({ title: r.title, url: r.url, score: r.score })),
    searchError,
    quoteSnapshots
  };
}
