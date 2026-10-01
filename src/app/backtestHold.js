import { createTradeSimulator } from './backtest/core/simulator.js';

export function runHoldBacktest(candles, options) {
  const { code, initialCash = 10000 } = options;
  if (!candles || candles.length === 0) return null;

  const first = candles[0];
  const firstPrice = Number(first.c);
  if (!Number.isFinite(firstPrice) || firstPrice <= 0) return null;

  const simulator = createTradeSimulator({ initialCash, ...options.tradingCosts });
  const buy = simulator.executeBuy(code, { close: firstPrice, c: firstPrice }, initialCash);
  const shares = buy?.shares || 0;
  const cash = simulator.cash;

  let peak = initialCash;
  let maxDrawdown = 0;

  const equityCurve = candles.map((candle) => {
    const price = Number(candle.c);
    const value = cash + shares * price;
    if (value > peak) peak = value;
    const drawdown = peak > 0 ? ((value - peak) / peak) * 100 : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
    return {
      t: candle.t,
      date: candle.date || candle.day,
      equity: value,
      drawdown
    };
  });

  const lastCandle = candles[candles.length - 1];
  const lastPrice = Number(lastCandle.c);
  const finalValue = cash + shares * lastPrice;
  const totalReturnPct = ((finalValue - initialCash) / initialCash) * 100;

  return {
    code,
    finalValue,
    totalReturnPct,
    maxDrawdownPct: maxDrawdown,
    tradeCount: buy ? 1 : 0,
    trades: buy ? [{ ...buy, action: 'buy', date: first.date || first.day, timestamp: first.t }] : [],
    equityCurve
  };
}

