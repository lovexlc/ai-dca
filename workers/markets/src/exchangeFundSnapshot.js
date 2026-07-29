// 场内 ETF/LOF 的轻量快照模型、排序字段和比较逻辑。
// 快照只保存报价字段，不包含 K 线 candles；历史走势继续走 /kline。

export const EXCHANGE_FUND_SORT_FIELDS = Object.freeze([
  'heldRank',
  'symbol',
  'name',
  'price',
  'changePercent',
  'change',
  'open',
  'high',
  'low',
  'previousClose',
  'volume',
  'turnover',
  'marketCapital',
  'iopv',
  'premiumPercent',
  'currentYearPercent',
  'ytdReturn',
  'return1w',
  'return1m',
  'return3m',
  'return6m',
  'return1y',
  'returnBase',
  'totalShares',
  'historicalPercentile',
  'highDrawdown',
  'closeHighDrawdown',
  'drawdownPercentile',
  'marketState',
  'asOf',
]);

const SORT_FIELD_SET = new Set(EXCHANGE_FUND_SORT_FIELDS);
const SORT_FIELD_ALIASES = Object.freeze({
  code: 'symbol',
  changePct: 'changePercent',
  currentYear: 'currentYearPercent',
  ytd: 'ytdReturn',
  premium: 'premiumPercent',
});
const EXCHANGE_CODE_PREFIXES = new Set(['15', '16', '50', '51', '52', '53', '54', '56', '58']);
const NUMERIC_SORT_FIELDS = new Set(EXCHANGE_FUND_SORT_FIELDS.filter((field) => !['symbol', 'name', 'marketState', 'asOf'].includes(field)));

export const EXCHANGE_FUND_HUB_NAME = 'cn-exchange-funds';

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrEmpty(value) {
  return String(value ?? '').trim();
}

export function normalizeExchangeFundCode(value) {
  const digits = textOrEmpty(value).replace(/^(sh|sz|bj)/i, '');
  return /^\d{6}$/.test(digits) ? digits : '';
}

export function isExchangeFundCode(value) {
  const code = normalizeExchangeFundCode(value);
  return Boolean(code) && EXCHANGE_CODE_PREFIXES.has(code.slice(0, 2));
}

export function normalizeExchangeFundItem(raw = {}, fallbackCode = '') {
  const code = normalizeExchangeFundCode(raw.code || raw.symbol || fallbackCode);
  if (!code || !isExchangeFundCode(code)) return null;
  const price = finiteOrNull(raw.price ?? raw.currentPrice ?? raw.close);
  const previousClose = finiteOrNull(raw.previousClose ?? raw.previous_close ?? raw.previousNav);
  const premiumPercent = finiteOrNull(raw.premiumPercent ?? raw.premium_rate ?? raw.premiumPct ?? raw.premium);
  const ytdReturn = finiteOrNull(raw.ytdReturn ?? raw.currentYearPercent ?? raw.current_year_percent);
  const highPoint = raw.highPoint && typeof raw.highPoint === 'object'
    ? {
        high: finiteOrNull(raw.highPoint.high ?? raw.highPoint.yearHigh ?? raw.highPoint.price),
        highDate: textOrEmpty(raw.highPoint.highDate || raw.highPoint.date),
        source: textOrEmpty(raw.highPoint.source),
      }
    : null;
  const closeHighPoint = raw.closeHighPoint && typeof raw.closeHighPoint === 'object'
    ? {
        high: finiteOrNull(raw.closeHighPoint.high ?? raw.closeHighPoint.yearHigh ?? raw.closeHighPoint.price),
        highDate: textOrEmpty(raw.closeHighPoint.highDate || raw.closeHighPoint.date),
        source: textOrEmpty(raw.closeHighPoint.source),
      }
    : null;
  const highDrawdown = finiteOrNull(
    raw.highDrawdown
      ?? raw.dayHighDrawdown
      ?? (price != null && highPoint?.high > 0 ? ((price - highPoint.high) / highPoint.high) : null)
  );
  const closeHighDrawdown = finiteOrNull(
    raw.closeHighDrawdown
      ?? (price != null && closeHighPoint?.high > 0 ? ((price - closeHighPoint.high) / closeHighPoint.high) : null)
  );
  return {
    code,
    symbol: code,
    name: textOrEmpty(raw.name || raw.fullName || code) || code,
    price,
    currentPrice: price,
    close: price,
    change: finiteOrNull(raw.change),
    changePercent: finiteOrNull(raw.changePercent ?? raw.percent),
    previousClose,
    open: finiteOrNull(raw.open),
    high: finiteOrNull(raw.high),
    low: finiteOrNull(raw.low),
    volume: finiteOrNull(raw.volume),
    turnover: finiteOrNull(raw.turnover ?? raw.amount),
    amount: finiteOrNull(raw.amount ?? raw.turnover),
    marketCapital: finiteOrNull(raw.marketCapital ?? raw.marketCap ?? raw.market_capital),
    marketCap: finiteOrNull(raw.marketCap ?? raw.marketCapital ?? raw.market_capital),
    iopv: finiteOrNull(raw.iopv ?? raw.estimateNav),
    latestNav: finiteOrNull(raw.latestNav),
    premiumPercent,
    premium_rate: premiumPercent,
    currentYearPercent: ytdReturn,
    ytdReturn,
    return1w: finiteOrNull(raw.return1w),
    return1m: finiteOrNull(raw.return1m),
    return3m: finiteOrNull(raw.return3m),
    return6m: finiteOrNull(raw.return6m),
    return1y: finiteOrNull(raw.return1y),
    returnBase: finiteOrNull(raw.returnBase),
    totalShares: finiteOrNull(raw.totalShares ?? raw.total_shares),
    historicalPercentile: finiteOrNull(raw.historicalPercentile),
    highDrawdown,
    closeHighDrawdown,
    drawdownPercentile: finiteOrNull(raw.drawdownPercentile),
    highPoint,
    closeHighPoint,
    yearHigh: finiteOrNull(raw.yearHigh ?? highPoint?.high),
    yearHighDate: textOrEmpty(raw.yearHighDate || highPoint?.highDate),
    highDate: textOrEmpty(raw.highDate || raw.yearHighDate || highPoint?.highDate),
    highSource: textOrEmpty(raw.highSource || highPoint?.source),
    marketState: textOrEmpty(raw.marketState),
    asOf: textOrEmpty(raw.asOf || raw.updatedAt) || new Date().toISOString(),
    updatedAt: textOrEmpty(raw.updatedAt || raw.asOf),
    source: textOrEmpty(raw.source),
    fallback: textOrEmpty(raw.fallback),
    stale: Boolean(raw.stale),
    error: textOrEmpty(raw.error),
    exchange: textOrEmpty(raw.exchange),
    currency: textOrEmpty(raw.currency),
    fundKind: 'exchange',
  };
}

export function normalizeExchangeFundItems(items = []) {
  const byCode = new Map();
  for (const raw of Array.isArray(items) ? items : []) {
    const item = normalizeExchangeFundItem(raw);
    if (item) byCode.set(item.code, item);
  }
  return Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
}

export function normalizeExchangeFundOrderBy(orderBy, { sortBy = '', order = '' } = {}) {
  const input = Array.isArray(orderBy)
    ? orderBy
    : sortBy
      ? [{ field: sortBy, dir: order }]
      : [];
  const out = [];
  const seen = new Set();
  for (const item of input) {
    const requestedField = textOrEmpty(item?.field || item?.id);
    const field = SORT_FIELD_ALIASES[requestedField] || requestedField;
    if (!field || !SORT_FIELD_SET.has(field) || seen.has(field)) continue;
    const rawDir = textOrEmpty(item?.dir || item?.direction || (item?.desc ? 'desc' : 'asc')).toLowerCase();
    out.push({ field, dir: rawDir === 'desc' ? 'desc' : 'asc' });
    seen.add(field);
  }
  if (!out.length) out.push({ field: 'heldRank', dir: 'desc' }, { field: 'changePercent', dir: 'desc' });
  if (!seen.has('symbol')) out.push({ field: 'symbol', dir: 'asc' });
  return out;
}

function sortValue(row, field, heldCodes) {
  if (field === 'heldRank') return heldCodes.has(row.code) ? 1 : 0;
  if (field === 'symbol') return row.symbol || row.code || '';
  if (field === 'name') return row.name || '';
  if (NUMERIC_SORT_FIELDS.has(field)) return finiteOrNull(row[field]);
  return row[field] ?? '';
}

function compareValues(left, right, field, dir) {
  const leftMissing = left == null || left === '' || (typeof left === 'number' && !Number.isFinite(left));
  const rightMissing = right == null || right === '' || (typeof right === 'number' && !Number.isFinite(right));
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  const result = typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right), 'zh-CN');
  return dir === 'desc' ? -result : result;
}

export function sortExchangeFundRows(items = [], orderBy = [], heldSymbols = []) {
  const heldCodes = new Set((Array.isArray(heldSymbols) ? heldSymbols : []).map(normalizeExchangeFundCode).filter(Boolean));
  const normalizedOrder = normalizeExchangeFundOrderBy(orderBy);
  return (Array.isArray(items) ? items : []).slice().sort((left, right) => {
    for (const item of normalizedOrder) {
      const result = compareValues(sortValue(left, item.field, heldCodes), sortValue(right, item.field, heldCodes), item.field, item.dir);
      if (result) return result;
    }
    return String(left.code || '').localeCompare(String(right.code || ''));
  });
}

export function filterExchangeFundRows(items = [], { symbols = [], query = '', heldSymbols = [], heldOnly = false } = {}) {
  const requested = new Set((Array.isArray(symbols) ? symbols : []).map(normalizeExchangeFundCode).filter(Boolean));
  const heldCodes = new Set((Array.isArray(heldSymbols) ? heldSymbols : []).map(normalizeExchangeFundCode).filter(Boolean));
  const q = textOrEmpty(query).toLowerCase();
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (requested.size && !requested.has(item.code)) return false;
    if (heldOnly && !heldCodes.has(item.code)) return false;
    if (q && !`${item.code} ${item.name}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
