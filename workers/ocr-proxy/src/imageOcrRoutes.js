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
import { nowShanghaiIso, readFundNavSnapshot } from './holdingsNavRoutes.js';
import { jsonResponse } from './ocrHttp.js';
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

export async function handleOcr(request, env) {
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

export async function handleHoldingsOcr(request, env) {
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
