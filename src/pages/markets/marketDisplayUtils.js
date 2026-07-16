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
  turnover: ['turnover', 'amount', 'regularMarketTurnover'],
  marketCap: ['marketCap', 'marketCapitalization'],
};

export function formatNumber(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

const CN_EXCHANGE_FUND_PREFIXES = new Set(['15', '50', '51', '52', '53', '54', '56', '58']);

export function isCnExchangeFundRow(row) {
  const digits = normalizeCnFundCode(row?.code || row?.symbol);
  return /^\d{6}$/.test(digits) && CN_EXCHANGE_FUND_PREFIXES.has(digits.slice(0, 2));
}

export function isCnLofFundRow(row) {
  if (!row) return false;
  const text = [row.kind, row.assetType, row.type, row.exchange, row.name, row.symbol, row.code]
    .filter(Boolean)
    .join(' ');
  return /\bLOF\b|LOF基金/i.test(text);
}

export function isOtcMarketRow(row) {
  return row?.kind === 'otc' || row?.fundKind === 'otc' || row?.assetType === 'otc_fund';
}

export function resolveMarketUpdatedAt(row = {}) {
  if (isOtcMarketRow(row)) {
    return row.latestNavDate || row.navDate || row.updatedAt || row.asOf || '';
  }
  return row.quoteTime || row.asOf || row.quoteDate || row.updatedAt || '';
}

export function formatMarketPrice(value, row = null) {
  return formatNumber(value, isCnExchangeFundRow(row) ? 3 : 2);
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
  const match = /^(sh|sz|bj|jj)(\d{6})$/i.exec(raw);
  return match ? match[2] : raw;
}

export function normalizeCnFundCode(value) {
  const raw = String(value || '').trim();
  const prefixed = /^(sh|sz|bj|jj)(\d{6})$/i.exec(raw);
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

function isFiniteRate(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function normalizePremiumPercentValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function resolvePremiumPercent(row) {
  if (!row || isCnLofFundRow(row)) return null;
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
  return pct !== null && Number.isFinite(Number(pct)) ? formatSignedPercent(pct) : '—';
}

export function resolveFundFeeRate(row) {
  if (!row) return null;
  const operationFeeRate = combineRuleRates(row.fundFee?.operationFees);
  if (isFiniteRate(operationFeeRate)) return operationFeeRate;
  const cachedAnnualFeeRate = Number(row.fundFee?.annualFeeRate);
  if (Number.isFinite(cachedAnnualFeeRate)) return cachedAnnualFeeRate;
  const explicit = rowMetric(row, ['feeRate', 'expenseRatio', 'managementFeeRate', 'fundFeeRate', 'annualFeeRate']);
  const n = Number(explicit);
  if (isFiniteRate(explicit)) return Math.abs(n) < 0.05 ? n * 100 : n;
  const code = normalizeCnFundCode(row.code || row.symbol);
  const fallback = code ? CN_FUND_FEE_RATE_FALLBACK[code] : null;
  return isFiniteRate(fallback) ? Number(fallback) : null;
}

function parseRateValue(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value) <= 1 ? value * 100 : value;
  const text = String(value || '')
    .replace(/,/g, '')
    .replace(/％/g, '%')
    .replace(/每年|年|\(.*?\)|（.*?）/g, '')
    .trim();
  if (!text || /暂无|不适用|无|--|—/.test(text)) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  if (!Number.isFinite(n)) return null;
  return Math.round((Math.abs(n) <= 1 && !/%/.test(text) ? n * 100 : n) * 10000) / 10000;
}

function parsePercentNumber(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

function ratesFromRuleRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const unit = String(row.unit ?? '').trim();
        if (unit === '1') return null;
        if (unit === '2' && row.value != null) return parsePercentNumber(row.value);
        if (row.value != null) return parseRateValue(row.value);
      }
      const values = Array.isArray(row)
        ? row
        : row && typeof row === 'object'
          ? Object.values(row)
          : [row];
      const percentText = values.find((value) => /[%％]/.test(String(value || '')));
      const fallbackText = values.length > 1 ? values[values.length - 1] : values[0];
      return parseRateValue(percentText ?? fallbackText);
    })
    .filter(isFiniteRate);
}

function combineRuleRates(rows = []) {
  const rates = ratesFromRuleRows(rows);
  if (!rates.length) return null;
  return Math.round(rates.reduce((sum, rate) => sum + Number(rate), 0) * 10000) / 10000;
}

export function resolveRedeemFeeRate(row) {
  const explicit = rowMetric(row, ['redeemFeeRate', 'redemptionFeeRate', 'sellFeeRate']);
  const explicitRate = parseRateValue(explicit);
  if (isFiniteRate(explicitRate)) return explicitRate;
  const rates = ratesFromRuleRows(row?.fundFee?.redeemRules);
  if (!rates.length) return null;
  return Math.max(...rates);
}

export function formatRedeemFeeRate(row) {
  const rate = resolveRedeemFeeRate(row);
  return isFiniteRate(rate) ? formatNumber(rate, 2) : '—';
}

export function resolveRedeemFeeTiers(row) {
  const rules = row?.fundFee?.redeemRules;
  if (!Array.isArray(rules) || !rules.length) return [];
  return rules
    .map((rule) => {
      if (rule && typeof rule === 'object' && !Array.isArray(rule)) {
        const name = String(rule.name ?? '').trim().replace(/(\d)\.0(?=\D|$)/g, '$1');
        const unit = String(rule.unit ?? '').trim();
        if (rule.value == null || rule.value === '') return null;
        let valueText;
        if (unit === '1') {
          valueText = `${String(rule.value).trim()}元`;
        } else {
          const rate = unit === '2' ? parsePercentNumber(rule.value) : parseRateValue(rule.value);
          if (!isFiniteRate(rate)) return null; // 过滤掉非数字的费率
          valueText = `${formatNumber(rate, 2)}%`;
        }
        return name ? `${name}：${valueText}` : valueText;
      }
      return null; // 过滤掉数组类型的规则（通常是文本说明）
    })
    .filter(Boolean);
}

export function formatRedeemFeeTiers(row) {
  return resolveRedeemFeeTiers(row).join('\n');
}

export function formatFeeRate(row) {
  const rate = resolveFundFeeRate(row);
  return isFiniteRate(rate) ? formatNumber(rate, 1) : '—';
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

export function formatTurnover(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (Math.abs(n) >= 100000000) return `${formatNumber(n / 100000000, 2)}亿`;
  if (Math.abs(n) >= 10000) return `${formatNumber(n / 10000, 2)}万`;
  return formatNumber(n, 2);
}

export function formatYearPercent(row) {
  const pct = Number(rowMetric(row, ['ytdReturn', 'currentYearPercent', 'ytdPercent', 'yearPercent']));
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
