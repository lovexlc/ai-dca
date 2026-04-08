import { connect } from 'cloudflare:sockets';
import { deriveFundSwitchComparison, sanitizeFundSwitchComparison, sanitizeFundSwitchRows } from '../../../src/app/fundSwitchCore.js';
import {
  getHoldingRowErrors,
  hasMeaningfulHoldingRow,
  normalizeHoldingRow,
  round as roundHolding,
  sanitizeHoldingRows,
  summarizeHoldingRowErrors
} from '../../../src/app/holdingsCore.js';
import {
  buildHoldingsOcrUserPrompt,
  buildOcrUserPrompt,
  DEFAULT_OCR_MODEL,
  HOLDINGS_PROMPT_VERSION,
  HOLDINGS_SYSTEM_PROMPT,
  FUND_SWITCH_SYSTEM_PROMPT,
  PROMPT_VERSION
} from './geminiPrompt.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
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

function buildHoldingRowId(index) {
  return `holding-import-${Date.now()}-${index + 1}`;
}

function sanitizeHoldingsRows(rows = []) {
  const warnings = [];
  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row, index) => normalizeHoldingRow({
    id: normalizeText(row?.id) || buildHoldingRowId(index),
    code: normalizeText(row?.code || row?.fundCode || ''),
    name: normalizeText(row?.name || row?.fundName || ''),
    avgCost: row?.avgCost ?? row?.averageCost ?? row?.buyPrice ?? row?.costPrice,
    shares: row?.shares ?? row?.units ?? row?.holdingShares ?? row?.holdingUnits
  }, {
    idPrefix: 'holding-import'
  }));

  const validRows = [];
  for (const row of normalizedRows) {
    if (!hasMeaningfulHoldingRow(row)) {
      continue;
    }

    const errors = getHoldingRowErrors(row);
    if (Object.keys(errors).length) {
      const label = row.code || row.name || '某一持仓行';
      warnings.push(`${label} ${summarizeHoldingRowErrors(errors)}`);
      continue;
    }

    validRows.push(row);
  }

  return {
    rows: sanitizeHoldingRows(validRows, { filterInvalid: true, idPrefix: 'holding-import' }),
    warnings
  };
}

function buildHoldingsPreviewLines(rows, warnings) {
  if (rows.length) {
    return rows.slice(0, 6).map((row) => `${row.code} | ${row.name || '未命名'} | ${row.avgCost} | ${row.shares}`);
  }

  return warnings.filter(Boolean).slice(0, 6);
}

function scoreHoldingsConfidence(rows, warnings) {
  let score = rows.length * 0.22;
  score += rows.filter((row) => row.name).length * 0.04;
  score -= warnings.length * 0.06;
  return round(Math.max(0.18, Math.min(score, 0.96)), 2);
}

function truncateText(value = '', maxLength = 220) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return '';
  }

  return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createUpstreamError(message, details = {}) {
  const error = new Error(message);
  if (details.status != null) {
    error.upstreamStatus = details.status;
  }
  if (details.code) {
    error.upstreamCode = details.code;
  }
  return error;
}

function isRetryableUpstreamError(error) {
  const status = Number(error?.upstreamStatus || 0);
  const code = String(error?.upstreamCode || '').trim().toLowerCase();
  const message = String(error?.message || '').trim().toLowerCase();

  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  if (['internal_server_error', 'server_error'].includes(code)) {
    return true;
  }

  return [
    'context canceled',
    'timed out',
    'timeout',
    'temporarily unavailable',
    'connection reset',
    'econnreset',
    'fetch failed',
    'network connection lost'
  ].some((keyword) => message.includes(keyword));
}

function extractJsonCandidate(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return value.trim() ? value : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const nested = value
      .map((item) => extractJsonCandidate(item))
      .filter((item) => item != null);

    if (!nested.length) {
      return null;
    }

    const directObject = nested.find((item) => typeof item === 'object' && !Array.isArray(item));
    if (directObject) {
      return directObject;
    }

    return nested.join('\n');
  }

  if (typeof value === 'object') {
    if (Array.isArray(value.rows) || Array.isArray(value.warnings)) {
      return value;
    }

    for (const key of ['parsed', 'json']) {
      const nested = extractJsonCandidate(value[key]);
      if (nested != null) {
        return nested;
      }
    }

    for (const key of ['text', 'value', 'content', 'arguments', 'output_text']) {
      const nested = extractJsonCandidate(value[key]);
      if (nested != null) {
        return nested;
      }
    }
  }

  return null;
}

function findJsonSlice(text) {
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    return text.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return text.slice(arrayStart, arrayEnd + 1);
  }

  return '';
}

function parseJsonText(text) {
  if (text && typeof text === 'object') {
    return text;
  }

  const raw = String(text || '').trim();
  if (!raw) {
    throw new Error('上游模型返回内容为空。');
  }

  const stripped = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch (_parseError) {
    const sliced = findJsonSlice(stripped);
    if (sliced && sliced !== stripped) {
      try {
        return JSON.parse(sliced);
      } catch (_sliceError) {
        // Fall through to the normalized error below.
      }
    }

    throw new Error(`上游模型返回了无法解析的 JSON 文本：${truncateText(stripped)}`);
  }
}

function describePayloadShape(payload = {}) {
  const topLevelKeys = Object.keys(payload || {}).slice(0, 8).join(', ') || '无';
  const message = payload?.choices?.[0]?.message;
  const messageKeys = message && typeof message === 'object'
    ? Object.keys(message).slice(0, 8).join(', ') || '无'
    : '无';

  return `top-level keys: ${topLevelKeys}; message keys: ${messageKeys}`;
}

function looksLikeOcrJson(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && ('rows' in value || 'warnings' in value)
  );
}

function tryParseStructuredJson(value) {
  if (value == null) {
    return null;
  }

  if (looksLikeOcrJson(value)) {
    return value;
  }

  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return null;
  }

  const text = String(value).trim();
  if (!text || (!text.includes('{') && !text.includes('[') && !text.startsWith('```'))) {
    return null;
  }

  try {
    const parsed = parseJsonText(text);
    return looksLikeOcrJson(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function deepFindStructuredJson(value, depth = 0, seen = new WeakSet()) {
  if (value == null || depth > 8) {
    return null;
  }

  const directMatch = tryParseStructuredJson(value);
  if (directMatch) {
    return directMatch;
  }

  if (typeof value !== 'object') {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = deepFindStructuredJson(item, depth + 1, seen);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  const priorityKeys = ['parsed', 'json', 'arguments', 'text', 'value', 'content', 'output_text', 'output', 'tool_calls', 'function', 'message', 'response'];

  for (const key of priorityKeys) {
    if (!(key in value)) {
      continue;
    }

    const nested = deepFindStructuredJson(value[key], depth + 1, seen);
    if (nested) {
      return nested;
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (priorityKeys.includes(key)) {
      continue;
    }

    const nested = deepFindStructuredJson(nestedValue, depth + 1, seen);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function parseModelResponse(payload) {
  const errorMessage = payload?.error?.message || (typeof payload?.error === 'string' ? payload.error : '');
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  const candidates = [
    payload?.choices?.[0]?.message?.parsed,
    payload?.choices?.[0]?.message?.content,
    payload?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments,
    payload?.choices?.[0]?.message?.function_call?.arguments,
    payload?.choices?.[0]?.text,
    payload?.output_text,
    payload?.output,
    payload?.response?.output_text,
    payload?.response?.output
  ];

  for (const candidate of candidates) {
    const extracted = extractJsonCandidate(candidate);
    if (extracted == null) {
      continue;
    }

    const parsed = tryParseStructuredJson(extracted) || deepFindStructuredJson(extracted);
    if (parsed) {
      return parsed;
    }
  }

  const deepParsed = deepFindStructuredJson(payload);
  if (deepParsed) {
    return deepParsed;
  }

  throw new Error(`上游模型没有返回可解析的 JSON 文本。${describePayloadShape(payload)}`);
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

async function postJsonOverFetch(url, body, apiKey) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  return {
    status: response.status,
    bodyText: await response.text()
  };
}

async function callUpstreamModel(file, env, promptConfig = FUND_SWITCH_OCR_PROMPT) {
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
        content: promptConfig.systemPrompt
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: promptConfig.buildUserPrompt(file.name || 'uploaded-image') },
          {
            type: 'image_url',
            image_url: {
              url: dataUrl
            }
          }
        ]
      }
    ],
    temperature: 0.1,
    max_tokens: 1200,
    max_completion_tokens: 1200
  };

  const endpoint = new URL(`${baseUrl}/chat/completions`);
  const shouldPreferSocketTransport = endpoint.protocol === 'http:' && isIpv4Hostname(endpoint.hostname);
  let transportResponse;

  if (shouldPreferSocketTransport) {
    try {
      transportResponse = await postJsonOverSocket(endpoint, body, apiKey);
    } catch (_socketError) {
      transportResponse = await postJsonOverFetch(endpoint, body, apiKey);
    }
  } else {
    transportResponse = await postJsonOverFetch(endpoint, body, apiKey);
  }

  const rawText = transportResponse.bodyText;
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      if (transportResponse.status >= 200 && transportResponse.status < 300) {
        throw new Error(`上游模型返回了非 JSON 响应：${truncateText(rawText)}`);
      }
    }
  }

  if (transportResponse.status < 200 || transportResponse.status >= 300) {
    const message = payload?.error?.message || rawText || `上游模型请求失败: HTTP ${transportResponse.status}`;
    throw createUpstreamError(message, {
      status: transportResponse.status,
      code: payload?.error?.code || payload?.error?.type
    });
  }

  return {
    model,
    payload
  };
}

async function callUpstreamModelWithRetry(file, env, promptConfig = FUND_SWITCH_OCR_PROMPT) {
  const maxRetries = Math.max(0, parseIntegerEnv(env.OCR_UPSTREAM_RETRY_ATTEMPTS, 1));
  const retryDelayMs = Math.max(0, parseIntegerEnv(env.OCR_UPSTREAM_RETRY_DELAY_MS, 800));
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
  const { model, payload } = await callUpstreamModelWithRetry(file, env, FUND_SWITCH_OCR_PROMPT);
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
  const { model, payload } = await callUpstreamModelWithRetry(file, env, HOLDINGS_OCR_PROMPT);
  const extracted = parseModelResponse(payload);
  const rowResult = sanitizeHoldingsRows(extracted.rows || []);
  const rows = rowResult.rows;
  const warnings = [
    ...(Array.isArray(extracted.warnings) ? extracted.warnings.map((item) => normalizeText(item)).filter(Boolean) : []),
    ...rowResult.warnings
  ];

  return jsonResponse({
    ok: true,
    provider: 'cloudflare-worker-openai-compatible',
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

function normalizeRequestedHoldingCodes(input = []) {
  const values = Array.isArray(input) ? input : String(input || '').split(',');
  const codeSet = new Set();

  for (const value of values) {
    const digits = String(value || '').trim().replace(/\D/g, '');
    if (/^\d{6}$/.test(digits)) {
      codeSet.add(digits);
    }
  }

  return [...codeSet].sort();
}

async function buildHoldingsCacheKey(codes = []) {
  const normalized = normalizeRequestedHoldingCodes(codes);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized.join(','))
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

function getHoldingsNavCacheTtlMs(env) {
  const ttlMinutes = Math.max(1, parseIntegerEnv(env.HOLDINGS_NAV_CACHE_TTL_MINUTES, 180));
  return ttlMinutes * 60 * 1000;
}

function isHoldingsPayloadFresh(payload = {}, ttlMs = 0) {
  const expiresAt = Date.parse(String(payload?.expiresAt || ''));
  if (Number.isFinite(expiresAt)) {
    return expiresAt > Date.now();
  }

  const generatedAt = Date.parse(String(payload?.generatedAt || ''));
  return Number.isFinite(generatedAt) ? (generatedAt + ttlMs) > Date.now() : false;
}

function withHoldingsCacheMeta(payload = {}, override = {}) {
  const nextCache = {
    key: String(override.key || payload?.cache?.key || '').trim(),
    hit: override.hit === true,
    source: String(override.source || payload?.cache?.source || '').trim(),
    stale: override.stale === true,
    codeCount: Math.max(Number(override.codeCount || payload?.cache?.codeCount) || 0, 0)
  };

  return {
    ...payload,
    cache: nextCache,
    items: (Array.isArray(payload?.items) ? payload.items : []).map((item) => ({
      ...item,
      cacheHit: nextCache.hit,
      cacheSource: nextCache.source,
      cacheKey: nextCache.key
    }))
  };
}

function buildHoldingsCacheRequest(url, key, codes) {
  const cacheUrl = new URL(url.origin);
  cacheUrl.pathname = '/api/holdings/nav';
  cacheUrl.searchParams.set('codes', normalizeRequestedHoldingCodes(codes).join(','));
  cacheUrl.searchParams.set('cacheKey', key);
  return new Request(cacheUrl.toString(), {
    method: 'GET'
  });
}

function resolveHoldingsBaselineOrigin(request, env) {
  const explicitOrigin = String(env.HOLDINGS_BASELINE_ORIGIN || '').trim();
  if (explicitOrigin) {
    return explicitOrigin;
  }

  const requestOrigin = new URL(request.url).origin;
  if (/(127\.0\.0\.1|localhost):8787$/i.test(requestOrigin)) {
    return '';
  }

  return requestOrigin;
}

async function readHoldingsBaselinePayload(request, env, key, ttlMs, codes) {
  const baselineOrigin = resolveHoldingsBaselineOrigin(request, env);
  if (!baselineOrigin) {
    return null;
  }

  const baselinePath = String(env.HOLDINGS_BASELINE_PATH || '/holdings-nav-cache').trim().replace(/\/+$/, '') || '/holdings-nav-cache';

  try {
    const indexUrl = new URL(`${baselinePath}/index.json`, baselineOrigin);
    const indexResponse = await fetch(indexUrl.toString(), {
      headers: {
        accept: 'application/json'
      }
    });

    if (!indexResponse.ok) {
      return null;
    }

    const indexPayload = await indexResponse.json();
    const entries = Array.isArray(indexPayload?.entries) ? indexPayload.entries : [];
    const matchedEntry = entries.find((entry) => String(entry?.key || '').trim() === key);
    if (!matchedEntry) {
      return null;
    }

    const fileName = String(matchedEntry?.file || `${key}.json`).trim() || `${key}.json`;
    const entryUrl = new URL(`${baselinePath}/${fileName}`, baselineOrigin);
    const entryResponse = await fetch(entryUrl.toString(), {
      headers: {
        accept: 'application/json'
      }
    });

    if (!entryResponse.ok) {
      return null;
    }

    const payload = await entryResponse.json();
    if (!isHoldingsPayloadFresh(payload, ttlMs)) {
      return null;
    }

    return withHoldingsCacheMeta(payload, {
      key,
      hit: true,
      source: 'repo-baseline',
      stale: false,
      codeCount: codes.length
    });
  } catch (_error) {
    return null;
  }
}

async function fetchFundNavSnapshot(code, generatedAt) {
  const url = new URL('https://api.fund.eastmoney.com/f10/lsjz');
  url.searchParams.set('fundCode', code);
  url.searchParams.set('pageIndex', '1');
  url.searchParams.set('pageSize', '6');

  const response = await fetch(url.toString(), {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: 'https://fundf10.eastmoney.com/',
      'user-agent': 'Mozilla/5.0'
    }
  });

  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      throw new Error(`${code} 净值接口返回了非 JSON 响应。`);
    }
  }

  if (!response.ok) {
    throw new Error(`${code} 净值接口请求失败：HTTP ${response.status}`);
  }

  if (Number(payload?.ErrCode || 0) !== 0) {
    throw new Error(payload?.ErrMsg || `${code} 净值接口返回错误。`);
  }

  const rows = Array.isArray(payload?.Data?.LSJZList) ? payload.Data.LSJZList : [];
  const latestIndex = rows.findIndex((row) => Number(row?.DWJZ) > 0);
  if (latestIndex < 0) {
    throw new Error(`${code} 暂未查询到最新净值。`);
  }

  const latestRow = rows[latestIndex];
  const previousRow = rows.slice(latestIndex + 1).find((row) => Number(row?.DWJZ) > 0);
  if (!previousRow) {
    throw new Error(`${code} 暂未查询到上一交易日净值。`);
  }

  return {
    ok: true,
    code,
    name: '',
    latestNav: roundHolding(Number(latestRow?.DWJZ) || 0, 4),
    latestNavDate: normalizeDate(latestRow?.FSRQ || ''),
    previousNav: roundHolding(Number(previousRow?.DWJZ) || 0, 4),
    previousNavDate: normalizeDate(previousRow?.FSRQ || ''),
    updatedAt: generatedAt
  };
}

async function fetchLiveHoldingsNavPayload(codes, env, key) {
  const generatedAt = new Date().toISOString();
  const ttlMs = getHoldingsNavCacheTtlMs(env);
  const items = await Promise.all(
    codes.map(async (code) => {
      try {
        const snapshot = await fetchFundNavSnapshot(code, generatedAt);
        return {
          ...snapshot,
          cacheHit: false,
          cacheSource: 'live',
          cacheKey: key
        };
      } catch (error) {
        return {
          ok: false,
          code,
          error: error instanceof Error ? error.message : `${code} 净值更新失败。`,
          updatedAt: generatedAt,
          cacheHit: false,
          cacheSource: 'live',
          cacheKey: key
        };
      }
    })
  );

  const successCount = items.filter((item) => item.ok === true).length;
  const failureCount = items.length - successCount;

  return {
    ok: true,
    generatedAt,
    expiresAt: new Date(Date.parse(generatedAt) + ttlMs).toISOString(),
    successCount,
    failureCount,
    cache: {
      key,
      hit: false,
      source: 'live',
      stale: false,
      codeCount: codes.length
    },
    items
  };
}

async function readRequestedHoldingCodes(request) {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    return normalizeRequestedHoldingCodes(url.searchParams.get('codes') || '');
  }

  if (request.method === 'POST') {
    let payload = {};
    try {
      payload = await request.json();
    } catch (_error) {
      payload = {};
    }
    return normalizeRequestedHoldingCodes(payload?.codes || []);
  }

  return [];
}

async function handleHoldingsNav(request, env) {
  const codes = await readRequestedHoldingCodes(request);
  if (!codes.length) {
    return jsonResponse({
      error: '请求中缺少有效的 6 位基金代码。'
    }, 400);
  }

  if (codes.length > 60) {
    return jsonResponse({
      error: '单次最多查询 60 个基金代码。'
    }, 400);
  }

  const key = await buildHoldingsCacheKey(codes);
  const ttlMs = getHoldingsNavCacheTtlMs(env);
  const cacheRequest = buildHoldingsCacheRequest(new URL(request.url), key, codes);

  const cachedResponse = await caches.default.match(cacheRequest);
  if (cachedResponse) {
    try {
      const payload = await cachedResponse.json();
      if (isHoldingsPayloadFresh(payload, ttlMs)) {
        return jsonResponse(withHoldingsCacheMeta(payload, {
          key,
          hit: true,
          source: 'edge-cache',
          stale: false,
          codeCount: codes.length
        }));
      }
    } catch (_error) {
      // Ignore broken cache entries and continue to baseline/live fetch.
    }
  }

  const baselinePayload = await readHoldingsBaselinePayload(request, env, key, ttlMs, codes);
  if (baselinePayload) {
    return jsonResponse(baselinePayload);
  }

  const livePayload = await fetchLiveHoldingsNavPayload(codes, env, key);

  if (livePayload.failureCount === 0) {
    const cacheResponse = jsonResponse(livePayload, 200, {
      'cache-control': `public, max-age=${Math.max(Math.floor(ttlMs / 1000), 60)}`
    });
    await caches.default.put(cacheRequest, cacheResponse.clone());
  }

  return jsonResponse(livePayload);
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

    return jsonResponse({
      error: 'Not found'
    }, 404);
  }
};
