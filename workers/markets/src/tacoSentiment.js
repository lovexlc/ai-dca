const TACO_PAGE_URL = 'https://data.xiaoyinsi.com/taco';
const TACO_PAGE_TIMEOUT_MS = 10_000;

const FACTOR_DEFINITIONS = [
  {
    key: 'brent',
    label: '布伦特原油',
    valuePattern: /\$([0-9][0-9,.]*)/,
    display: (raw) => `$${raw}`,
    note: '能源成本压力',
    tone: 'rose'
  },
  {
    key: 'ust10y',
    label: '美债10Y',
    valuePattern: /([0-9][0-9,.]*)%/,
    display: (raw) => `${raw}%`,
    note: '融资压力',
    tone: 'amber'
  },
  {
    key: 'hormuz',
    label: '霍尔木兹通行',
    valuePattern: /([0-9][0-9,.]*)\s*艘\/日/,
    display: (raw) => `${raw} 艘/日`,
    note: '航运中断压力',
    tone: 'emerald'
  },
  {
    key: 'sp500',
    label: '标普500',
    valuePattern: /([0-9][0-9,.]*)/,
    display: (raw) => raw,
    note: '风险偏好缓冲',
    tone: 'slate'
  }
];

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#x2002;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'");
}

function pageText(html) {
  return decodeHtmlEntities(String(html || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numericValue(raw) {
  const value = Number(String(raw || '').replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function parseFactor(text, definition) {
  const start = text.indexOf(definition.label);
  if (start < 0) throw new Error(`TACO factor missing: ${definition.key}`);
  const segment = text.slice(start, start + 180);
  const afterLabel = segment.slice(definition.label.length);
  const valueMatch = afterLabel.match(definition.valuePattern);
  if (!valueMatch) throw new Error(`TACO factor value missing: ${definition.key}`);
  const rawValue = valueMatch[1];
  const value = numericValue(rawValue);
  if (value == null) throw new Error(`TACO factor value invalid: ${definition.key}`);

  const directionMatch = afterLabel.match(/^\s+([^ ]+)\s+/);
  const contributionMatch = afterLabel.match(/占压力\s+([+-]?)\s*([0-9][0-9,.]*)\s*%/);
  const contributionValue = numericValue(contributionMatch?.[2]);
  const contribution = contributionValue == null
    ? null
    : (contributionMatch?.[1] === '-' ? -contributionValue : contributionValue);

  return {
    key: definition.key,
    label: definition.label,
    value,
    displayValue: definition.display(rawValue),
    contribution,
    tone: definition.tone,
    direction: directionMatch?.[1] || '',
    note: definition.note
  };
}

export function parseTacoPage(html, { generatedAt = new Date().toISOString() } = {}) {
  const rawHtml = String(html || '');
  const text = pageText(rawHtml);
  const scoreMatch = rawHtml.match(/aria-label=["']转向分\s+(\d+)["']/);
  const dateMatch = text.match(/Windward[\s\S]{0,100}?截至\s+(\d{4}-\d{2}-\d{2})/);
  const trafficMatch = text.match(/24h\s+过境仅\s+([0-9][0-9,.]*)\s*艘/);
  const percentileMatch = text.match(/历史分位\s+前\s+([0-9]+)\s*%/);
  const rankMatch = text.match(/([0-9][0-9,]*)\s*个交易日里\s*第\s*([0-9][0-9,]*)\s*高/);
  const statusMatch = text.match(/盘中实时\s+[^\s]+\s+([^\s]+)/u);
  const score = numericValue(scoreMatch?.[1]);

  if (score == null) throw new Error('TACO score missing');

  const factors = FACTOR_DEFINITIONS.map((definition) => parseFactor(text, definition));
  const hormuz = factors.find((factor) => factor.key === 'hormuz');
  if (hormuz && trafficMatch && numericValue(trafficMatch[1]) !== hormuz.value) {
    throw new Error('TACO Hormuz value mismatch');
  }

  const asOf = dateMatch?.[1] || '';
  const rank = rankMatch?.[2] ? `第 ${rankMatch[2]} 高` : '';
  return {
    date: asOf || String(generatedAt).slice(0, 10),
    score,
    status: statusMatch?.[1] || '',
    percentile: percentileMatch?.[1] ? `前 ${percentileMatch[1]}%` : '',
    rank,
    source: 'xiaoyinsi-taco-page',
    sourceUrl: TACO_PAGE_URL,
    asOf,
    generatedAt,
    factors
  };
}

export function isValidTacoPayload(payload, { now = Date.now(), maxAgeMs = Infinity } = {}) {
  const factors = Array.isArray(payload?.factors) ? payload.factors : [];
  const factorKeys = new Set(factors.map((factor) => String(factor?.key || '').trim()));
  const generatedAtMs = Date.parse(String(payload?.generatedAt || ''));
  const ageMs = now - generatedAtMs;
  return payload
    && payload.source === 'xiaoyinsi-taco-page'
    && Number.isFinite(Number(payload.score))
    && Number.isFinite(generatedAtMs)
    && ageMs >= -60_000
    && ageMs <= maxAgeMs
    && factors.length === FACTOR_DEFINITIONS.length
    && FACTOR_DEFINITIONS.every((definition) => factorKeys.has(definition.key))
    && factors.every((factor) => Number.isFinite(Number(factor?.value)));
}

export async function fetchTacoSentiment({ fetchImpl = globalThis.fetch, now = () => new Date(), timeoutMs = TACO_PAGE_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(TACO_PAGE_URL, {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'ai-dca-markets-taco/1.0'
      },
      signal: controller.signal,
      cf: { cacheTtl: 30 }
    });
    if (!response.ok) throw new Error(`TACO page HTTP ${response.status}`);
    return parseTacoPage(await response.text(), { generatedAt: now().toISOString() });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`TACO page timeout ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const __internals = {
  pageText,
  parseFactor,
  tacoPageUrl: TACO_PAGE_URL
};
