import { buildGeminiUserPrompt, DEFAULT_GEMINI_MODEL, FUND_SWITCH_RESPONSE_SCHEMA, FUND_SWITCH_SYSTEM_PROMPT, PROMPT_VERSION } from './geminiPrompt.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type'
};

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders
    }
  });
}

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

function sanitizeComparison(comparison = {}) {
  return {
    sourceCode: normalizeText(comparison.sourceCode),
    sourceSellShares: Math.max(Number(comparison.sourceSellShares) || 0, 0),
    sourceCurrentPrice: Math.max(Number(comparison.sourceCurrentPrice) || 0, 0),
    targetCode: normalizeText(comparison.targetCode),
    targetBuyShares: Math.max(Number(comparison.targetBuyShares) || 0, 0),
    targetCurrentPrice: Math.max(Number(comparison.targetCurrentPrice) || 0, 0),
    switchCost: Math.max(Number(comparison.switchCost) || 0, 0),
    extraCash: Math.max(Number(comparison.extraCash) || 0, 0),
    feeTradeCount: Math.max(Number(comparison.feeTradeCount) || 0, 0)
  };
}

function buildRowId(index) {
  return `switch-import-${Date.now()}-${index + 1}`;
}

function sanitizeRows(rows = []) {
  return rows
    .map((row, index) => ({
      id: normalizeText(row?.id) || buildRowId(index),
      date: normalizeDate(row?.date || ''),
      code: normalizeText(row?.code || ''),
      type: normalizeTradeType(row?.type || ''),
      price: round(Math.max(Number(row?.price) || 0, 0), 4),
      shares: round(Math.max(Number(row?.shares) || 0, 0), 2)
    }))
    .filter((row) => row.code && row.type && row.price > 0 && row.shares > 0);
}

function getRowAmount(row) {
  return round((Number(row?.price) || 0) * (Number(row?.shares) || 0), 2);
}

function getRowTimestamp(row) {
  if (!row?.date) {
    return Number.NaN;
  }

  const timestamp = Date.parse(String(row.date).replace(' ', 'T'));
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function summarizeByCode(rows, type) {
  const groups = new Map();

  for (const row of rows) {
    if (row.type !== type || !row.code) {
      continue;
    }

    const current = groups.get(row.code) || {
      code: row.code,
      shares: 0,
      amount: 0
    };

    current.shares += row.shares;
    current.amount += getRowAmount(row);
    groups.set(row.code, current);
  }

  return [...groups.values()].sort((left, right) => right.amount - left.amount || right.shares - left.shares);
}

function inferComparisonFromRows(rows, fallbackComparison) {
  const fallback = sanitizeComparison(fallbackComparison);

  for (let index = 0; index < rows.length - 1; index += 1) {
    const first = rows[index];
    const second = rows[index + 1];
    if (first.type === second.type || first.code === second.code) {
      continue;
    }

    const buy = first.type === '买入' ? first : second;
    const sell = first.type === '卖出' ? first : second;
    if (!buy || !sell) {
      continue;
    }

    const buyAmount = getRowAmount(buy);
    const sellAmount = getRowAmount(sell);

    return {
      ...fallback,
      sourceCode: sell.code || fallback.sourceCode,
      sourceSellShares: round(sell.shares, 2),
      targetCode: buy.code || fallback.targetCode,
      targetBuyShares: round(buy.shares, 2),
      switchCost: buyAmount > 0 ? buyAmount : fallback.switchCost,
      extraCash: round(Math.max(buyAmount - sellAmount, 0), 2),
      feeTradeCount: 2
    };
  }

  let bestPair = null;

  for (let index = 0; index < rows.length; index += 1) {
    for (let inner = index + 1; inner < rows.length; inner += 1) {
      const first = rows[index];
      const second = rows[inner];
      if (first.type === second.type || first.code === second.code) {
        continue;
      }

      const buy = first.type === '买入' ? first : second;
      const sell = first.type === '卖出' ? first : second;
      if (!buy || !sell) {
        continue;
      }

      const buyAmount = getRowAmount(buy);
      const sellAmount = getRowAmount(sell);
      const buyTime = getRowTimestamp(buy);
      const sellTime = getRowTimestamp(sell);
      const timeGap = Number.isFinite(buyTime) && Number.isFinite(sellTime) ? Math.abs(buyTime - sellTime) : 24 * 60 * 60 * 1000;
      const amountGap = Math.abs(buyAmount - sellAmount);
      const amountSimilarity = 1 - Math.min(amountGap / Math.max(buyAmount, sellAmount, 1), 1);
      const score = (amountSimilarity * 100) - (timeGap / 60000);

      if (!bestPair || score > bestPair.score) {
        bestPair = { buy, sell, score };
      }
    }
  }

  if (bestPair) {
    const buyAmount = getRowAmount(bestPair.buy);
    const sellAmount = getRowAmount(bestPair.sell);

    return {
      ...fallback,
      sourceCode: bestPair.sell.code || fallback.sourceCode,
      sourceSellShares: round(bestPair.sell.shares, 2),
      targetCode: bestPair.buy.code || fallback.targetCode,
      targetBuyShares: round(bestPair.buy.shares, 2),
      switchCost: buyAmount > 0 ? buyAmount : fallback.switchCost,
      extraCash: round(Math.max(buyAmount - sellAmount, 0), 2),
      feeTradeCount: 2
    };
  }

  const sellGroups = summarizeByCode(rows, '卖出');
  const buyGroups = summarizeByCode(rows, '买入');
  const source = sellGroups[0];
  const target = buyGroups[0];
  const totalSellAmount = round(sellGroups.reduce((sum, item) => sum + item.amount, 0), 2);
  const totalBuyAmount = round(buyGroups.reduce((sum, item) => sum + item.amount, 0), 2);

  return {
    ...fallback,
    sourceCode: source?.code || fallback.sourceCode,
    sourceSellShares: source ? round(source.shares, 2) : fallback.sourceSellShares,
    targetCode: target?.code || fallback.targetCode,
    targetBuyShares: target ? round(target.shares, 2) : fallback.targetBuyShares,
    switchCost: totalBuyAmount > 0 ? totalBuyAmount : fallback.switchCost,
    extraCash: round(Math.max(totalBuyAmount - totalSellAmount, 0), 2),
    feeTradeCount: rows.length ? Math.min(rows.length, 2) : fallback.feeTradeCount
  };
}

function buildPreviewLines(rows, warnings) {
  if (rows.length) {
    return rows.slice(0, 6).map((row) => `${row.date || '无日期'} | ${row.type} | ${row.code} | ${row.price} | ${row.shares}`);
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

function parseJsonText(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    throw new Error('Gemini 返回内容为空。');
  }

  const stripped = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  return JSON.parse(stripped);
}

function parseGeminiResponse(payload) {
  const text = payload?.candidates
    ?.flatMap((candidate) => candidate?.content?.parts || [])
    ?.map((part) => part?.text)
    ?.find(Boolean);

  if (!text) {
    const reason = payload?.promptFeedback?.blockReason;
    if (reason) {
      throw new Error(`Gemini 请求被拦截: ${reason}`);
    }

    throw new Error('Gemini 没有返回可解析的 JSON 文本。');
  }

  return parseJsonText(text);
}

function parseFallbackComparison(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') {
    return {};
  }

  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return {};
  }
}

function encodeBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function callGemini(file, env) {
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const arrayBuffer = await file.arrayBuffer();
  const body = {
    system_instruction: {
      parts: [
        { text: FUND_SWITCH_SYSTEM_PROMPT }
      ]
    },
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildGeminiUserPrompt(file.name || 'uploaded-image') },
          {
            inline_data: {
              mime_type: file.type || 'image/jpeg',
              data: encodeBase64(arrayBuffer)
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.1,
      response_mime_type: 'application/json',
      response_schema: FUND_SWITCH_RESPONSE_SCHEMA
    }
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = {};
    }
  }

  if (!response.ok) {
    const message = payload?.error?.message || rawText || `Gemini 请求失败: HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    model,
    payload
  };
}

async function handleOcr(request, env) {
  if (!env.GEMINI_API_KEY) {
    return jsonResponse({
      error: '缺少 Cloudflare Workers Secret: GEMINI_API_KEY'
    }, 500);
  }

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
  const fallbackComparison = parseFallbackComparison(formData.get('fallbackComparison'));
  const { model, payload } = await callGemini(file, env);
  const extracted = parseGeminiResponse(payload);
  const rows = sanitizeRows(extracted.rows || []);
  const warnings = Array.isArray(extracted.warnings) ? extracted.warnings.map((item) => normalizeText(item)).filter(Boolean) : [];
  const comparison = inferComparisonFromRows(rows, fallbackComparison);

  return jsonResponse({
    ok: true,
    provider: 'cloudflare-worker-gemini',
    model,
    promptVersion: PROMPT_VERSION,
    durationMs: Date.now() - startedAt,
    confidence: scoreConfidence(rows, warnings),
    recordCount: rows.length,
    rows,
    comparison,
    warnings,
    previewLines: buildPreviewLines(rows, warnings)
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: JSON_HEADERS
      });
    }

    if (url.pathname === '/api/health') {
      return jsonResponse({
        ok: true,
        service: 'ocr-proxy',
        promptVersion: PROMPT_VERSION
      });
    }

    if (url.pathname !== '/api/ocr') {
      return jsonResponse({
        error: 'Not found'
      }, 404);
    }

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
        error: error instanceof Error ? error.message : 'Gemini OCR 代理执行失败。'
      }, 502);
    }
  }
};
