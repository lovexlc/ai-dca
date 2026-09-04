import { errorJson, json } from './marketRuntime.js';

function shape(row) {
  return {
    artCode: row.art_code,
    title: row.title,
    reportType: row.report_type,
    reportPeriod: row.report_period,
    publishDate: row.publish_date,
    benchmark: row.benchmark_name,
    period3m: {
      fundReturn: row.fund_return_3m,
      benchmarkReturn: row.benchmark_return_3m,
      trackingDifference: row.tracking_difference_3m,
      fundVolatility: row.fund_volatility_3m,
      benchmarkVolatility: row.benchmark_volatility_3m,
      volatilityDifference: row.volatility_difference_3m
    },
    period1y: {
      fundReturn: row.fund_return_1y,
      benchmarkReturn: row.benchmark_return_1y,
      trackingDifference: row.tracking_difference_1y,
      fundVolatility: row.fund_volatility_1y,
      benchmarkVolatility: row.benchmark_volatility_1y,
      volatilityDifference: row.volatility_difference_1y
    },
    trackingPolicy: {
      dailyDeviationLimit: row.daily_tracking_deviation_limit,
      annualTrackingErrorLimit: row.annual_tracking_error_limit
    },
    trackingErrorActual: row.tracking_error_actual,
    parser: { type: row.parser_type, status: row.parser_status, confidence: row.extraction_confidence },
    source: { url: row.source_url, title: row.source_title },
    fetchedAt: row.fetched_at
  };
}

export async function handleFundReport(env, url) {
  const code = String(url.searchParams.get('code') || '').trim();
  if (!/^\d{6}$/.test(code)) return errorJson('invalid code', 400);
  if (!env?.DB) return errorJson('DB unavailable', 503);
  const result = await env.DB.prepare(`
    SELECT * FROM fund_periodic_reports
    WHERE fund_code = ?
    ORDER BY publish_date DESC, report_period DESC
    LIMIT 8
  `).bind(code).all();
  const history = (result?.results || []).map(shape);
  return json({ code, latest: history[0] || null, history });
}
