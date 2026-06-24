/**
 * Worker compatibility adapter for the unified premium-spread backtest engine.
 *
 * Keep the historical export name for routes/tests while delegating all
 * behavior to workers/notify/src/backtest, which mirrors src/app/backtest.
 */

import { runBacktest } from './backtest/index.js';

export function runQuantPremiumBacktestV2(strategyInput = {}, options = {}) {
  return runBacktest({
    type: 'premium-spread',
    ...strategyInput
  }, options);
}
