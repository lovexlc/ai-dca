import { fetchYahooQuotesBatch } from './fetchers.js';

const PORTWATCH_QUERY_URL = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';
const PORTWATCH_CHOKEPOINT = 'chokepoint6';
const TACO_SOURCE = 'local-four-factor-model';
const TACO_MODEL_VERSION = 'taco-local-v1';

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
    note: 'PortWatch n_total',
    direction: '反向项',
    tone: 'emerald',
    precision: 0,
    source: 'portwatch'
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

function buildPortwatchUrl() {
  const url = new URL(PORTWATCH_QUERY_URL);
  url.searchParams.set('where', `portid='${PORTWATCH_CHOKEPOINT}'`);
  url.searchParams.set('outFields', 'date,n_total,portid');
  url.searchParams.set('orderByFields', 'date DESC');
  url.searchParams.set('resultRecordCount', '1');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');
  return url.toString();
}

async function fetchPortwatchLatest({ fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(buildPortwatchUrl(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'ai-dca-markets-taco/1.0'
      },
      signal: controller.signal,
      cf: { cacheTtl: 3600 }
    });
    if (!response.ok) throw new Error(`PortWatch HTTP ${response.status}`);
    const payload = await response.json();
    const attributes = payload?.features?.[0]?.attributes || {};
    const date = isoDate(attributes.date);
    const total = numericValue(attributes.n_total);
    if (!date || total == null || total < 0) throw new Error('PortWatch latest n_total missing');
    return { date, value: total, source: 'portwatch', sourceUrl: PORTWATCH_QUERY_URL };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`PortWatch timeout ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

function factorFromPortwatch(definition, latest) {
  return {
    key: definition.key,
    label: definition.label,
    value: latest.value,
    displayValue: formatFactorValue(definition.key, latest.value),
    source: latest.source,
    sourceUrl: latest.sourceUrl,
    asOf: latest.date,
    contribution: null,
    modelTerm: null,
    tone: definition.tone,
    direction: definition.direction,
    note: definition.note
  };
}

export async function fetchLocalTacoFactors({ fetchQuotes = fetchYahooQuotesBatch, fetchPortwatch = fetchPortwatchLatest } = {}) {
  const quoteMap = await fetchQuotes(['BZ=F', '^TNX', '^GSPC'], { range: '1d', interval: '5m' });
  const brent = quoteFactor(FACTOR_DEFINITIONS[0], quoteMap?.['BZ=F']);
  const ust10y = quoteFactor(FACTOR_DEFINITIONS[1], quoteMap?.['^TNX']);
  const sp500 = quoteFactor(FACTOR_DEFINITIONS[3], quoteMap?.['^GSPC']);
  const hormuz = factorFromPortwatch(FACTOR_DEFINITIONS[2], await fetchPortwatch());
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

export async function computeTacoSentiment({ now = new Date(), fetchQuotes, fetchPortwatch } = {}) {
  const factors = await fetchLocalTacoFactors({ fetchQuotes, fetchPortwatch });
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
  buildPortwatchUrl,
  fetchPortwatchLatest,
  factorDefinitions: FACTOR_DEFINITIONS,
  tacoSource: TACO_SOURCE,
  tacoModelVersion: TACO_MODEL_VERSION
};
