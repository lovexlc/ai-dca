import { roundTo, clampNumber, firstPositiveNumber } from './math.js';

export function calcFee(amount, feeRate = 0.001, minFee = 0) {
  return Math.max(clampNumber(minFee, 0), amount * clampNumber(feeRate, 0.001));
}

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
 * Pure trade simulator. `accumulateBuys` is explicit because the legacy
 * browser adapter historically accumulated repeated buys while notify's
 * worker adapter replaced a position after a full sell/buy rotation.
 */
export function createTradeSimulator(config = {}) {
  const {
    initialCash = 100000,
    feeRate = 0.001,
    minFee = 0,
    lotSize = 100,
    tickSize = 0.001,
    slippageTicks = 0,
    useQuotedPrices = true,
    accumulateBuys = true
  } = config;
  let cash = initialCash;
  const positions = {};

  function executeSell(code, bar) {
    const position = positions[code];
    if (!position || position.shares <= 0) return null;
    const { price: sellPrice, priceSource } = resolveSellExecutionPrice(bar, tickSize, slippageTicks, useQuotedPrices);
    const sellAmount = position.shares * sellPrice;
    const fee = calcFee(sellAmount, feeRate, minFee);
    const netProceeds = sellAmount - fee;
    cash += netProceeds;
    const profit = netProceeds - position.shares * position.costPrice;
    const trade = {
      type: 'sell', code, shares: position.shares, price: sellPrice, priceSource,
      amount: sellAmount, fee, netProceeds, costBasis: position.shares * position.costPrice,
      profit: roundTo(profit, 2)
    };
    delete positions[code];
    return trade;
  }

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
        const existing = accumulateBuys ? positions[code] : null;
        const existingShares = Number(existing?.shares) || 0;
        const existingCost = existingShares > 0 ? existingShares * Number(existing.costPrice || 0) : 0;
        const nextShares = existingShares + maxShares;
        positions[code] = {
          shares: nextShares,
          costPrice: roundTo((existingCost + totalCost) / nextShares, 4)
        };
        return {
          type: 'buy', code, shares: maxShares, price: buyPrice, priceSource,
          amount: buyAmount, fee, totalCost, costPrice: positions[code].costPrice, roundLotMode
        };
      }
      maxShares += roundLotMode === 'ceil' ? lotSize : -lotSize;
    }
    return null;
  }

  function calcEquity(currentPrices) {
    let marketValue = 0;
    for (const [code, position] of Object.entries(positions)) {
      marketValue += position.shares * (currentPrices[code] || 0);
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
