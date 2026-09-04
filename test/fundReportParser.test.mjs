import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFundReportText, parseReportPeriod, validateTrackingDifference } from '../workers/ocr-proxy/src/fundReportParser.js';

test('parses report period', () => {
  assert.equal(parseReportPeriod('广发纳斯达克100ETF联接(QDII)2026年第2季度报告', '2026-07-20'), '2026Q2');
  assert.equal(parseReportPeriod('某基金2025年年度报告', '2026-01-01'), '2025FY');
});

test('parses 3m metrics and validates arithmetic', () => {
  const text = `业绩比较基准：人民币计价的纳斯达克100总收益指数收益率\n阶段 ①净值增长率 ②净值增长率标准差 ③业绩比较基准收益率 ④业绩比较基准收益率标准差 ①-③ ②-④\n过去三个月 -7.56% 1.19% -7.28% 1.20% -0.28% -0.01%`;
  const parsed = parseFundReportText(text);
  assert.equal(parsed.period3m.fundReturn, -7.56);
  assert.equal(parsed.period3m.benchmarkReturn, -7.28);
  assert.equal(parsed.period3m.trackingDifference, -0.28);
  assert.equal(parsed.validation.period3m, true);
});

test('rejects inconsistent tracking difference', () => {
  assert.equal(validateTrackingDifference({ fundReturn: -7.56, benchmarkReturn: -7.28, trackingDifference: 3.9 }), false);
});
