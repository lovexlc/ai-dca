import { isHoldingCode } from '../../../src/app/holdingsCore.js';

const FUND_CATALOG_URL = 'https://fund.eastmoney.com/js/fundcode_search.js';
const FUND_CATALOG_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FUND_SUGGEST_URL = 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx';
const ONLINE_NAME_FX_KEYWORDS = ['美元', '美元现汇', '美金', '美钞', '美汇', '现汇'];

let fundCatalogCache = {
  expiresAt: 0,
  list: null,
  byCode: null
};

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

export function extractVisibleHoldingCode(value = '') {
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

export async function resolveFundByCode(code = '') {
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

export async function resolveFundCodeByName(name = '') {
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
