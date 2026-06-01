import { deriveFundSwitchComparison, sanitizeFundSwitchComparison, sanitizeFundSwitchRows } from '../../../src/app/fundSwitchCore.js';
import {
  buildHoldingsOcrUserPrompt,
  buildOcrUserPrompt,
  DEFAULT_OCR_MODEL,
  HOLDINGS_PROMPT_VERSION,
  HOLDINGS_SYSTEM_PROMPT,
  FUND_SWITCH_SYSTEM_PROMPT,
  PROMPT_VERSION
} from './geminiPrompt.js';
import { fetchFundLimit, fetchFundLimitsBatch } from './fundLimit.js';
import { fetchFundFee, fetchFundFeesBatch } from './fundFee.js';
import {
  handleHoldingsNav,
  handleHoldingsNavHistory,
  handleHoldingsNavHistoryBatch,
  nowShanghaiIso,
  readFundNavSnapshot
} from './holdingsNavRoutes.js';
import { emptyResponse, jsonResponse, JSON_HEADERS } from './ocrHttp.js';
import {
  bytesToBase64,
  createUpstreamError,
  isRetryableUpstreamError,
  parseFallbackComparison,
  parseIntegerEnv,
  parseModelResponse,
  sleep
} from './ocrModelResponse.js';
import {
  buildHoldingsPreviewLines,
  sanitizeHoldingsRows,
  scoreHoldingsConfidence
} from './holdingsOcrRows.js';

const FUND_SWITCH_OCR_PROMPT = {
  systemPrompt: FUND_SWITCH_SYSTEM_PROMPT,
  buildUserPrompt: buildOcrUserPrompt,
  promptVersion: PROMPT_VERSION
};

const HOLDINGS_OCR_PROMPT = {
  systemPrompt: HOLDINGS_SYSTEM_PROMPT,
  buildUserPrompt: buildHoldingsOcrUserPrompt,
  promptVersion: HOLDINGS_PROMPT_VERSION
};

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function normalizeText(value = '') {
  return String(value)
    .replace(/\u3000/g, ' ')
    .replace(/[，]/g, ',')
    .replace(/[：]/g, ':')
    .replace(/[．·•]/g, '.')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTradeType(value = '') {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }

  if (['卖出', '赎回', '转出'].some((keyword) => text.includes(keyword)) || /^卖/.test(text)) {
    return '卖出';
  }

  if (['买入', '申购', '定投', '转入'].some((keyword) => text.includes(keyword)) || /^买/.test(text)) {
    return '买入';
  }

  if (text.toLowerCase() === 'sell') {
    return '卖出';
  }

  if (text.toLowerCase() === 'buy') {
    return '买入';
  }

  return '';
}

function normalizeDate(rawValue = '') {
  const text = normalizeText(rawValue).replace(/[一]/g, '-');
  const separated = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (separated) {
    const [, year, month, day, hour, minute, second] = separated;
    const date = [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
    if (!hour || !minute) {
      return date;
    }

    return `${date} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${(second || '00').padStart(2, '0')}`;
  }

  const compact = text.match(/(20\d{2})(\d{2})(\d{2})(?:\s?(\d{2}):?(\d{2}):?(\d{2}))?/);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    const date = `${year}-${month}-${day}`;
    if (!hour || !minute || !second) {
      return date;
    }

    return `${date} ${hour}:${minute}:${second}`;
  }

  return text;
}

function buildRowId(index) {
  return `switch-import-${Date.now()}-${index + 1}`;
}

function normalizeAmount(value) {
  return round(Math.max(Number(value) || 0, 0), 2);
}

function maybeRepairShares(row, warnings) {
  const price = row.price;
  const shares = row.shares;
  const amount = row.amount;

  if (!(price > 0 && shares > 0 && amount > 0)) {
    return row;
  }

  const inferredShares = amount / price;
  const hundredLotCandidate = Math.round(inferredShares / 100) * 100;
  const integerCandidate = Math.round(inferredShares);
  const amountMismatch = Math.abs((price * shares) - amount);
  const hasMajorMismatch = amountMismatch > Math.max(1, amount * 0.002);
  let nextShares = shares;
  let reason = '';

  if (Math.abs(hundredLotCandidate - inferredShares) <= 0.5 && Math.abs(shares - hundredLotCandidate) > 0.01) {
    nextShares = hundredLotCandidate;
    reason = '按成交额/单价修正为 100 份整数';
  } else if (Math.abs(integerCandidate - inferredShares) <= 0.05 && Math.abs(shares - integerCandidate) > 0.01) {
    nextShares = integerCandidate;
    reason = '按成交额/单价修正为整数份额';
  } else if (hasMajorMismatch) {
    nextShares = round(inferredShares, 2);
    reason = '按成交额/单价回推份额';
  }

  if (!reason) {
    return row;
  }

  warnings.push(`${row.date || '未标注日期'} ${row.code} ${reason}`);
  return {
    ...row,
    shares: round(nextShares, 2)
  };
}

function sanitizeRows(rows = []) {
  const normalizationWarnings = [];
  const normalizedRows = rows.map((row, index) => maybeRepairShares({
    id: normalizeText(row?.id) || buildRowId(index),
    date: normalizeDate(row?.date || ''),
    code: normalizeText(row?.code || ''),
    type: normalizeTradeType(row?.type || ''),
    price: round(Math.max(Number(row?.price) || 0, 0), 4),
    shares: round(Math.max(Number(row?.shares) || 0, 0), 2),
    amount: normalizeAmount(row?.amount)
  }, normalizationWarnings));

  return {
    rows: sanitizeFundSwitchRows(normalizedRows, { filterInvalid: true, idPrefix: 'switch-import' }),
    warnings: normalizationWarnings
  };
}

function buildPreviewLines(rows, warnings) {
  if (rows.length) {
    return rows.slice(0, 6).map((row) => `${row.date || '无日期'} | ${row.type} | ${row.code} | ${row.price} | ${row.shares} | ${row.amount}`);
  }

  return warnings.filter(Boolean).slice(0, 6);
}

function scoreConfidence(rows, warnings) {
  let score = rows.length * 0.18;
  score += rows.filter((row) => row.date).length * 0.08;

  if (rows.some((row) => row.type === '买入')) {
    score += 0.12;
  }

  if (rows.some((row) => row.type === '卖出')) {
    score += 0.12;
  }

  score -= warnings.length * 0.05;
  return round(Math.max(0.15, Math.min(score, 0.95)), 2);
}

async function callUpstreamModel(file, env, promptConfig = FUND_SWITCH_OCR_PROMPT) {
  if (!env?.AI || typeof env.AI.run !== 'function') {
    throw new Error('未配置 Workers AI 绑定（[ai] binding = "AI"），无法执行 OCR。');
  }

  const model = String(env.OCR_MODEL || DEFAULT_OCR_MODEL).trim();
  const arrayBuffer = await file.arrayBuffer();
  const imageUint8 = new Uint8Array(arrayBuffer);
  // OCR 输出是结构化 JSON（数组 + 多列字段），1500 token 容易被截断。
  // 默认放到 4096；可通过 wrangler.toml 的 OCR_MAX_TOKENS 覆盖。
  const maxTokens = Math.max(256, parseIntegerEnv(env.OCR_MAX_TOKENS, 4096));

  // 点名是“OpenAI 兑充”调用路径（kimi-k2.6 / llava / GPT-style）：图必须作为 user message
  // 的 content 数组中的 image_url（base64 data URL）传入，不能用顶层 `image` 字段。
  // 顶层 `image` 是 Cloudflare 早期 Llama 3.2 Vision 专用的快路径，其他模型会直接
  // 忽略它 —— 导致 user message 只有文字、模型答“未检测到可识别的交易截图”。
  const mimeType = (typeof file?.type === 'string' && file.type.startsWith('image/')) ? file.type : 'image/jpeg';
  const base64Image = bytesToBase64(imageUint8);
  const dataUrl = `data:${mimeType};base64,${base64Image}`;
  const userText = promptConfig.buildUserPrompt(file.name || 'uploaded-image');

  const input = {
    messages: [
      { role: 'system', content: promptConfig.systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ],
    max_tokens: maxTokens,
    temperature: 0.1
  };

  let payload;
  try {
    console.log('[ocr] calling Workers AI', JSON.stringify({
      model,
      msgCount: input?.messages?.length || 0,
      mimeType,
      imageBytes: imageUint8.length,
      base64Len: base64Image.length,
      max_tokens: input?.max_tokens
    }));
    payload = await env.AI.run(model, input);
    try {
      const keys = payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 12) : [];
      const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
      const contentRaw = choice?.message?.content ?? choice?.text ?? payload?.response ?? payload?.description ?? '';
      const content = typeof contentRaw === 'string' ? contentRaw : JSON.stringify(contentRaw);
      const sample = String(content || '').slice(0, 320);
      const finishReason = choice?.finish_reason || choice?.stop_reason || null;
      const usage = payload?.usage || null;
      console.log('[ocr] workers-ai payload shape', JSON.stringify({ keys, finishReason, usage, contentLen: String(content || '').length, sample }));
    } catch (_logErr) {}
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Workers AI 调用失败。';
    const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status ?? 0);
    const normalizedMessage = String(message || '').toLowerCase();

    // 某些模型（如 Llama 3.2 Vision）首次调用需先提交 'agree' 以同意许可与使用政策。
    // 遇到相关报错（常见包含关键词 'agree' 或代码 5016），先发送一次同意，再重试真实请求。
    const needsAgree = normalizedMessage.includes('agree') || String(error?.code || '').includes('5016') || String(status) === '5016';
    if (needsAgree) {
      try {
        // 轻量同意请求 —— 使用 messages 形式提交 'agree'
        await env.AI.run(model, { messages: [{ role: 'user', content: 'agree' }] });
        // 同意成功后重试真实推理
        console.log('[ocr] sent agree, retrying real inference');
        payload = await env.AI.run(model, input);
        try {
          const keys = payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 12) : [];
          const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
          const contentRaw = choice?.message?.content ?? choice?.text ?? payload?.response ?? payload?.description ?? '';
          const content = typeof contentRaw === 'string' ? contentRaw : JSON.stringify(contentRaw);
          const sample = String(content || '').slice(0, 320);
          const finishReason = choice?.finish_reason || choice?.stop_reason || null;
          const usage = payload?.usage || null;
          console.log('[ocr] workers-ai payload shape (retry)', JSON.stringify({ keys, finishReason, usage, contentLen: String(content || '').length, sample }));
        } catch (_logErr) {}
      } catch (retryError) {
        const retryMsg = retryError instanceof Error && retryError.message ? retryError.message : 'Workers AI 调用失败（同意后重试仍失败）。';
        const retryStatus = Number(retryError?.status ?? retryError?.statusCode ?? retryError?.response?.status ?? 0);
        throw createUpstreamError(retryMsg, {
          status: Number.isFinite(retryStatus) && retryStatus > 0 ? retryStatus : (Number.isFinite(status) && status > 0 ? status : 502),
          code: retryError?.code || retryError?.name || error?.code || error?.name
        });
      }
    } else {
      throw createUpstreamError(message, {
        status: Number.isFinite(status) && status > 0 ? status : 502,
        code: error?.code || error?.name
      });
    }
  }

  // Workers AI 根据模型不同，返回可能是 { response: "..." } 、 { description: "..." } 、
  // 纯字符串，或其它 OpenAI 兼容形式。全部交给 parseModelResponse 统一处理。
  if (typeof payload === 'string') {
    payload = { response: payload };
  } else if (payload == null) {
    throw new Error('Workers AI 返回了空响应。');
  }

  return { model, payload };
}

async function callUpstreamModelWithRetry(file, env, promptConfig = FUND_SWITCH_OCR_PROMPT) {
  const maxRetries = Math.max(0, parseIntegerEnv(env.OCR_RETRY_ATTEMPTS, 1));
  const retryDelayMs = Math.max(0, parseIntegerEnv(env.OCR_RETRY_DELAY_MS, 800));
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await callUpstreamModel(file, env, promptConfig);
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !isRetryableUpstreamError(error)) {
        throw error;
      }

      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  throw lastError;
}

async function handleOcr(request, env) {
  try { console.log('[ocr] handleOcr start'); } catch (_e) {}
  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return jsonResponse({
      error: '请求中缺少图片文件字段 file。'
    }, 400);
  }

  if (!String(file.type || '').startsWith('image/')) {
    return jsonResponse({
      error: '当前仅支持图片上传，请使用 PNG、JPG、JPEG 或 WebP。'
    }, 400);
  }

  const startedAt = Date.now();
  const fallbackComparison = sanitizeFundSwitchComparison(parseFallbackComparison(formData.get('fallbackComparison')));
  const { model, payload } = await callUpstreamModelWithRetry(file, env, FUND_SWITCH_OCR_PROMPT);
  try { console.log('[ocr] handleOcr got payload'); } catch (_e) {}
  const extracted = parseModelResponse(payload);
  const rowResult = sanitizeRows(extracted.rows || []);
  const rows = rowResult.rows;
  const warnings = [
    ...(Array.isArray(extracted.warnings) ? extracted.warnings.map((item) => normalizeText(item)).filter(Boolean) : []),
    ...rowResult.warnings
  ];
  const comparison = deriveFundSwitchComparison(rows, fallbackComparison, fallbackComparison.strategy);

  return jsonResponse({
    ok: true,
    provider: 'cloudflare-workers-ai',
    model,
    promptVersion: FUND_SWITCH_OCR_PROMPT.promptVersion,
    durationMs: Date.now() - startedAt,
    confidence: scoreConfidence(rows, warnings),
    recordCount: rows.length,
    rows,
    comparison,
    warnings,
    previewLines: buildPreviewLines(rows, warnings)
  });
}

async function handleHoldingsOcr(request, env) {
  try { console.log('[ocr] handleHoldingsOcr start'); } catch (_e) {}
  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return jsonResponse({
      error: '请求中缺少图片文件字段 file。'
    }, 400);
  }

  if (!String(file.type || '').startsWith('image/')) {
    return jsonResponse({
      error: '当前仅支持图片上传，请使用 PNG、JPG、JPEG 或 WebP。'
    }, 400);
  }

  const startedAt = Date.now();
  const { model, payload } = await callUpstreamModelWithRetry(file, env, HOLDINGS_OCR_PROMPT);
  try { console.log('[ocr] handleHoldingsOcr got payload'); } catch (_e) {}
  const extracted = parseModelResponse(payload);
  const rowResult = await sanitizeHoldingsRows(extracted.rows || [], {
    generatedAt: nowShanghaiIso(),
    readFundNavSnapshot
  });
  const rows = rowResult.rows;
  const warnings = [
    ...(Array.isArray(extracted.warnings) ? extracted.warnings.map((item) => normalizeText(item)).filter(Boolean) : []),
    ...rowResult.warnings
  ];

  return jsonResponse({
    ok: true,
    provider: 'cloudflare-workers-ai',
    model,
    promptVersion: HOLDINGS_OCR_PROMPT.promptVersion,
    durationMs: Date.now() - startedAt,
    confidence: scoreHoldingsConfidence(rows, warnings),
    recordCount: rows.length,
    rows,
    warnings,
    previewLines: buildHoldingsPreviewLines(rows, warnings)
  });
}

/**
 * /api/ai-chat
 * Lightweight chat completion via Cloudflare Workers AI (env.AI).
 * Body: { messages: [{role, content}], system?: string, model?: string }
 * Response: { reply: string, model: string }
 */
async function handleAiChat(request, env) {
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
  let lastUserIdx = -1;
  for (let i = rawMessages.length - 1; i >= 0; i--) {
    const m = rawMessages[i];
    if (m && m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      lastUserContent = m.content.trim();
      lastUserIdx = i;
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return emptyResponse();
    }

    if (url.pathname === '/api/health') {
      return jsonResponse({
        ok: true,
        service: 'ocr-proxy',
        fundSwitchPromptVersion: PROMPT_VERSION,
        fundHoldingsPromptVersion: HOLDINGS_PROMPT_VERSION
      });
    }

    if (url.pathname === '/api/ocr') {
      if (request.method !== 'POST') {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'POST, OPTIONS'
        });
      }

      try {
        return await handleOcr(request, env);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : 'OCR 代理执行失败。'
        }, 502);
      }
    }

    if (url.pathname === '/api/holdings/ocr') {
      if (request.method !== 'POST') {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'POST, OPTIONS'
        });
      }

      try {
        return await handleHoldingsOcr(request, env);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : '持仓 OCR 代理执行失败。'
        }, 502);
      }
    }

    if (url.pathname === '/api/holdings/nav') {
      if (!['GET', 'POST'].includes(request.method)) {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'GET, POST, OPTIONS'
        });
      }

      try {
        return await handleHoldingsNav(request, env);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : '持仓净值代理执行失败。'
        }, 502);
      }
    }

    if (url.pathname === '/api/holdings/nav-history') {
      // GET ?code=XXXXXX            → 单 code（兼容）
      // POST { codes:[], from?, to?, days?, force? }   → 批量
      if (request.method !== 'GET' && request.method !== 'POST') {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'GET, POST, OPTIONS'
        });
      }

      try {
        if (request.method === 'POST') {
          return await handleHoldingsNavHistoryBatch(request, env);
        }
        return await handleHoldingsNavHistory(request, env);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : '净值历史代理执行失败。'
        }, 502);
      }
    }

    if (url.pathname === '/api/fund-limit') {
      // GET ?code=XXXXXX        → 单 code（向后兼容）
      // POST { codes: [...] }   → 批量，Worker 内部限并发刷 mapLimit，避免 N*3 上游放大
      if (request.method !== 'GET' && request.method !== 'POST') {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'GET, POST, OPTIONS'
        });
      }

      try {
        const force = url.searchParams.get('refresh') === '1' || url.searchParams.get('force') === '1';

        if (request.method === 'POST') {
          let payload = {};
          try {
            payload = await request.json();
          } catch (_e) {
            payload = {};
          }
          const rawCodes = Array.isArray(payload?.codes) ? payload.codes
            : typeof payload?.codes === 'string' ? payload.codes.split(',')
            : [];
          // 上限 60（与 holdings/nav 对齐）；防忖意传上千个 code。
          if (rawCodes.length > 60) {
            return jsonResponse({ error: '单次最多查询 60 个基金代码。' }, 400);
          }
          const batch = await fetchFundLimitsBatch({ codes: rawCodes, force, env, ctx, concurrency: 4 });
          if (!batch.ok) {
            return jsonResponse({ error: batch.error, items: [], successCount: 0, failureCount: 0 }, batch.status || 400);
          }
          return jsonResponse({
            items: batch.items,
            successCount: batch.successCount,
            failureCount: batch.failureCount,
            generatedAt: new Date().toISOString()
          });
        }

        const code = (url.searchParams.get('code') || '').trim();
        const result = await fetchFundLimit({ code, force, env, ctx });
        if (!result.ok) {
          return jsonResponse({
            error: result.error,
            code: result.code,
            tried: result.tried
          }, result.status || 502);
        }
        return jsonResponse(result.data);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : '基金限额代理执行失败。'
        }, 502);
      }
    }

    if (url.pathname === '/api/fund-fee') {
      // GET ?code=XXXXXX        → 单 code
      // POST { codes: [...] }   → 批量，场外走蛋卷，场内 ETF 自动降级 F10
      if (request.method !== 'GET' && request.method !== 'POST') {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'GET, POST, OPTIONS'
        });
      }

      try {
        const force = url.searchParams.get('refresh') === '1' || url.searchParams.get('force') === '1';

        if (request.method === 'POST') {
          let payload = {};
          try {
            payload = await request.json();
          } catch (_e) {
            payload = {};
          }
          const rawCodes = Array.isArray(payload?.codes) ? payload.codes
            : typeof payload?.codes === 'string' ? payload.codes.split(',')
            : [];
          if (rawCodes.length > 60) {
            return jsonResponse({ error: '单次最多查询 60 个基金代码。' }, 400);
          }
          const batch = await fetchFundFeesBatch({ codes: rawCodes, force, env, ctx, concurrency: 4 });
          if (!batch.ok) {
            return jsonResponse({ error: batch.error, items: [], successCount: 0, failureCount: 0 }, batch.status || 400);
          }
          return jsonResponse({
            items: batch.items,
            successCount: batch.successCount,
            failureCount: batch.failureCount,
            generatedAt: new Date().toISOString()
          });
        }

        const code = (url.searchParams.get('code') || '').trim();
        const result = await fetchFundFee({ code, force, env, ctx });
        if (!result.ok) {
          return jsonResponse({
            error: result.error,
            code: result.code,
            tried: result.tried
          }, result.status || 502);
        }
        return jsonResponse(result.data);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : '基金费率代理执行失败。'
        }, 502);
      }
    }

    if (url.pathname === '/api/ai-chat') {
      if (request.method !== 'POST') {
        return jsonResponse({
          error: 'Method not allowed'
        }, 405, {
          allow: 'POST, OPTIONS'
        });
      }

      try {
        return await handleAiChat(request, env);
      } catch (error) {
        return jsonResponse({
          error: error instanceof Error ? error.message : 'AI 问答代理执行失败。'
        }, 502);
      }
    }

    return jsonResponse({
      error: 'Not found'
    }, 404);
  }
};
