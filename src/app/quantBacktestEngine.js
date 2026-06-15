/**
 * 量化回测引擎 - 修正版
 * 解决原版的持仓追踪、收益计算等问题
 */

import { clampNumber, roundTo } from './quantTrading.js';

/**
 * 持仓状态
 */
class PositionState {
  constructor(symbol, shares, costBasis) {
    this.symbol = symbol;
    this.shares = shares;
    this.costBasis = costBasis; // 总成本
  }

  get avgPrice() {
    return this.shares > 0 ? this.costBasis / this.shares : 0;
  }

  marketValue(price) {
    return this.shares * price;
  }

  unrealizedPnL(price) {
    return this.marketValue(price) - this.costBasis;
  }

  clone() {
    return new PositionState(this.symbol, this.shares, this.costBasis);
  }
}

/**
 * 账户状态
 */
class AccountState {
  constructor(cash, positions = {}) {
    this.cash = cash;
    this.positions = positions; // {symbol: PositionState}
  }

  equity(priceMap) {
    let totalValue = this.cash;
    for (const [symbol, position] of Object.entries(this.positions)) {
      const price = priceMap[symbol] || position.avgPrice;
      totalValue += position.marketValue(price);
    }
    return roundTo(totalValue, 2);
  }

  clone() {
    const clonedPositions = {};
    for (const [symbol, pos] of Object.entries(this.positions)) {
      clonedPositions[symbol] = pos.clone();
    }
    return new AccountState(this.cash, clonedPositions);
  }
}

/**
 * 交易执行模拟器
 */
class TradeSimulator {
  constructor(config = {}) {
    this.feeRate = clampNumber(config.feeRate, 0.01) / 100; // 转为小数
    this.minFee = clampNumber(config.minFee, 0);
    this.tickSize = clampNumber(config.tickSize, 0.001);
    this.slippageTicks = clampNumber(config.slippageTicks, 1);
    this.lotSize = Math.max(1, Math.floor(clampNumber(config.lotSize, 100)));
  }

  calcFee(amount) {
    if (amount <= 0) return 0;
    const fee = amount * this.feeRate;
    return roundTo(Math.max(fee, this.minFee), 2);
  }

  roundPrice(price) {
    return Math.max(this.tickSize, roundTo(
      Math.round(price / this.tickSize) * this.tickSize,
      4
    ));
  }

  floorToLot(quantity) {
    return Math.floor(quantity / this.lotSize) * this.lotSize;
  }

  /**
   * 执行卖出
   */
  executeSell(account, symbol, quantity, price) {
    const position = account.positions[symbol];
    if (!position || position.shares < quantity) {
      throw new Error(`Insufficient position: ${symbol}`);
    }

    const actualQuantity = this.floorToLot(Math.min(quantity, position.shares));
    if (actualQuantity <= 0) {
      return { success: false, reason: 'Quantity too small after lot rounding' };
    }

    const grossAmount = roundTo(actualQuantity * price, 2);
    const fee = this.calcFee(grossAmount);
    const netAmount = roundTo(grossAmount - fee, 2);

    // 更新持仓
    const newShares = position.shares - actualQuantity;
    const soldCostBasis = (position.costBasis / position.shares) * actualQuantity;
    const newCostBasis = roundTo(position.costBasis - soldCostBasis, 2);

    if (newShares > 0) {
      position.shares = newShares;
      position.costBasis = newCostBasis;
    } else {
      delete account.positions[symbol];
    }

    // 更新现金
    account.cash = roundTo(account.cash + netAmount, 2);

    return {
      success: true,
      side: 'SELL',
      symbol,
      quantity: actualQuantity,
      price: roundTo(price, 4),
      grossAmount,
      fee,
      netAmount,
      realizedPnL: roundTo(grossAmount - soldCostBasis - fee, 2)
    };
  }

  /**
   * 执行买入
   */
  executeBuy(account, symbol, quantity, price) {
    const actualQuantity = this.floorToLot(quantity);
    if (actualQuantity <= 0) {
      return { success: false, reason: 'Quantity too small after lot rounding' };
    }

    const grossAmount = roundTo(actualQuantity * price, 2);
    const fee = this.calcFee(grossAmount);
    const totalCost = roundTo(grossAmount + fee, 2);

    if (totalCost > account.cash) {
      return { success: false, reason: 'Insufficient cash' };
    }

    // 更新现金
    account.cash = roundTo(account.cash - totalCost, 2);

    // 更新持仓
    if (!account.positions[symbol]) {
      account.positions[symbol] = new PositionState(symbol, 0, 0);
    }

    const position = account.positions[symbol];
    position.shares += actualQuantity;
    position.costBasis = roundTo(position.costBasis + totalCost, 2);

    return {
      success: true,
      side: 'BUY',
      symbol,
      quantity: actualQuantity,
      price: roundTo(price, 4),
      grossAmount,
      fee,
      totalCost
    };
  }

  /**
   * 执行切换交易（卖出A买入B）
   */
  executeSwitch(account, sellSymbol, sellPrice, buySymbol, buyPrice, targetAmount) {
    // 1. 先计算卖出
    const sellPosition = account.positions[sellSymbol];
    if (!sellPosition) {
      return { success: false, reason: `No position in ${sellSymbol}` };
    }

    const maxSellValue = sellPosition.shares * sellPrice;
    const sellValue = Math.min(targetAmount, maxSellValue);
    const sellQuantity = this.floorToLot(sellValue / sellPrice);

    if (sellQuantity <= 0) {
      return { success: false, reason: 'Sell quantity too small' };
    }

    // 2. 执行卖出
    const sellResult = this.executeSell(account, sellSymbol, sellQuantity, sellPrice);
    if (!sellResult.success) {
      return sellResult;
    }

    // 3. 用卖出所得买入
    const buyBudget = sellResult.netAmount;
    const buyQuantity = this.floorToLot(buyBudget / buyPrice);

    if (buyQuantity <= 0) {
      // 回滚卖出（实际交易不可回滚，这里为了模拟严谨性）
      return { success: false, reason: 'Buy quantity too small', sellExecuted: sellResult };
    }

    // 4. 执行买入
    const buyResult = this.executeBuy(account, buySymbol, buyQuantity, buyPrice);
    if (!buyResult.success) {
      return { success: false, reason: buyResult.reason, sellExecuted: sellResult };
    }

    return {
      success: true,
      sell: sellResult,
      buy: buyResult,
      totalFee: roundTo(sellResult.fee + buyResult.fee, 2),
      netCashChange: roundTo(account.cash - (sellResult.netAmount - buyResult.totalCost), 2)
    };
  }
}

/**
 * 回测引擎主类
 */
export class BacktestEngine {
  constructor(config) {
    this.config = {
      initialCash: clampNumber(config.initialCash, 100000),
      initialPositions: config.initialPositions || {},
      strategy: config.strategy,
      tradingCosts: config.tradingCosts || {},
      ...config
    };

    this.simulator = new TradeSimulator(this.config.tradingCosts);
    this.account = this.initializeAccount();
    this.trades = [];
    this.equityHistory = [];
    this.metrics = {
      peak: this.config.initialCash,
      maxDrawdown: 0,
      maxDrawdownPct: 0
    };
  }

  initializeAccount() {
    const positions = {};
    for (const [symbol, pos] of Object.entries(this.config.initialPositions)) {
      positions[symbol] = new PositionState(
        symbol,
        pos.shares,
        pos.shares * pos.costPrice
      );
    }
    return new AccountState(this.config.initialCash, positions);
  }

  /**
   * 运行溢价差策略回测
   */
  runPremiumSpreadBacktest(historicalData) {
    const { strategy } = this.config;
    let lastTradeIndex = -Infinity;

    for (let i = 0; i < historicalData.length; i++) {
      const row = historicalData[i];

      // 构建当日价格映射
      const priceMap = {
        [strategy.sellSymbol]: row.sellPrice || row.sellBid || 0,
        [strategy.buySymbol]: row.buyPrice || row.buyAsk || 0
      };

      // 记录当日权益
      const equity = this.account.equity(priceMap);
      this.equityHistory.push({
        date: row.date,
        equity,
        cash: this.account.cash,
        ...this.extractPositionValues(priceMap)
      });

      // 更新峰值和回撤
      this.updateDrawdownMetrics(equity);

      // 评估交易信号
      const signal = this.evaluateSignal(row, strategy);

      // 检查冷却期
      const cooldownOk = (i - lastTradeIndex) > (strategy.cooldownDays || 0);

      if (signal.action === 'switch' && signal.canTrade && cooldownOk) {
        // 执行切换交易
        const sellPrice = this.simulator.roundPrice(
          row.sellBid - this.simulator.slippageTicks * this.simulator.tickSize
        );
        const buyPrice = this.simulator.roundPrice(
          row.buyAsk + this.simulator.slippageTicks * this.simulator.tickSize
        );

        const tradeResult = this.simulator.executeSwitch(
          this.account,
          strategy.sellSymbol,
          sellPrice,
          strategy.buySymbol,
          buyPrice,
          strategy.maxOrderCash || 16000
        );

        if (tradeResult.success) {
          this.trades.push({
            date: row.date,
            index: i,
            ...tradeResult,
            signal: signal,
            equityBefore: equity,
            equityAfter: this.account.equity(priceMap)
          });
          lastTradeIndex = i;
        }
      }
    }

    return this.generateReport();
  }

  /**
   * 评估溢价差信号
   */
  evaluateSignal(row, strategy) {
    const sellPremiumPct = clampNumber(row.sellPremiumPct, 0);
    const buyPremiumPct = clampNumber(row.buyPremiumPct, 0);
    const rawSpreadPct = sellPremiumPct - buyPremiumPct;
    const netSpreadPct = rawSpreadPct - clampNumber(strategy.feeBufferPct, 0);

    const hasPosition = !!this.account.positions[strategy.sellSymbol];
    const hasValidData = row.sellBid > 0 && row.buyAsk > 0 && row.sellIOPV > 0 && row.buyIOPV > 0;

    const action = hasValidData
      && netSpreadPct >= strategy.triggerSpreadPct
      && hasPosition
        ? 'switch'
        : 'wait';

    return {
      action,
      sellPremiumPct: roundTo(sellPremiumPct, 4),
      buyPremiumPct: roundTo(buyPremiumPct, 4),
      rawSpreadPct: roundTo(rawSpreadPct, 4),
      netSpreadPct: roundTo(netSpreadPct, 4),
      canTrade: action === 'switch' && hasValidData
    };
  }

  extractPositionValues(priceMap) {
    const values = {};
    for (const [symbol, position] of Object.entries(this.account.positions)) {
      values[`${symbol}_shares`] = position.shares;
      values[`${symbol}_value`] = position.marketValue(priceMap[symbol] || 0);
    }
    return values;
  }

  updateDrawdownMetrics(equity) {
    this.metrics.peak = Math.max(this.metrics.peak, equity);
    const drawdown = this.metrics.peak - equity;
    const drawdownPct = this.metrics.peak > 0 ? (drawdown / this.metrics.peak) * 100 : 0;

    if (drawdown > this.metrics.maxDrawdown) {
      this.metrics.maxDrawdown = drawdown;
      this.metrics.maxDrawdownPct = drawdownPct;
    }
  }

  generateReport() {
    const initialEquity = this.config.initialCash;
    const finalEquity = this.equityHistory.length > 0
      ? this.equityHistory[this.equityHistory.length - 1].equity
      : initialEquity;

    const totalProfit = roundTo(finalEquity - initialEquity, 2);
    const totalReturnPct = roundTo((totalProfit / initialEquity) * 100, 2);

    // 计算胜率（基于已实现盈亏）
    const realizedTrades = this.trades.filter(t => t.sell && t.sell.realizedPnL !== undefined);
    const winners = realizedTrades.filter(t => t.sell.realizedPnL > 0).length;
    const winRatePct = realizedTrades.length > 0
      ? roundTo((winners / realizedTrades.length) * 100, 2)
      : 0;

    // 计算夏普比率（简化版，假设无风险利率0）
    const returns = this.equityHistory.map((row, i) => {
      if (i === 0) return 0;
      const prev = this.equityHistory[i - 1].equity;
      return prev > 0 ? (row.equity - prev) / prev : 0;
    }).slice(1);

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? roundTo((avgReturn / stdDev) * Math.sqrt(252), 2) : 0;

    return {
      summary: {
        trades: this.trades.length,
        totalProfit,
        totalReturnPct,
        winRatePct,
        maxDrawdown: roundTo(this.metrics.maxDrawdown, 2),
        maxDrawdownPct: roundTo(this.metrics.maxDrawdownPct, 2),
        sharpeRatio,
        finalEquity: roundTo(finalEquity, 2),
        avgNetSpreadPct: this.trades.length > 0
          ? roundTo(this.trades.reduce((sum, t) => sum + t.signal.netSpreadPct, 0) / this.trades.length, 4)
          : 0,
        totalFees: roundTo(this.trades.reduce((sum, t) => sum + (t.totalFee || 0), 0), 2)
      },
      trades: this.trades,
      equityHistory: this.equityHistory,
      finalAccount: {
        cash: this.account.cash,
        positions: Object.fromEntries(
          Object.entries(this.account.positions).map(([symbol, pos]) => [
            symbol,
            { shares: pos.shares, costBasis: pos.costBasis, avgPrice: pos.avgPrice }
          ])
        )
      }
    };
  }
}

/**
 * 便捷函数：运行溢价差回测
 */
export function runPremiumSpreadBacktest(config, historicalData) {
  const engine = new BacktestEngine(config);
  return engine.runPremiumSpreadBacktest(historicalData);
}
