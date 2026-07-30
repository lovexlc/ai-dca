import {
  calcFee,
  createTradeSimulator as createSharedTradeSimulator,
  resolveBuyExecutionPrice as resolveSharedBuyExecutionPrice,
  resolveSellExecutionPrice as resolveSharedSellExecutionPrice
} from '../../../../shared/src/backtest/core/simulator.js';

export { calcFee };

// Preserve notify's historical adapter semantics: the worker always used
// quoted bid/ask prices and replaced a position after a full sell/buy cycle.
export function resolveSellExecutionPrice(bar, tickSize = 0.001, slippageTicks = 0) {
  return resolveSharedSellExecutionPrice(bar, tickSize, slippageTicks, true);
}

export function resolveBuyExecutionPrice(bar, tickSize = 0.001, slippageTicks = 0) {
  return resolveSharedBuyExecutionPrice(bar, tickSize, slippageTicks, true);
}

export function createTradeSimulator(config = {}) {
  return createSharedTradeSimulator({
    ...config,
    useQuotedPrices: true,
    accumulateBuys: false
  });
}
