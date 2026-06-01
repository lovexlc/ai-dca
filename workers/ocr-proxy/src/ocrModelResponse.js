// 将二进制字节转成 base64 字符串，用于拼接 image_url 的 data URL。
// Cloudflare Workers 运行时提供全局 btoa；大图不能用 String.fromCharCode(...arr)
// 一次性展开（可能胆栈溢出），需要分段拼接。
export function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function truncateText(value = '', maxLength = 220) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return '';
  }

  return raw.length > maxLength ? `${raw.slice(0, maxLength)}...` : raw;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createUpstreamError(message, details = {}) {
  const error = new Error(message);
  if (details.status != null) {
    error.upstreamStatus = details.status;
  }
  if (details.code) {
    error.upstreamCode = details.code;
  }
  return error;
}

export function isRetryableUpstreamError(error) {
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

export function parseModelResponse(payload) {
  const errorMessage = payload?.error?.message || (typeof payload?.error === 'string' ? payload.error : '');
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  const candidates = [
    payload?.response,
    payload?.description,
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

export function parseFallbackComparison(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') {
    return {};
  }

  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return {};
  }
}
