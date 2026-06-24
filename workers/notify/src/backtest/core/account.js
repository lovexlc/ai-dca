/**
 * 账户状态管理 - 回测统一真源
 */

import { roundTo } from './math.js';

/**
 * 持仓状态
 */
export class PositionState {
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
export class AccountState {
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
