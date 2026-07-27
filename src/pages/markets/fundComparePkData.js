import {
  MARKET_EMPTY_VALUE,
  formatNumber,
  formatSignedPercent,
  normalizeCnFundCode,
  resolveFundFeeRate,
  resolveRedeemFeeTiers,
  rowMetric,
} from './marketDisplayUtils.js';
import { formatCnMoney } from './marketFinancialFormatters.js';

export const PK_GROUP_RETURNS = 'returns';
export const PK_GROUP_FEES = 'fees';
export const PK_GROUP_LIMITS = 'limits';

export const PK_GROUPS = [
  { key: PK_GROUP_RETURNS, label: '涨幅' },
  { key: PK_GROUP_FEES, label: '费用' },
  { key: PK_GROUP_LIMITS, label: '限额' },
];

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickMetric(row, keys) {
  if (!row) return null;
  if (typeof rowMetric === 'function') {
    const explicit = rowMetric(row, keys);
    if (explicit !== null && explicit !== undefined && explicit !== '') {
      const n = Number(explicit);
      return Number.isFinite(n) ? n : explicit;
    }
  }
  for (const key of keys) {
    if (row[key] == null || row[key] === '') continue;
    const n = Number(row[key]);
    if (Number.isFinite(n)) return n;
    return row[key];
  }
  return null;
}

function formatPercentCell(value) {
  const n = finiteNumber(value);
  return n == null ? MARKET_EMPTY_VALUE : formatSignedPercent(n);
}

function formatNavCell(value) {
  const n = finiteNumber(value);
  return n == null ? MARKET_EMPTY_VALUE : formatNumber(n, 4);
}

function formatFeeCell(value) {
  const n = finiteNumber(value);
  return n == null ? MARKET_EMPTY_VALUE : `${formatNumber(n, 2)}%`;
}

function formatSizeCell(value) {
  if (value == null || value === '') return MARKET_EMPTY_VALUE;
  return formatCnMoney(value);
}

function purchaseFeeSummary(fundFee) {
  const rules = Array.isArray(fundFee?.purchaseRules) ? fundFee.purchaseRules : [];
  const rates = rules
    .map((rule) => {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
      const unit = String(rule.unit ?? '').trim();
      if (unit === '1') return null;
      const raw = rule.value;
      if (raw == null || raw === '') return null;
      const n = Number(String(raw).replace(/[%％,]/g, '').trim());
      if (!Number.isFinite(n)) return null;
      return Math.abs(n) <= 1 && !/%/.test(String(raw)) ? n * 100 : n;
    })
    .filter((n) => Number.isFinite(n));
  if (!rates.length) {
    const fallback = finiteNumber(fundFee?.purchaseFeeRate);
    return fallback == null ? null : fallback;
  }
  return Math.min(...rates);
}

function redeemFeeSummaryText(rowWithFee) {
  const tiers = resolveRedeemFeeTiers(rowWithFee);
  if (!tiers.length) return MARKET_EMPTY_VALUE;
  if (tiers.length <= 2) return tiers.join('；');
  return `${tiers.slice(0, 2).join('；')}…`;
}

function limitStatusText(limit) {
  if (!limit || typeof limit !== 'object') return MARKET_EMPTY_VALUE;
  const text = String(limit.buyStatusText || limit.buyStatus || '').trim();
  return text || MARKET_EMPTY_VALUE;
}

function limitMaxPurchaseText(limit) {
  if (!limit || typeof limit !== 'object') return MARKET_EMPTY_VALUE;
  const max = finiteNumber(limit.maxPurchasePerDay ?? limit.maxPurchase);
  if (max == null) return MARKET_EMPTY_VALUE;
  if (max >= 100000000) return `${formatNumber(max / 100000000, 2)}亿`;
  if (max >= 10000) return `${formatNumber(max / 10000, 2)}万`;
  return formatNumber(max, 0);
}

function limitMinPurchaseText(limit) {
  if (!limit || typeof limit !== 'object') return MARKET_EMPTY_VALUE;
  const min = finiteNumber(limit.minPurchase ?? limit.minPurchaseAmount);
  if (min == null) return MARKET_EMPTY_VALUE;
  return `${formatNumber(min, 0)}元`;
}

/**
 * @param {object} params
 * @param {object} params.mainRow
 * @param {string[]} params.compareSymbols
 * @param {Record<string, object>} params.quoteMap
 * @param {Record<string, object>} params.feeMap
 * @param {Record<string, object>} params.limitMap
 * @param {boolean} [params.showLimits]
 */
export function buildComparePkColumns({
  mainRow,
  compareSymbols = [],
  quoteMap = {},
  feeMap = {},
  limitMap = {},
} = {}) {
  const mainSymbol = String(mainRow?.symbol || mainRow?.code || '').trim().toUpperCase();
  const mainCode = normalizeCnFundCode(mainSymbol) || mainSymbol;
  const symbols = [
    mainSymbol,
    ...compareSymbols.map((sym) => String(sym || '').trim().toUpperCase()).filter(Boolean),
  ].filter(Boolean);

  return symbols.map((symbol, index) => {
    const code = normalizeCnFundCode(symbol) || symbol;
    const isMain = index === 0;
    const quote = isMain
      ? { ...mainRow, ...(quoteMap[symbol] || quoteMap[code] || {}) }
      : (quoteMap[symbol] || quoteMap[code] || {});
    const fee = feeMap[code] || feeMap[symbol] || quote.fundFee || null;
    const limit = limitMap[code] || limitMap[symbol] || quote.fundLimit || null;
    const withFee = fee ? { ...quote, fundFee: fee } : quote;
    return {
      symbol,
      code,
      isMain,
      name: quote.name || quote.shortName || quote.displayName || symbol,
      quote,
      fee,
      limit,
      withFee,
    };
  });
}

export function buildComparePkRows({
  columns = [],
  showLimits = false,
  loadingFees = false,
  loadingLimits = false,
} = {}) {
  if (!columns.length) return [];

  const percentKeys = (keys) => ({
    type: 'percent',
    resolve: (col) => pickMetric(col.quote, keys),
    format: formatPercentCell,
    better: 'max',
  });

  const defs = [
    {
      id: 'latestNav',
      group: PK_GROUP_RETURNS,
      label: '最新净值',
      type: 'number',
      better: null,
      resolve: (col) => pickMetric(col.quote, ['latestNav', 'price', 'nav']),
      format: formatNavCell,
    },
    {
      id: 'dayChange',
      group: PK_GROUP_RETURNS,
      label: '日涨跌幅',
      ...percentKeys(['changePercent', 'dayChangePercent', 'nav_grtd']),
    },
    {
      id: 'return1w',
      group: PK_GROUP_RETURNS,
      label: '近1周',
      ...percentKeys(['return1w']),
    },
    {
      id: 'return1m',
      group: PK_GROUP_RETURNS,
      label: '近1月',
      ...percentKeys(['return1m']),
    },
    {
      id: 'return3m',
      group: PK_GROUP_RETURNS,
      label: '近3月',
      ...percentKeys(['return3m']),
    },
    {
      id: 'return6m',
      group: PK_GROUP_RETURNS,
      label: '近6月',
      ...percentKeys(['return6m']),
    },
    {
      id: 'return1y',
      group: PK_GROUP_RETURNS,
      label: '近1年',
      ...percentKeys(['return1y']),
    },
    {
      id: 'ytdReturn',
      group: PK_GROUP_RETURNS,
      label: '今年以来',
      ...percentKeys(['ytdReturn', 'currentYearPercent', 'ytdPercent', 'yearPercent']),
    },
    {
      id: 'returnBase',
      group: PK_GROUP_RETURNS,
      label: '成立来',
      ...percentKeys(['returnBase', 'returnSinceInception']),
    },
    {
      id: 'maxDrawdown',
      group: PK_GROUP_RETURNS,
      label: '最大回撤',
      type: 'percent',
      better: 'minAbs',
      resolve: (col) => pickMetric(col.quote, ['maxDrawdown', 'max_drawdown']),
      format: formatPercentCell,
    },
    {
      id: 'fundSize',
      group: PK_GROUP_RETURNS,
      label: '基金规模',
      type: 'number',
      better: null,
      resolve: (col) => pickMetric(col.quote, ['fundSize', 'assetSize', 'scale']),
      format: formatSizeCell,
    },
    {
      id: 'annualFee',
      group: PK_GROUP_FEES,
      label: '综合费率',
      type: 'percent',
      better: 'min',
      resolve: (col) => {
        const fromFee = resolveFundFeeRate(col.withFee);
        if (fromFee != null) return fromFee;
        return pickMetric(col.quote, ['annualFeeRate', 'feeRate', 'managementFeeRate']);
      },
      format: (value) => (value == null && loadingFees ? '加载中' : formatFeeCell(value)),
    },
    {
      id: 'managementFee',
      group: PK_GROUP_FEES,
      label: '管理费',
      type: 'percent',
      better: 'min',
      resolve: (col) => pickMetric(col.fee || {}, ['managementFeeRate']) ?? pickMetric(col.quote, ['managementFeeRate']),
      format: (value) => (value == null && loadingFees ? '加载中' : formatFeeCell(value)),
    },
    {
      id: 'custodyFee',
      group: PK_GROUP_FEES,
      label: '托管费',
      type: 'percent',
      better: 'min',
      resolve: (col) => pickMetric(col.fee || {}, ['custodyFeeRate']) ?? pickMetric(col.quote, ['custodyFeeRate']),
      format: (value) => (value == null && loadingFees ? '加载中' : formatFeeCell(value)),
    },
    {
      id: 'purchaseFee',
      group: PK_GROUP_FEES,
      label: '申购费率(低档)',
      type: 'percent',
      better: 'min',
      resolve: (col) => purchaseFeeSummary(col.fee),
      format: (value) => (value == null && loadingFees ? '加载中' : formatFeeCell(value)),
    },
    {
      id: 'redeemTiers',
      group: PK_GROUP_FEES,
      label: '赎回费率',
      type: 'text',
      better: null,
      resolve: (col) => redeemFeeSummaryText(col.withFee),
      format: (value) => {
        if ((value == null || value === MARKET_EMPTY_VALUE) && loadingFees) return '加载中';
        return value == null || value === '' ? MARKET_EMPTY_VALUE : String(value);
      },
    },
  ];

  if (showLimits) {
    defs.push(
      {
        id: 'buyStatus',
        group: PK_GROUP_LIMITS,
        label: '申购状态',
        type: 'text',
        better: null,
        resolve: (col) => limitStatusText(col.limit),
        format: (value) => {
          if ((value == null || value === MARKET_EMPTY_VALUE) && loadingLimits) return '加载中';
          return value == null || value === '' ? MARKET_EMPTY_VALUE : String(value);
        },
      },
      {
        id: 'maxPurchase',
        group: PK_GROUP_LIMITS,
        label: '日申购上限',
        type: 'text',
        better: null,
        resolve: (col) => limitMaxPurchaseText(col.limit),
        format: (value) => {
          if ((value == null || value === MARKET_EMPTY_VALUE) && loadingLimits) return '加载中';
          return value == null || value === '' ? MARKET_EMPTY_VALUE : String(value);
        },
      },
      {
        id: 'minPurchase',
        group: PK_GROUP_LIMITS,
        label: '起购金额',
        type: 'text',
        better: null,
        resolve: (col) => limitMinPurchaseText(col.limit),
        format: (value) => {
          if ((value == null || value === MARKET_EMPTY_VALUE) && loadingLimits) return '加载中';
          return value == null || value === '' ? MARKET_EMPTY_VALUE : String(value);
        },
      },
    );
  }

  return defs.map((def) => {
    const cells = columns.map((col) => {
      const raw = def.resolve(col);
      const text = def.format(raw, col);
      return {
        symbol: col.symbol,
        raw: raw == null || raw === '' ? null : raw,
        text: text == null || text === '' ? MARKET_EMPTY_VALUE : text,
      };
    });
    const bestIndexes = pickBestCellIndexes(cells, def.better);
    return {
      id: def.id,
      group: def.group,
      label: def.label,
      type: def.type,
      better: def.better,
      cells,
      bestIndexes,
    };
  });
}

export function pickBestCellIndexes(cells = [], better = null) {
  if (!better || !Array.isArray(cells) || cells.length < 2) return [];
  const scored = cells
    .map((cell, index) => {
      const n = finiteNumber(cell?.raw);
      if (n == null) return null;
      return { index, n, abs: Math.abs(n) };
    })
    .filter(Boolean);
  if (scored.length < 2) return [];

  let best;
  if (better === 'max') {
    best = scored.reduce((a, b) => (b.n > a.n ? b : a));
  } else if (better === 'min') {
    best = scored.reduce((a, b) => (b.n < a.n ? b : a));
  } else if (better === 'minAbs') {
    best = scored.reduce((a, b) => (b.abs < a.abs ? b : a));
  } else {
    return [];
  }

  return scored.filter((item) => {
    if (better === 'max') return item.n === best.n;
    if (better === 'min') return item.n === best.n;
    return item.abs === best.abs;
  }).map((item) => item.index);
}

export function groupComparePkRows(rows = []) {
  const byGroup = new Map(PK_GROUPS.map((g) => [g.key, []]));
  rows.forEach((row) => {
    if (!byGroup.has(row.group)) byGroup.set(row.group, []);
    byGroup.get(row.group).push(row);
  });
  return PK_GROUPS
    .map((group) => ({
      ...group,
      rows: byGroup.get(group.key) || [],
    }))
    .filter((group) => group.rows.length > 0);
}

export function visiblePkGroups({ showLimits = false } = {}) {
  return PK_GROUPS.filter((group) => group.key !== PK_GROUP_LIMITS || showLimits);
}
