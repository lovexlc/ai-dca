function cleanText(input = '') {
  return String(input)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[%％,，\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function findPercentages(text, max = 6) {
  const values = [];
  const re = /([+-]?\d+(?:\.\d+)?)\s*[%％]/g;
  let m;
  while ((m = re.exec(text)) && values.length < max) values.push(toNumber(m[1]));
  return values;
}

function extractPeriod(text, labels) {
  for (const label of labels) {
    const idx = text.indexOf(label);
    if (idx < 0) continue;
    const values = findPercentages(text.slice(idx, idx + 1400), 6);
    if (values.length >= 6) {
      return {
        fundReturn: values[0],
        fundVolatility: values[1],
        benchmarkReturn: values[2],
        benchmarkVolatility: values[3],
        trackingDifference: values[4],
        volatilityDifference: values[5]
      };
    }
  }
  return null;
}

export function validateTrackingDifference(period, tolerance = 0.02) {
  if (!period) return false;
  const a = Number(period.fundReturn);
  const b = Number(period.benchmarkReturn);
  const d = Number(period.trackingDifference);
  if (![a, b, d].every(Number.isFinite)) return false;
  return Math.abs((a - b) - d) <= tolerance;
}

function extractBenchmarkName(text) {
  const patterns = [
    /业绩比较基准(?:为|：|:)?\s*([^\n。；;]{4,120})/,
    /业绩比较基准收益率[^\n]{0,20}(?:为|：|:)?\s*([^\n。；;]{4,120})/
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim().replace(/[。；;]+$/, '');
  }
  return null;
}

function extractLimit(text, keyword) {
  const i = text.indexOf(keyword);
  if (i < 0) return null;
  const segment = text.slice(Math.max(0, i - 120), i + 220);
  const m = segment.match(/(?:不超过|控制在|小于等于|≤)\s*([0-9]+(?:\.[0-9]+)?)\s*[%％]/)
    || segment.match(/([0-9]+(?:\.[0-9]+)?)\s*[%％][^\n]{0,20}(?:以内|以下)/);
  return m ? toNumber(m[1]) : null;
}

export function parseTrackingPolicy(input = '') {
  const text = cleanText(input);
  return {
    dailyDeviationLimit: extractLimit(text, '日均跟踪偏离度'),
    annualTrackingErrorLimit: extractLimit(text, '年跟踪误差')
  };
}

export function extractRelevantReportText(input = '') {
  const text = cleanText(input);
  const windows = [];
  for (const [keyword, radius] of [['业绩比较基准', 6000], ['跟踪误差', 3000], ['过去三个月', 2500], ['过去一年', 2500]]) {
    const idx = text.indexOf(keyword);
    if (idx >= 0) windows.push(text.slice(Math.max(0, idx - radius), idx + radius));
  }
  return windows.length ? windows.join('\n\n---\n\n') : text.slice(0, 12000);
}

export function parseFundReportText(input = '') {
  const text = cleanText(input);
  const period3m = extractPeriod(text, ['过去三个月', '过去3个月', '近三个月', '近3个月']);
  const period1y = extractPeriod(text, ['过去一年', '过去1年', '近一年', '近1年']);
  const trackingPolicy = parseTrackingPolicy(text);
  const validation = {
    period3m: period3m ? validateTrackingDifference(period3m) : false,
    period1y: period1y ? validateTrackingDifference(period1y) : false
  };
  return {
    benchmarkName: extractBenchmarkName(text),
    period3m,
    period1y,
    trackingPolicy,
    validation,
    validated: Boolean((!period3m || validation.period3m) && (!period1y || validation.period1y) && (period3m || period1y))
  };
}

export function parseReportPeriod(title = '', publishDate = '') {
  const t = String(title);
  const year = (t.match(/(20\d{2})年/) || String(publishDate).match(/(20\d{2})/))?.[1];
  if (!year) return null;
  const q = t.match(/第?([一二三四1234])季度/);
  if (q) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4 };
    return `${year}Q${map[q[1]] || q[1]}`;
  }
  if (/中期报告|半年度报告/.test(t)) return `${year}H1`;
  if (/年度报告/.test(t)) return `${year}FY`;
  return null;
}
