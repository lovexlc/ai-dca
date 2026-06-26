/**
 * 交易模拟器 - 回测统一真源
 */

import { roundTo, clampNumber, firstPositiveNumber } from './math.js';

/**
 * 计算交易手续费
 * @param {number} amount - 交易金额
 * @param {number} feeRate - 费率（默认 0.001）
 * @param {number} minFee - 最小手续费（默认 0）
 * @returns {number} 手续费金额
 */
export function calcFee(amount, feeRate = 0.001, minFee = 0) {
  return Math.max(clampNumber(minFee, 0), amount * clampNumber(feeRate, 0.001));
}

/**
 * 解析卖出执行价格
 * @param {Object} bar - K线数据
 * @param {number} tickSize - 最小变动单位
 * @param {number} slippageTicks - 滑点跳数
 * @returns {Object} {price, priceSource}
 */
export function resolveSellExecutionPrice(bar, tickSize = 0.001, slippageTicks = 0, useQuotedPrices = true) {
  if (useQuotedPrices) {
    const quoted = firstPositiveNumber(
      bar?.bidPrice, bar?.bid, bar?.bp1, bar?.bid1, bar?.bid1_price, bar?.bid_price1,
      bar?.buy1, bar?.buy1_price, bar?.buy_price1, bar?.orderBook?.bidPrice
    );
    if (quoted != null) return { price: roundTo(quoted, 4), priceSource: 'bid' };
  }
  return {
    price: roundTo(Number(bar?.close || 0) - clampNumber(slippageTicks, 0) * clampNumber(tickSize, 0.001), 4),
    priceSource: 'close-slippage'
  };
}

/**
 * 解析买入执行价格
 * @param {Object} bar - K线数据
 * @param {number} tickSize - 最小变动单位
 * @param {number} slippageTicks - 滑点跳数
 * @returns {Object} {price, priceSource}
 */
export function resolveBuyExecutionPrice(bar, tickSize = 0.001, slippageTicks = 0, useQuotedPrices = true) {
  if (useQuotedPrices) {
    const quoted = firstPositiveNumber(
      bar?.askPrice, bar?.ask, bar?.sp1, bar?.ask1, bar?.ask1_price, bar?.ask_price1,
      bar?.sell1, bar?.sell1_price, bar?.sell_price1, bar?.orderBook?.askPrice
    );
    if (quoted != null) return { price: roundTo(quoted, 4), priceSource: 'ask' };
  }
  return {
    price: roundTo(Number(bar?.close || 0) + clampNumber(slippageTicks, 0) * clampNumber(tickSize, 0.001), 4),
    priceSource: 'close+slippage'
  };
}

/**
 * 创建交易模拟器
 * @param {Object} config - 配置参数
 * @returns {Object} 模拟器实例
 */
export function createTradeSimulator(config = {}) {
  const {
    initialCash = 100000,
    feeRate = 0.001,
    minFee = 0,
    lotSize = 100,
    tickSize = 0.001,
    slippageTicks = 0,
    useQuotedPrices = true
  } = config;

  let cash = initialCash;
  const positions = {}; // {code: {shares, costPrice}}

  /**
   * 执行卖出
   */
  function executeSell(code, bar) {
    const pos = positions[code];
    if (!pos || pos.shares <= 0) return null;

    const { price: sellPrice, priceSource } = resolveSellExecutionPrice(bar, tickSize, slippageTicks, useQuotedPrices);
    const sellAmount = pos.shares * sellPrice;
    const fee = calcFee(sellAmount, feeRate, minFee);
    const netProceeds = sellAmount - fee;

    cash += netProceeds;
    const profit = netProceeds - (pos.shares * pos.costPrice);

    const trade = {
      type: 'sell',
      code,
      shares: pos.shares,
      price: sellPrice,
      priceSource,
      amount: sellAmount,
      fee,
      netProceeds,
      costBasis: pos.shares * pos.costPrice,
      profit: roundTo(profit, 2)
    };

    delete positions[code];
    return trade;
  }

  /**
   * 执行买入
   */
  function executeBuy(code, bar, targetCash = cash, { roundLotMode = 'floor' } = {}) {
    const { price: buyPrice, priceSource } = resolveBuyExecutionPrice(bar, tickSize, slippageTicks, useQuotedPrices);
    const targetSpend = Math.max(0, clampNumber(targetCash, cash));
    const boundedSpend = roundLotMode === 'ceil' ? targetSpend : Math.min(cash, targetSpend);
    const rawLots = boundedSpend / buyPrice / lotSize;
    let maxShares = (roundLotMode === 'ceil' ? Math.ceil(rawLots) : Math.floor(rawLots)) * lotSize;

    while (maxShares > 0) {
      const buyAmount = roundTo(maxShares * buyPrice, 2);
      const fee = calcFee(buyAmount, feeRate, minFee);
      const totalCost = roundTo(buyAmount + fee, 2);
      const canSpend = roundLotMode === 'ceil'
        ? totalCost >= targetSpend || maxShares === lotSize
        : totalCost <= boundedSpend && totalCost <= cash;
      if (canSpend) {
        cash = roundTo(cash - totalCost, 2);
        positions[code] = {
          shares: maxShares,
          costPrice: roundTo(totalCost / maxShares, 4)
        };
        return {
          type: 'buy',
          code,
          shares: maxShares,
          price: buyPrice,
          priceSource,
          amount: buyAmount,
          fee,
          totalCost,
          costPrice: positions[code].costPrice,
          roundLotMode
        };
      }
      maxShares += roundLotMode === 'ceil' ? lotSize : -lotSize;
    }

    return null;
  }

  /**
   * 计算当前权益
   */
  function calcEquity(currentPrices) {
    let marketValue = 0;
    for (const [code, pos] of Object.entries(positions)) {
      const price = currentPrices[code] || 0;
      marketValue += pos.shares * price;
    }
    return roundTo(cash + marketValue, 2);
  }

  return {
    get cash() { return cash; },
    get positions() { return positions; },
    executeSell,
    executeBuy,
    calcEquity
  };
}
