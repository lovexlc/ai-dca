/** Pure account and position state used by both backtest consumers. */
import { roundTo } from './math.js';

export class PositionState {
  constructor(symbol, shares = 0, costBasis = 0) {
    this.symbol = symbol;
    this.shares = shares;
    this.costBasis = costBasis;
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

export class AccountState {
  constructor(cash, positions = {}) {
    this.cash = cash;
    this.positions = positions;
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
    for (const [symbol, position] of Object.entries(this.positions)) {
      clonedPositions[symbol] = position.clone();
    }
    return new AccountState(this.cash, clonedPositions);
  }
}
