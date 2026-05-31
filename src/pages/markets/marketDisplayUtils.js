const CN_FUND_FEE_RATE_FALLBACK = {
  '513100': 0.8,
};

export const MARKET_TABLE_METRICS = {
  price: ['price', 'regularMarketPrice'],
  changePercent: ['changePercent', 'regularMarketChangePercent'],
  previousClose: ['previousClose', 'prevClose', 'regularMarketPreviousClose'],
  open: ['open', 'regularMarketOpen'],
  high: ['high', 'regularMarketDayHigh', 'dayHigh'],
  low: ['low', 'regularMarketDayLow', 'dayLow'],
  volume: ['volume', 'regularMarketVolume'],
  marketCap: ['marketCap', 'marketCapitalization'],
};

export function formatNumber(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

export function formatPercent(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(fractionDigits) + '%';
}

export function formatSignedPercent(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(fractionDigits) + '%';
}

export function formatPercentNoPlus(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(fractionDigits) + '%';
}

export function formatSymbolDisplay(value) {
  const raw = String(value || '').trim();
  const match = /^(sh|sz|bj)(\d{6})$/i.exec(raw);
  return match ? match[2] : raw;
}

export function normalizeCnFundCode(value) {
  const raw = String(value || '').trim();
  const prefixed = /^(sh|sz|bj)(\d{6})$/i.exec(raw);
  if (prefixed) return prefixed[2];
  const sixDigits = /(\d{6})/.exec(raw);
  return sixDigits ? sixDigits[1] : '';
}

export function formatLargeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return n.toLocaleString('zh-CN');
}

export function valueOrDash(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? formatNumber(n, digits) : '--';
}

export function rowMetric(row, keys = []) {
  for (const key of keys) {
    const value = row && row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function normalizePremiumPercentValue(value, forceRate = false) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (forceRate || Math.abs(n) <= 1) return n * 100;
  return n;
}

export function resolvePremiumPercent(row) {
  if (!row) return null;
  const explicitPercent = rowMetric(row, ['premiumPercent', 'premium_rate', 'premiumPct']);
  if (explicitPercent !== null) return normalizePremiumPercentValue(explicitPercent, false);
  const explicitRate = rowMetric(row, ['premiumRate', 'premium']);
  if (explicitRate !== null) return normalizePremiumPercentValue(explicitRate, false);
  const price = Number(rowMetric(row, ['price', 'regularMarketPrice', 'latestPrice']));
  const nav = Number(rowMetric(row, ['nav', 'latestNav', 'iopv', 'baseNav', 'estimateNav']));
  if (!Number.isFinite(price) || !Number.isFinite(nav) || nav <= 0) return null;
  return ((price - nav) / nav) * 100;
}

export function formatPremiumPercent(row) {
  const pct = resolvePremiumPercent(row);
  return Number.isFinite(Number(pct)) ? formatSignedPercent(pct) : '—';
}

export function resolveFundFeeRate(row) {
  if (!row) return null;
  const cachedAnnualFeeRate = Number(row.fundFee?.annualFeeRate);
  if (Number.isFinite(cachedAnnualFeeRate)) return cachedAnnualFeeRate;
  const explicit = rowMetric(row, ['feeRate', 'expenseRatio', 'managementFeeRate', 'fundFeeRate', 'annualFeeRate']);
  const n = Number(explicit);
  if (Number.isFinite(n)) return Math.abs(n) < 0.05 ? n * 100 : n;
  const code = normalizeCnFundCode(row.code || row.symbol);
  const fallback = code ? CN_FUND_FEE_RATE_FALLBACK[code] : null;
  return Number.isFinite(Number(fallback)) ? Number(fallback) : null;
}

export function formatFeeRate(row) {
  const rate = resolveFundFeeRate(row);
  return Number.isFinite(Number(rate)) ? formatNumber(rate, 1) : '—';
}

export function feeRateToneClass(row) {
  const rate = resolveFundFeeRate(row);
  const n = Number(rate);
  if (!Number.isFinite(n)) return 'text-[#5f6368]';
  if (n >= 1) return 'text-[#d93025]';
  if (n >= 0.8) return 'text-[#f29900]';
  return 'text-[#137333]';
}

export function formatTotalShares(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 100000000) return `${formatNumber(n / 100000000, 2)}亿`;
  if (n >= 10000) return `${formatNumber(n / 10000, 2)}万`;
  return formatNumber(n, 2);
}

export function formatYearPercent(row) {
  const pct = Number(rowMetric(row, ['currentYearPercent', 'ytdPercent', 'yearPercent']));
  return Number.isFinite(pct) ? formatSignedPercent(pct) : '—';
}

export function sortableMetric(row, key) {
  if (key === 'symbol' || key === 'name') return String(row[key] || '').toLowerCase();
  if (key === 'trend') return Number(row.changePercent) || 0;
  const value = rowMetric(row, MARKET_TABLE_METRICS[key] || [key]);
  const n = Number(value);
  return Number.isFinite(n) ? n : -Infinity;
}

export function changeToneClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'text-slate-500';
  return n > 0 ? 'text-rose-600' : 'text-emerald-600';
}
