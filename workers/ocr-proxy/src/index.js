import { deriveFundSwitchComparison, sanitizeFundSwitchComparison, sanitizeFundSwitchRows } from '../../../src/app/fundSwitchCore.js';
import {
  getHoldingRowErrors,
  hasMeaningfulHoldingRow,
  isHoldingCode,
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

// 将二进制字节转成 base64 字符串，用于拼接 image_url 的 data URL。
// Cloudflare Workers 运行时提供全局 btoa；大图不能用 String.fromCharCode(...arr)
// 一次性展开（可能胆栈溢出），需要分段拼接。
function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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

const FUND_CATALOG_URL = 'https://fund.eastmoney.com/js/fundcode_search.js';
const FUND_CATALOG_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let fundCatalogCache = {
  expiresAt: 0,
  list: null,
  byCode: null
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

function hasNumericInput(value) {
  return !(value == null || String(value).trim() === '');
}

function parseScaledNumber(value, precision = 4, { allowNegative = false } = {}) {
  if (!hasNumericInput(value)) {
    return 0;
  }

  const rawText = String(value).trim();
  let scale = 1;
  if (rawText.includes('亿')) {
    scale = 100000000;
  } else if (rawText.includes('万')) {
    scale = 10000;
  }

  const normalized = rawText
    .replace(/[,\s]/g, '')
    .replace(/[¥￥元份]/g, '')
    .replace(/[亿万]/g, '')
    .trim();
  const numericValue = Number(normalized);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  if (!allowNegative && numericValue <= 0) {
    return 0;
  }

  return roundHolding(numericValue * scale, precision);
}

function parsePositiveNumber(value, precision = 4) {
  return parseScaledNumber(value, precision, { allowNegative: false });
}

function parseSignedNumber(value, precision = 2) {
  return parseScaledNumber(value, precision, { allowNegative: true });
}

function extractVisibleHoldingCode(value = '') {
  const digits = normalizeText(value).replace(/\D/g, '');
  return /^\d{6}$/.test(digits) ? digits : '';
}

function normalizeFundLookupName(value = '') {
  return normalizeText(value)
    .replace(/\.{2,}/g, '')
    .replace(/…+/g, '')
    .replace(/[()（）【】\[\]\-_\s]/g, '')
    .replace(/人民币/g, '')
    .trim()
    .toUpperCase();
}

function extractFundShareClassHint(value = '') {
  const normalized = normalizeText(value).replace(/\s+/g, '');
  const match = normalized.match(/([ABCHIOR])(?:类)?(?:\)|）)?$/i);
  return match ? match[1].toUpperCase() : '';
}

function normalizeFundBaseName(value = '') {
  return normalizeFundLookupName(value)
    .replace(/后端$/i, '')
    .replace(/([ABCHIOR])(?:类)?$/i, '');
}

function parseFundCatalogScript(scriptText = '') {
  const match = String(scriptText || '')
    .replace(/^\uFEFF/, '')
    .match(/var\s+r\s*=\s*(\[.*\]);?\s*$/s);

  if (!match) {
    throw new Error('基金目录脚本格式无法解析。');
  }

  const rawList = JSON.parse(match[1]);
  const list = rawList
    .filter((item) => Array.isArray(item) && item.length >= 3)
    .map((item) => {
      const code = String(item[0] || '').trim();
      const name = normalizeText(item[2] || '');
      const shareClass = extractFundShareClassHint(name);
      return {
        code,
        name,
        kind: normalizeText(item[3] || ''),
        alias: normalizeText(item[1] || ''),
        pinyin: normalizeText(item[4] || '').toUpperCase(),
        searchName: normalizeFundLookupName(name),
        baseName: normalizeFundBaseName(name),
        shareClass
      };
    })
    .filter((item) => isHoldingCode(item.code) && item.name);

  return {
    list,
    byCode: new Map(list.map((item) => [item.code, item]))
  };
}

async function getFundCatalog() {
  if (fundCatalogCache.list && fundCatalogCache.expiresAt > Date.now()) {
    return fundCatalogCache;
  }

  const response = await fetch(FUND_CATALOG_URL, {
    headers: {
      accept: 'application/javascript, text/javascript, */*;q=0.1',
      referer: 'https://fund.eastmoney.com/',
      'user-agent': 'Mozilla/5.0'
    }
  });

  if (!response.ok) {
    throw new Error(`基金目录请求失败：HTTP ${response.status}`);
  }

  const scriptText = await response.text();
  const parsed = parseFundCatalogScript(scriptText);
  fundCatalogCache = {
    ...parsed,
    expiresAt: Date.now() + FUND_CATALOG_CACHE_TTL_MS
  };
  return fundCatalogCache;
}

async function resolveFundByCode(code = '') {
  if (!isHoldingCode(code)) {
    return null;
  }

  const catalog = await getFundCatalog();
  return catalog.byCode.get(code) || null;
}

function scoreFundCatalogEntry(entry, queryName = '') {
  const queryNormalized = normalizeFundLookupName(queryName);
  const queryBase = normalizeFundBaseName(queryName);
  if (!queryNormalized) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (entry.searchName === queryNormalized) {
    score += 140;
  } else if (entry.searchName.startsWith(queryNormalized)) {
    score += 110;
  } else if (entry.searchName.includes(queryNormalized)) {
    score += 90;
  }

  if (queryNormalized.startsWith(entry.searchName)) {
    score += 40;
  }

  if (queryBase) {
    if (entry.baseName === queryBase) {
      score += 90;
    } else if (entry.baseName.startsWith(queryBase)) {
      score += 65;
    } else if (entry.baseName.includes(queryBase)) {
      score += 45;
    } else if (queryBase.startsWith(entry.baseName)) {
      score += 30;
    }
  }

  const shareClassHint = extractFundShareClassHint(queryName);
  if (shareClassHint && entry.shareClass === shareClassHint) {
    score += 18;
  } else if (shareClassHint && entry.shareClass && entry.shareClass !== shareClassHint) {
    score -= 12;
  }

  if (entry.name.includes('后端')) {
    score -= 20;
  }

  return score;
}

async function resolveFundCodeByName(name = '') {
  const normalizedName = normalizeText(name);
  const queryNormalized = normalizeFundLookupName(normalizedName);
  if (!queryNormalized || queryNormalized.length < 2) {
    return null;
  }

  const catalog = await getFundCatalog();
  const ranked = catalog.list
    .map((entry) => ({
      ...entry,
      score: scoreFundCatalogEntry(entry, normalizedName)
    }))
    .filter((entry) => entry.score >= 60)
    .sort((left, right) => right.score - left.score);

  if (!ranked.length) {
    return null;
  }

  const best = ranked[0];
  const second = ranked[1];
  const shareClassHint = extractFundShareClassHint(normalizedName);
  const ambiguousWithoutShareClass = !shareClassHint
    && second
    && (best.score - second.score) < 8
    && best.baseName
    && best.baseName === second.baseName
    && best.code !== second.code;

  if (ambiguousWithoutShareClass) {
    return null;
  }

  return best;
}

function normalizeHoldingExtractionRow(row = {}, index = 0) {
  const rawCode = row?.code ?? row?.fundCode ?? row?.fund_code ?? '';
  const rawName = row?.name ?? row?.fundName ?? row?.holdingName ?? row?.title ?? '';
  const rawAvgCost = row?.avgCost ?? row?.averageCost ?? row?.buyPrice ?? row?.costPrice ?? row?.cost ?? '';
  const rawMarketValue = row?.marketValue ?? row?.holdingAmount ?? row?.amount ?? row?.assetValue ?? row?.market_amount ?? '';
  const rawHoldingProfit = row?.holdingProfit ?? row?.profit ?? row?.profitAmount ?? row?.income ?? row?.holding_income ?? '';
  const rawShares = row?.shares ?? row?.units ?? row?.holdingShares ?? row?.holdingUnits ?? row?.positionShares ?? '';
  const rawUnitNav = row?.unitNav ?? row?.nav ?? row?.latestNav ?? row?.netValue ?? row?.unitNetValue ?? '';
  const rawUnitNavDate = row?.unitNavDate ?? row?.navDate ?? row?.latestNavDate ?? row?.netValueDate ?? '';

  return {
    id: normalizeText(row?.id) || buildHoldingRowId(index),
    code: extractVisibleHoldingCode(rawCode),
    name: normalizeText(rawName),
    avgCost: parsePositiveNumber(rawAvgCost, 4),
    hasAvgCost: hasNumericInput(rawAvgCost),
    marketValue: parsePositiveNumber(rawMarketValue, 2),
    hasMarketValue: hasNumericInput(rawMarketValue),
    holdingProfit: parseSignedNumber(rawHoldingProfit, 2),
    hasHoldingProfit: hasNumericInput(rawHoldingProfit),
    shares: parsePositiveNumber(rawShares, 2),
    hasShares: hasNumericInput(rawShares),
    unitNav: parsePositiveNumber(rawUnitNav, 4),
    hasUnitNav: hasNumericInput(rawUnitNav),
    unitNavDate: normalizeDate(rawUnitNavDate || '')
  };
}

async function enrichHoldingExtractionRow(rawRow, generatedAt) {
  const warnings = [];
  const workingRow = normalizeHoldingExtractionRow(rawRow);

  let resolvedCode = workingRow.code;
  let resolvedName = workingRow.name;
  let resolvedAvgCost = workingRow.avgCost;
  let resolvedShares = workingRow.shares;
  let resolvedUnitNav = workingRow.unitNav;

  let catalogMatch = null;

  if (isHoldingCode(resolvedCode)) {
    try {
      catalogMatch = await resolveFundByCode(resolvedCode);
      if (catalogMatch?.name && (!resolvedName || resolvedName.includes('...') || resolvedName.includes('…'))) {
        resolvedName = catalogMatch.name;
      }
    } catch (error) {
      warnings.push(`代码 ${resolvedCode} 补全名称失败：${error instanceof Error ? error.message : '基金目录读取失败。'}`);
    }
  } else if (resolvedName) {
    try {
      catalogMatch = await resolveFundCodeByName(resolvedName);
      if (catalogMatch?.code) {
        resolvedCode = catalogMatch.code;
        if (catalogMatch.name) {
          resolvedName = catalogMatch.name;
        }
      } else {
        warnings.push(`${resolvedName} 未能匹配到唯一基金代码。`);
      }
    } catch (error) {
      warnings.push(`${resolvedName || '某一持仓行'} 基金代码补全失败：${error instanceof Error ? error.message : '基金目录读取失败。'}`);
    }
  }

  if (!(resolvedShares > 0) && workingRow.marketValue > 0 && workingRow.unitNav > 0) {
    resolvedShares = roundHolding(workingRow.marketValue / workingRow.unitNav, 2);
    warnings.push(`${resolvedName || resolvedCode || '某一持仓行'} 已按图片净值计算持仓份额。`);
  }

  if (!(resolvedShares > 0) && workingRow.marketValue > 0 && isHoldingCode(resolvedCode)) {
    try {
      const liveSnapshot = await fetchFundNavSnapshot(resolvedCode, generatedAt);
      if (liveSnapshot.latestNav > 0) {
        resolvedUnitNav = liveSnapshot.latestNav;
        resolvedShares = roundHolding(workingRow.marketValue / liveSnapshot.latestNav, 2);
        warnings.push(`${resolvedName || resolvedCode} 已按联网净值估算持仓份额。`);
      }
    } catch (error) {
      warnings.push(`${resolvedName || resolvedCode} 份额估算失败：${error instanceof Error ? error.message : '净值查询失败。'}`);
    }
  }

  if (!(resolvedAvgCost > 0) && workingRow.marketValue > 0 && resolvedShares > 0 && workingRow.hasHoldingProfit) {
    const costAmount = roundHolding(workingRow.marketValue - workingRow.holdingProfit, 2);
    if (costAmount > 0) {
      resolvedAvgCost = roundHolding(costAmount / resolvedShares, 4);
    }
  }

  const normalizedRow = normalizeHoldingRow({
    id: workingRow.id,
    code: resolvedCode,
    name: resolvedName || catalogMatch?.name || '',
    avgCost: resolvedAvgCost,
    shares: resolvedShares
  }, {
    idPrefix: 'holding-import'
  });

  return {
    row: normalizedRow,
    warnings
  };
}

async function sanitizeHoldingsRows(rows = []) {
  const warnings = [];
  const generatedAt = new Date().toISOString();
  const enrichedRows = await Promise.all(
    (Array.isArray(rows) ? rows : []).map((row, index) => enrichHoldingExtractionRow({
      ...row,
      id: normalizeText(row?.id) || buildHoldingRowId(index)
    }, generatedAt))
  );

  const validRows = [];
  for (const item of enrichedRows) {
    warnings.push(...item.warnings.map((entry) => normalizeText(entry)).filter(Boolean));
    const row = item.row;

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
  const rowResult = await sanitizeHoldingsRows(extracted.rows || []);
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

const EXCHANGE_FUND_CODE_PREFIXES = ['15', '50', '51', '52', '53', '54', '56', '58'];

function isExchangeFundCode(code) {
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  return EXCHANGE_FUND_CODE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function resolveExchangeMarket(code) {
  // 15x -> Shenzhen (secid 0.*)；其他前缀 -> Shanghai (secid 1.*).
  return String(code || '').startsWith('15') ? '0' : '1';
}

function formatShanghaiDateFromEpochSec(seconds) {
  const ms = Number(seconds) > 0 ? Number(seconds) * 1000 : Date.now();
  const shifted = new Date(ms + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftIsoDateDays(isoDate, deltaDays) {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const parts = isoDate.split('-').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return '';
  const ref = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  ref.setUTCDate(ref.getUTCDate() + deltaDays);
  const y = ref.getUTCFullYear();
  const m = String(ref.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ref.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function fetchExchangeQuoteSnapshot(code, generatedAt) {
  const market = resolveExchangeMarket(code);
  const url = new URL('https://push2.eastmoney.com/api/qt/stock/get');
  url.searchParams.set('secid', `${market}.${code}`);
  url.searchParams.set('fields', 'f43,f60,f86,f57,f58,f1');
  url.searchParams.set('_', String(Date.now()));

  const response = await fetch(url.toString(), {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: 'https://quote.eastmoney.com/',
      'user-agent': 'Mozilla/5.0'
    }
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`${code} 场内行情请求失败：HTTP ${response.status}`);
  }

  let payload = {};
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      throw new Error(`${code} 场内行情接口返回了非 JSON 响应。`);
    }
  }

  const data = payload?.data;
  if (!data || typeof data !== 'object') {
    throw new Error(`${code} 暂未查询到场内实时行情。`);
  }

  const scale = Math.max(Math.min(Number(data.f1) || 3, 6), 0);
  const divisor = Math.pow(10, scale);
  const latestRaw = Number(data.f43);
  const previousRaw = Number(data.f60);
  if (!(latestRaw > 0)) {
    throw new Error(`${code} 场内行情暂无最新交易价。`);
  }
  if (!(previousRaw > 0)) {
    throw new Error(`${code} 场内行情缺少昨收价。`);
  }

  const latestPrice = roundHolding(latestRaw / divisor, 4);
  const previousPrice = roundHolding(previousRaw / divisor, 4);
  const latestDate = formatShanghaiDateFromEpochSec(data.f86);
  const previousDate = shiftIsoDateDays(latestDate, -1);
  const name = String(data.f58 || '').trim();

  return {
    ok: true,
    code,
    name,
    latestNav: latestPrice,
    latestNavDate: latestDate,
    previousNav: previousPrice,
    previousNavDate: previousDate,
    updatedAt: generatedAt,
    priceSource: 'exchange-quote'
  };
}

async function fetchHoldingSnapshot(code, generatedAt) {
  if (isExchangeFundCode(code)) {
    return fetchExchangeQuoteSnapshot(code, generatedAt);
  }
  return fetchFundNavSnapshot(code, generatedAt);
}

async function fetchLiveHoldingsNavPayload(codes, env, key) {
  const generatedAt = new Date().toISOString();
  const ttlMs = getHoldingsNavCacheTtlMs(env);
  const items = await Promise.all(
    codes.map(async (code) => {
      try {
        const snapshot = await fetchHoldingSnapshot(code, generatedAt);
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
