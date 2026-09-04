const DEMO_CODES = ['270042'];

function metric(period, key) {
  const value = period?.[key];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export async function syncFundReport(env, code = '270042') {
  if (!env?.DB) throw new Error('DB binding unavailable');
  if (!env?.OCR?.fetch) throw new Error('OCR service binding unavailable');
  const fundCode = String(code || '').trim();

  const response = await env.OCR.fetch(`https://ocr.internal/api/fund-report?code=${encodeURIComponent(fundCode)}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok || !payload?.report || !payload?.parser?.validated) {
    return { code: fundCode, ok: false, skipped: true, reason: payload?.parserStatus || `ocr_http_${response.status}` };
  }

  const existing = await env.DB.prepare(
    'SELECT art_code FROM fund_periodic_reports WHERE fund_code = ? AND art_code = ? LIMIT 1'
  ).bind(fundCode, payload.artCode).first();
  if (existing?.art_code) return { code: fundCode, ok: true, skipped: true, reason: 'unchanged', artCode: payload.artCode };

  const r = payload.report;
  const p3 = r.period3m || {};
  const p1 = r.period1y || {};
  const policy = r.trackingPolicy || {};
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO fund_periodic_reports (
      fund_code, art_code, report_type, report_period, report_date, publish_date, title,
      benchmark_name,
      fund_return_3m, benchmark_return_3m, tracking_difference_3m,
      fund_volatility_3m, benchmark_volatility_3m, volatility_difference_3m,
      fund_return_1y, benchmark_return_1y, tracking_difference_1y,
      fund_volatility_1y, benchmark_volatility_1y, volatility_difference_1y,
      daily_tracking_deviation_limit, annual_tracking_error_limit, tracking_error_actual,
      source_url, source_title, parser_type, parser_status, extraction_model, extraction_confidence,
      raw_json, fetched_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fund_code, art_code) DO UPDATE SET
      report_type=excluded.report_type, report_period=excluded.report_period, report_date=excluded.report_date,
      publish_date=excluded.publish_date, title=excluded.title, benchmark_name=excluded.benchmark_name,
      fund_return_3m=excluded.fund_return_3m, benchmark_return_3m=excluded.benchmark_return_3m,
      tracking_difference_3m=excluded.tracking_difference_3m, fund_volatility_3m=excluded.fund_volatility_3m,
      benchmark_volatility_3m=excluded.benchmark_volatility_3m, volatility_difference_3m=excluded.volatility_difference_3m,
      fund_return_1y=excluded.fund_return_1y, benchmark_return_1y=excluded.benchmark_return_1y,
      tracking_difference_1y=excluded.tracking_difference_1y, fund_volatility_1y=excluded.fund_volatility_1y,
      benchmark_volatility_1y=excluded.benchmark_volatility_1y, volatility_difference_1y=excluded.volatility_difference_1y,
      daily_tracking_deviation_limit=excluded.daily_tracking_deviation_limit,
      annual_tracking_error_limit=excluded.annual_tracking_error_limit, tracking_error_actual=excluded.tracking_error_actual,
      source_url=excluded.source_url, source_title=excluded.source_title, parser_type=excluded.parser_type,
      parser_status=excluded.parser_status, extraction_model=excluded.extraction_model,
      extraction_confidence=excluded.extraction_confidence, raw_json=excluded.raw_json,
      fetched_at=excluded.fetched_at, updated_at=excluded.updated_at
  `).bind(
    fundCode, payload.artCode, payload.reportType, payload.reportPeriod, payload.reportDate, payload.publishDate, payload.title,
    r.benchmarkName || null,
    metric(p3, 'fundReturn'), metric(p3, 'benchmarkReturn'), metric(p3, 'trackingDifference'),
    metric(p3, 'fundVolatility'), metric(p3, 'benchmarkVolatility'), metric(p3, 'volatilityDifference'),
    metric(p1, 'fundReturn'), metric(p1, 'benchmarkReturn'), metric(p1, 'trackingDifference'),
    metric(p1, 'fundVolatility'), metric(p1, 'benchmarkVolatility'), metric(p1, 'volatilityDifference'),
    metric(policy, 'dailyDeviationLimit'), metric(policy, 'annualTrackingErrorLimit'), metric(r, 'trackingErrorActual'),
    payload.sourceUrl || null, payload.sourceTitle || payload.title || null,
    payload.parser.type, payload.parserStatus || 'complete', payload.parser.model || null, metric(payload.parser, 'confidence'),
    JSON.stringify(payload), payload.fetchedAt || now, now
  ).run();

  return { code: fundCode, ok: true, skipped: false, artCode: payload.artCode, reportPeriod: payload.reportPeriod };
}

export async function syncFundReports(env, codes = DEMO_CODES) {
  const results = [];
  for (const code of codes) {
    try { results.push(await syncFundReport(env, code)); }
    catch (error) { results.push({ code, ok: false, skipped: false, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { total: results.length, success: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results };
}
