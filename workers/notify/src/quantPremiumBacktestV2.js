/**
 * 量化溢价差回测引擎 V2 - 修复版
 *
 * 核心改进：
 * 1. 完整的持仓追踪（股数、成本、市值）
 * 2. 真实的交易模拟（买卖价、手续费、滑点）
 * 3. 准确的胜率计算（盈利交易/总交易）
 * 4. 专业指标（夏普比率、最大回撤）
 */

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function clampNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function buildNavLookup(navHistory = []) {
  const sorted = navHistory
    .filter((item) => item && item.date && Number.isFinite(item.nav))
    .sort((a, b) => a.date.localeCompare(b.date));
  return (date) => {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].date <= date) return sorted[i].nav;
    }
    return 0;
  };
}

function normalizeBacktestCandles(candles = []) {
  return (Array.isArray(candles) ? candles : [])
    .filter((bar) => bar && bar.t && Number.isFinite(bar.close))
    .sort((a, b) => a.t - b.t);
}

/**
 * V2回测引擎 - 带持仓追踪
 */
export function runQuantPremiumBacktestV2(strategyInput = {}, options = {}) {
  const {
    timeframe = '5m',
    historyByCode = {},
    navHistoryByCode = {},
    dataIssues = {},
    initialEquity = 100000,
    orderCash = 16000,
    feeRate = 0.001,
    minFee = 0,
    tickSize = 0.001,
    slippageTicks = 1,
    lotSize = 100
  } = options;

  const strategy = normalizeStrategy(strategyInput);
  const highCodes = strategy.highCodes || [];
  const lowCodes = strategy.lowCodes || [];
  const codes = Array.from(new Set([...highCodes, ...lowCodes]));

  // 构建K线和NAV查询
  const candleMap = {};
  for (const code of codes) {
    candleMap[code] = normalizeBacktestCandles(
      historyByCode?.[code]?.candles || historyByCode?.[code] || []
    );
  }

  const anchorCode = codes.slice().sort((a, b) =>
    (candleMap[b]?.length || 0) - (candleMap[a]?.length || 0)
  )[0] || '';
  const anchorCandles = candleMap[anchorCode] || [];

  const closeByCode = Object.fromEntries(
    codes.map((code) => [
      code,
      new Map((candleMap[code] || []).map((bar) => [bar.t, bar]))
    ])
  );

  const navLookupByCode = Object.fromEntries(
    codes.map((code) => [code, buildNavLookup(navHistoryByCode?.[code] || [])])
  );

  // 持仓状态
  const positions = {}; // { code: { shares, costPrice } }
  let cash = clampNumber(initialEquity, 100000);
  let equity = cash;
  let peak = equity;
  let maxDrawdownPct = 0;

  // 统计
  const trades = [];
  const rows = [];
  const signals = [];
  let completePriceRows = 0;
  let completeNavRows = 0;

  // 溢价分类
  const premiumClass = Object.fromEntries([
    ...highCodes.map((code) => [code, 'H']),
    ...lowCodes.map((code) => [code, 'L'])
  ]);

  let currentCode = '';
  let entryGapPct = null;

  // 初始化：选择初始持仓
  function pickInitialHolding(highList, lowList) {
    if (strategy.activeSide === 'L') {
      return lowList.reduce((best, item) =>
        (!best || item.premiumPct < best.premiumPct ? item : best), null
      ) || highList.reduce((best, item) =>
        (!best || item.premiumPct > best.premiumPct ? item : best), null
      );
    }
    return highList.reduce((best, item) =>
      (!best || item.premiumPct > best.premiumPct ? item : best), null
    ) || lowList.reduce((best, item) =>
      (!best || item.premiumPct < best.premiumPct ? item : best), null
    );
  }

  // 计算交易手续费
  function calcFee(amount) {
    return Math.max(clampNumber(minFee, 0), amount * clampNumber(feeRate, 0.001));
  }

  // 执行卖出
  function executeSell(code, bar, nav) {
    const pos = positions[code];
    if (!pos || pos.shares <= 0) return null;

    const sellPrice = bar.close - slippageTicks * tickSize; // 滑点
    const sellAmount = pos.shares * sellPrice;
    const fee = calcFee(sellAmount);
    const netProceeds = sellAmount - fee;

    cash += netProceeds;
    const profit = netProceeds - (pos.shares * pos.costPrice);

    const trade = {
      type: 'sell',
      code,
      shares: pos.shares,
      price: sellPrice,
      amount: sellAmount,
      fee,
      netProceeds,
      costBasis: pos.shares * pos.costPrice,
      profit: roundTo(profit, 2)
    };

    delete positions[code];
    return trade;
  }

  // 执行买入
  function executeBuy(code, bar, nav, targetCash) {
    const buyPrice = bar.close + slippageTicks * tickSize; // 滑点
    const maxShares = Math.floor(targetCash / buyPrice / lotSize) * lotSize;
    if (maxShares <= 0) return null;

    const buyAmount = maxShares * buyPrice;
    const fee = calcFee(buyAmount);
    const totalCost = buyAmount + fee;

    if (totalCost > cash) return null;

    cash -= totalCost;
    positions[code] = {
      shares: maxShares,
      costPrice: roundTo((buyAmount + fee) / maxShares, 4)
    };

    return {
      type: 'buy',
      code,
      shares: maxShares,
      price: buyPrice,
      amount: buyAmount,
      fee,
      totalCost,
      costPrice: positions[code].costPrice
    };
  }

  // 计算当前权益
  function calcEquity(currentPrices) {
    let marketValue = 0;
    for (const [code, pos] of Object.entries(positions)) {
      const price = currentPrices[code] || 0;
      marketValue += pos.shares * price;
    }
    return roundTo(cash + marketValue, 2);
  }

  // 主循环
  for (const anchor of anchorCandles) {
    const premiums = {};
    const currentPrices = {};
    let hasAllPrices = true;
    let hasAllNav = true;

    // 获取当前行情
    for (const code of codes) {
      const bar = closeByCode[code].get(anchor.t);
      if (!bar) {
        hasAllPrices = false;
        continue;
      }
      const nav = navLookupByCode[code](anchor.date);
      if (!(nav > 0)) {
        hasAllNav = false;
        continue;
      }
      currentPrices[code] = bar.close;
      premiums[code] = roundTo(((bar.close - nav) / nav) * 100, 4);
    }

    if (hasAllPrices) completePriceRows += 1;
    if (hasAllPrices && hasAllNav) completeNavRows += 1;
    if (!hasAllPrices || !hasAllNav) continue;

    // 计算当前权益
    equity = calcEquity(currentPrices);
    peak = Math.max(peak, equity);
    const drawdownPct = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
    maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);

    // 构建H/L列表
    const highList = highCodes
      .map((code) => ({ code, premiumPct: premiums[code] }))
      .filter((item) => Number.isFinite(item.premiumPct));
    const lowList = lowCodes
      .map((code) => ({ code, premiumPct: premiums[code] }))
      .filter((item) => Number.isFinite(item.premiumPct));

    // 初始化持仓
    if (!currentCode || !Number.isFinite(premiums[currentCode])) {
      const initial = pickInitialHolding(highList, lowList);
      currentCode = initial?.code || '';
      entryGapPct = null;

      // 用所有现金买入初始持仓
      if (currentCode && cash > 0) {
        const bar = closeByCode[currentCode].get(anchor.t);
        const nav = navLookupByCode[currentCode](anchor.date);
        const buyTrade = executeBuy(currentCode, bar, nav, cash * 0.95);
        if (buyTrade) {
          trades.push({ ...buyTrade, ts: anchor.t, date: anchor.date });
        }
      }
    }

    const currentClass = premiumClass[currentCode] || '';
    const currentPremiumPct = premiums[currentCode];
    const from = currentCode && Number.isFinite(currentPremiumPct)
      ? { code: currentCode, premiumPct: currentPremiumPct }
      : null;

    if (!from) continue;

    // 判断交易信号
    let to = null;
    let gapPct = NaN;
    let rule = 'none';
    let threshold = NaN;

    if (currentClass === 'H') {
      to = lowList.reduce((best, item) =>
        (!best || item.premiumPct < best.premiumPct ? item : best), null
      );
      if (to) {
        gapPct = roundTo(from.premiumPct - to.premiumPct, 4);
        rule = 'B';
        threshold = strategy.intraBuyOtherPct;
      }
    } else if (currentClass === 'L') {
      to = highList.reduce((best, item) =>
        (!best || item.premiumPct > best.premiumPct ? item : best), null
      );
      if (to) {
        gapPct = roundTo(to.premiumPct - from.premiumPct, 4);
        rule = 'A';
        threshold = strategy.intraSellLowerPct;
      }
    }

    if (!to || !Number.isFinite(gapPct)) continue;

    const sideAllowed = strategy.activeSide === 'all' || strategy.activeSide === currentClass;
    const triggered = sideAllowed && (
      (rule === 'B' && gapPct > strategy.intraBuyOtherPct) ||
      (rule === 'A' && gapPct < strategy.intraSellLowerPct)
    );

    // 执行交易
    if (triggered) {
      const fromBar = closeByCode[from.code].get(anchor.t);
      const toBar = closeByCode[to.code].get(anchor.t);
      const fromNav = navLookupByCode[from.code](anchor.date);
      const toNav = navLookupByCode[to.code](anchor.date);

      // 卖出当前持仓
      const sellTrade = executeSell(from.code, fromBar, fromNav);
      if (sellTrade) {
        trades.push({ ...sellTrade, ts: anchor.t, date: anchor.date });

        // 买入新持仓
        const targetCash = Math.min(cash, clampNumber(orderCash, 16000));
        const buyTrade = executeBuy(to.code, toBar, toNav, targetCash);
        if (buyTrade) {
          trades.push({ ...buyTrade, ts: anchor.t, date: anchor.date });
        }
      }

      signals.push({
        ts: anchor.t,
        date: anchor.date,
        fromCode: from.code,
        toCode: to.code,
        rule,
        threshold,
        gapPct,
        entryGapPct: Number.isFinite(entryGapPct) ? entryGapPct : null,
        profit: sellTrade ? sellTrade.profit : 0
      });

      if (rule === 'B') {
        entryGapPct = gapPct;
      } else if (rule === 'A') {
        entryGapPct = null;
      }
      currentCode = to.code;
    }

    rows.push({
      ts: anchor.t,
      date: anchor.date,
      fromCode: from.code,
      toCode: to.code,
      currentCode: from.code,
      currentClass,
      highPremiumPct: currentClass === 'H' ? from.premiumPct : to.premiumPct,
      lowPremiumPct: currentClass === 'H' ? to.premiumPct : from.premiumPct,
      gapPct,
      rule,
      threshold,
      signal: triggered ? 'switch' : 'wait',
      profit: 0,
      equity: roundTo(equity, 2),
      cash: roundTo(cash, 2),
      positions: JSON.parse(JSON.stringify(positions))
    });
  }

  // 最终结算
  const finalPrices = {};
  const lastAnchor = anchorCandles[anchorCandles.length - 1];
  if (lastAnchor) {
    for (const code of codes) {
      const bar = closeByCode[code].get(lastAnchor.t);
      if (bar) finalPrices[code] = bar.close;
    }
  }
  const finalEquity = calcEquity(finalPrices);

  // 统计
  const sampleCount = rows.length;
  const priceCoveragePct = anchorCandles.length
    ? roundTo((completePriceRows / anchorCandles.length) * 100, 2)
    : 0;
  const navCoveragePct = completePriceRows
    ? roundTo((completeNavRows / completePriceRows) * 100, 2)
    : 0;
  const dataCoveragePct = anchorCandles.length
    ? roundTo((sampleCount / anchorCandles.length) * 100, 2)
    : 0;

  const totalProfit = roundTo(finalEquity - initialEquity, 2);
  const totalReturnPct = initialEquity > 0
    ? roundTo((totalProfit / initialEquity) * 100, 4)
    : 0;

  // 计算胜率
  const profitableTrades = trades.filter(t => t.type === 'sell' && t.profit > 0).length;
  const totalSellTrades = trades.filter(t => t.type === 'sell').length;
  const winRatePct = totalSellTrades > 0
    ? roundTo((profitableTrades / totalSellTrades) * 100, 2)
    : 0;

  // 计算夏普比率（简化版）
  const returns = [];
  for (let i = 1; i < rows.length; i++) {
    const ret = rows[i].equity > 0
      ? (rows[i].equity - rows[i - 1].equity) / rows[i - 1].equity
      : 0;
    returns.push(ret);
  }
  const avgReturn = returns.length > 0
    ? returns.reduce((sum, r) => sum + r, 0) / returns.length
    : 0;
  const variance = returns.length > 0
    ? returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? roundTo(avgReturn / stdDev * Math.sqrt(252), 2) : 0;

  const passed = sampleCount >= 10 && priceCoveragePct >= 60 && navCoveragePct >= 60;

  return {
    summary: {
      trades: signals.length,
      totalProfit,
      totalReturnPct,
      winRatePct,
      maxDrawdownPct: roundTo(maxDrawdownPct, 2),
      sharpeRatio,
      finalEquity,
      sampleCount,
      priceCoveragePct,
      navCoveragePct,
      dataCoveragePct,
      passed
    },
    rows,
    signals,
    trades,
    chart: {
      candles: anchorCandles,
      markers: signals
    }
  };
}

function normalizeStrategy(input = {}) {
  return {
    highCodes: Array.isArray(input.highCodes) ? input.highCodes : [],
    lowCodes: Array.isArray(input.lowCodes) ? input.lowCodes : [],
    activeSide: ['all', 'H', 'L'].includes(input.activeSide) ? input.activeSide : 'all',
    intraSellLowerPct: clampNumber(input.intraSellLowerPct, 1),
    intraBuyOtherPct: clampNumber(input.intraBuyOtherPct, 3)
  };
}
