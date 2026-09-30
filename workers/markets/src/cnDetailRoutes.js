import { fetchTencentCnQuote, fetchSinaKline } from './fetchers.js';
import { fetchCollectorPremiumBatch } from './collectorPremium.js';
import { normalizeFundMetricFromQuote } from './fundMetricsRoutes.js';
import { classifySymbol, toEastmoneySecId } from './symbols.js';
import { kvGetJson, kvPutJson } from './storage.js';
import { errorJson, json } from './marketRuntime.js';

const TTL_SECONDS = 300;
const number = (value) => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);

async function fetchCapitalFlow(symbol) {
  const params = new URLSearchParams({
    secid: toEastmoneySecId(symbol), ut: 'fa5fd1943c7b386f172bc3bcefc9a2c',
    fields: 'f1,f2,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87', fltt: '2'
  });
  const response = await fetch(`https://push2.eastmoney.com/api/qt/stock/get?${params}`, {
    signal: AbortSignal.timeout(8000), headers: { referer: 'https://quote.eastmoney.com/' }
  });
  if (!response.ok) throw new Error('capital flow HTTP ' + response.status);
  const { data } = await response.json();
  if (!data || number(data.f62) == null) return null;
  return {
    mainNetInflow: number(data.f62), mainNetInflowPct: number(data.f184),
    superLarge: number(data.f66), large: number(data.f69), medium: number(data.f72), small: number(data.f75),
    superLargePct: number(data.f78), largePct: number(data.f81), mediumPct: number(data.f84), smallPct: number(data.f87),
    source: 'eastmoney'
  };
}

async function fetchAvgVolume(symbol) {
  const payload = await fetchSinaKline(symbol, { intervalLabel: '1d', limit: 10 });
  const volumes = payload.candles.slice(-10).map((bar) => number(bar.v)).filter((v) => v != null && v >= 0);
  return volumes.length ? volumes.reduce((sum, v) => sum + v, 0) / volumes.length : null;
}

export async function handleCnDetail(env, rawSymbol, params = new URLSearchParams()) {
  const raw = String(rawSymbol || '').trim();
  // Bare Shanghai funds include 50/52/53/54 prefixes as well as 51/56/58.
  const { market, code: symbol } = classifySymbol(/^5\d{5}$/.test(raw) ? 'sh' + raw : raw);
  if (market !== 'cn' || !/^(sh|sz|bj)\d{6}$/.test(symbol)) return errorJson('invalid cn symbol', 400);
  const code = symbol.slice(2);
  const key = 'cn-detail:' + code;
  if (params.get('refresh') !== '1') {
    const cached = await kvGetJson(env, key).catch(() => null);
    const age = Date.now() - Date.parse(cached?.generatedAt || '');
    if (cached?.source === 'cn-detail' && cached.code === code && cached.symbol === symbol
      && cached.price > 0 && age >= 0 && age < TTL_SECONDS * 1000
      && Object.hasOwn(cached, 'capitalFlow') && Object.hasOwn(cached, 'finance')
      && (cached.orderBook === null || (cached.orderBook?.source === 'tencent-pankou' && cached.orderBook.levels?.length === 5))) {
      return json({ ...cached, cached: true });
    }
  }
  const [quoteResult, flowResult, volumeResult] = await Promise.allSettled([
    fetchTencentCnQuote(symbol), fetchCapitalFlow(symbol), fetchAvgVolume(symbol)
  ]);
  if (quoteResult.status === 'rejected') return errorJson('cn quote unavailable', 502);
  const quote = quoteResult.value;
  const premiums = await fetchCollectorPremiumBatch([{ code, price: quote.price }]).catch(() => ({}));
  const item = {
    ...normalizeFundMetricFromQuote(code, { ...quote, ...premiums[code], premiumEngine: 'collector' }, { exchange: true }),
    code, symbol, open: quote.open ?? null, high52w: quote.high52w ?? null, low52w: quote.low52w ?? null,
    orderBook: quote.orderBook ?? null,
    avgVolume: volumeResult.status === 'fulfilled' ? volumeResult.value : null,
    capitalFlow: flowResult.status === 'fulfilled' ? flowResult.value : null,
    finance: null, source: 'cn-detail', cached: false, generatedAt: new Date().toISOString()
  };
  await kvPutJson(env, key, item, { ttlSeconds: TTL_SECONDS }).catch(() => {});
  return json(item);
}
