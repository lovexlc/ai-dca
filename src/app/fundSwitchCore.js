const FUND_SWITCH_EPSILON = 1e-6;
const DEFAULT_PAIR_THRESHOLD = 35;

export const FUND_SWITCH_STRATEGIES = ['trace', 'direct'];

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function toPositiveNumber(value) {
  return Math.max(Number(value) || 0, 0);
}

function normalizeCode(value = '') {
  return String(value || '').trim();
}

function addPositionShare(map, code, shares) {
  const normalizedCode = normalizeCode(code);
  const normalizedShares = Number(shares) || 0;
  if (!normalizedCode || normalizedShares <= FUND_SWITCH_EPSILON) {
    return;
  }

  map.set(normalizedCode, (map.get(normalizedCode) || 0) + normalizedShares);
}

function sortPositions(positions = []) {
  return [...positions].sort((left, right) => right.shares - left.shares || left.code.localeCompare(right.code));
}

function mapToPositions(positionMap) {
  return sortPositions(
    [...positionMap.entries()]
      .filter(([, shares]) => shares > FUND_SWITCH_EPSILON)
      .map(([code, shares]) => ({ code, shares: round(shares, 2) }))
  );
}

function sanitizePosition(position) {
  const code = normalizeCode(position?.code);
  const shares = round(toPositiveNumber(position?.shares), 2);
  if (!code || shares <= 0) {
    return null;
  }

  return { code, shares };
}

function sanitizePositions(positions, fallbackCode = '', fallbackShares = 0) {
  const nextPositions = Array.isArray(positions)
    ? positions.map((position) => sanitizePosition(position)).filter(Boolean)
    : [];

  if (nextPositions.length) {
    const positionMap = new Map();
    for (const position of nextPositions) {
      addPositionShare(positionMap, position.code, position.shares);
    }
    return mapToPositions(positionMap);
  }

  const fallbackPosition = sanitizePosition({ code: fallbackCode, shares: fallbackShares });
  return fallbackPosition ? [fallbackPosition] : [];
}

function sanitizePriceOverrides(priceOverrides = {}) {
  if (!priceOverrides || typeof priceOverrides !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(priceOverrides)
      .map(([code, value]) => [normalizeCode(code), round(toPositiveNumber(value), 4)])
      .filter(([code, value]) => code && value > 0)
  );
}

export function normalizeFundSwitchStrategy(value) {
  return value === 'direct' ? 'direct' : 'trace';
}

export function sanitizeFundSwitchComparison(comparison = {}) {
  const strategy = normalizeFundSwitchStrategy(comparison.strategy);
  const sourcePositions = sanitizePositions(comparison.sourcePositions, comparison.sourceCode, comparison.sourceSellShares);
  const targetPositions = sanitizePositions(comparison.targetPositions, comparison.targetCode, comparison.targetBuyShares);
  const priceOverrides = sanitizePriceOverrides(comparison.priceOverrides);
  const sourceSingle = sourcePositions.length === 1 ? sourcePositions[0] : null;
  const targetSingle = targetPositions.length === 1 ? targetPositions[0] : null;

  return {
    strategy,
    sourcePositions,
    targetPositions,
    priceOverrides,
    sourceCode: sourceSingle?.code || '',
    sourceSellShares: sourceSingle?.shares || 0,
    sourceCurrentPrice: sourceSingle ? round(toPositiveNumber(comparison.sourceCurrentPrice), 4) : 0,
    targetCode: targetSingle?.code || '',
    targetBuyShares: targetSingle?.shares || 0,
    targetCurrentPrice: targetSingle ? round(toPositiveNumber(comparison.targetCurrentPrice), 4) : 0,
    switchCost: round(toPositiveNumber(comparison.switchCost), 2),
    extraCash: round(toPositiveNumber(comparison.extraCash), 2),
    feeTradeCount: Math.max(Number(comparison.feeTradeCount) || 0, 0)
  };
}

export function getFundSwitchRowPrice(row) {
  if (row?.type === '卖出') {
    return round(toPositiveNumber(row?.sellPrice ?? row?.price), 4);
  }

  return round(toPositiveNumber(row?.buyPrice ?? row?.price), 4);
}

export function getFundSwitchRowAmount(row) {
  const explicitAmount = toPositiveNumber(row?.amount);
  if (explicitAmount > 0) {
    return round(explicitAmount, 2);
  }

  return round(getFundSwitchRowPrice(row) * toPositiveNumber(row?.shares), 2);
}

export function sanitizeFundSwitchRow(row, index = 0, { idPrefix = 'switch' } = {}) {
  const type = row?.type === '卖出' ? '卖出' : '买入';
  const legacyPrice = toPositiveNumber(row?.price);
  const buyPrice = round(toPositiveNumber(row?.buyPrice ?? (type === '买入' ? legacyPrice : 0)), 4);
  const sellPrice = round(toPositiveNumber(row?.sellPrice ?? (type === '卖出' ? legacyPrice : 0)), 4);
  const shares = round(toPositiveNumber(row?.shares), 2);
  const price = type === '卖出' ? sellPrice : buyPrice;
  const amount = round(toPositiveNumber(row?.amount) || (price * shares), 2);

  return {
    id: row?.id || `${idPrefix}-${index + 1}`,
    date: String(row?.date || '').trim(),
    code: normalizeCode(row?.code),
    type,
    buyPrice,
    sellPrice,
    price,
    shares,
    amount,
    _originalIndex: index
  };
}

export function sanitizeFundSwitchRows(rows = [], { filterInvalid = false, idPrefix = 'switch' } = {}) {
  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row, index) => sanitizeFundSwitchRow(row, index, { idPrefix }));
  if (!filterInvalid) {
    return normalizedRows;
  }

  return normalizedRows.filter((row) => row.code && row.type && row.price > 0 && row.shares > 0);
}

function getRowTimestamp(row) {
  if (!row?.date) {
    return Number.NaN;
  }

  const timestamp = Date.parse(String(row.date).replace(' ', 'T'));
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function compareRows(left, right) {
  const leftTimestamp = getRowTimestamp(left);
  const rightTimestamp = getRowTimestamp(right);

  if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp) && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }

  if (Number.isFinite(leftTimestamp) && !Number.isFinite(rightTimestamp)) {
    return -1;
  }

  if (!Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp)) {
    return 1;
  }

  return (left._originalIndex ?? 0) - (right._originalIndex ?? 0);
}

function evaluatePairScore(sell, buy) {
  if (!sell || !buy || sell.type !== '卖出' || buy.type !== '买入' || sell.code === buy.code) {
    return null;
  }

  const sellAmount = getFundSwitchRowAmount(sell);
  const buyAmount = getFundSwitchRowAmount(buy);
  const relativeAmountGap = Math.abs(sellAmount - buyAmount) / Math.max(sellAmount, buyAmount, 1);
  const orderGap = Math.max((buy._sortIndex ?? 0) - (sell._sortIndex ?? 0), 0);
  const sellTimestamp = getRowTimestamp(sell);
  const buyTimestamp = getRowTimestamp(buy);
  const timeGapHours = Number.isFinite(sellTimestamp) && Number.isFinite(buyTimestamp)
    ? Math.abs(buyTimestamp - sellTimestamp) / (60 * 60 * 1000)
    : orderGap * 4;
  const backwardsPenalty = Number.isFinite(sellTimestamp) && Number.isFinite(buyTimestamp) && buyTimestamp < sellTimestamp ? 12 : 0;
  const score = (relativeAmountGap * 120) + (orderGap * 4) + (timeGapHours * 0.15) + backwardsPenalty;

  return {
    sellAmount,
    buyAmount,
    relativeAmountGap,
    orderGap,
    timeGapHours,
    score
  };
}

function canAcceptPair(measurement) {
  if (!measurement) {
    return false;
  }

  if (measurement.score <= DEFAULT_PAIR_THRESHOLD) {
    return true;
  }

  return measurement.relativeAmountGap <= 0.08 && measurement.orderGap <= 3;
}

export function pairFundSwitchRows(rows = []) {
  const orderedRows = sanitizeFundSwitchRows(rows, { filterInvalid: true })
    .slice()
    .sort(compareRows)
    .map((row, index) => ({ ...row, _sortIndex: index }));

  const pendingSells = [];
  const pairedSellIds = new Set();
  const buyEventMap = new Map();
  const switchEvents = [];
  const unmatchedBuys = [];

  for (const row of orderedRows) {
    if (row.type === '卖出') {
      pendingSells.push(row);
      continue;
    }

    let bestMatch = null;

    for (let index = 0; index < pendingSells.length; index += 1) {
      const sell = pendingSells[index];
      const measurement = evaluatePairScore(sell, row);
      if (!measurement) {
        continue;
      }

      if (!bestMatch || measurement.score < bestMatch.measurement.score) {
        bestMatch = { index, sell, measurement };
      }
    }

    if (!bestMatch || !canAcceptPair(bestMatch.measurement)) {
      unmatchedBuys.push(row);
      continue;
    }

    pendingSells.splice(bestMatch.index, 1);
    pairedSellIds.add(bestMatch.sell.id);

    const event = {
      id: `switch-event-${switchEvents.length + 1}`,
      sell: bestMatch.sell,
      buy: row,
      sellAmount: round(bestMatch.measurement.sellAmount, 2),
      buyAmount: round(bestMatch.measurement.buyAmount, 2),
      extraCash: round(Math.max(bestMatch.measurement.buyAmount - bestMatch.measurement.sellAmount, 0), 2),
      score: round(bestMatch.measurement.score, 4),
      relativeAmountGap: round(bestMatch.measurement.relativeAmountGap, 6),
      orderGap: bestMatch.measurement.orderGap,
      timeGapHours: round(bestMatch.measurement.timeGapHours, 2)
    };

    switchEvents.push(event);
    buyEventMap.set(row.id, event);
  }

  return {
    orderedRows,
    switchEvents,
    buyEventMap,
    pairedSellIds,
    unmatchedBuys,
    unmatchedSells: pendingSells
  };
}

function createOriginMap(code, shares) {
  const originMap = new Map();
  addPositionShare(originMap, code, shares);
  return originMap;
}

function mergeOriginMaps(targetMap, sourceMap) {
  for (const [code, shares] of sourceMap.entries()) {
    addPositionShare(targetMap, code, shares);
  }
}

function splitOriginMap(originMap, ratio) {
  const consumedMap = new Map();

  for (const [code, shares] of originMap.entries()) {
    const consumedShares = shares * ratio;
    const remainingShares = shares - consumedShares;

    if (consumedShares > FUND_SWITCH_EPSILON) {
      consumedMap.set(code, consumedShares);
    }

    if (remainingShares > FUND_SWITCH_EPSILON) {
      originMap.set(code, remainingShares);
    } else {
      originMap.delete(code);
    }
  }

  return consumedMap;
}

function pruneLots(lots = []) {
  return lots.filter((lot) => lot.remainingShares > FUND_SWITCH_EPSILON);
}

function addLotToInventory(lotsByCode, lot) {
  if (!lot || !lot.code || lot.remainingShares <= FUND_SWITCH_EPSILON) {
    return;
  }

  const currentLots = lotsByCode.get(lot.code) || [];
  currentLots.push(lot);
  lotsByCode.set(lot.code, currentLots);
}

function consumeInventory(lotsByCode, code, shares) {
  const currentLots = lotsByCode.get(code) || [];
  let remainingShares = shares;
  let tracedExtraCash = 0;
  const tracedOrigins = new Map();

  for (const lot of currentLots) {
    if (remainingShares <= FUND_SWITCH_EPSILON) {
      break;
    }

    const availableShares = lot.remainingShares;
    if (availableShares <= FUND_SWITCH_EPSILON) {
      continue;
    }

    const consumedShares = Math.min(availableShares, remainingShares);
    const ratio = consumedShares / availableShares;
    const consumedCost = lot.remainingCost * ratio;
    const consumedDirectExtraCash = lot.directExtraCash * ratio;
    const consumedTracedExtraCash = lot.tracedExtraCash * ratio;

    splitOriginMap(lot.directOrigins, ratio);
    const consumedTracedOrigins = splitOriginMap(lot.tracedOrigins, ratio);

    lot.remainingShares = round(Math.max(lot.remainingShares - consumedShares, 0), 6);
    lot.remainingCost = round(Math.max(lot.remainingCost - consumedCost, 0), 6);
    lot.directExtraCash = round(Math.max(lot.directExtraCash - consumedDirectExtraCash, 0), 6);
    lot.tracedExtraCash = round(Math.max(lot.tracedExtraCash - consumedTracedExtraCash, 0), 6);

    mergeOriginMaps(tracedOrigins, consumedTracedOrigins);
    tracedExtraCash += consumedTracedExtraCash;
    remainingShares -= consumedShares;
  }

  const nextLots = pruneLots(currentLots);
  if (nextLots.length) {
    lotsByCode.set(code, nextLots);
  } else {
    lotsByCode.delete(code);
  }

  if (remainingShares > FUND_SWITCH_EPSILON) {
    addPositionShare(tracedOrigins, code, remainingShares);
  }

  return {
    tracedOrigins,
    tracedExtraCash: round(tracedExtraCash, 6)
  };
}

function createStandaloneLot(row, index) {
  const originMap = createOriginMap(row.code, row.shares);

  return {
    id: `standalone-lot-${index + 1}`,
    code: row.code,
    isSwitchDerived: false,
    remainingShares: row.shares,
    remainingCost: row.amount,
    directOrigins: new Map(originMap),
    tracedOrigins: new Map(originMap),
    directExtraCash: 0,
    tracedExtraCash: 0
  };
}

function createSwitchLot(event, inventorySnapshot, index) {
  return {
    id: `switch-lot-${index + 1}`,
    code: event.buy.code,
    isSwitchDerived: true,
    remainingShares: event.buy.shares,
    remainingCost: event.buyAmount,
    directOrigins: createOriginMap(event.sell.code, event.sell.shares),
    tracedOrigins: new Map(inventorySnapshot.tracedOrigins),
    directExtraCash: event.extraCash,
    tracedExtraCash: round(event.extraCash + inventorySnapshot.tracedExtraCash, 6)
  };
}

export function replayFundSwitchRows(rows = []) {
  const pairing = pairFundSwitchRows(rows);
  const lotsByCode = new Map();
  const allLots = [];

  for (const row of pairing.orderedRows) {
    if (row.type === '卖出') {
      if (pairing.pairedSellIds.has(row.id)) {
        continue;
      }

      consumeInventory(lotsByCode, row.code, row.shares);
      continue;
    }

    const matchedEvent = pairing.buyEventMap.get(row.id);
    const nextLot = matchedEvent
      ? createSwitchLot(matchedEvent, consumeInventory(lotsByCode, matchedEvent.sell.code, matchedEvent.sell.shares), allLots.length)
      : createStandaloneLot(row, allLots.length);

    addLotToInventory(lotsByCode, nextLot);
    allLots.push(nextLot);
  }

  return {
    ...pairing,
    currentLots: [...lotsByCode.values()].flat().filter((lot) => lot.remainingShares > FUND_SWITCH_EPSILON)
  };
}

function buildPositionsFromLots(lots, strategy) {
  const switchedLots = lots.filter((lot) => lot?.isSwitchDerived);
  const targetPositionMap = new Map();
  const sourcePositionMap = new Map();
  let switchCost = 0;
  let extraCash = 0;
  const originKey = strategy === 'trace' ? 'tracedOrigins' : 'directOrigins';
  const extraCashKey = strategy === 'trace' ? 'tracedExtraCash' : 'directExtraCash';

  for (const lot of switchedLots) {
    addPositionShare(targetPositionMap, lot.code, lot.remainingShares);
    mergeOriginMaps(sourcePositionMap, lot[originKey]);
    switchCost += lot.remainingCost;
    extraCash += lot[extraCashKey];
  }

  return {
    sourcePositions: mapToPositions(sourcePositionMap),
    targetPositions: mapToPositions(targetPositionMap),
    switchCost: round(switchCost, 2),
    extraCash: round(extraCash, 2)
  };
}

export function deriveFundSwitchComparison(rows = [], comparison = {}, strategyOverride) {
  const baseComparison = sanitizeFundSwitchComparison(comparison);
  const strategy = normalizeFundSwitchStrategy(strategyOverride ?? baseComparison.strategy);
  const normalizedRows = sanitizeFundSwitchRows(rows, { filterInvalid: true });
  const replay = replayFundSwitchRows(normalizedRows);
  const derivedPositions = buildPositionsFromLots(replay.currentLots, strategy);

  return sanitizeFundSwitchComparison({
    ...baseComparison,
    strategy,
    sourcePositions: derivedPositions.sourcePositions,
    targetPositions: derivedPositions.targetPositions,
    switchCost: derivedPositions.switchCost,
    extraCash: derivedPositions.extraCash,
    feeTradeCount: normalizedRows.length
  });
}

export function resolveFundSwitchPositionPrice(code, kind, comparison, getCurrentPrice) {
  const marketPrice = round(toPositiveNumber(getCurrentPrice?.(code, kind)), 4);
  if (marketPrice > 0) {
    return marketPrice;
  }

  const overridePrice = round(toPositiveNumber(comparison?.priceOverrides?.[code]), 4);
  if (overridePrice > 0) {
    return overridePrice;
  }

  if (kind === 'source' && comparison?.sourcePositions?.length === 1 && comparison.sourceCode === code) {
    return round(toPositiveNumber(comparison.sourceCurrentPrice), 4);
  }

  if (kind === 'target' && comparison?.targetPositions?.length === 1 && comparison.targetCode === code) {
    return round(toPositiveNumber(comparison.targetCurrentPrice), 4);
  }

  return 0;
}

export function buildFundSwitchPositionMetrics(positions, kind, comparison, getCurrentPrice) {
  return sortPositions(
    positions.map((position) => {
      const currentPrice = resolveFundSwitchPositionPrice(position.code, kind, comparison, getCurrentPrice);
      return {
        ...position,
        currentPrice,
        marketValue: round(position.shares * currentPrice, 2)
      };
    })
  );
}
