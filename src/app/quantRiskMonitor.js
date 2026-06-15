/**
 * 增强版风控监控模块
 * 实时监控交易风险，触发熔断和预警
 */

import { RISK_CONTROL_CONFIG } from './quantConfigPresets.js';

/**
 * 风控检查器
 */
export class RiskMonitor {
  constructor(config = {}) {
    this.config = { ...RISK_CONTROL_CONFIG, ...config };
    this.alerts = [];
    this.dailyStats = this.initDailyStats();
  }

  initDailyStats() {
    return {
      date: this.getTodayDateKey(),
      trades: 0,
      losses: 0,
      consecutiveLosses: 0,
      totalPnL: 0,
      totalFees: 0
    };
  }

  getTodayDateKey() {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * 检查今日统计是否需要重置
   */
  checkDailyReset() {
    const today = this.getTodayDateKey();
    if (this.dailyStats.date !== today) {
      this.dailyStats = this.initDailyStats();
    }
  }

  /**
   * 全面风控检查
   */
  checkRisks(state, plan) {
    this.checkDailyReset();
    this.alerts = [];

    // 1. 数据有效性检查
    this.checkDataValidity(state, plan);

    // 2. 市场风险检查
    this.checkMarketRisks(state, plan);

    // 3. 流动性风险检查
    this.checkLiquidityRisks(state, plan);

    // 4. 持仓风险检查
    this.checkPositionRisks(state);

    // 5. 交易频率风险检查
    this.checkTradingFrequency(state);

    // 6. 损益风险检查
    this.checkPnLRisks(state);

    return {
      passed: this.alerts.filter(a => a.level === 'ERROR').length === 0,
      alerts: this.alerts,
      stats: this.dailyStats
    };
  }

  /**
   * 1. 数据有效性检查
   */
  checkDataValidity(state, plan) {
    const { quotes, strategy } = state;
    const sellQuote = quotes[strategy.sellSymbol];
    const buyQuote = quotes[strategy.buySymbol];

    // 检查盘口数据
    if (!sellQuote || !buyQuote) {
      this.addAlert('ERROR', 'DATA_MISSING', '行情数据缺失');
      return;
    }

    // 检查价格合理性
    if (sellQuote.bid <= 0 || sellQuote.ask <= 0) {
      this.addAlert('ERROR', 'INVALID_PRICE', `${strategy.sellSymbol} 价格数据异常`);
    }

    if (buyQuote.bid <= 0 || buyQuote.ask <= 0) {
      this.addAlert('ERROR', 'INVALID_PRICE', `${strategy.buySymbol} 价格数据异常`);
    }

    // 检查IOPV
    if (sellQuote.iopv <= 0 || buyQuote.iopv <= 0) {
      this.addAlert('ERROR', 'INVALID_IOPV', 'IOPV 数据缺失或异常');
    }

    // 检查买卖价差合理性
    const sellSpread = sellQuote.ask - sellQuote.bid;
    const buySpread = buyQuote.ask - buyQuote.bid;

    if (sellSpread > sellQuote.bid * 0.01) { // 买卖价差超过1%
      this.addAlert('WARNING', 'WIDE_SPREAD', `${strategy.sellSymbol} 买卖价差过大：${(sellSpread / sellQuote.bid * 100).toFixed(2)}%`);
    }

    if (buySpread > buyQuote.bid * 0.01) {
      this.addAlert('WARNING', 'WIDE_SPREAD', `${strategy.buySymbol} 买卖价差过大：${(buySpread / buyQuote.bid * 100).toFixed(2)}%`);
    }

    // 检查数据时效性
    if (sellQuote.asOf) {
      const quoteAge = Date.now() - new Date(sellQuote.asOf).getTime();
      if (quoteAge > 5 * 60 * 1000) { // 超过5分钟
        this.addAlert('WARNING', 'STALE_DATA', `行情数据已过时 ${Math.floor(quoteAge / 60000)} 分钟`);
      }
    }
  }

  /**
   * 2. 市场风险检查
   */
  checkMarketRisks(state, plan) {
    const { quotes, strategy } = state;
    const sellQuote = quotes[strategy.sellSymbol];
    const buyQuote = quotes[strategy.buySymbol];

    if (!sellQuote || !buyQuote) return;

    // 计算溢价率
    const sellPremiumPct = ((sellQuote.bid - sellQuote.iopv) / sellQuote.iopv) * 100;
    const buyPremiumPct = ((buyQuote.ask - buyQuote.iopv) / buyQuote.iopv) * 100;

    // 极端溢价率熔断
    if (Math.abs(sellPremiumPct) > this.config.extremePremiumThreshold) {
      this.addAlert('ERROR', 'EXTREME_PREMIUM',
        `${strategy.sellSymbol} 溢价率 ${sellPremiumPct.toFixed(2)}% 异常，可能是数据错误`);
    }

    if (Math.abs(buyPremiumPct) > this.config.extremePremiumThreshold) {
      this.addAlert('ERROR', 'EXTREME_PREMIUM',
        `${strategy.buySymbol} 溢价率 ${buyPremiumPct.toFixed(2)}% 异常，可能是数据错误`);
    }

    // IOPV比例检查（基差风险）
    const iopvRatio = sellQuote.iopv / buyQuote.iopv;
    const expectedRatio = this.config.iopvRatio.expected;
    const deviation = Math.abs(iopvRatio - expectedRatio) / expectedRatio;

    if (deviation > this.config.iopvRatio.maxDeviation) {
      this.addAlert('WARNING', 'IOPV_RATIO_ABNORMAL',
        `IOPV比例 ${iopvRatio.toFixed(4)} 偏离预期 ${expectedRatio.toFixed(4)}，基差风险 ${(deviation * 100).toFixed(1)}%`);
    }

    // 卖出标的折价过高风险
    if (sellPremiumPct < -0.5) {
      this.addAlert('WARNING', 'NEGATIVE_PREMIUM',
        `${strategy.sellSymbol} 折价 ${Math.abs(sellPremiumPct).toFixed(2)}%，此时卖出不利`);
    }

    // 市场状态检查
    if (sellQuote.marketState && sellQuote.marketState !== 'trading') {
      this.addAlert('INFO', 'MARKET_CLOSED', `市场状态：${sellQuote.marketState}`);
    }
  }

  /**
   * 3. 流动性风险检查
   */
  checkLiquidityRisks(state, plan) {
    const { quotes, strategy } = state;
    const sellQuote = quotes[strategy.sellSymbol];
    const buyQuote = quotes[strategy.buySymbol];

    if (!sellQuote || !buyQuote || !plan || !plan.canTrade) return;

    // 盘口深度检查
    if (sellQuote.bidSize < this.config.minBidAskSize) {
      this.addAlert('WARNING', 'LOW_LIQUIDITY',
        `${strategy.sellSymbol} 买一量 ${sellQuote.bidSize} 不足，可能冲击成本较大`);
    }

    if (buyQuote.askSize < this.config.minBidAskSize) {
      this.addAlert('WARNING', 'LOW_LIQUIDITY',
        `${strategy.buySymbol} 卖一量 ${buyQuote.askSize} 不足，可能冲击成本较大`);
    }

    // 订单量占盘口深度比例
    if (plan.sell && plan.sell.quantity > 0) {
      const sellDepthRatio = plan.sell.quantity / sellQuote.bidSize;
      if (sellDepthRatio > this.config.depthUtilization) {
        this.addAlert('WARNING', 'HIGH_DEPTH_UTILIZATION',
          `卖出量占盘口 ${(sellDepthRatio * 100).toFixed(1)}%，可能滑点较大`);
      }
    }

    if (plan.buy && plan.buy.quantity > 0) {
      const buyDepthRatio = plan.buy.quantity / buyQuote.askSize;
      if (buyDepthRatio > this.config.depthUtilization) {
        this.addAlert('WARNING', 'HIGH_DEPTH_UTILIZATION',
          `买入量占盘口 ${(buyDepthRatio * 100).toFixed(1)}%，可能滑点较大`);
      }
    }
  }

  /**
   * 4. 持仓风险检查
   */
  checkPositionRisks(state) {
    const { account, quotes } = state;

    // 计算总权益和持仓市值
    let totalEquity = account.cash;
    let maxSinglePositionValue = 0;

    for (const [symbol, position] of Object.entries(account.positions)) {
      if (position.shares <= 0) continue;

      const quote = quotes[symbol];
      const price = quote?.bid || quote?.ask || position.costPrice || 0;
      const marketValue = position.shares * price;

      totalEquity += marketValue;
      maxSinglePositionValue = Math.max(maxSinglePositionValue, marketValue);
    }

    // 单标的集中度检查
    if (totalEquity > 0) {
      const maxPositionPct = (maxSinglePositionValue / totalEquity) * 100;
      const threshold = this.config.maxSinglePositionPct * 100;

      if (maxPositionPct > threshold) {
        this.addAlert('WARNING', 'HIGH_CONCENTRATION',
          `单标的仓位 ${maxPositionPct.toFixed(1)}% 超过限制 ${threshold.toFixed(0)}%`);
      }

      // 总仓位检查
      const totalPositionPct = ((totalEquity - account.cash) / totalEquity) * 100;
      const maxTotalThreshold = this.config.maxTotalPositionPct * 100;

      if (totalPositionPct > maxTotalThreshold) {
        this.addAlert('WARNING', 'HIGH_LEVERAGE',
          `总仓位 ${totalPositionPct.toFixed(1)}% 超过限制 ${maxTotalThreshold.toFixed(0)}%`);
      }
    }
  }

  /**
   * 5. 交易频率风险检查
   */
  checkTradingFrequency(state) {
    // 日内交易次数限制
    if (this.dailyStats.trades >= this.config.maxTradesPerDay) {
      this.addAlert('ERROR', 'MAX_TRADES_EXCEEDED',
        `今日已达交易上限 ${this.config.maxTradesPerDay} 次`);
    }

    // 连续亏损限制
    if (this.dailyStats.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      this.addAlert('ERROR', 'MAX_CONSECUTIVE_LOSSES',
        `连续亏损 ${this.dailyStats.consecutiveLosses} 次，触发熔断`);
    }
  }

  /**
   * 6. 损益风险检查
   */
  checkPnLRisks(state) {
    const { account } = state;

    // 计算今日亏损比例（简化版，实际需要记录期初权益）
    const dailyLossPct = this.dailyStats.totalPnL < 0
      ? (Math.abs(this.dailyStats.totalPnL) / account.cash) * 100
      : 0;

    if (dailyLossPct > this.config.maxDailyLossPct) {
      this.addAlert('ERROR', 'MAX_DAILY_LOSS',
        `今日亏损 ${dailyLossPct.toFixed(2)}% 超过止损线 ${this.config.maxDailyLossPct}%`);
    }
  }

  /**
   * 记录交易结果（用于更新统计）
   */
  recordTrade(tradeResult) {
    this.checkDailyReset();

    this.dailyStats.trades += 1;

    if (tradeResult.sell && tradeResult.sell.realizedPnL !== undefined) {
      const pnl = tradeResult.sell.realizedPnL;
      this.dailyStats.totalPnL += pnl;

      if (pnl < 0) {
        this.dailyStats.losses += 1;
        this.dailyStats.consecutiveLosses += 1;
      } else {
        this.dailyStats.consecutiveLosses = 0; // 重置连续亏损
      }
    }

    if (tradeResult.totalFee) {
      this.dailyStats.totalFees += tradeResult.totalFee;
    }
  }

  /**
   * 添加预警
   */
  addAlert(level, code, message) {
    this.alerts.push({
      level,    // ERROR | WARNING | INFO
      code,     // 预警代码
      message,  // 描述
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 获取所有预警
   */
  getAlerts() {
    return this.alerts;
  }

  /**
   * 获取错误级别预警（熔断）
   */
  getErrors() {
    return this.alerts.filter(a => a.level === 'ERROR');
  }

  /**
   * 获取警告级别预警
   */
  getWarnings() {
    return this.alerts.filter(a => a.level === 'WARNING');
  }

  /**
   * 是否通过风控检查
   */
  passed() {
    return this.getErrors().length === 0;
  }

  /**
   * 生成风控报告
   */
  generateReport() {
    const errors = this.getErrors();
    const warnings = this.getWarnings();

    return {
      passed: this.passed(),
      summary: {
        totalAlerts: this.alerts.length,
        errors: errors.length,
        warnings: warnings.length
      },
      errors,
      warnings,
      dailyStats: this.dailyStats,
      riskLevel: this.assessRiskLevel()
    };
  }

  /**
   * 评估整体风险等级
   */
  assessRiskLevel() {
    const errors = this.getErrors().length;
    const warnings = this.getWarnings().length;

    if (errors > 0) return 'HIGH';
    if (warnings > 2) return 'MEDIUM';
    if (warnings > 0) return 'LOW';
    return 'MINIMAL';
  }
}

/**
 * 便捷函数：执行风控检查
 */
export function performRiskCheck(state, plan, config) {
  const monitor = new RiskMonitor(config);
  return monitor.checkRisks(state, plan);
}
