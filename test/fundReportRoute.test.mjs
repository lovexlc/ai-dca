import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFundReport } from '../workers/markets/src/fundReportRoutes.js';

test('fund report route returns latest and history', async () => {
  const row = { fund_code:'270042', art_code:'A1', title:'2026年第2季度报告', report_type:'quarterly', report_period:'2026Q2', publish_date:'2026-07-20', benchmark_name:'NASDAQ 100', fund_return_3m:-7.56, benchmark_return_3m:-7.28, tracking_difference_3m:-0.28 };
  const env = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [row] }) }) }) } };
  const response = await handleFundReport(env, new URL('https://x/api/markets/fund-report?code=270042'));
  const json = await response.json();
  assert.equal(json.latest.reportPeriod, '2026Q2');
  assert.equal(json.latest.period3m.trackingDifference, -0.28);
});
