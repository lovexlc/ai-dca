/**
 * @typedef {'premium-spread'} BacktestStrategyType
 *
 * @typedef {Object} PremiumSpreadStrategy
 * @property {BacktestStrategyType=} type
 * @property {string=} id
 * @property {string=} name
 * @property {string[]} highCodes
 * @property {string[]} lowCodes
 * @property {'H'|'L'|'all'=} activeSide
 * @property {number=} intraSellLowerPct
 * @property {number=} intraBuyOtherPct
 *
 * @typedef {Object} BacktestOptions
 * @property {'1m'|'5m'|'15m'|'30m'|'60m'|'1d'=} timeframe
 * @property {Record<string, Array|{candles:Array}>=} historyByCode
 * @property {Record<string, Array>=} navHistoryByCode
 * @property {Record<string, Array>=} dataIssues
 * @property {number=} initialEquity
 * @property {number=} feeRate
 * @property {number=} minFee
 * @property {number=} tickSize
 * @property {number=} slippageTicks
 * @property {number=} lotSize
 *
 * @typedef {Object} BacktestResult
 * @property {boolean} ok
 * @property {'passed'|'failed'} status
 * @property {string} timeframe
 * @property {Object} summary
 * @property {Array} rows
 * @property {Array} signals
 * @property {Array} trades
 * @property {Object} chart
 * @property {Object} quality
 */

export {};
