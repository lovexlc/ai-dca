import { jsonResponse, JSON_HEADERS } from './ocrHttp.js';

/**
 * /api/ai-chat
 * Lightweight chat completion via Cloudflare Workers AI (env.AI).
 * Body: { messages: [{role, content}], system?: string, model?: string }
 * Response: { reply: string, model: string }
 */
export async function handleAiChat(request, env) {
  if (!env || !env.AI || typeof env.AI.run !== 'function') {
    return jsonResponse({ error: 'AI binding 未配置。' }, 503);
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ error: '请求体必须是 JSON。' }, 400);
  }
  const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
  const wantStream = body?.stream === true;
  const messages = [];
  const baseSystem = typeof body?.system === 'string' && body.system.trim()
    ? body.system.trim()
    : [
      '你是 ai-dca 应用内置的 AI 助手，用中文回答。',
      '严格的「闭卷」回答模式：你的回答必须完全建立在下方提供的「知识库片段」之上，不允许使用片段之外的知识、不允许脑补步骤/按钮名/路径/版本号/任何细节、不允许凭印象推断。',
      '如果知识库片段为空，或片段里没有直接回答用户问题的内容，只能回复：',
      '  「抱歉，知识库里暂时没有这个问题的答案，你可以换个说法再问，或者查阅项目文档。」',
      '不要用通用知识填补、不要给「大概/应该/可能」式的猜测回答、不要编造任何 tab 名/按钮名/操作步骤。',
      '当片段确实命中了问题时：',
      '· 按钮名、tab 名、卡片名、输入框提示、文件名一律照抄原文（含引号、中英文混排），不改名、不改说法。',
      '· 步骤的先后顺序、条数照抄；原文 6 步不要合并成 5 步，不省略次要步骤。',
      '· 原文里的细节/限制（先切 sub-tab、加电池白名单、需要同步计划等）必须原样讲出来。',
      '· 原文没写的具体细节（截图、版本号、具体路径）不要补充。',
      '· 如果原文片段里出现 `![](url)` 形式的图片引用，请原样保留在回答里（不要删掉 url，不要改写描述），让前端能渲染出来。',
      '涉及具体投资建议时，提醒用户自行判断风险，不给出绝对收益承诺。',
      '',
      '输出格式规范（前端会按 markdown 渲染，请务必遵守）：',
      '· 第一句先用 1–2 句话直接给出结论或 TL;DR，不要开场重复用户问题、不要说「根据知识库」。',
      '· 主体用 markdown 结构化：多步骤用有序列表 `1.` `2.` `3.`；并列要点用无序列表 `- `；需要分区时用 `**小标题**` 一行领起，不要用 `#`/`##` 大标题。',
      '· 重要的名词（按钮/Tab/选项/开关名）用 **加粗**或 `行内代码`突出，代码/路径/JSON 用 \\`\\`\\` 代码块。',
      '· 不要在回复里逐片段复述、不要写「片段 1 讲了……片段 2 讲了……」这种拼贴文本；必须把多个片段的内容去重、按主题综合成一段连贯的回答。',
      '· 控制长度：一般不超过 250 字，不超过 8 个要点；能一句说清的不要凑多条。',
      '· 末尾另起一行注明依据，格式为 `> 依据：片段 1、3`（这一行不算在主体长度里）。',
    ].join('\n');

  // 取最后一条 user 消息作为检索 query。
  let lastUserContent = '';
  for (let i = rawMessages.length - 1; i >= 0; i--) {
    const m = rawMessages[i];
    if (m && m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      lastUserContent = m.content.trim();
      break;
    }
  }

  // 调用知识库检索（失败不阻断主流程）。
  const knowledge = await retrieveKnowledge(lastUserContent, env).catch((err) => {
    console.warn('[ai-chat] retrieve failed:', err && err.message ? err.message : err);
    return [];
  });

  // 前端可选附带：当前页面简介 / 本地数据片段。
  const pageContext = typeof body?.pageContext === 'string' ? body.pageContext.slice(0, 2000).trim() : '';
  const dataSnippets = Array.isArray(body?.dataSnippets)
    ? body.dataSnippets
        .filter((s) => typeof s === 'string' && s.trim())
        .slice(0, 8)
        .map((s) => s.slice(0, 800))
    : [];

  // 拼接增强 system prompt。
  const systemParts = [baseSystem];
  if (knowledge.length > 0) {
    const ctx = knowledge
      .map((k, i) => `【片段${i + 1}｜${k.title || k.source || ''}】\n${k.text}`)
      .join('\n\n---\n\n');
    systemParts.push(
      '以下是从本站知识库检索到的原文片段（按相关度递减）。你的回答必须完全在这些原文范围内构建：直接引用、复述或综合这些片段；不要补充片段之外的细节，不要修改原文中的名词或步骤；如果这些片段没有直接回答用户问题，按上面的规则回复「抱歉，知识库里暂时没有这个问题的答案……」。\n\n' + ctx,
    );
  } else {
    systemParts.push(
      '本次知识库检索没有命中任何相关片段。请严格按规则直接回复：「抱歉，知识库里暂时没有这个问题的答案，你可以换个说法再问，或者查阅项目文档。」不要使用通用知识尝试回答。',
    );
  }
  if (pageContext) systemParts.push('用户当前页面上下文：\n' + pageContext);
  if (dataSnippets.length > 0) {
    systemParts.push(
      '用户本地数据片段（仅本次对话使用，不会保存）：\n' +
        dataSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n'),
    );
  }
  messages.push({ role: 'system', content: systemParts.join('\n\n') });

  for (let i = 0; i < rawMessages.length; i++) {
    const m = rawMessages[i];
    if (!m || typeof m.content !== 'string') continue;
    const role = m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user');
    if (role === 'system') continue; // system 已经从 body.system 注入
    const text = m.content.slice(0, 4000);
    if (!text.trim()) continue;
    messages.push({ role, content: text });
  }
  if (messages.length <= 1) {
    return jsonResponse({ error: 'messages 不能为空。' }, 400);
  }

  // 模型选择：显式 body.model > 默认文本模型。
  const explicitModel = (typeof body?.model === 'string' && body.model.trim()) ? body.model.trim() : '';
  const textModel = (env.CHAT_MODEL && String(env.CHAT_MODEL).trim())
    || '@cf/meta/llama-3.1-8b-instruct';
  const model = explicitModel || textModel;
  const maxTokens = Number(env.CHAT_MAX_TOKENS) > 0 ? Number(env.CHAT_MAX_TOKENS) : 1024;

  const sources = knowledge.map((k) => ({
    source: k.source,
    title: k.title,
    score: k.score,
  }));

  if (wantStream) {
    let upstream;
    try {
      upstream = await env.AI.run(model, { messages, max_tokens: maxTokens, stream: true });
    } catch (error) {
      return jsonResponse({
        error: error instanceof Error ? error.message : 'Workers AI 调用失败。',
        model,
      }, 502);
    }
    if (!upstream || typeof upstream.getReader !== 'function') {
      return jsonResponse({
        error: 'AI 流式响应不可用。',
        model,
      }, 502);
    }

    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    (async () => {
      const writer = writable.getWriter();
      try {
        const meta = JSON.stringify({ type: 'meta', model, sources });
        await writer.write(encoder.encode(`event: meta\ndata: ${meta}\n\n`));
        const reader = upstream.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) await writer.write(value);
        }
      } catch (err) {
        const errPayload = JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
        try {
          await writer.write(encoder.encode(`event: error\ndata: ${errPayload}\n\n`));
        } catch (e) { /* ignore */ }
      } finally {
        try { await writer.close(); } catch (e) { /* ignore */ }
      }
    })();

    return new Response(readable, {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  }

  let aiResult;
  try {
    aiResult = await env.AI.run(model, {
      messages,
      max_tokens: maxTokens,
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Workers AI 调用失败。',
      model,
    }, 502);
  }
  let reply = '';
  if (typeof aiResult === 'string') {
    reply = aiResult;
  } else if (aiResult && typeof aiResult === 'object') {
    if (typeof aiResult.response === 'string') reply = aiResult.response;
    else if (typeof aiResult.result === 'string') reply = aiResult.result;
    else if (typeof aiResult.output_text === 'string') reply = aiResult.output_text;
    else if (Array.isArray(aiResult.choices) && aiResult.choices[0]?.message?.content) {
      reply = String(aiResult.choices[0].message.content);
    }
  }
  reply = (reply || '').trim();
  if (!reply) {
    return jsonResponse({
      error: 'AI 没有返回有效回复。',
      model,
      raw: aiResult ?? null,
    }, 502);
  }
  return jsonResponse({
    reply,
    model,
    sources,
  });
}

async function retrieveKnowledge(query, env) {
  if (!query || !env || !env.KNOWLEDGE_INDEX || typeof env.KNOWLEDGE_INDEX.query !== 'function') {
    return [];
  }
  if (!env.AI || typeof env.AI.run !== 'function') return [];

  const embedModel = env.EMBED_MODEL || '@cf/baai/bge-m3';
  const topK = Number(env.CHAT_TOP_K) > 0 ? Math.min(Number(env.CHAT_TOP_K), 12) : 8;
  const minScore = Number.isFinite(Number(env.CHAT_MIN_SCORE)) ? Number(env.CHAT_MIN_SCORE) : 0.3;

  let embed;
  try {
    embed = await env.AI.run(embedModel, { text: [query.slice(0, 1000)] });
  } catch (err) {
    console.warn('[ai-chat] embed failed:', err && err.message ? err.message : err);
    return [];
  }
  const vector =
    (Array.isArray(embed?.data) && Array.isArray(embed.data[0]) && embed.data[0]) ||
    (Array.isArray(embed) && Array.isArray(embed[0]) && embed[0]) ||
    null;
  if (!vector || vector.length === 0) return [];

  let queryRes;
  try {
    queryRes = await env.KNOWLEDGE_INDEX.query(vector, {
      topK,
      returnMetadata: 'all',
    });
  } catch (err) {
    console.warn('[ai-chat] vectorize query failed:', err && err.message ? err.message : err);
    return [];
  }
  const matches = Array.isArray(queryRes?.matches) ? queryRes.matches : [];
  return matches
    .filter((m) => typeof m.score === 'number' && m.score >= minScore)
    .map((m) => ({
      id: m.id,
      score: m.score,
      source: m.metadata?.source || '',
      title: m.metadata?.title || '',
      text: typeof m.metadata?.text === 'string' ? m.metadata.text : '',
    }))
    .filter((m) => m.text.trim().length > 0);
}
