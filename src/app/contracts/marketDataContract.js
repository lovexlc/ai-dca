function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

export function normalizeFundMetric(raw, fallbackCode = '') {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...source,
    code: text(source.code, text(fallbackCode)),
    ok: source.ok !== false,
    price: finiteOrNull(source.price ?? source.currentPrice ?? source.close),
    latestNav: finiteOrNull(source.latestNav ?? source.navBase ?? source.iopv),
    premiumPercent: finiteOrNull(source.premiumPercent ?? source.premiumPct),
    source: text(source.source, 'unknown'),
    cacheStatus: text(source.cacheStatus)
  };
}

export function normalizeFundMetricsPayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
    ? rawPayload
    : {};
  return {
    ...payload,
    items: (Array.isArray(payload.items) ? payload.items : [])
      .map((item) => normalizeFundMetric(item))
  };
}

export function normalizeKlinePayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
    ? rawPayload
    : {};
  const candles = (Array.isArray(payload.candles) ? payload.candles : []).map((rawBar) => {
    const source = rawBar && typeof rawBar === 'object' ? rawBar : {};
    const close = finiteOrNull(source.c ?? source.close ?? source.price);
    const open = finiteOrNull(source.o ?? source.open) ?? close;
    const high = finiteOrNull(source.h ?? source.high) ?? close;
    const low = finiteOrNull(source.l ?? source.low) ?? close;
    return {
      ...source,
      t: finiteOrNull(source.t ?? source.timestamp ?? source.time),
      c: close,
      close,
      o: open,
      open,
      h: high,
      high,
      l: low,
      low
    };
  });
  return { ...payload, candles };
}
