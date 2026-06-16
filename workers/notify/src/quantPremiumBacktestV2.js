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
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** digits;
  return Math.round((num + Number.EPSILON) * factor) / factor;
}

function clampNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function buildNavLookup(navHistory = []) {
  const sorted = (Array.isArray(navHistory) ? navHistory : [])
    .map((item) => {
      const date = String(item?.date || '').slice(0, 10);
      const nav = Number(item?.nav);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(nav) && nav > 0
        ? { date, nav }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
  return (date) => {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].date <= date) return sorted[i].nav;
    }
    return 0;
  };
}

function shanghaiDateFromEpochSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date(n * 1000).toISOString().slice(0, 10);
  }
}

function normalizeBacktestTimeframe(value = '') {
  const tf = String(value || '').trim();
  return new Set(['1m', '5m', '15m', '30m', '60m', '1d']).has(tf) ? tf : '5m';
}

function normalizeBacktestCandles(candles = []) {
  return (Array.isArray(candles) ? candles : [])
    .map((bar) => {
      const t = Number(bar?.t ?? bar?.timestamp);
      const close = Number(bar?.c ?? bar?.close);
      if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(close) || close <= 0) return null;
      const open = Number(bar?.o ?? bar?.open);
      const high = Number(bar?.h ?? bar?.high);
      const low = Number(bar?.l ?? bar?.low);
      return {
        t,
        date: String(bar?.date || '').slice(0, 10) || shanghaiDateFromEpochSec(t),
        open: Number.isFinite(open) && open > 0 ? open : close,
        high: Number.isFinite(high) && high > 0 ? high : close,
        low: Number.isFinite(low) && low > 0 ? low : close,
        close
      };
    })
    .filter(Boolean)
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
    feeRate = 0.00005,  // 0.005% = 万0.5
    minFee = 0,
    tickSize = 0.001,
    slippageTicks = 1,
    lotSize = 100
  } = options;

  const strategy = normalizeStrategy(strategyInput);
  const tf = normalizeBacktestTimeframe(timeframe);
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
  const startEquity = Math.max(1, clampNumber(initialEquity, 100000));
  let cash = startEquity;
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
  function executeSell(code, bar) {
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
  function executeBuy(code, bar, targetCash = cash) {
    const buyPrice = bar.close + slippageTicks * tickSize; // 滑点
    const spendLimit = Math.min(cash, Math.max(0, clampNumber(targetCash, cash)));
    let maxShares = Math.floor(spendLimit / buyPrice / lotSize) * lotSize;

    while (maxShares > 0) {
      const buyAmount = roundTo(maxShares * buyPrice, 2);
      const fee = calcFee(buyAmount);
      const totalCost = roundTo(buyAmount + fee, 2);
      if (totalCost <= spendLimit && totalCost <= cash) {
        cash = roundTo(cash - totalCost, 2);
        positions[code] = {
          shares: maxShares,
          costPrice: roundTo(totalCost / maxShares, 4)
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
      maxShares -= lotSize;
    }

    return null;
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

    // V2修复：即使数据不完整也继续，只是不执行交易
    // 这样至少能看到回测框架和数据覆盖率
    const canTrade = hasAllPrices && hasAllNav;

    if (!hasAllPrices) {
      // 没有价格数据，跳过这个时间点
      continue;
    }

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

    // 初始化持仓（只在数据完整时）
    if (canTrade && (!currentCode || !Number.isFinite(premiums[currentCode]))) {
      const initial = pickInitialHolding(highList, lowList);
      currentCode = initial?.code || '';
      entryGapPct = null;

      // 用所有现金买入初始持仓
      if (currentCode && cash > 0) {
        const bar = closeByCode[currentCode].get(anchor.t);
        const buyTrade = executeBuy(currentCode, bar, cash);
        if (buyTrade) {
          trades.push({ ...buyTrade, ts: anchor.t, date: anchor.date });
          equity = calcEquity(currentPrices);
        }
      }
    }

    const currentClass = premiumClass[currentCode] || '';
    const currentPremiumPct = premiums[currentCode];
    const from = currentCode && Number.isFinite(currentPremiumPct)
      ? { code: currentCode, premiumPct: currentPremiumPct }
      : null;

    if (!from) {
      // 没有持仓或无效溢价，记录数据行
      rows.push({
        ts: anchor.t,
        date: anchor.date,
        fromCode: '',
        toCode: '',
        currentCode: '',
        currentClass: '',
        highPremiumPct: 0,
        lowPremiumPct: 0,
        gapPct: 0,
        rule: 'none',
        threshold: 0,
        signal: 'wait',
        profit: 0,
        equity: roundTo(equity, 2),
        cash: roundTo(cash, 2),
        positions: JSON.parse(JSON.stringify(positions))
      });
      continue;
    }

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

    if (!to || !Number.isFinite(gapPct)) {
      // 没有对手方或无效差价，记录数据但不交易
      rows.push({
        ts: anchor.t,
        date: anchor.date,
        fromCode: from.code,
        toCode: from.code,
        currentCode: from.code,
        currentClass,
        highPremiumPct: 0,
        lowPremiumPct: 0,
        gapPct: 0,
        rule: 'none',
        threshold: 0,
        signal: 'wait',
        profit: 0,
        equity: roundTo(equity, 2),
        cash: roundTo(cash, 2),
        positions: JSON.parse(JSON.stringify(positions))
      });
      continue;
    }

    const sideAllowed = strategy.activeSide === 'all' || strategy.activeSide === currentClass;
    const triggered = canTrade && sideAllowed && (
      (rule === 'B' && gapPct >= strategy.intraBuyOtherPct) ||
      (rule === 'A' && gapPct <= strategy.intraSellLowerPct)
    );

    // 执行交易（只在数据完整时）
    if (triggered && canTrade) {
      const fromBar = closeByCode[from.code].get(anchor.t);
      const toBar = closeByCode[to.code].get(anchor.t);

      // 卖出当前持仓
      const sellTrade = executeSell(from.code, fromBar);
      if (sellTrade) {
        trades.push({ ...sellTrade, ts: anchor.t, date: anchor.date });

        // V2 回测模拟的是满仓轮动：卖出后立即用可用现金买入对侧，
        // 仅因手续费和 100 股一手约束保留少量现金零头。
        const buyTrade = executeBuy(to.code, toBar, cash);
        if (buyTrade) {
          trades.push({ ...buyTrade, ts: anchor.t, date: anchor.date });
          currentCode = to.code;
        } else {
          currentCode = '';
        }
        equity = calcEquity(currentPrices);
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
    }

    const displayCurrentCode = triggered ? currentCode : from.code;
    const displayCurrentClass = premiumClass[displayCurrentCode] || (triggered ? '' : currentClass);

    rows.push({
      ts: anchor.t,
      date: anchor.date,
      fromCode: from.code,
      toCode: to.code,
      currentCode: displayCurrentCode,
      currentClass: displayCurrentClass,
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

  const totalProfit = roundTo(finalEquity - startEquity, 2);
  const totalReturnPct = startEquity > 0
    ? roundTo((totalProfit / startEquity) * 100, 4)
    : 0;

  // 计算单独持有高溢价和低溢价基金的收益（用于对比）
  let holdHighReturnPct = null;
  let holdLowReturnPct = null;

  if (anchorCandles.length > 1 && highCodes.length > 0 && lowCodes.length > 0) {
    const firstBar = anchorCandles[0];
    const lastBar = anchorCandles[anchorCandles.length - 1];

    console.log('[持有收益] 回测期间:', {
      from: firstBar.date,
      to: lastBar.date,
      firstTs: firstBar.t,
      lastTs: lastBar.t
    });

    // 计算高溢价基金的首尾价格
    const highCode = highCodes[0];
    const highFirstPrice = closeByCode[highCode]?.get(firstBar.t)?.close;
    const highLastPrice = closeByCode[highCode]?.get(lastBar.t)?.close;

    console.log('[持有收益] 高溢价基金:', {
      code: highCode,
      firstPrice: highFirstPrice,
      lastPrice: highLastPrice,
      hasData: !!closeByCode[highCode],
      dataPoints: closeByCode[highCode]?.size || 0
    });

    if (highFirstPrice && highLastPrice && highFirstPrice > 0) {
      holdHighReturnPct = roundTo(((highLastPrice - highFirstPrice) / highFirstPrice) * 100, 4);
    }

    // 计算低溢价基金的首尾价格
    const lowCode = lowCodes[0];
    const lowFirstPrice = closeByCode[lowCode]?.get(firstBar.t)?.close;
    const lowLastPrice = closeByCode[lowCode]?.get(lastBar.t)?.close;

    console.log('[持有收益] 低溢价基金:', {
      code: lowCode,
      firstPrice: lowFirstPrice,
      lastPrice: lowLastPrice,
      hasData: !!closeByCode[lowCode],
      dataPoints: closeByCode[lowCode]?.size || 0
    });

    if (lowFirstPrice && lowLastPrice && lowFirstPrice > 0) {
      holdLowReturnPct = roundTo(((lowLastPrice - lowFirstPrice) / lowFirstPrice) * 100, 4);
    }
  }

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
  const klineIssues = Array.isArray(dataIssues?.kline) ? dataIssues.kline : [];
  const missingKlineCodes = Array.from(new Set([
    ...klineIssues.map((item) => String(item?.code || '').trim()).filter(Boolean),
    ...codes.filter((code) => !(candleMap[code]?.length > 0))
  ]));
  const qualityReason = passed
    ? '数据覆盖率满足回测门槛'
    : missingKlineCodes.length
      ? `缺少 ${missingKlineCodes.join('、')} 的 ${tf} 历史 K 线，已按回测失败处理`
      : '样本或 NAV/价格覆盖率不足';

  const chartCandles = anchorCandles.map((bar) => {
    const open = roundTo(bar.open, 4);
    const high = roundTo(bar.high, 4);
    const low = roundTo(bar.low, 4);
    const close = roundTo(bar.close, 4);
    return {
      t: bar.t,
      date: bar.date,
      o: open,
      h: high,
      l: low,
      c: close,
      open,
      high,
      low,
      close
    };
  });
  const chartTs = new Set(chartCandles.map((bar) => bar.t));
  const chartMarkers = signals
    .filter((signal) => chartTs.has(signal.ts))
    .map((signal) => {
      const bar = closeByCode[anchorCode]?.get(signal.ts);
      const isSell = signal.fromCode === anchorCode;
      const isBuy = signal.toCode === anchorCode;
      const side = isSell ? 'sell' : isBuy ? 'buy' : 'signal';
      const markerPrice = side === 'sell'
        ? Number(bar?.high ?? bar?.close)
        : side === 'buy'
          ? Number(bar?.low ?? bar?.close)
          : Number(bar?.close);
      return {
        ts: signal.ts,
        date: signal.date,
        side,
        price: roundTo(Number.isFinite(markerPrice) && markerPrice > 0 ? markerPrice : bar?.close, 4),
        fromCode: signal.fromCode,
        toCode: signal.toCode,
        rule: signal.rule,
        gapPct: signal.gapPct,
        label: side === 'sell'
          ? `卖 ${signal.fromCode} → 买 ${signal.toCode}`
          : side === 'buy'
            ? `卖 ${signal.fromCode} → 买 ${signal.toCode}`
            : `${signal.fromCode} → ${signal.toCode}`
      };
    });

  return {
    ok: true,
    status: passed ? 'passed' : 'failed',
    timeframe: tf,
    strategyId: strategy.id,
    strategyName: strategy.name,
    generatedAt: new Date().toISOString(),
    summary: {
      trades: signals.length,
      signalCount: signals.length,
      tradeCount: trades.length,
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
      passed,
      from: rows[0]?.date || '',
      to: rows[rows.length - 1]?.date || '',
      // 持有收益对比
      holdHighReturnPct,
      holdLowReturnPct,
      highCode: highCodes[0] || '',
      lowCode: lowCodes[0] || ''
    },
    rows: rows.slice(-500),
    signals: signals.slice(-120),
    trades,
    chart: {
      code: anchorCode,
      timeframe: tf,
      candles: chartCandles,
      markers: chartMarkers,
      // 添加高溢价和低溢价的K线数据
      highCode: highCodes[0] || '',
      lowCode: lowCodes[0] || '',
      highCandles: highCodes[0] && closeByCode[highCodes[0]]
        ? Array.from(closeByCode[highCodes[0]].values()).map(bar => ({
            t: bar.t,
            date: bar.date,
            open: roundTo(bar.open, 4),
            high: roundTo(bar.high, 4),
            low: roundTo(bar.low, 4),
            close: roundTo(bar.close, 4)
          })).slice(-500)
        : [],
      lowCandles: lowCodes[0] && closeByCode[lowCodes[0]]
        ? Array.from(closeByCode[lowCodes[0]].values()).map(bar => ({
            t: bar.t,
            date: bar.date,
            open: roundTo(bar.open, 4),
            high: roundTo(bar.high, 4),
            low: roundTo(bar.low, 4),
            close: roundTo(bar.close, 4)
          })).slice(-500)
        : []
    },
    quality: {
      passed,
      reason: qualityReason,
      anchorCode,
      anchorBars: anchorCandles.length,
      missingKlineCodes,
      klineIssues,
      supportedTimeframes: ['1m', '5m', '15m', '30m', '60m', '1d']
    }
  };
}

function normalizeStrategy(input = {}) {
  return {
    id: String(input.id || input.strategyId || 'default').trim() || 'default',
    name: String(input.name || '纳指 ETF 溢价差').trim().slice(0, 60),
    highCodes: Array.isArray(input.highCodes) ? input.highCodes : [],
    lowCodes: Array.isArray(input.lowCodes) ? input.lowCodes : [],
    activeSide: ['all', 'H', 'L'].includes(input.activeSide) ? input.activeSide : 'all',
    intraSellLowerPct: clampNumber(input.intraSellLowerPct, 1),
    intraBuyOtherPct: clampNumber(input.intraBuyOtherPct, 3)
  };
}
