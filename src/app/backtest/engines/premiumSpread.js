/**
 * 溢价差轮动回测引擎 - 统一真源
 *
 * - 完整的持仓追踪（股数、成本、市值）
 * - 真实的交易模拟（买卖价、手续费、滑点）
 * - 准确的胜率计算（盈利交易/总交易）
 * - 专业指标（夏普比率、最大回撤）
 * - 基准对比（hold-high vs hold-low 收益）
 */

import { roundTo, clampNumber } from '../core/math.js';
import {
  shanghaiMinuteFromEpochSec,
  normalizeBacktestTimeframe
} from '../core/candles.js';
import { createTradeSimulator } from '../core/simulator.js';
import {
  buildPremiumLists,
  buildPremiumPanel,
  classifyPremiumCodes
} from '../core/premiumPanel.js';

function normalizeStrategy(input = {}) {
  return {
    id: String(input?.id || '').trim(),
    name: String(input?.name || '').trim(),
    highCodes: Array.isArray(input.highCodes) ? input.highCodes : [],
    lowCodes: Array.isArray(input.lowCodes) ? input.lowCodes : [],
    intraSellLowerPct: clampNumber(input.intraSellLowerPct, 0.2),
    intraBuyOtherPct: clampNumber(input.intraBuyOtherPct, 0.5),
    activeSide: ['H', 'L', 'all'].includes(input.activeSide) ? input.activeSide : 'all',
    initialSide: ['H', 'L'].includes(input.initialSide) ? input.initialSide : '',
    autoClassify: input.autoClassify !== false
  };
}

function pickPremiumSpreadTarget({ currentClass, from, highList, lowList, strategy }) {
  if (!from) return null;
  if (currentClass === 'H') {
    return lowList
      .map((item) => ({
        ...item,
        rule: 'B',
        threshold: strategy.intraBuyOtherPct,
        gapPct: roundTo(from.premiumPct - item.premiumPct, 4),
        targetReason: 'max_gap'
      }))
      .filter((item) => Number.isFinite(item.gapPct))
      .reduce((best, item) => (!best || item.gapPct > best.gapPct ? item : best), null);
  }
  if (currentClass === 'L') {
    return highList
      .map((item) => ({
        ...item,
        rule: 'A',
        threshold: strategy.intraSellLowerPct,
        gapPct: roundTo(item.premiumPct - from.premiumPct, 4),
        targetReason: 'min_gap'
      }))
      .filter((item) => Number.isFinite(item.gapPct))
      .reduce((best, item) => (!best || item.gapPct < best.gapPct ? item : best), null);
  }
  return null;
}

/**
 * 运行溢价差轮动回测
 * @param {Object} strategyInput - 策略配置
 * @param {Object} options - 回测选项
 * @returns {Object} 回测结果
 */
export function runPremiumSpreadBacktest(strategyInput = {}, options = {}) {
  const {
    timeframe = '5m',
    historyByCode = {},
    navHistoryByCode = {},
    crossBorderCodes,
    dataIssues = {},
    initialEquity = 100000,
    feeRate = 0.00005,  // 0.005% = 万0.5
    minFee = 0,
    tickSize = 0.001,
    slippageTicks = 1,
    lotSize = 100,
    silent = false
  } = options;

  const strategy = normalizeStrategy(strategyInput);
  const tf = normalizeBacktestTimeframe(timeframe);
  const codes = Array.from(new Set([
    ...(strategy.highCodes || []),
    ...(strategy.lowCodes || [])
  ]));

  const panel = buildPremiumPanel({ codes, historyByCode, navHistoryByCode, crossBorderCodes });
  const {
    anchorCode,
    anchorCandles,
    candleMap,
    closeByCode,
  } = panel;

  let highCodes = strategy.highCodes || [];
  let lowCodes = strategy.lowCodes || [];
  let avgPremiumByCode = null;
  let autoClassified = false;
  if (strategy.autoClassify && codes.length >= 2 && anchorCandles.length >= 10) {
    const classified = classifyPremiumCodes(panel, codes);
    const newHSet = new Set(classified.highCodes);
    const mismatch = highCodes.length !== classified.highCodes.length ||
      highCodes.some((code) => !newHSet.has(code));
    if (mismatch) {
      if (!silent) {
        console.log('[premiumSpread] 自适应 H/L 重分类:', {
          old: { H: highCodes, L: lowCodes },
          new: { H: classified.highCodes, L: classified.lowCodes },
          avgPremiumByCode: Object.fromEntries(
            Object.entries(classified.avgPremiumByCode).map(([code, value]) => [code, roundTo(value, 4)])
          )
        });
      }
      highCodes = classified.highCodes;
      lowCodes = classified.lowCodes;
      autoClassified = true;
    }
    avgPremiumByCode = classified.avgPremiumByCode;
  }

  const startEquity = Math.max(1, clampNumber(initialEquity, 100000));
  const simulator = createTradeSimulator({
    initialCash: startEquity,
    feeRate,
    minFee,
    lotSize,
    tickSize,
    slippageTicks
  });
  let equity = simulator.cash;
  let peak = equity;
  let maxDrawdownPct = 0;

  // 统计
  const trades = [];
  const rows = [];
  const signals = [];
  let switchCount = 0; // 轮动次数统计

  // 溢价分类
  const premiumClass = Object.fromEntries([
    ...highCodes.map((code) => [code, 'H']),
    ...lowCodes.map((code) => [code, 'L'])
  ]);

  let currentCode = '';
  let entryGapPct = null;

  // 初始化：选择初始持仓
  function pickInitialHolding(highList, lowList) {
    if (strategy.initialSide === 'L') {
      return lowList.reduce((best, item) =>
        (!best || item.premiumPct < best.premiumPct ? item : best), null
      ) || highList.reduce((best, item) =>
        (!best || item.premiumPct > best.premiumPct ? item : best), null
      );
    }
    if (strategy.initialSide === 'H') {
      return highList.reduce((best, item) =>
        (!best || item.premiumPct > best.premiumPct ? item : best), null
      ) || lowList.reduce((best, item) =>
        (!best || item.premiumPct < best.premiumPct ? item : best), null
      );
    }
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

  // 主循环
  if (!silent) {
    console.log('[premiumSpread] 开始主循环，总K线数:', anchorCandles.length);
    console.log('[premiumSpread] 代码列表:', codes);
    console.log('[premiumSpread] K线数据长度:', Object.fromEntries(codes.map(c => [c, candleMap[c]?.length])));
    console.log('[premiumSpread] NAV查询函数已构建');
  }

  for (const panelRow of panel.rows) {
    const anchor = panelRow.anchor;
    const anchorDatetime = panelRow.datetime || shanghaiMinuteFromEpochSec(anchor.t);
    const premiums = panelRow.premiums;
    const currentPrices = panelRow.currentPrices;
    const hasAllPrices = panelRow.hasAllPrices;

    // V2修复：即使数据不完整也继续，只是不执行交易
    // 这样至少能看到回测框架和数据覆盖率
    const canTrade = panelRow.canTrade;

    if (!hasAllPrices) {
      // 没有价格数据，跳过这个时间点
      continue;
    }

    // 计算当前权益
    equity = simulator.calcEquity(currentPrices);
    peak = Math.max(peak, equity);
    const drawdownPct = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
    maxDrawdownPct = Math.min(maxDrawdownPct, drawdownPct);

    // 构建H/L列表
    const { highList, lowList } = buildPremiumLists(panelRow, highCodes, lowCodes);

    // 初始化持仓（只在数据完整时）
    if (canTrade && (!currentCode || !Number.isFinite(premiums[currentCode]))) {
      const initial = pickInitialHolding(highList, lowList);
      currentCode = initial?.code || '';
      entryGapPct = null;

      // 用所有现金买入初始持仓；买入受 100 股一手约束时向上补到下一手，允许出现少量负现金。
      if (currentCode && simulator.cash > 0) {
        const bar = closeByCode[currentCode].get(anchor.t);
        const buyTrade = simulator.executeBuy(currentCode, bar, simulator.cash, { roundLotMode: 'ceil' });
        if (buyTrade) {
          trades.push({ ...buyTrade, ts: anchor.t, date: anchor.date, datetime: anchorDatetime });
          equity = simulator.calcEquity(currentPrices);
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
        datetime: anchorDatetime,
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
        cash: roundTo(simulator.cash, 2),
        positions: JSON.parse(JSON.stringify(simulator.positions))
      });
      continue;
    }

    // 判断交易信号
    const to = pickPremiumSpreadTarget({ currentClass, from, highList, lowList, strategy });
    const gapPct = Number(to?.gapPct);
    const rule = to?.rule || 'none';
    const threshold = Number(to?.threshold);

    if (!to || !Number.isFinite(gapPct)) {
      // 没有对手方或无效差价，记录数据但不交易
      rows.push({
        ts: anchor.t,
        date: anchor.date,
        datetime: anchorDatetime,
        fromCode: from.code,
        toCode: from.code,
        currentCode: from.code,
        currentClass,
        fromClass: currentClass,
        toClass: currentClass,
        highPremiumPct: 0,
        lowPremiumPct: 0,
        gapPct: 0,
        rule: 'none',
        threshold: 0,
        signal: 'wait',
        profit: 0,
        equity: roundTo(equity, 2),
        cash: roundTo(simulator.cash, 2),
        positions: JSON.parse(JSON.stringify(simulator.positions))
      });
      continue;
    }

    const sideAllowed = strategy.activeSide === 'all' || strategy.activeSide === currentClass;
    // 规则 B：持 H 时溢价差扩大，切到便宜的 L；规则 A：持 L 时溢价差回归，切回流动性好的 H。
    const triggered = canTrade && sideAllowed && (
      (rule === 'B' && gapPct >= strategy.intraBuyOtherPct) ||
      (rule === 'A' && gapPct <= strategy.intraSellLowerPct)
    );

    // 记录交易判断逻辑（每10行记录一次，避免日志过多）
    if (!silent && rows.length % 10 === 0) {
      console.log('[premiumSpread] 交易判断:', {
        date: anchor.date,
        fromCode: from.code,
        fromClass: currentClass,
        fromPremium: from.premiumPct,
        toCode: to?.code,
        toClass: premiumClass[to?.code] || '',
        toPremium: to?.premiumPct,
        gapPct,
        rule,
        threshold,
        sideAllowed,
        canTrade,
        triggered
      });
    }

    // 执行交易（只在数据完整时）
    if (triggered && canTrade) {
      switchCount += 1; // 记录轮动次数

      const fromBar = closeByCode[from.code].get(anchor.t);
      const toBar = closeByCode[to.code].get(anchor.t);

      // 卖出当前持仓
      const sellTrade = simulator.executeSell(from.code, fromBar);
      if (sellTrade) {
        trades.push({ ...sellTrade, ts: anchor.t, date: anchor.date, datetime: anchorDatetime });

        // V2 回测模拟的是满仓轮动：卖出后立即买入对侧。
        // 买入受 100 股一手约束时向上补到下一手，允许出现少量负现金。
        const buyTrade = simulator.executeBuy(to.code, toBar, simulator.cash, { roundLotMode: 'ceil' });
        if (buyTrade) {
          trades.push({ ...buyTrade, ts: anchor.t, date: anchor.date, datetime: anchorDatetime });
          currentCode = to.code;
        } else {
          currentCode = '';
        }
        equity = simulator.calcEquity(currentPrices);
      }

      signals.push({
        ts: anchor.t,
        date: anchor.date,
        datetime: anchorDatetime,
        fromCode: from.code,
        toCode: to.code,
        fromClass: currentClass,
        toClass: premiumClass[to.code] || '',
        rule,
        threshold,
        gapPct,
        targetReason: to.targetReason,
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
      datetime: anchorDatetime,
      fromCode: from.code,
      toCode: to.code,
      currentCode: displayCurrentCode,
      currentClass: displayCurrentClass,
      fromClass: currentClass,
      toClass: premiumClass[to.code] || '',
      highPremiumPct: currentClass === 'H' ? from.premiumPct : to.premiumPct,
      lowPremiumPct: currentClass === 'H' ? to.premiumPct : from.premiumPct,
      gapPct,
      rule,
      threshold,
      targetReason: to.targetReason,
      signal: triggered ? 'switch' : 'wait',
      profit: 0,
      equity: roundTo(equity, 2),
      cash: roundTo(simulator.cash, 2),
      positions: JSON.parse(JSON.stringify(simulator.positions))
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
  const finalEquity = simulator.calcEquity(finalPrices);

  // 统计
  const sampleCount = rows.length;
  const {
    completePriceRows,
    completeNavRows,
    priceCoveragePct,
    navCoveragePct,
    dataCoveragePct
  } = panel.coverage;

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

    // 计算高溢价基金的首尾价格
    const highCode = highCodes[0];
    const highFirstPrice = closeByCode[highCode]?.get(firstBar.t)?.close;
    const highLastPrice = closeByCode[highCode]?.get(lastBar.t)?.close;

    if (highFirstPrice && highLastPrice && highFirstPrice > 0) {
      holdHighReturnPct = roundTo(((highLastPrice - highFirstPrice) / highFirstPrice) * 100, 4);
    }

    // 计算低溢价基金的首尾价格
    const lowCode = lowCodes[0];
    const lowFirstPrice = closeByCode[lowCode]?.get(firstBar.t)?.close;
    const lowLastPrice = closeByCode[lowCode]?.get(lastBar.t)?.close;

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
      datetime: bar.datetime,
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
        datetime: signal.datetime,
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

  if (!silent) {
    console.log('[premiumSpread] 回测完成统计:', {
      completePriceRows,
      completeNavRows,
      totalRows: rows.length,
      trades: trades.length,
      switchCount,
      priceCoveragePct,
      navCoveragePct,
      passed
    });
  }

  return {
    ok: true,
    status: passed ? 'passed' : 'failed',
    timeframe: tf,
    strategyId: strategy.id,
    strategyName: strategy.name,
    generatedAt: new Date().toISOString(),
    autoClassified,
    effectiveHighCodes: highCodes,
    effectiveLowCodes: lowCodes,
    avgPremiumByCode: avgPremiumByCode
      ? Object.fromEntries(Object.entries(avgPremiumByCode).map(([code, value]) => [code, roundTo(value, 4)]))
      : null,
    summary: {
      trades: signals.length,
      signalCount: signals.length,
      tradeCount: trades.length,
      switchCount, // 轮动次数
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
            datetime: bar.datetime,
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
            datetime: bar.datetime,
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
