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
import { fetchFundLimit, fetchFundLimitsBatch, mapLimit } from './fundLimit.js';
import {
  fetchExchangeQuoteSnapshot as getNavExchangeQuoteSnapshot,
  fetchFundNavHistory as getNavFundNavHistory,
  fetchFundNavHistoryWithMonthlyKv as getNavFundNavHistoryWithMonthlyKv,
  fetchFundNavSnapshot as getNavFundNavSnapshot,
  fetchHoldingSnapshot as getNavHoldingSnapshot
} from '../../notify/src/getNav.js';

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
const FUND_SUGGEST_URL = 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx';
const ONLINE_NAME_FX_KEYWORDS = ['美元', '美元现汇', '美金', '美钞', '美汇', '现汇'];
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

function bigramSet(str = '') {
  const s = String(str || '');
  const set = new Set();
  for (let i = 0; i < s.length - 1; i += 1) {
    set.add(s.slice(i, i + 2));
  }
  return set;
}

function jaccardBigram(a = '', b = '') {
  const A = bigramSet(a);
  const B = bigramSet(b);
  if (A.size === 0 || B.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const g of A) {
    if (B.has(g)) inter += 1;
  }
  const union = A.size + B.size - inter;
  return union > 0 ? inter / union : 0;
}

function longestCommonSubstringLength(a = '', b = '') {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  // 滚动两行动态规划，O(m×n) 时间、O(n) 空间。
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);
  let best = 0;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      curr[j] = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : 0;
      if (curr[j] > best) best = curr[j];
    }
    const tmp = prev; prev = curr; curr = tmp;
    curr.fill(0);
  }
  return best;
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

  // 模糊度奖励：名字重叠“差不多就行”。
  // catalog 中常多/少“发起式”“人民币”“QDII”令双向子串全失包含，
  // 用 bigram Jaccard + 最长公共子串补上，让主体词汇重叠高的候选能走进决赛。
  const queryFuzzy = queryBase || queryNormalized;
  const candFuzzy = entry.baseName || entry.searchName;
  if (queryFuzzy && candFuzzy && queryFuzzy.length >= 2 && candFuzzy.length >= 2) {
    const jacc = jaccardBigram(queryFuzzy, candFuzzy);
    score += Math.round(jacc * 60); // 满分 60
    const lcs = longestCommonSubstringLength(queryFuzzy, candFuzzy);
    if (lcs >= 4) score += 8;
    if (lcs >= 6) score += 12;
    if (lcs >= 9) score += 15;
    if (lcs >= 12) score += 10;
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
    .filter((entry) => entry.score >= 50)
    .sort((left, right) => right.score - left.score);

  if (!ranked.length) {
    // 本地 catalog 子串/前缀评分未命中（例：“发起式联接”/“人民币”令名字不互为子串）。
    // 走东方财富 fundsuggest 语义搜索做兑底；命中后标 ambiguous=true 让前端提示用户核对。
    try {
      const online = await searchFundByNameOnline(normalizedName);
      const picked = pickBestOnlineCandidate(online, normalizedName);
      if (picked) {
        return { ...picked, ambiguous: true, source: 'online' };
      }
    } catch (_e) {
      /* 东财接口任何问题都不应该冲击主流程 */
    }
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
    // 同基础名下 A/C/E/I 等份额类无法从名字消歧时，仍返回最佳候选。
    // 让 enrich 链路用这个 code 走联网净值兜底；前端弹窗会提示让用户核对。
    return { ...best, ambiguous: true };
  }

  return best;
}

async function searchFundByNameOnline(name = '') {
  const trimmed = String(name || '').trim();
  if (trimmed.length < 2) {
    return [];
  }
  const url = `${FUND_SUGGEST_URL}?m=1&key=${encodeURIComponent(trimmed)}`;
  const response = await fetch(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: 'https://fund.eastmoney.com/',
      'user-agent': 'Mozilla/5.0'
    }
  });
  if (!response.ok) {
    return [];
  }
  const json = await response.json().catch(() => null);
  if (!json || !Array.isArray(json.Datas)) {
    return [];
  }
  return json.Datas
    .map((item) => ({
      code: String(item?.CODE || '').trim(),
      name: normalizeText(item?.NAME || '')
    }))
    .filter((item) => isHoldingCode(item.code) && item.name);
}

function pickBestOnlineCandidate(candidates, queryName = '') {
  if (!Array.isArray(candidates) || !candidates.length) {
    return null;
  }
  const queryRaw = normalizeText(queryName);
  if (!queryRaw) {
    return null;
  }
  const prefixOptions = [queryRaw.slice(0, 4), queryRaw.slice(0, 3), queryRaw.slice(0, 2)].filter(Boolean);
  const queryShareClass = extractFundShareClassHint(queryName);
  const queryNormalized = normalizeFundLookupName(queryName);
  const queryBase = normalizeFundBaseName(queryName);

  let best = null;
  let bestScore = -Infinity;
  for (const cand of candidates) {
    let score = 0;
    let prefixHit = 0;
    for (const prefix of prefixOptions) {
      if (cand.name.startsWith(prefix)) {
        prefixHit = prefix.length;
        break;
      }
    }
    if (prefixHit === 0) {
      continue;
    }
    score += prefixHit * 12;

    const candShareClass = extractFundShareClassHint(cand.name);
    if (queryShareClass && candShareClass) {
      if (candShareClass === queryShareClass) {
        score += 25;
      } else {
        score -= 30;
      }
    }

    const fxInName = ONLINE_NAME_FX_KEYWORDS.some((kw) => cand.name.includes(kw));
    const fxInQuery = ONLINE_NAME_FX_KEYWORDS.some((kw) => queryRaw.includes(kw));
    if (fxInName && !fxInQuery) {
      score -= 25;
    }

    const candBase = normalizeFundBaseName(cand.name);
    if (queryBase && candBase) {
      if (candBase === queryBase) score += 30;
      else if (candBase.includes(queryBase) || queryBase.includes(candBase)) score += 15;
    }
    if (queryNormalized && cand.name) {
      const candNormalized = normalizeFundLookupName(cand.name);
      if (queryNormalized.length >= 4 && candNormalized.includes(queryNormalized.slice(0, 4))) score += 6;
      if (queryNormalized.length >= 6 && candNormalized.includes(queryNormalized.slice(0, 6))) score += 6;
    }

    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  if (!best || bestScore < 24) {
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
        if (catalogMatch.ambiguous) {
          warnings.push(`${resolvedName} 同名候选较多，已按猜测的份额类匹配代码 ${catalogMatch.code}，请核对。`);
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
  const generatedAt = nowShanghaiIso();
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
      // 仍把这行作为 partial draft 透传给前端，让用户在弹窗里手填缺失字段。
    }

    validRows.push(row);
  }

  return {
    // filterInvalid: false → 把 partial 行也透传出去（前端 modal 已支持逐行编辑 / 红色标记）。
    rows: sanitizeHoldingRows(validRows, { filterInvalid: false, idPrefix: 'holding-import' }),
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
  // 改动这个版本号可一次性废掉所有旧 entry。
  // v2 = 场内 ETF 缓存 TTL 从 180min 调为 60s 后的首次 BUST。
  // v3 = 拆分 场内/场外 两个独立缓存后的 BUST。
  const cacheBust = 'v3';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${cacheBust}|${normalized.join(',')}`)
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
  return getNavFundNavSnapshot(code, generatedAt);
}

// 拉取一段时间内的历史 NAV 序列（DWJZ 单位净值），按日期升序返回。
// 复用 lsjz 上游，pageSize=40 + 最多 50 页即可覆盖 ~8 年交易日数据。

function compareIsoDate(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function minIsoDate(a, b) {
  return compareIsoDate(a, b) <= 0 ? a : b;
}

function monthKeyFromIsoDate(isoDate) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || '')) ? String(isoDate).slice(0, 7) : '';
}

function firstOfMonthIso(monthKey) {
  return /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? `${monthKey}-01` : '';
}

function lastOfMonthIso(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return '';
  const [year, month] = monthKey.split('-').map((n) => Number(n));
  const dt = new Date(Date.UTC(year, month, 0));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function nextMonthKey(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return '';
  const [year, month] = monthKey.split('-').map((n) => Number(n));
  const dt = new Date(Date.UTC(year, month, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

function enumerateMonthKeys(fromDate, toDate) {
  const start = monthKeyFromIsoDate(fromDate);
  const end = monthKeyFromIsoDate(toDate);
  if (!start || !end || start > end) return [];
  const out = [];
  for (let key = start; key && key <= end; key = nextMonthKey(key)) {
    out.push(key);
    if (key === end) break;
  }
  return out;
}

function filterNavItemsByDateRange(items, fromDate, toDate) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const date = String(item?.date || '').slice(0, 10);
    const nav = Number(item?.nav);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(nav) || nav <= 0) continue;
    if (date < fromDate || date > toDate || seen.has(date)) continue;
    seen.add(date);
    out.push({ date, nav: roundHolding(nav, 4) });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function buildNavHistoryKvKey(code, monthKey) {
  return `navhist:v1:${code}:${monthKey}`;
}

function hasNavHistoryKv(env) {
  return Boolean(env?.NAV_HISTORY_KV && typeof env.NAV_HISTORY_KV.get === 'function' && typeof env.NAV_HISTORY_KV.put === 'function');
}

function isNavHistoryKvMonthFresh(payload, monthKey, today, ttlMs) {
  if (!payload || payload.version !== 1 || payload.month !== monthKey || !Array.isArray(payload.items)) return false;
  const todayMonth = monthKeyFromIsoDate(today);
  const monthEnd = lastOfMonthIso(monthKey);
  const payloadTo = String(payload.to || '');
  if (todayMonth && monthKey < todayMonth) {
    return payloadTo >= monthEnd;
  }
  return isHoldingsPayloadFresh(payload, ttlMs);
}

async function readJsonFromNavHistoryKv(env, key) {
  try {
    const payload = await env.NAV_HISTORY_KV.get(key, { type: 'json' });
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

async function putJsonToNavHistoryKv(env, key, payload) {
  try {
    await env.NAV_HISTORY_KV.put(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

async function deleteNavHistoryKvKey(env, key) {
  try {
    await env.NAV_HISTORY_KV.delete(key);
  } catch { /* ignore */ }
}

async function fetchFundNavHistoryWithMonthlyKv(code, fromDate, toDate, env, options = {}) {
  return getNavFundNavHistoryWithMonthlyKv(code, fromDate, toDate, env, options);
}

async function fetchFundNavHistory(code, fromDate, toDate) {
  return getNavFundNavHistory(code, fromDate, toDate);
}

// 单 code + 单区间的稳定 cache key，作为 caches.default 的 Request URL 参数。
async function buildNavHistoryCacheKey(code, fromDate, toDate) {
  const text = `${code}|${fromDate}|${toDate}`;
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function todayShanghaiIsoDate() {
  return epochMsToShanghaiIso(Date.now()).slice(0, 10);
}

// GET /api/holdings/nav-history?code=510300&from=YYYY-MM-DD&to=YYYY-MM-DD（或 &days=365）
// 返回单只基金给定区间的日级 NAV 序列；caches.default 边缘缓存，TTL 区分历史段(24h) vs 含今天段(动态)。
async function handleHoldingsNavHistory(request, env) {
  return handleHoldingsNavHistorySingle(request, env);
}

// POST /api/holdings/nav-history
// Body: { codes: string[], from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', days?: number, force?: bool }
// 返回：{ ok, from, to, items:[{code, ok, data?|error?}], successCount, failureCount, generatedAt }
// 单 code 逻辑复用 GET 路径内部的 caches.default + KV 路径，Worker 内 mapLimit(6)。
async function handleHoldingsNavHistoryBatch(request, env) {
  let body = {};
  try { body = await request.json(); } catch (_e) { body = {}; }
  const rawCodes = Array.isArray(body?.codes) ? body.codes
    : typeof body?.codes === 'string' ? body.codes.split(',')
    : [];
  const codes = Array.from(new Set(rawCodes.map((c) => String(c || '').trim()).filter((c) => /^\d{6}$/.test(c))));
  if (!codes.length) return jsonResponse({ error: '请求中缺少有效的 6 位基金代码。' }, 400);
  if (codes.length > 60) return jsonResponse({ error: '单次最多查询 60 个基金代码。' }, 400);

  const today = todayShanghaiIsoDate();
  const toRaw = typeof body?.to === 'string' ? body.to.trim() : '';
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : today;
  let fromDate;
  const fromRaw = typeof body?.from === 'string' ? body.from.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) {
    fromDate = fromRaw;
  } else {
    const daysNum = Number(body?.days);
    const days = Number.isFinite(daysNum)
      ? Math.max(1, Math.min(Math.floor(daysNum), 3650))
      : 365;
    fromDate = shiftIsoDateDays(toDate, -days);
  }
  if (fromDate > toDate) return jsonResponse({ error: 'from 必须早于或等于 to。' }, 400);
  const forceBypass = body?.force === true || body?.force === 1
    || body?.refresh === true || body?.refresh === 1;

  const generatedAt = nowShanghaiIso();
  const baseTtlMs = getHoldingsNavCacheTtlMs(env);
  const includesToday = toDate >= today;
  const ttlMs = includesToday
    ? computeNonExchangeNavTtlMs(baseTtlMs, new Date())
    : Math.max(baseTtlMs, 24 * 60 * 60 * 1000);
  const origin = new URL(request.url).origin;

  const items = await mapLimit(codes, 6, async (code) => {
    try {
      const cacheKey = await buildNavHistoryCacheKey(code, fromDate, toDate);
      const cacheUrl = new URL(origin);
      cacheUrl.pathname = '/api/holdings/nav-history';
      cacheUrl.searchParams.set('code', code);
      cacheUrl.searchParams.set('from', fromDate);
      cacheUrl.searchParams.set('to', toDate);
      cacheUrl.searchParams.set('cacheKey', cacheKey);
      const cacheRequest = new Request(cacheUrl.toString(), { method: 'GET' });

      if (forceBypass) {
        try { await caches.default.delete(cacheRequest); } catch (_e) { /* ignore */ }
      } else {
        const cachedResponse = await caches.default.match(cacheRequest);
        if (cachedResponse) {
          try {
            const cached = await cachedResponse.json();
            if (isHoldingsPayloadFresh(cached, ttlMs)) {
              return {
                code,
                ok: true,
                data: { ...cached, cache: { ...(cached.cache || {}), hit: true, source: 'edge-cache', stale: false } }
              };
            }
          } catch (_e) { /* fall through */ }
        }
      }

      const navHistoryResult = await fetchFundNavHistoryWithMonthlyKv(code, fromDate, toDate, env, {
        today,
        ttlMs,
        forceBypass,
        generatedAt
      });
      const itemsList = navHistoryResult.items || [];
      const expiresAt = epochMsToShanghaiIso(Date.parse(generatedAt) + ttlMs);
      const itemPayload = {
        ok: true,
        code,
        from: fromDate,
        to: toDate,
        count: itemsList.length,
        items: itemsList,
        generatedAt,
        expiresAt,
        cache: {
          key: cacheKey,
          hit: navHistoryResult.cache?.hit === true,
          source: navHistoryResult.cache?.source || 'live',
          stale: false,
          ttlMs,
          kv: navHistoryResult.cache?.kv || null
        }
      };
      try {
        const cachePut = new Response(JSON.stringify(itemPayload), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `max-age=${Math.floor(ttlMs / 1000)}`
          }
        });
        await caches.default.put(cacheRequest, cachePut);
      } catch (_e) { /* ignore cache put failures */ }
      return { code, ok: true, data: itemPayload };
    } catch (error) {
      return {
        code,
        ok: false,
        error: error instanceof Error ? error.message : `${code} 净值历史拉取失败。`
      };
    }
  });

  const successCount = items.filter((it) => it && it.ok === true).length;
  return jsonResponse({
    ok: true,
    from: fromDate,
    to: toDate,
    items,
    successCount,
    failureCount: items.length - successCount,
    generatedAt
  });
}

async function handleHoldingsNavHistorySingle(request, env) {
  const url = new URL(request.url);
  const rawCode = String(url.searchParams.get('code') || '').trim();
  if (!/^\d{6}$/.test(rawCode)) {
    return jsonResponse({ error: '请求中缺少有效的 6 位基金代码（参数 code）。' }, 400);
  }
  const today = todayShanghaiIsoDate();
  const toDate = String(url.searchParams.get('to') || '').trim() || today;
  let fromDate = String(url.searchParams.get('from') || '').trim();
  if (!fromDate) {
    const daysRaw = url.searchParams.get('days');
    const days = Math.max(1, Math.min(parseIntegerEnv(daysRaw, 365), 3650));
    fromDate = shiftIsoDateDays(toDate, -days);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return jsonResponse({ error: 'from / to 必须是 YYYY-MM-DD 格式。' }, 400);
  }
  if (fromDate > toDate) {
    return jsonResponse({ error: 'from 必须早于或等于 to。' }, 400);
  }

  const forceBypass = url.searchParams.get('force') === '1' || url.searchParams.get('refresh') === '1';
  const cacheKey = await buildNavHistoryCacheKey(rawCode, fromDate, toDate);

  // 规范化缓存请求 URL（与原 request 的多余 query 解耦）。
  const cacheUrl = new URL(url.origin);
  cacheUrl.pathname = '/api/holdings/nav-history';
  cacheUrl.searchParams.set('code', rawCode);
  cacheUrl.searchParams.set('from', fromDate);
  cacheUrl.searchParams.set('to', toDate);
  cacheUrl.searchParams.set('cacheKey', cacheKey);
  const cacheRequest = new Request(cacheUrl.toString(), { method: 'GET' });

  const baseTtlMs = getHoldingsNavCacheTtlMs(env);
  const cacheNow = new Date();
  const includesToday = toDate >= today;
  const ttlMs = includesToday
    ? computeNonExchangeNavTtlMs(baseTtlMs, cacheNow)
    : Math.max(baseTtlMs, 24 * 60 * 60 * 1000);

  if (forceBypass) {
    try { await caches.default.delete(cacheRequest); } catch (_e) { /* ignore */ }
  } else {
    const cachedResponse = await caches.default.match(cacheRequest);
    if (cachedResponse) {
      try {
        const payload = await cachedResponse.json();
        if (isHoldingsPayloadFresh(payload, ttlMs)) {
          return jsonResponse({
            ...payload,
            cache: { ...(payload.cache || {}), hit: true, source: 'edge-cache', stale: false }
          });
        }
      } catch (_e) { /* fall through to live fetch */ }
    }
  }

  const generatedAt = nowShanghaiIso();
  let navHistoryResult;
  try {
    navHistoryResult = await fetchFundNavHistoryWithMonthlyKv(rawCode, fromDate, toDate, env, {
      today,
      ttlMs,
      forceBypass,
      generatedAt
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      code: rawCode,
      from: fromDate,
      to: toDate,
      error: error instanceof Error ? error.message : `${rawCode} 净值历史拉取失败。`,
      generatedAt
    }, 502);
  }

  const items = navHistoryResult.items || [];
  const expiresAt = epochMsToShanghaiIso(Date.parse(generatedAt) + ttlMs);
  const payload = {
    ok: true,
    code: rawCode,
    from: fromDate,
    to: toDate,
    count: items.length,
    items,
    generatedAt,
    expiresAt,
    cache: {
      key: cacheKey,
      hit: navHistoryResult.cache?.hit === true,
      source: navHistoryResult.cache?.source || 'live',
      stale: false,
      ttlMs,
      kv: navHistoryResult.cache?.kv || null
    }
  };

  try {
    const cachePut = new Response(JSON.stringify(payload), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `max-age=${Math.floor(ttlMs / 1000)}`
      }
    });
    await caches.default.put(cacheRequest, cachePut);
  } catch (_e) { /* ignore cache put failures */ }

  return jsonResponse(payload);
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

// 返回当下东八区时间的 ISO 字符串，带 +08:00，例：「2026-05-06T14:48:08.639+08:00」。
// 与 UTC ISO 表示同一时刻，Date.parse(...) 能正确解析。
function epochMsToShanghaiIso(ms) {
  const t = Number.isFinite(ms) ? ms : Date.now();
  const shifted = new Date(t + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const M = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  const H = String(shifted.getUTCHours()).padStart(2, '0');
  const m = String(shifted.getUTCMinutes()).padStart(2, '0');
  const s = String(shifted.getUTCSeconds()).padStart(2, '0');
  const ms3 = String(shifted.getUTCMilliseconds()).padStart(3, '0');
  return `${y}-${M}-${d}T${H}:${m}:${s}.${ms3}+08:00`;
}

function nowShanghaiIso() {
  return epochMsToShanghaiIso(Date.now());
}

function containsExchangeFundCode(codes) {
  return Array.isArray(codes) && codes.some((c) => isExchangeFundCode(c));
}

// 判断当前是否处于 A 股场内交易时间 (周一至周五 09:30–11:30 、 13:00–15:00，上海时间)。
function isAshareTradingNow(now) {
  const { hour, minute, dayOfWeek } = getShanghaiHourMinuteDow(now);
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const total = hour * 60 + minute;
  const morningOpen = 9 * 60 + 30;
  const morningClose = 11 * 60 + 30;
  const afternoonOpen = 13 * 60;
  const afternoonClose = 15 * 60;
  return (total >= morningOpen && total < morningClose)
      || (total >= afternoonOpen && total < afternoonClose);
}

// 场内 ETF 缓存 TTL：盘中 60s（报价秒变）；非交易时间拉长到下一个开盘前，价格不再变。
function computeExchangeNavTtlMs(envBaseMs, now) {
  const base = Math.max(60_000, Number(envBaseMs) || 0);
  if (isAshareTradingNow(now)) return 60_000;
  const { hour, minute, dayOfWeek } = getShanghaiHourMinuteDow(now);
  const total = hour * 60 + minute;
  // 周末：缓到 24 小时（足以跨越周六-日，反正坚请求也会重新验证）。
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return Math.max(base, 24 * 60 * 60 * 1000);
  }
  const openMin = 9 * 60 + 30;
  const closeMin = 15 * 60;
  let untilOpenMin;
  if (total >= closeMin) {
    // 盘后～午夜：算到次日 09:30。
    untilOpenMin = (24 * 60 - total) + openMin;
  } else if (total < openMin) {
    // 凌晨 00:00～09:30：算到今日开盘。
    untilOpenMin = openMin - total;
  } else {
    // 11:30 午间休市：算到 13:00 开盘。
    untilOpenMin = (13 * 60) - total;
  }
  return Math.max(base, untilOpenMin * 60 * 1000);
}

// ---- /api/holdings/nav 动态缓存 TTL ----
// 上下文：场外 (OTC) NAV 在 T 日晚 19:00–23:30 左右公布；QDII NAV 在 T+1 晚 18:00–22:00 公布。
// 在 A 股交易日今晚 NAV 公布之前，上游 lsjz 接口返回的只会是上个交易日的 NAV——重复拉一定同值。
// 所以在“不会变化”的时段拉长 cache TTL 可以减少上游压力、避免被限流。
function getShanghaiHourMinuteDow(now) {
  const t = now instanceof Date ? now : new Date();
  const shifted = new Date(t.getTime() + 8 * 60 * 60 * 1000);
  return {
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayOfWeek: shifted.getUTCDay() // 0=Sun, 6=Sat
  };
}

// 根据上海时间返回“场外/QDII NAV 不会再变”的窗口长度（以毫秒计）。
// 不需要被调方告诉“哪些 code 是 QDII”，OTC 和 QDII 取交集（较保守的）估计即可。
function computeNonExchangeNavTtlMs(envBaseMs, now) {
  const base = Math.max(60_000, Number(envBaseMs) || 0);
  const { hour, minute, dayOfWeek } = getShanghaiHourMinuteDow(now);
  const totalMin = hour * 60 + minute;

  // 周六/周日：A 股未开盘、OTC/QDII NAV 均不变。缓存到8 小时，足够跨越周末。
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return Math.max(base, 8 * 60 * 60 * 1000);
  }

  // 工作日分段：
  // - 00:00 – 17:30: 距离今晚公布还久，缓存到 17:30 之前。
  // - 17:30 – 23:30: NAV 公布窗口，不调起上游频率（取较短 30min）。
  // - 23:30 – 24:00: NAV 已锁，缓存到8:00 次日交易开始前。
  const noUpdateUntilMin = 17 * 60 + 30; // 17:30
  const publishWindowEndMin = 23 * 60 + 30; // 23:30
  const nextDayQuietStartMin = 9 * 60 + 30; // 次日 09:30

  if (totalMin < noUpdateUntilMin) {
    const remainingMs = (noUpdateUntilMin - totalMin) * 60 * 1000;
    return Math.max(base, remainingMs);
  }

  if (totalMin < publishWindowEndMin) {
    return Math.min(base, 30 * 60 * 1000);
  }

  // 23:30 – 24:00
  const remainingTodayMin = 24 * 60 - totalMin; // 到次日 00:00 的分钟
  const nextDayMs = (remainingTodayMin + nextDayQuietStartMin) * 60 * 1000; // 到次日 09:30
  return Math.max(base, nextDayMs);
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
  return getNavExchangeQuoteSnapshot(code, generatedAt);
}

async function fetchHoldingSnapshot(code, generatedAt) {
  return getNavHoldingSnapshot(code, generatedAt);
}

async function fetchLiveHoldingsNavPayload(codes, env, key, ttlMsOverride) {
  const generatedAt = nowShanghaiIso();
  // 默认 fallback 以防被其他调用点复用；但 handleHoldingsNav 总是传进来。
  const ttlMs = Number.isFinite(ttlMsOverride) && ttlMsOverride > 0
    ? ttlMsOverride
    : getHoldingsNavCacheTtlMs(env);
  // 以前是无限并发 Promise.all：冷缓存时 60 code 可能同时打 60 个上游。
  // 这里改用 mapLimit(6) 限并发；东财 NAV 上游本身并不费力，6 并发 + 重试足够。
  const items = await mapLimit(codes, 6, async (code) => {
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
  });

  const successCount = items.filter((item) => item.ok === true).length;
  const failureCount = items.length - successCount;

  return {
    ok: true,
    generatedAt,
    expiresAt: epochMsToShanghaiIso(Date.parse(generatedAt) + ttlMs),
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

  // 拆分策略：场内 ETF 与 场外/QDII 各自独立 cache key + TTL，并行 fetch。
  //   - 场内 ETF：盘中 60s（报价秒变）；非交易时间拉长到下一个开盘前。
  //   - 场外 / QDII：沿用 computeNonExchangeNavTtlMs，17:30 之前默认 NAV 未变可拉长几小时。
  // 3 只场内 + N 只场外：盘中 60s 过期只需重拉 3 个 ETF，场外几小时内函数全走缓存。
  const reqUrl = new URL(request.url);
  const forceBypass = reqUrl.searchParams.get('force') === '1' || reqUrl.searchParams.get('refresh') === '1';
  const cacheNow = new Date();
  const baseTtlMs = getHoldingsNavCacheTtlMs(env);

  const exchangeCodes = codes.filter((c) => isExchangeFundCode(c));
  const otcCodes = codes.filter((c) => !isExchangeFundCode(c));

  const exchangeTtlMs = computeExchangeNavTtlMs(baseTtlMs, cacheNow);
  const otcTtlMs = computeNonExchangeNavTtlMs(baseTtlMs, cacheNow);

  const [exchangePayload, otcPayload] = await Promise.all([
    exchangeCodes.length
      ? resolveHoldingsGroup({ request, env, codes: exchangeCodes, ttlMs: exchangeTtlMs, forceBypass })
      : Promise.resolve(null),
    otcCodes.length
      ? resolveHoldingsGroup({ request, env, codes: otcCodes, ttlMs: otcTtlMs, forceBypass })
      : Promise.resolve(null)
  ]);

  const itemsByCode = new Map();
  if (exchangePayload && Array.isArray(exchangePayload.items)) {
    for (const it of exchangePayload.items) itemsByCode.set(it.code, it);
  }
  if (otcPayload && Array.isArray(otcPayload.items)) {
    for (const it of otcPayload.items) itemsByCode.set(it.code, it);
  }
  const items = codes.map((c) => itemsByCode.get(c)).filter(Boolean);
  const successCount = items.filter((i) => i && i.ok === true).length;
  const failureCount = items.length - successCount;
  const generatedAt = (exchangePayload && exchangePayload.generatedAt)
    || (otcPayload && otcPayload.generatedAt)
    || nowShanghaiIso();
  const expCandidates = [exchangePayload, otcPayload]
    .filter(Boolean)
    .map((p) => Date.parse(String(p.expiresAt || '')))
    .filter((n) => Number.isFinite(n));
  const expiresAt = expCandidates.length
    ? epochMsToShanghaiIso(Math.min(...expCandidates))
    : generatedAt;
  const groups = [exchangePayload, otcPayload].filter(Boolean);
  const allHit = groups.length > 0 && groups.every((g) => g && g.cache && g.cache.hit === true);
  const anyLive = groups.some((g) => g && g.cache && g.cache.source === 'live');
  const cacheSource = anyLive ? 'live' : ((groups[0] && groups[0].cache && groups[0].cache.source) || 'edge-cache');

  return jsonResponse({
    ok: true,
    generatedAt,
    expiresAt,
    successCount,
    failureCount,
    cache: {
      key: [exchangePayload && exchangePayload.cache && exchangePayload.cache.key,
            otcPayload && otcPayload.cache && otcPayload.cache.key].filter(Boolean).join('+'),
      hit: allHit,
      source: cacheSource,
      stale: false,
      codeCount: codes.length,
      groups: {
        exchange: exchangePayload ? {
          count: (exchangePayload.items && exchangePayload.items.length) || 0,
          source: (exchangePayload.cache && exchangePayload.cache.source) || '',
          hit: !!(exchangePayload.cache && exchangePayload.cache.hit === true),
          ttlMs: exchangeTtlMs
        } : null,
        otc: otcPayload ? {
          count: (otcPayload.items && otcPayload.items.length) || 0,
          source: (otcPayload.cache && otcPayload.cache.source) || '',
          hit: !!(otcPayload.cache && otcPayload.cache.hit === true),
          ttlMs: otcTtlMs
        } : null
      }
    },
    items
  });
}

// 单个分组（场内或场外）的 cache -> baseline -> live 查找流程。
// 拆出来以便 handleHoldingsNav 并行调用。
async function resolveHoldingsGroup({ request, env, codes, ttlMs, forceBypass }) {
  const key = await buildHoldingsCacheKey(codes);
  const cacheRequest = buildHoldingsCacheRequest(new URL(request.url), key, codes);

  if (forceBypass) {
    try { await caches.default.delete(cacheRequest); } catch (_e) { /* ignore */ }
  } else {
    const cachedResponse = await caches.default.match(cacheRequest);
    if (cachedResponse) {
      try {
        const payload = await cachedResponse.json();
        if (isHoldingsPayloadFresh(payload, ttlMs)) {
          return withHoldingsCacheMeta(payload, {
            key, hit: true, source: 'edge-cache', stale: false, codeCount: codes.length
          });
        }
      } catch (_error) { /* fall through */ }
    }
    const baselinePayload = await readHoldingsBaselinePayload(request, env, key, ttlMs, codes);
    if (baselinePayload) return baselinePayload;
  }

  const livePayload = await fetchLiveHoldingsNavPayload(codes, env, key, ttlMs);
  if (livePayload.failureCount === 0) {
    const cacheResponse = jsonResponse(livePayload, 200, {
      'cache-control': `public, max-age=${Math.max(Math.floor(ttlMs / 1000), 60)}`
    });
    await caches.default.put(cacheRequest, cacheResponse.clone());
  }
  return livePayload;
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
