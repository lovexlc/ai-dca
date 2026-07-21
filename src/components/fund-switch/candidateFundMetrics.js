import { estimateSwitchCost, normalizeFeeConfig } from '../../app/switchRuleModel.js';

export const ETF_LOT_SIZE = 100;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  const number = finiteNumber(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

function floorToLot(shares, lotSize = ETF_LOT_SIZE) {
  const value = finiteNumber(shares);
  if (value === null || value < lotSize) return 0;
  return Math.floor(value / lotSize) * lotSize;
}

function feeForAmount(feeConfig, amount, side) {
  const fee = normalizeFeeConfig(feeConfig);
  const value = Math.max(0, finiteNumber(amount) || 0);
  if (fee.mode === 'estimated_total') return 0;
  const rate = side === 'sell' ? fee.sellCommissionRate : fee.buyCommissionRate;
  return Math.max(fee.minimumCommission, (value * rate) / 100);
}

export function formatTurnover(value) {
  const number = finiteNumber(value);
  if (number === null || number < 0) return '暂无';
  if (number >= 100000000) return `¥${(number / 100000000).toFixed(2)}亿`;
  if (number >= 10000) return `¥${(number / 10000).toFixed(1)}万`;
  return `¥${Math.round(number).toLocaleString('zh-CN')}`;
}

export function formatShares(value) {
  const number = finiteNumber(value);
  return number === null ? '暂无' : Math.max(0, Math.round(number)).toLocaleString('zh-CN');
}

export function addYtdRanks(candidates = []) {
  const valid = (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => ({
      code: String(candidate?.code || index),
      value: finiteNumber(candidate?.ytdReturnPct ?? candidate?.ytdReturn)
    }))
    .filter((item) => item.value !== null)
    .sort((a, b) => b.value - a.value);
  const rankByCode = new Map(valid.map((item, index) => [item.code, index + 1]));
  return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => {
    const code = String(candidate?.code || index);
    const value = finiteNumber(candidate?.ytdReturnPct ?? candidate?.ytdReturn);
    return {
      ...candidate,
      ytdReturnPct: value,
      ytdRank: rankByCode.get(code) || null,
      ytdRankTotal: valid.length || null
    };
  });
}

export function calculateCandidateTradeMetrics({
  candidate = {},
  feeConfig = {},
  holdingQuantity = 0,
  holdingNotional = 0,
  holdingPrice = 0,
  lotSize = ETF_LOT_SIZE
} = {}) {
  const fee = normalizeFeeConfig(feeConfig);
  const quantity = Math.max(0, finiteNumber(holdingQuantity) || 0);
  const candidatePrice = finiteNumber(candidate?.price ?? candidate?.currentPrice);
  const resolvedHoldingPriceValue = finiteNumber(holdingPrice);
  const resolvedHoldingPrice = resolvedHoldingPriceValue !== null && resolvedHoldingPriceValue > 0
    ? resolvedHoldingPriceValue
    : null;
  const savedNotional = Math.max(0, finiteNumber(holdingNotional) || 0);
  const sellShares = floorToLot(quantity, lotSize);
  const sellAmount = resolvedHoldingPrice !== null && sellShares > 0
    ? sellShares * resolvedHoldingPrice
    : savedNotional > 0
      ? savedNotional * (sellShares > 0 && quantity > 0 ? sellShares / quantity : 1)
      : 0;

  if (!(sellAmount > 0) || !(candidatePrice > 0)) {
    return {
      sellShares: sellShares || null,
      sellLots: sellShares ? sellShares / lotSize : null,
      buyShares: null,
      buyLots: null,
      sellAmount: sellAmount > 0 ? round(sellAmount) : null,
      buyAmount: null,
      fee: fee.mode === 'estimated_total' ? round(fee.estimatedTotalFee) : null,
      feeBreakdown: null
    };
  }

  if (fee.mode === 'estimated_total') {
    const available = Math.max(0, sellAmount - fee.estimatedTotalFee);
    const buyShares = floorToLot(available / candidatePrice, lotSize);
    return {
      sellShares,
      sellLots: sellShares / lotSize,
      buyShares,
      buyLots: buyShares / lotSize,
      sellAmount: round(sellAmount),
      buyAmount: round(buyShares * candidatePrice),
      fee: round(fee.estimatedTotalFee),
      feeBreakdown: { sell: 0, buy: 0, other: 0 }
    };
  }

  const sellFee = feeForAmount(fee, sellAmount, 'sell');
  const availableForBuy = Math.max(0, sellAmount - sellFee - fee.otherFee);
  let buyShares = floorToLot(availableForBuy / candidatePrice, lotSize);
  let buyAmount = buyShares * candidatePrice;
  let buyFee = feeForAmount(fee, buyAmount, 'buy');
  while (buyShares >= lotSize && buyAmount + buyFee > availableForBuy) {
    buyShares -= lotSize;
    buyAmount = buyShares * candidatePrice;
    buyFee = feeForAmount(fee, buyAmount, 'buy');
  }

  const totalFee = sellFee + buyFee + fee.otherFee;
  return {
    sellShares,
    sellLots: sellShares / lotSize,
    buyShares,
    buyLots: buyShares / lotSize,
    sellAmount: round(sellAmount),
    buyAmount: round(buyAmount),
    fee: round(totalFee),
    feeBreakdown: {
      sell: round(sellFee),
      buy: round(buyFee),
      other: round(fee.otherFee)
    }
  };
}

export function candidateDecision(candidate = {}) {
  const rawStatus = String(candidate?.status || '').toLowerCase();
  if (['better', 'reached', 'triggered'].includes(rawStatus)) return 'switchable';
  if (['near', 'near_trigger'].includes(rawStatus)) return 'near';
  if (['no_data', 'pending'].includes(rawStatus)) return 'unknown';
  return 'wait';
}

export function candidateSuggestion(candidate = {}, { distancePct = null } = {}) {
  const decision = candidateDecision(candidate);
  if (decision === 'switchable') return '建议：可切换，当前优势已达到提醒条件';
  if (decision === 'near') {
    const distance = finiteNumber(distancePct ?? candidate?.distancePct);
    return distance === null
      ? '建议：继续观察，已经接近提醒条件'
      : `建议：继续观察，还差 ${distance.toFixed(2)}%`;
  }
  if (decision === 'unknown') return '建议：等待行情数据后再判断';
  return '建议：暂不切换，当前优势不足';
}

export function candidateEstimatedFee(feeConfig, holdingNotional) {
  const value = finiteNumber(holdingNotional);
  return value !== null && value > 0 ? estimateSwitchCost(feeConfig, value) : null;
}
