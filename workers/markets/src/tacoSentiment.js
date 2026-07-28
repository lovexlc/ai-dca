import { fetchYahooQuotesBatch } from './fetchers.js';

const WINDWARD_URL = 'https://insights.windward.ai/';
const WINDWARD_SOURCE = 'windward-browser-run';
const WINDWARD_SCRAPE_ELEMENTS = Object.freeze([
  { selector: '.dmap-panel.dmap-in .dmap-sub' },
  { selector: '.dmap-panel.dmap-out .dmap-sub' },
  { selector: '.dmap-panel-footer' }
]);
const TACO_SOURCE = 'local-four-factor-model';
const TACO_MODEL_VERSION = 'taco-local-v2-windward';

export const TACO_CACHE_KEY = 'taco:live';
export const TACO_CACHE_MAX_AGE_MS = 6 * 3600 * 1000;

export const TACO_MODEL = Object.freeze({
  version: TACO_MODEL_VERSION,
  scoreFormula: 'clip(round(9.7727 + 0.611395 × Brent + 5.89306 × UST10Y - 0.00144492 × SP500 - 0.765978 × HormuzTotal), 0, 100)',
  coefficients: Object.freeze({
    intercept: 9.7727,
    brent: 0.611395,
    ust10y: 5.89306,
    sp500: -0.00144492,
    hormuz: -0.765978
  })
});

const FACTOR_DEFINITIONS = [
  {
    key: 'brent',
    label: '布伦特原油',
    symbol: 'BZ=F',
    note: 'Yahoo Brent 期货',
    direction: '正向项',
    tone: 'rose',
    precision: 2,
    source: 'yahoo-chart'
  },
  {
    key: 'ust10y',
    label: '美债10Y',
    symbol: '^TNX',
    note: 'Yahoo 10Y 指数',
    direction: '正向项',
    tone: 'amber',
    precision: 3,
    source: 'yahoo-chart'
  },
  {
    key: 'hormuz',
    label: '霍尔木兹通行',
    note: 'Windward 24h crossings',
    direction: '反向项',
    tone: 'emerald',
    precision: 0,
    source: WINDWARD_SOURCE
  },
  {
    key: 'sp500',
    label: '标普500',
    symbol: '^GSPC',
    note: 'Yahoo S&P 500 指数',
    direction: '缓冲项',
    tone: 'slate',
    precision: 2,
    source: 'yahoo-chart'
  }
];

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, precision = 2) {
  const number = numericValue(value);
  if (number == null) return null;
  const factor = 10 ** precision;
  return Math.round(number * factor) / factor;
}

function formatValue(value, precision = 2) {
  const number = numericValue(value);
  if (number == null) return '';
  return number.toLocaleString('en-US', {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision
  });
}

function formatFactorValue(key, value) {
  if (key === 'brent') return `$${formatValue(value, 2)}`;
  if (key === 'ust10y') return `${formatValue(value, 3)}%`;
  if (key === 'hormuz') return `${formatValue(value, 0)} 艘/日`;
  return formatValue(value, 2);
}

function isoDate(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : '';
}

function scrapeResultItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function scrapeText(payload, selector, index = 0) {
  const group = scrapeResultItems(payload).find((item) => item?.selector === selector);
  const result = group?.results?.[index];
  return String(result?.text || result?.html || '').replace(/\s+/g, ' ').trim();
}

function parseTransitCount(text, direction) {
  const normalized = String(text || '').trim();
  if (new RegExp(`no\\s+${direction}\\s+transits?`, 'i').test(normalized)) return 0;
  const match = normalized.match(/([0-9][0-9,]*)\s+transits?\b/i);
  const count = numericValue(match?.[1]?.replace(/,/g, ''));
  if (count == null || count < 0) throw new Error(`Windward ${direction} transit count missing`);
  return count;
}

function parseWindwardSourceDate(text) {
  const match = String(text || '').match(/Source:\s*Windward AI\s*[·•-]\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
  return isoDate(match?.[1]);
}

async function readQuickActionPayload(response) {
  if (response && typeof response.json === 'function') {
    if ('ok' in response && !response.ok) throw new Error(`Windward Browser Run HTTP ${response.status}`);
    return await response.json();
  }
  return response;
}

export async function fetchWindwardLatest({ browser } = {}) {
  if (!browser || typeof browser.quickAction !== 'function') {
    throw new Error('Cloudflare Browser Run binding unavailable');
  }
  const payload = await readQuickActionPayload(await browser.quickAction('scrape', {
    url: WINDWARD_URL,
    elements: WINDWARD_SCRAPE_ELEMENTS
  }));
  if (payload?.success === false) throw new Error('Windward Browser Run scrape failed');

  const inboundText = scrapeText(payload, WINDWARD_SCRAPE_ELEMENTS[0].selector);
  const outboundText = scrapeText(payload, WINDWARD_SCRAPE_ELEMENTS[1].selector);
  const sourceText = scrapeText(payload, WINDWARD_SCRAPE_ELEMENTS[2].selector);
  const inbound = parseTransitCount(inboundText, 'inbound');
  const outbound = parseTransitCount(outboundText, 'outbound');
  const date = parseWindwardSourceDate(sourceText);
  if (!date) throw new Error('Windward source date missing');
  return {
    date,
    value: inbound + outbound,
    inbound,
    outbound,
    source: WINDWARD_SOURCE,
    sourceUrl: WINDWARD_URL
  };
}

function quoteFactor(definition, quote) {
  const value = numericValue(quote?.price);
  if (value == null || value <= 0) throw new Error(`${definition.key} quote unavailable`);
  return {
    key: definition.key,
    label: definition.label,
    value: round(value, definition.precision),
    displayValue: formatFactorValue(definition.key, value),
    source: 'yahoo-chart',
    sourceSymbol: definition.symbol,
    asOf: quote.asOf || '',
    contribution: null,
    modelTerm: null,
    tone: definition.tone,
    direction: definition.direction,
    note: definition.note
  };
}

function factorFromWindward(definition, latest) {
  return {
    key: definition.key,
    label: definition.label,
    value: latest.value,
    displayValue: formatFactorValue(definition.key, latest.value),
    source: latest.source,
    sourceUrl: latest.sourceUrl,
    asOf: latest.date,
    inbound: latest.inbound,
    outbound: latest.outbound,
    contribution: null,
    modelTerm: null,
    tone: definition.tone,
    direction: definition.direction,
    note: definition.note
  };
}

export async function fetchLocalTacoFactors({ fetchQuotes = fetchYahooQuotesBatch, fetchWindward = fetchWindwardLatest, browser } = {}) {
  const quoteMap = await fetchQuotes(['BZ=F', '^TNX', '^GSPC'], { range: '1d', interval: '5m' });
  const brent = quoteFactor(FACTOR_DEFINITIONS[0], quoteMap?.['BZ=F']);
  const ust10y = quoteFactor(FACTOR_DEFINITIONS[1], quoteMap?.['^TNX']);
  const sp500 = quoteFactor(FACTOR_DEFINITIONS[3], quoteMap?.['^GSPC']);
  const hormuz = factorFromWindward(FACTOR_DEFINITIONS[2], await fetchWindward({ browser }));
  return [brent, ust10y, hormuz, sp500];
}

function scoreStatus(score) {
  if (score >= 100) return '转向临界';
  if (score >= 79) return '转向在即';
  return '观察区';
}

export function calculateTacoSentiment(factors, { generatedAt = new Date().toISOString() } = {}) {
  const byKey = new Map((Array.isArray(factors) ? factors : []).map((factor) => [factor?.key, factor]));
  const values = {};
  for (const definition of FACTOR_DEFINITIONS) {
    const value = numericValue(byKey.get(definition.key)?.value);
    if (value == null || value < 0) throw new Error(`TACO factor missing: ${definition.key}`);
    values[definition.key] = value;
  }

  const { coefficients } = TACO_MODEL;
  const terms = {
    brent: coefficients.brent * values.brent,
    ust10y: coefficients.ust10y * values.ust10y,
    hormuz: coefficients.hormuz * values.hormuz,
    sp500: coefficients.sp500 * values.sp500
  };
  const rawScore = coefficients.intercept + terms.brent + terms.ust10y + terms.hormuz + terms.sp500;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const nextFactors = FACTOR_DEFINITIONS.map((definition) => {
    const factor = byKey.get(definition.key);
    const modelTerm = round(terms[definition.key], 2);
    return {
      ...factor,
      modelTerm,
      contribution: modelTerm
    };
  });

  return {
    date: String(generatedAt).slice(0, 10),
    score,
    rawScore: round(rawScore, 4),
    status: scoreStatus(score),
    percentile: '—',
    rank: '—',
    source: TACO_SOURCE,
    modelVersion: TACO_MODEL_VERSION,
    scoreFormula: TACO_MODEL.scoreFormula,
    generatedAt,
    factors: nextFactors
  };
}

export async function computeTacoSentiment({ now = new Date(), fetchQuotes, fetchWindward, browser } = {}) {
  const factors = await fetchLocalTacoFactors({ fetchQuotes, fetchWindward, browser });
  return calculateTacoSentiment(factors, { generatedAt: now.toISOString() });
}

export function isValidTacoPayload(payload, { now = Date.now(), maxAgeMs = TACO_CACHE_MAX_AGE_MS } = {}) {
  const factors = Array.isArray(payload?.factors) ? payload.factors : [];
  const factorKeys = new Set(factors.map((factor) => String(factor?.key || '').trim()));
  const generatedAtMs = Date.parse(String(payload?.generatedAt || ''));
  const ageMs = now - generatedAtMs;
  return payload
    && payload.source === TACO_SOURCE
    && payload.modelVersion === TACO_MODEL_VERSION
    && Number.isInteger(Number(payload.score))
    && Number(payload.score) >= 0
    && Number(payload.score) <= 100
    && Number.isFinite(generatedAtMs)
    && ageMs >= -60_000
    && ageMs <= maxAgeMs
    && factors.length === FACTOR_DEFINITIONS.length
    && FACTOR_DEFINITIONS.every((definition) => factorKeys.has(definition.key))
    && factors.every((factor) => {
      const definition = FACTOR_DEFINITIONS.find((item) => item.key === factor?.key);
      return definition
        && factor.source === definition.source
        && Number.isFinite(Number(factor?.value))
        && Number(factor.value) >= 0
        && Number.isFinite(Number(factor?.modelTerm));
    });
}

export const __internals = {
  fetchWindwardLatest,
  factorDefinitions: FACTOR_DEFINITIONS,
  windwardScrapeElements: WINDWARD_SCRAPE_ELEMENTS,
  windwardSource: WINDWARD_SOURCE,
  tacoSource: TACO_SOURCE,
  tacoModelVersion: TACO_MODEL_VERSION
};
