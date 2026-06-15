/**
 * 订单生成逻辑 - 修正版
 * 解决原版的买卖金额不匹配、约束不合理等问题
 */

import { clampNumber, roundTo, premiumPct } from './quantTrading.js';

/**
 * 修正版：构建订单计划
 */
export function buildOrderPlanV2(state) {
  const { account, strategy, quotes } = state;
  const sellQuote = quotes[strategy.sellSymbol];
  const buyQuote = quotes[strategy.buySymbol];

  // 1. 计算信号
  const signal = evaluatePremiumSpreadV2(state);

  // 2. 如果信号不是switch，直接返回
  if (signal.action !== 'switch') {
    return {
      signal,
      canTrade: false,
      rejectReason: signal.reason,
      sell: null,
      buy: null,
      totalFee: 0,
      estimatedCapture: 0,
      estimatedCaptureDetails: {}
    };
  }

  // 3. 验证数据完整性
  const validation = validateQuotes(sellQuote, buyQuote, account.positions[strategy.sellSymbol]);
  if (!validation.valid) {
    return {
      signal,
      canTrade: false,
      rejectReason: validation.reason,
      sell: null,
      buy: null,
      totalFee: 0,
      estimatedCapture: 0
    };
  }

  // 4. 计算价格（考虑滑点）
  const tickSize = account.tickSize;
  const slip = account.slippageTicks * tickSize;

  const sellPrice = roundPriceToTick(sellQuote.bid - slip, tickSize);
  const buyPrice = roundPriceToTick(buyQuote.ask + slip, tickSize);

  // 5. 计算卖出数量（目标：卖出足够的金额来支持买入）
  const sellPosition = account.positions[strategy.sellSymbol];
  const targetSwitchAmount = strategy.maxOrderCash; // 目标切换金额

  // 卖出约束：持仓、对手盘深度、目标金额
  const maxSellByPosition = sellPosition.shares;
  const maxSellByDepth = sellQuote.bidSize * 0.3; // 只用30%深度，避免冲击成本
  const maxSellByAmount = targetSwitchAmount / sellPrice;

  const sellQuantity = floorToLot(
    Math.min(maxSellByPosition, maxSellByDepth, maxSellByAmount),
    strategy.lotSize
  );

  const sellAmount = roundTo(sellQuantity * sellPrice, 2);
  const sellFee = calcFee(sellAmount, account);
  const sellNet = roundTo(sellAmount - sellFee, 2);

  // 6. 计算买入数量（用卖出所得，实现真正的"切换"）
  // 修正：不再受maxOrderCash限制，而是用实际卖出所得
  const buyBudget = sellNet; // 关键修正点

  const maxBuyByBudget = buyBudget / buyPrice;
  const maxBuyByDepth = buyQuote.askSize * 0.3;

  const buyQuantity = floorToLot(
    Math.min(maxBuyByBudget, maxBuyByDepth),
    strategy.lotSize
  );

  const buyAmount = roundTo(buyQuantity * buyPrice, 2);
  const buyFee = calcFee(buyAmount, account);
  const buyTotal = roundTo(buyAmount + buyFee, 2);

  // 7. 最终可行性检查
  const canTrade = sellQuantity > 0
    && buyQuantity > 0
    && sellAmount >= strategy.minOrderCash
    && buyAmount >= strategy.minOrderCash
    && buyTotal <= account.cash + sellNet; // 确保现金足够

  // 8. 计算预估收益（修正版）
  const captureDetails = calculateEstimatedCapture({
    sellQuantity,
    sellPrice,
    sellIOPV: sellQuote.iopv,
    buyQuantity,
    buyPrice,
    buyIOPV: buyQuote.iopv,
    totalFee: sellFee + buyFee
  });

  return {
    signal,
    canTrade,
    rejectReason: canTrade ? '' : deriveRejectReason(sellQuantity, buyQuantity, sellAmount, buyAmount, strategy),
    sell: {
      side: 'SELL',
      symbol: strategy.sellSymbol,
      name: sellQuote.name || strategy.sellSymbol,
      price: sellPrice,
      quantity: sellQuantity,
      amount: sellAmount,
      fee: sellFee,
      netProceeds: sellNet
    },
    buy: {
      side: 'BUY',
      symbol: strategy.buySymbol,
      name: buyQuote.name || strategy.buySymbol,
      price: buyPrice,
      quantity: buyQuantity,
      amount: buyAmount,
      fee: buyFee,
      totalCost: buyTotal
    },
    totalFee: roundTo(sellFee + buyFee, 2),
    estimatedCapture: captureDetails.netCapture,
    estimatedCaptureDetails: captureDetails
  };
}

/**
 * 修正版：评估溢价差信号（增强风控）
 */
function evaluatePremiumSpreadV2(state) {
  const { strategy, quotes } = state;
  const sellQuote = quotes[strategy.sellSymbol];
  const buyQuote = quotes[strategy.buySymbol];

  const sellPremiumPct = premiumPct(sellQuote?.bid, sellQuote?.iopv);
  const buyPremiumPct = premiumPct(buyQuote?.ask, buyQuote?.iopv);
  const rawSpreadPct = sellPremiumPct - buyPremiumPct;
  const netSpreadPct = rawSpreadPct - strategy.feeBufferPct;

  // 数据有效性检查
  const hasValidQuotes =
    sellQuote?.bid > 0 &&
    sellQuote?.iopv > 0 &&
    buyQuote?.ask > 0 &&
    buyQuote?.iopv > 0;

  if (!hasValidQuotes) {
    return {
      action: 'wait',
      reason: '盘口或 IOPV 数据不完整',
      sellPremiumPct: roundTo(sellPremiumPct, 4),
      buyPremiumPct: roundTo(buyPremiumPct, 4),
      rawSpreadPct: roundTo(rawSpreadPct, 4),
      netSpreadPct: roundTo(netSpreadPct, 4),
      triggerSpreadPct: strategy.triggerSpreadPct,
      riskFlags: ['INVALID_DATA']
    };
  }

  // 风控检查
  const riskFlags = [];

  // 1. 极端溢价率熔断
  if (Math.abs(sellPremiumPct) > 5 || Math.abs(buyPremiumPct) > 5) {
    riskFlags.push('EXTREME_PREMIUM');
  }

  // 2. IOPV比例异常检查（基差风险）
  const iopvRatio = sellQuote.iopv / buyQuote.iopv;
  const expectedRatio = 1.18; // 159513科技指数vs513100完整指数的历史比例
  const ratioDiff = Math.abs(iopvRatio - expectedRatio) / expectedRatio;
  if (ratioDiff > 0.05) { // 偏离超过5%
    riskFlags.push('IOPV_RATIO_ABNORMAL');
  }

  // 3. 盘口深度不足预警
  if (sellQuote.bidSize < 10000 || buyQuote.askSize < 10000) {
    riskFlags.push('LOW_LIQUIDITY');
  }

  // 4. 溢价差回归风险（卖出标的溢价率为负）
  if (sellPremiumPct < -0.5) {
    riskFlags.push('NEGATIVE_SELL_PREMIUM');
  }

  // 判断动作
  const action = netSpreadPct >= strategy.triggerSpreadPct && riskFlags.length === 0
    ? 'switch'
    : 'wait';

  const reason = deriveSignalReason(action, netSpreadPct, strategy, riskFlags);

  return {
    action,
    reason,
    sellPremiumPct: roundTo(sellPremiumPct, 4),
    buyPremiumPct: roundTo(buyPremiumPct, 4),
    rawSpreadPct: roundTo(rawSpreadPct, 4),
    netSpreadPct: roundTo(netSpreadPct, 4),
    triggerSpreadPct: strategy.triggerSpreadPct,
    closeSpreadPct: strategy.closeSpreadPct,
    riskFlags,
    iopvRatio: roundTo(iopvRatio, 4),
    expectedIopvRatio: expectedRatio
  };
}

/**
 * 修正版：计算预估收益
 *
 * 收益来源：
 * 1. 卖出标的的溢价变现（如果溢价率为正）
 * 2. 买入标的的溢价成本（如果溢价率为负则是收益）
 * 3. 扣除手续费
 */
function calculateEstimatedCapture(params) {
  const {
    sellQuantity,
    sellPrice,
    sellIOPV,
    buyQuantity,
    buyPrice,
    buyIOPV,
    totalFee
  } = params;

  // 卖出相对IOPV的超额收益
  const sellPremiumValue = sellQuantity * (sellPrice - sellIOPV);

  // 买入相对IOPV的超额成本
  const buyPremiumCost = buyQuantity * (buyPrice - buyIOPV);

  // 净收益 = 卖出溢价 - 买入溢价成本 - 手续费
  const grossCapture = sellPremiumValue - buyPremiumCost;
  const netCapture = roundTo(grossCapture - totalFee, 2);

  // 计算收益率（相对于交易金额）
  const tradeAmount = Math.min(sellQuantity * sellPrice, buyQuantity * buyPrice);
  const captureRatePct = tradeAmount > 0 ? roundTo((netCapture / tradeAmount) * 100, 4) : 0;

  return {
    sellPremiumValue: roundTo(sellPremiumValue, 2),
    buyPremiumCost: roundTo(buyPremiumCost, 2),
    grossCapture: roundTo(grossCapture, 2),
    totalFee: roundTo(totalFee, 2),
    netCapture,
    captureRatePct,
    explanation: `卖出溢价 ${roundTo(sellPremiumValue, 2)}元 - 买入溢价成本 ${roundTo(buyPremiumCost, 2)}元 - 手续费 ${roundTo(totalFee, 2)}元`
  };
}

/**
 * 验证行情数据
 */
function validateQuotes(sellQuote, buyQuote, sellPosition) {
  if (!sellQuote || !buyQuote) {
    return { valid: false, reason: '行情数据缺失' };
  }

  if (!sellPosition || sellPosition.shares <= 0) {
    return { valid: false, reason: '无可卖持仓' };
  }

  if (sellQuote.bid <= 0 || sellQuote.iopv <= 0) {
    return { valid: false, reason: '卖出标的数据无效' };
  }

  if (buyQuote.ask <= 0 || buyQuote.iopv <= 0) {
    return { valid: false, reason: '买入标的数据无效' };
  }

  return { valid: true };
}

/**
 * 推导拒绝原因
 */
function deriveRejectReason(sellQty, buyQty, sellAmt, buyAmt, strategy) {
  if (sellQty <= 0) {
    return '可卖持仓或卖一深度不足';
  }
  if (buyQty <= 0) {
    return '买一深度不足或卖出所得无法买入';
  }
  if (sellAmt < strategy.minOrderCash) {
    return `卖出金额 ${roundTo(sellAmt, 2)}元 低于最小交易额 ${strategy.minOrderCash}元`;
  }
  if (buyAmt < strategy.minOrderCash) {
    return `买入金额 ${roundTo(buyAmt, 2)}元 低于最小交易额 ${strategy.minOrderCash}元`;
  }
  return '订单验证失败';
}

/**
 * 推导信号原因
 */
function deriveSignalReason(action, netSpread, strategy, riskFlags) {
  if (riskFlags.includes('EXTREME_PREMIUM')) {
    return '极端溢价率，疑似数据异常';
  }
  if (riskFlags.includes('IOPV_RATIO_ABNORMAL')) {
    return 'IOPV比例异常，基差风险过高';
  }
  if (riskFlags.includes('LOW_LIQUIDITY')) {
    return '盘口深度不足，冲击成本风险';
  }
  if (riskFlags.includes('NEGATIVE_SELL_PREMIUM')) {
    return '卖出标的折价过高，不宜卖出';
  }

  if (action === 'switch') {
    return `净差价 ${roundTo(netSpread, 2)}% 达到触发线`;
  }

  if (netSpread <= strategy.closeSpreadPct) {
    return '差价低于观察线';
  }

  return `净差价 ${roundTo(netSpread, 2)}% 未达触发线 ${strategy.triggerSpreadPct}%`;
}

/**
 * 工具函数
 */
function roundPriceToTick(price, tickSize) {
  const tick = Math.max(0.0001, clampNumber(tickSize, 0.001));
  return Math.max(tick, roundTo(Math.round(clampNumber(price, 0) / tick) * tick, 4));
}

function floorToLot(quantity, lotSize) {
  const lot = Math.max(1, Math.floor(clampNumber(lotSize, 1)));
  return Math.floor(Math.max(0, clampNumber(quantity, 0)) / lot) * lot;
}

function calcFee(amount, account) {
  if (amount <= 0) return 0;
  const raw = amount * (Math.max(0, clampNumber(account.feeRate, 0)) / 100);
  return roundTo(Math.max(raw, Math.max(0, clampNumber(account.minFee, 0))), 2);
}
