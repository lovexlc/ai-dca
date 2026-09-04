import { fetchFundAnnouncementContent, fetchFundAnnouncementList } from './fundAnnouncement.js';
import { extractRelevantReportText, parseFundReportText, parseReportPeriod, validateTrackingDifference } from './fundReportParser.js';

const QUARTERLY_RE = /第[一二三四1234]季度报告|季度报告/;
const HALF_YEAR_RE = /中期报告|半年度报告/;
const ANNUAL_RE = /年度报告(?!摘要)|年报(?!摘要)/;
const EXCLUDE_RE = /提示性公告|摘要|更正公告|更新招募说明书|基金产品资料概要/;
const DEFAULT_MODEL = '@cf/moonshotai/kimi-k2.6';

function classifyReportType(title = '') {
  if (EXCLUDE_RE.test(title)) return null;
  if (QUARTERLY_RE.test(title)) return 'quarterly';
  if (HALF_YEAR_RE.test(title)) return 'half_year';
  if (ANNUAL_RE.test(title)) return 'annual';
  return null;
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeAiPeriod(period = {}) {
  return {
    fundReturn: finiteOrNull(period.fundReturn),
    benchmarkReturn: finiteOrNull(period.benchmarkReturn),
    trackingDifference: finiteOrNull(period.trackingDifference),
    fundVolatility: finiteOrNull(period.fundVolatility),
    benchmarkVolatility: finiteOrNull(period.benchmarkVolatility),
    volatilityDifference: finiteOrNull(period.volatilityDifference)
  };
}

function parseJsonLoose(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI response missing JSON');
  return JSON.parse(text.slice(start, end + 1));
}

async function aiExtract(env, text) {
  if (!env?.AI?.run) return null;
  const prompt = `Extract fund periodic report tracking metrics from the supplied Chinese text. Return strict JSON only with this schema:\n{\n  "benchmarkName": string|null,\n  "period3m": {"fundReturn":number|null,"benchmarkReturn":number|null,"trackingDifference":number|null,"fundVolatility":number|null,"benchmarkVolatility":number|null,"volatilityDifference":number|null},\n  "period1y": {"fundReturn":number|null,"benchmarkReturn":number|null,"trackingDifference":number|null,"fundVolatility":number|null,"benchmarkVolatility":number|null,"volatilityDifference":number|null},\n  "trackingPolicy": {"dailyDeviationLimit":number|null,"annualTrackingErrorLimit":number|null},\n  "confidence": number\n}\nAll percentage values must be plain percentage points, for example -7.56 means -7.56%. Do not infer missing values.\n\nTEXT:\n${text}`;
  const model = String(env.FUND_REPORT_LLM_MODEL || env.ANNOUNCEMENT_LLM_MODEL || DEFAULT_MODEL).trim();
  const response = await env.AI.run(model, { messages: [{ role: 'user', content: prompt }] });
  const candidate = response?.response ?? response?.result ?? response?.output_text ?? response;
  const json = parseJsonLoose(candidate);
  const period3m = normalizeAiPeriod(json.period3m);
  const period1y = normalizeAiPeriod(json.period1y);
  const valid3m = period3m.fundReturn == null ? false : validateTrackingDifference(period3m);
  const valid1y = period1y.fundReturn == null ? false : validateTrackingDifference(period1y);
  return {
    benchmarkName: json.benchmarkName || null,
    period3m: valid3m ? period3m : null,
    period1y: valid1y ? period1y : null,
    trackingPolicy: {
      dailyDeviationLimit: finiteOrNull(json.trackingPolicy?.dailyDeviationLimit),
      annualTrackingErrorLimit: finiteOrNull(json.trackingPolicy?.annualTrackingErrorLimit)
    },
    confidence: finiteOrNull(json.confidence),
    validated: valid3m && valid1y,
    model
  };
}

export async function fetchLatestPeriodicReportMeta({ code } = {}) {
  const fundCode = String(code || '').trim();
  if (!/^\d{6}$/.test(fundCode)) throw new Error('invalid fund code');
  const list = await fetchFundAnnouncementList({ code: fundCode, type: 3, pageSize: 20 });
  const matched = list
    .map((item) => ({ ...item, reportType: classifyReportType(item.title) }))
    .filter((item) => item.reportType)
    .sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)));
  const latest = matched[0];
  if (!latest) throw new Error('periodic report not found');
  return {
    ok: true,
    code: fundCode,
    artCode: latest.artCode,
    title: latest.title,
    reportType: latest.reportType,
    reportPeriod: parseReportPeriod(latest.title, latest.publishDate),
    publishDate: latest.publishDate || null,
    sourceUrl: latest.sourceUrl || null
  };
}

export async function fetchLatestPeriodicReport({ code, env, force = false } = {}) {
  void force;
  const meta = await fetchLatestPeriodicReportMeta({ code });
  const fundCode = meta.code;
  const content = await fetchFundAnnouncementContent({ code: fundCode, artCode: meta.artCode });
  const base = {
    ...meta,
    reportDate: null,
    sourceUrl: content.sourceUrl || meta.sourceUrl,
    attachUrl: content.attachUrl || null,
    sourceTitle: meta.title,
    fetchedAt: new Date().toISOString()
  };

  if (content.noticeContent.length < 1000) {
    return { ok: false, ...base, parserStatus: 'incomplete', parser: { type: 'none', validated: false }, report: null };
  }

  const rules = parseFundReportText(content.noticeContent);
  if (rules.validation.period3m && rules.validation.period1y && rules.period3m && rules.period1y) {
    return {
      ok: true,
      ...base,
      parserStatus: 'complete',
      parser: { type: 'rules', validated: true, confidence: 1 },
      report: {
        benchmarkName: rules.benchmarkName,
        period3m: rules.period3m,
        period1y: rules.period1y,
        trackingPolicy: rules.trackingPolicy,
        trackingErrorActual: null
      }
    };
  }

  const ai = await aiExtract(env, extractRelevantReportText(content.noticeContent));
  if (!ai?.validated) {
    return {
      ok: false,
      ...base,
      parserStatus: 'validation_failed',
      parser: { type: ai ? 'ai' : 'rules', validated: false, confidence: ai?.confidence ?? null, model: ai?.model ?? null },
      report: null
    };
  }

  return {
    ok: true,
    ...base,
    parserStatus: 'complete',
    parser: { type: 'ai', validated: true, confidence: ai.confidence, model: ai.model },
    report: {
      benchmarkName: ai.benchmarkName || rules.benchmarkName,
      period3m: ai.period3m,
      period1y: ai.period1y,
      trackingPolicy: {
        dailyDeviationLimit: ai.trackingPolicy.dailyDeviationLimit ?? rules.trackingPolicy.dailyDeviationLimit,
        annualTrackingErrorLimit: ai.trackingPolicy.annualTrackingErrorLimit ?? rules.trackingPolicy.annualTrackingErrorLimit
      },
      trackingErrorActual: null
    }
  };
}
