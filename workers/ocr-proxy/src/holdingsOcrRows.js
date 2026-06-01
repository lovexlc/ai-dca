import {
  getHoldingRowErrors,
  hasMeaningfulHoldingRow,
  isHoldingCode,
  normalizeHoldingRow,
  round as roundHolding,
  sanitizeHoldingRows as sanitizeHoldingRowsCore
} from '../../../src/app/holdingsCore.js';
import {
  extractVisibleHoldingCode,
  resolveFundByCode,
  resolveFundCodeByName
} from './fundCatalog.js';

function normalizeText(value = '') {
  return String(value)
    .replace(/\u3000/g, ' ')
    .replace(/[，]/g, ',')
    .replace(/[：]/g, ':')
    .replace(/[．·•]/g, '.')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDate(rawValue = '') {
  const text = normalizeText(rawValue).replace(/[一]/g, '-');
  const separated = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (separated) {
    const [, year, month, day, hour, minute, second] = separated;
    const date = [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
    if (!hour || !minute) {
      return date;
    }

    return `${date} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${(second || '00').padStart(2, '0')}`;
  }

  const compact = text.match(/(20\d{2})(\d{2})(\d{2})(?:\s?(\d{2}):?(\d{2}):?(\d{2}))?/);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    const date = `${year}-${month}-${day}`;
    if (!hour || !minute || !second) {
      return date;
    }

    return `${date} ${hour}:${minute}:${second}`;
  }

  return text;
}

function buildHoldingRowId(index) {
  return `holding-import-${Date.now()}-${index + 1}`;
}

function hasNumericInput(value) {
  return !(value == null || String(value).trim() === '');
}

function parseScaledNumber(value, precision = 4, { allowNegative = false } = {}) {
  if (!hasNumericInput(value)) {
    return 0;
  }

  const rawText = String(value).trim();
  let scale = 1;
  if (rawText.includes('亿')) {
    scale = 100000000;
  } else if (rawText.includes('万')) {
    scale = 10000;
  }

  const normalized = rawText
    .replace(/[,\s]/g, '')
    .replace(/[¥￥元份]/g, '')
    .replace(/[亿万]/g, '')
    .trim();
  const numericValue = Number(normalized);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  if (!allowNegative && numericValue <= 0) {
    return 0;
  }

  return roundHolding(numericValue * scale, precision);
}

function parsePositiveNumber(value, precision = 4) {
  return parseScaledNumber(value, precision, { allowNegative: false });
}

function parseSignedNumber(value, precision = 2) {
  return parseScaledNumber(value, precision, { allowNegative: true });
}

function normalizeHoldingExtractionRow(row = {}, index = 0) {
  const rawCode = row?.code ?? row?.fundCode ?? row?.fund_code ?? '';
  const rawName = row?.name ?? row?.fundName ?? row?.holdingName ?? row?.title ?? '';
  const rawAvgCost = row?.avgCost ?? row?.averageCost ?? row?.buyPrice ?? row?.costPrice ?? row?.cost ?? '';
  const rawMarketValue = row?.marketValue ?? row?.holdingAmount ?? row?.amount ?? row?.assetValue ?? row?.market_amount ?? '';
  const rawHoldingProfit = row?.holdingProfit ?? row?.profit ?? row?.profitAmount ?? row?.income ?? row?.holding_income ?? '';
  const rawShares = row?.shares ?? row?.units ?? row?.holdingShares ?? row?.holdingUnits ?? row?.positionShares ?? '';
  const rawUnitNav = row?.unitNav ?? row?.nav ?? row?.latestNav ?? row?.netValue ?? row?.unitNetValue ?? '';
  const rawUnitNavDate = row?.unitNavDate ?? row?.navDate ?? row?.latestNavDate ?? row?.netValueDate ?? '';

  return {
    id: normalizeText(row?.id) || buildHoldingRowId(index),
    code: extractVisibleHoldingCode(rawCode),
    name: normalizeText(rawName),
    avgCost: parsePositiveNumber(rawAvgCost, 4),
    hasAvgCost: hasNumericInput(rawAvgCost),
    marketValue: parsePositiveNumber(rawMarketValue, 2),
    hasMarketValue: hasNumericInput(rawMarketValue),
    holdingProfit: parseSignedNumber(rawHoldingProfit, 2),
    hasHoldingProfit: hasNumericInput(rawHoldingProfit),
    shares: parsePositiveNumber(rawShares, 2),
    hasShares: hasNumericInput(rawShares),
    unitNav: parsePositiveNumber(rawUnitNav, 4),
    hasUnitNav: hasNumericInput(rawUnitNav),
    unitNavDate: normalizeDate(rawUnitNavDate || '')
  };
}

async function enrichHoldingExtractionRow(rawRow, { generatedAt = '', readFundNavSnapshot = null } = {}) {
  const warnings = [];
  const workingRow = normalizeHoldingExtractionRow(rawRow);

  let resolvedCode = workingRow.code;
  let resolvedName = workingRow.name;
  let resolvedAvgCost = workingRow.avgCost;
  let resolvedShares = workingRow.shares;
  let resolvedUnitNav = workingRow.unitNav;

  let catalogMatch = null;

  if (isHoldingCode(resolvedCode)) {
    try {
      catalogMatch = await resolveFundByCode(resolvedCode);
      if (catalogMatch?.name && (!resolvedName || resolvedName.includes('...') || resolvedName.includes('…'))) {
        resolvedName = catalogMatch.name;
      }
    } catch (error) {
      warnings.push(`代码 ${resolvedCode} 补全名称失败：${error instanceof Error ? error.message : '基金目录读取失败。'}`);
    }
  } else if (resolvedName) {
    try {
      catalogMatch = await resolveFundCodeByName(resolvedName);
      if (catalogMatch?.code) {
        resolvedCode = catalogMatch.code;
        if (catalogMatch.name) {
          resolvedName = catalogMatch.name;
        }
        if (catalogMatch.ambiguous) {
          warnings.push(`${resolvedName} 同名候选较多，已按猜测的份额类匹配代码 ${catalogMatch.code}，请核对。`);
        }
      } else {
        warnings.push(`${resolvedName} 未能匹配到唯一基金代码。`);
      }
    } catch (error) {
      warnings.push(`${resolvedName || '某一持仓行'} 基金代码补全失败：${error instanceof Error ? error.message : '基金目录读取失败。'}`);
    }
  }

  if (!(resolvedShares > 0) && workingRow.marketValue > 0 && workingRow.unitNav > 0) {
    resolvedShares = roundHolding(workingRow.marketValue / workingRow.unitNav, 2);
    warnings.push(`${resolvedName || resolvedCode || '某一持仓行'} 已按图片净值计算持仓份额。`);
  }

  if (!(resolvedShares > 0) && workingRow.marketValue > 0 && isHoldingCode(resolvedCode) && typeof readFundNavSnapshot === 'function') {
    try {
      const liveSnapshot = await readFundNavSnapshot(resolvedCode, generatedAt);
      if (liveSnapshot.latestNav > 0) {
        resolvedUnitNav = liveSnapshot.latestNav;
        resolvedShares = roundHolding(workingRow.marketValue / liveSnapshot.latestNav, 2);
        warnings.push(`${resolvedName || resolvedCode} 已按联网净值估算持仓份额。`);
      }
    } catch (error) {
      warnings.push(`${resolvedName || resolvedCode} 份额估算失败：${error instanceof Error ? error.message : '净值查询失败。'}`);
    }
  }

  if (!(resolvedAvgCost > 0) && workingRow.marketValue > 0 && resolvedShares > 0 && workingRow.hasHoldingProfit) {
    const costAmount = roundHolding(workingRow.marketValue - workingRow.holdingProfit, 2);
    if (costAmount > 0) {
      resolvedAvgCost = roundHolding(costAmount / resolvedShares, 4);
    }
  }

  const normalizedRow = normalizeHoldingRow({
    id: workingRow.id,
    code: resolvedCode,
    name: resolvedName || catalogMatch?.name || '',
    avgCost: resolvedAvgCost,
    shares: resolvedShares
  }, {
    idPrefix: 'holding-import'
  });

  return {
    row: normalizedRow,
    warnings
  };
}

function summarizeHoldingRowErrors(errors = {}) {
  return Object.values(errors).filter(Boolean).join(' ');
}

export async function sanitizeHoldingsRows(rows = [], options = {}) {
  const warnings = [];
  const enrichedRows = await Promise.all(
    (Array.isArray(rows) ? rows : []).map((row, index) => enrichHoldingExtractionRow({
      ...row,
      id: normalizeText(row?.id) || buildHoldingRowId(index)
    }, options))
  );

  const validRows = [];
  for (const item of enrichedRows) {
    warnings.push(...item.warnings.map((entry) => normalizeText(entry)).filter(Boolean));
    const row = item.row;

    if (!hasMeaningfulHoldingRow(row)) {
      continue;
    }

    const errors = getHoldingRowErrors(row);
    if (Object.keys(errors).length) {
      const label = row.code || row.name || '某一持仓行';
      warnings.push(`${label} ${summarizeHoldingRowErrors(errors)}`);
      // 仍把这行作为 partial draft 透传给前端，让用户在弹窗里手填缺失字段。
    }

    validRows.push(row);
  }

  return {
    // filterInvalid: false → 把 partial 行也透传出去（前端 modal 已支持逐行编辑 / 红色标记）。
    rows: sanitizeHoldingRowsCore(validRows, { filterInvalid: false, idPrefix: 'holding-import' }),
    warnings
  };
}

export function buildHoldingsPreviewLines(rows, warnings) {
  if (rows.length) {
    return rows.slice(0, 6).map((row) => `${row.code} | ${row.name || '未命名'} | ${row.avgCost} | ${row.shares}`);
  }

  return warnings.filter(Boolean).slice(0, 6);
}

export function scoreHoldingsConfidence(rows, warnings) {
  let score = rows.length * 0.22;
  score += rows.filter((row) => row.name).length * 0.04;
  score -= warnings.length * 0.06;
  return Math.round(Math.max(0.18, Math.min(score, 0.96)) * 100) / 100;
}
