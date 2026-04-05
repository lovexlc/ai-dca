import { connect } from 'cloudflare:sockets';
import { deriveFundSwitchComparison, sanitizeFundSwitchComparison, sanitizeFundSwitchRows } from '../../../src/app/fundSwitchCore.js';
import { buildOcrUserPrompt, DEFAULT_OCR_MODEL, FUND_SWITCH_SYSTEM_PROMPT, PROMPT_VERSION } from './geminiPrompt.js';

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

function parseJsonText(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    throw new Error('上游模型返回内容为空。');
  }

  const stripped = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  return JSON.parse(stripped);
}

function parseModelResponse(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => part?.text).filter(Boolean).join('\n')
      : '';

  if (!text) {
    if (payload?.error?.message) {
      throw new Error(payload.error.message);
    }

    throw new Error('上游模型没有返回可解析的 JSON 文本。');
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

function isIpv4Hostname(hostname = '') {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(hostname).trim());
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged;
}

function findHeaderBoundary(bytes) {
  for (let index = 0; index <= bytes.length - 4; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10 && bytes[index + 2] === 13 && bytes[index + 3] === 10) {
      return index;
    }
  }

  return -1;
}

function decodeChunkedBody(bytes) {
  const chunks = [];
  let offset = 0;

  while (offset < bytes.length) {
    const lineEnd = bytes.indexOf(13, offset);
    if (lineEnd < 0 || bytes[lineEnd + 1] !== 10) {
      throw new Error('上游返回了无法解析的 chunked 响应。');
    }

    const sizeText = new TextDecoder().decode(bytes.slice(offset, lineEnd)).split(';', 1)[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) {
      throw new Error('上游返回了非法 chunk size。');
    }

    offset = lineEnd + 2;
    if (size === 0) {
      break;
    }

    const chunkEnd = offset + size;
    chunks.push(bytes.slice(offset, chunkEnd));
    offset = chunkEnd + 2;
  }

  return concatUint8Arrays(chunks);
}

async function readSocketResponse(socket) {
  const reader = socket.readable.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (value?.byteLength) {
      chunks.push(value);
    }
  }

  return concatUint8Arrays(chunks);
}

function parseHttpResponse(bytes) {
  const boundary = findHeaderBoundary(bytes);
  if (boundary < 0) {
    throw new Error('上游响应缺少 HTTP 头部分隔符。');
  }

  const decoder = new TextDecoder();
  const headerText = decoder.decode(bytes.slice(0, boundary));
  const lines = headerText.split('\r\n');
  const statusLine = lines.shift() || '';
  const statusMatch = statusLine.match(/^HTTP\/\d+(?:\.\d+)?\s+(\d{3})/i);
  const status = Number(statusMatch?.[1] || 0);
  const headers = new Map();

  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator < 0) {
      continue;
    }

    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers.set(key, value);
  }

  let bodyBytes = bytes.slice(boundary + 4);
  const transferEncoding = headers.get('transfer-encoding') || '';
  if (transferEncoding.toLowerCase().includes('chunked')) {
    bodyBytes = decodeChunkedBody(bodyBytes);
  } else {
    const contentLength = Number.parseInt(headers.get('content-length') || '', 10);
    if (Number.isFinite(contentLength) && contentLength >= 0) {
      bodyBytes = bodyBytes.slice(0, contentLength);
    }
  }

  return {
    status,
    headers,
    bodyText: decoder.decode(bodyBytes)
  };
}

async function postJsonOverSocket(url, body, apiKey) {
  const requestBody = JSON.stringify(body);
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const socket = connect({
    hostname: url.hostname,
    port
  }, {
    secureTransport: url.protocol === 'https:' ? 'on' : 'off',
    allowHalfOpen: true
  });

  const writer = socket.writable.getWriter();
  const encoder = new TextEncoder();
  const path = `${url.pathname}${url.search}`;
  const hostHeader = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  const requestText = [
    `POST ${path || '/'} HTTP/1.1`,
    `Host: ${hostHeader}`,
    'Content-Type: application/json',
    'Accept: application/json',
    `Authorization: Bearer ${apiKey}`,
    `Content-Length: ${encoder.encode(requestBody).byteLength}`,
    'Connection: close',
    '',
    requestBody
  ].join('\r\n');

  try {
    await writer.write(encoder.encode(requestText));
    writer.releaseLock();
    const responseBytes = await readSocketResponse(socket);
    return parseHttpResponse(responseBytes);
  } finally {
    await socket.close().catch(() => {});
  }
}

async function callUpstreamModel(file, env) {
  const baseUrl = String(env.OCR_UPSTREAM_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(env.OCR_UPSTREAM_API_KEY || '').trim();
  const model = env.OCR_UPSTREAM_MODEL || DEFAULT_OCR_MODEL;

  if (!baseUrl) {
    throw new Error('缺少环境变量 OCR_UPSTREAM_BASE_URL');
  }

  if (!apiKey) {
    throw new Error('缺少环境变量 OCR_UPSTREAM_API_KEY');
  }

  const arrayBuffer = await file.arrayBuffer();
  const mimeType = file.type || 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${encodeBase64(arrayBuffer)}`;
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: FUND_SWITCH_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildOcrUserPrompt(file.name || 'uploaded-image') },
          {
            type: 'image_url',
            image_url: {
              url: dataUrl
            }
          }
        ]
      }
    ],
    response_format: {
      type: 'json_object'
    },
    temperature: 0.1
  };

  const endpoint = new URL(`${baseUrl}/chat/completions`);
  const useSocketTransport = endpoint.protocol === 'http:' && isIpv4Hostname(endpoint.hostname);
  const transportResponse = useSocketTransport
    ? await postJsonOverSocket(endpoint, body, apiKey)
    : await (async () => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      return {
        status: response.status,
        bodyText: await response.text()
      };
    })();

  const rawText = transportResponse.bodyText;
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = {};
    }
  }

  if (transportResponse.status < 200 || transportResponse.status >= 300) {
    const message = payload?.error?.message || rawText || `上游模型请求失败: HTTP ${transportResponse.status}`;
    throw new Error(message);
  }

  return {
    model,
    payload
  };
}

async function handleOcr(request, env) {
  if (!env.OCR_UPSTREAM_API_KEY) {
    return jsonResponse({
      error: '缺少 Cloudflare Workers Secret: OCR_UPSTREAM_API_KEY'
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
  const fallbackComparison = sanitizeFundSwitchComparison(parseFallbackComparison(formData.get('fallbackComparison')));
  const { model, payload } = await callUpstreamModel(file, env);
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
    provider: 'cloudflare-worker-openai-compatible',
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
        error: error instanceof Error ? error.message : 'OCR 代理执行失败。'
      }, 502);
    }
  }
};
