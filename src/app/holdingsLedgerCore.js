/**
 * Holdings ledger core: lot-level BUY / SELL transactions + per-code aggregation
 * + portfolio-level summary. Mirrors the Excel model the user already uses:
 *   - 每笔交易单单独一行（BUY/SELL）
 *   - 按基金代码聚合 → 总份额 / 平均成本 / 总收益 / 当日收益
 *   - 平均成本 = 按买入批次扣减后的剩余持仓成本 / 剩余份额。
 *     按交易日期顺序逐笔处理：
 *       · BUY：追加一个买入批次（shares / cost）。
 *       · SELL：按先进先出消耗买入批次，清仓收益按被消耗批次的成本结算；
 *         剩余持仓只保留未卖出批次的成本，所以卖出后平均成本可能变化。
 *     这样「卖掉低成本批次 → 剩余高成本批次」场景下，基金汇总会与南方基金
 *     等 App 的持仓成本更一致，也能避免把已卖出批次继续摊到剩余份额里。
 *   - 总份额 = 当前持仓份额（客态全部卖光则 0）
 *   - 总收益仅算未实现（mark-to-market），不包含卖出已实现盈亏
 *   - 当日收益 = (latestNav − previousNav) × totalShares
 *     仅当持仓的 latestNavDate === "该 kind 的预期最新 NAV 日期" 时计入：
 *       · exchange（场内 ETF）：盘中实时，预期 = 今日（非交易日则上一个工作日）。
 *       · otc（境内场外）：T 日 NAV 在 T 日晚（约 21:00）发布，预期 = 今日（非交易日回退到上一个工作日）。
 *         T 日早晨 NAV 尚未发布时 isLatestNavToday=false，"当日收益"留空，避免把 T-1 涨跌误显示成今日。
 *       · qdii（场外 QDII，海外标的）：净值 T+1 发布，预期 = 上一个工作日。周一回退到上周五（T-3），
 *         周二~周五回退到前一天（T-1）；这样 4-24（周五）的 NAV 在周一就能正确视为"最新可用"NAV。
 *   - QDII 识别：优先看 transaction.kind，否则按持仓名称中的关键词（QDII / 纳指 / 标普 / 海外… ）+
 *     代码白名单兜底；都不命中则按代码前缀分 exchange / otc 两档。
 */

import { countHolidayWorkdaysBetween, calendarDaysBetween } from './holidaysCN.js';
import {
  FUND_CODE_PATTERN,
  TRANSACTION_TYPES,
  getExpectedLatestNavDate,
  getTodayShanghaiDate,
  normalizeFundCode,
  normalizeFundKind,
  normalizeIsoDate,
  normalizeTransaction,
  round,
  sanitizeTransactions
} from './holdingsLedgerBasics.js';

export {
  EXCHANGE_PREFIXES,
  FUND_CODE_PATTERN,
  FUND_KINDS,
  TRANSACTION_TYPES,
  buildTransactionId,
  createEmptyTransaction,
  detectFundKind,
  detectQdiiByName,
  getExpectedLatestNavDate,
  getLedgerCodeList,
  getTodayShanghaiDate,
  getTransactionErrors,
  hasMeaningfulTransaction,
  isValidFundCode,
  normalizeFundCode,
  normalizeFundKind,
  normalizeFundName,
  normalizeIsoDate,
  normalizeTransaction,
  normalizeTransactionType,
  round,
  sanitizeTransactions,
  summarizeTransactionErrors
} from './holdingsLedgerBasics.js';
export { parseExcelPaste } from './holdingsLedgerPaste.js';
export {
  computeSwitchChainMetrics,
  normalizeSwitchChain,
  normalizeSwitchChains
} from './holdingsSwitchChains.js';

/**
 * 仅返回「当前仍有持仓」的 code list：跑一遍移动摊薄（与 aggregateByCode 一致），
 * 只保留 BUY/SELL 抵冲后 totalShares > 0 的 code。
 * 适用于净值拉取、行情刷新 等“只需要活跃持仓”的场景，避免给已清仓的 code 调 nav 接口。
 * SELL 带 costPrice 时仍要扣减已有持仓；若本地没有对应 BUY 批次，则视为独立已结清记录。
 */
export function getActiveHoldingCodeList(transactions = []) {
  const normalizedTxs = sanitizeTransactions(transactions, { filterInvalid: false });
  const txsByCode = new Map();
  for (const tx of normalizedTxs) {
    if (!tx.code) continue;
    if (!FUND_CODE_PATTERN.test(tx.code)) continue;
    if (!txsByCode.has(tx.code)) txsByCode.set(tx.code, []);
    txsByCode.get(tx.code).push(tx);
  }
  const active = [];
  for (const [code, txs] of txsByCode) {
    const sortedTxs = [...txs].sort(compareTxChrono);
    let runShares = 0;
    for (const tx of sortedTxs) {
      if (tx.type === 'BUY') {
        runShares = round(runShares + tx.shares, 4);
      } else if (tx.type === 'SELL') {
        if (isPendingOtcSell(tx)) continue;
        runShares = round(runShares - tx.shares, 4);
        if (runShares <= 0) runShares = 0;
      }
    }
    if (runShares > 0) active.push(code);
  }
  return active.sort();
}

/**
 * 返回「出现在基金切换链路里」的所有 code（仅依赖 SELL.switchPairId 标注推导）。
 * 用途：NAV 刷新时连同已清仓但仍作为「未切换基准」参照的代码一并刷新，
 * 避免 baseline 价冻结在切换那天的口子。
 */
export function getSwitchChainCodeList(transactions = []) {
  const normalizedTxs = sanitizeTransactions(transactions, { filterInvalid: false });
  const txById = new Map();
  for (const tx of normalizedTxs) {
    if (tx && tx.id) txById.set(tx.id, tx);
  }
  const codes = new Set();
  for (const tx of normalizedTxs) {
    if (tx.type !== 'SELL' || !tx.switchPairId) continue;
    const pair = txById.get(tx.switchPairId);
    if (!pair || pair.type !== 'BUY' || !pair.code) continue;
    if (pair.code === tx.code) continue;
    if (tx.code && FUND_CODE_PATTERN.test(tx.code)) codes.add(tx.code);
    if (pair.code && FUND_CODE_PATTERN.test(pair.code)) codes.add(pair.code);
  }
  return [...codes].sort();
}

/** Metrics per lot/row, matching the Excel "成交流水" sheet columns. */
export function buildLotMetrics(tx = {}, snapshot = null, options = {}) {
  const normalized = normalizeTransaction(tx);
  const latestNav = round(Number(snapshot?.latestNav) || 0, 4);
  const previousNav = round(Number(snapshot?.previousNav) || 0, 4);
  const hasLatestNav = latestNav > 0;
  const hasPreviousNav = previousNav > 0;
  const latestNavDate = String(snapshot?.latestNavDate || '');
  const todayDate = String(options?.todayDate || getTodayShanghaiDate());
  // 场内 ETF 今日实时；境内场外 T 日晚发布；QDII T+1 发布（周一 → 上周五）。
  // 同样按名称+代码重新识别 QDII，避免存量 kind='otc' 误判。
  const resolvedKind = normalizeFundKind(normalized.kind, normalized.code, normalized.name || snapshot?.name || '');
  const expectedLatestNavDate = getExpectedLatestNavDate(resolvedKind, todayDate);
  const isLatestNavToday = !!latestNavDate
    && latestNavDate >= expectedLatestNavDate
    && latestNavDate <= todayDate;
  const cost = round(normalized.price * normalized.shares, 2);

  // 场内基金用实时价格估值，场外/QDII 用净值
  const isExchange = resolvedKind === 'exchange';
  const price = round(Number(snapshot?.price) || 0, 4);
  const previousClose = round(Number(snapshot?.previousClose) || 0, 4);
  const hasPrice = isExchange && price > 0;
  const hasPreviousClose = isExchange && previousClose > 0;
  const valuationPrice = hasPrice ? price : latestNav;
  const hasValuation = hasPrice || hasLatestNav;
  const prevPrice = hasPreviousClose ? previousClose : previousNav;
  const hasPrevPrice = hasPreviousClose || hasPreviousNav;
  const isFreshForToday = hasPrice || isLatestNavToday;

  if (normalized.type === 'SELL') {
    const proceeds = round(normalized.price * normalized.shares, 2);
    return {
      tx: normalized,
      isSell: true,
      isBuy: false,
      displayShares: normalized.shares,
      costBasis: cost,
      proceeds,
      marketValue: 0,
      unrealizedProfit: 0,
      unrealizedReturnRate: 0,
      todayProfit: 0,
      todayReturnRate: 0,
      hasLatestNav,
      hasPreviousNav,
      hasTodayNav: false,
      latestNav,
      previousNav,
      latestNavDate,
      previousNavDate: String(snapshot?.previousNavDate || '')
    };
  }

  const marketValue = hasValuation ? round(valuationPrice * normalized.shares, 2) : 0;
  const unrealizedProfit = hasValuation ? round((valuationPrice - normalized.price) * normalized.shares, 2) : 0;
  const unrealizedReturnRate = hasValuation && cost > 0 ? round((unrealizedProfit / cost) * 100, 2) : 0;
  const todayProfit = hasValuation && hasPrevPrice && isFreshForToday
    ? round((valuationPrice - prevPrice) * normalized.shares, 2)
    : 0;
  const previousValue = hasPrevPrice && isFreshForToday ? prevPrice * normalized.shares : 0;
  const todayReturnRate = hasValuation && hasPrevPrice && isFreshForToday && previousValue > 0
    ? round((todayProfit / previousValue) * 100, 2)
    : 0;

  const previousNavDateStr = String(snapshot?.previousNavDate || '');
  const todayProfitSpanDays = isLatestNavToday && previousNavDateStr && latestNavDate ? Math.max(0, calendarDaysBetween(previousNavDateStr, latestNavDate)) : 0;
  const todayProfitHolidayDays = isLatestNavToday && previousNavDateStr && latestNavDate ? countHolidayWorkdaysBetween(previousNavDateStr, latestNavDate) : 0;
  return {
    tx: normalized,
    isSell: false,
    isBuy: true,
    displayShares: normalized.shares,
    costBasis: cost,
    proceeds: 0,
    marketValue,
    unrealizedProfit,
    unrealizedReturnRate,
    todayProfit,
    todayReturnRate,
    hasLatestNav,
    hasPreviousNav,
    hasTodayNav: isFreshForToday,
    latestNav,
    previousNav,
    latestNavDate,
    previousNavDate: previousNavDateStr,
    todayProfitSpanDays,
    todayProfitHolidayDays
  };
}

/** Group transactions by fund code and produce the Excel "基金汇总" sheet shape. */
/**
 * 同一代码下交易的按时间顺序比较器：日期升序 → 同日 BUY 先于 SELL → id 字典序兑底。
 * 保证移动摊薄遇同日买卖时 SELL 不会看到未完成的 BUY，也与 buildSoldLots 顺序一致。
 */
function compareTxChrono(a, b) {
  const da = String(a?.date || '');
  const db = String(b?.date || '');
  if (da !== db) return da < db ? -1 : 1;
  const ta = a?.type === 'BUY' ? 0 : 1;
  const tb = b?.type === 'BUY' ? 0 : 1;
  if (ta !== tb) return ta - tb;
  const ia = String(a?.id || '');
  const ib = String(b?.id || '');
  return ia < ib ? -1 : (ia > ib ? 1 : 0);
}

/**
 * 场外/QDII 基金 SELL 提交后到 NAV 公布前：price 为空/0，算作「待确认」。
 * 参考支付宝/天天基金的 UX：仓位/清仓明细不提前扣减份额，等净值回填后才转为正常已结算。
 * costPrice > 0 的独立已结算交易不走待确认。
 */
export function isPendingOtcSell(tx) {
  if (!tx || tx.type !== 'SELL') return false;
  if (Number(tx.costPrice) > 0) return false;
  const kind = String(tx.kind || '').toLowerCase();
  if (kind !== 'otc' && kind !== 'qdii') return false;
  return !(Number(tx.price) > 0);
}

function pushCostLot(lots, shares, price) {
  const qty = round(Number(shares) || 0, 4);
  const px = Number(price) || 0;
  if (!(qty > 0) || !(px > 0)) return;
  lots.push({ shares: qty, cost: round(qty * px, 6) });
}

function consumeCostLots(lots, shares) {
  let remaining = round(Number(shares) || 0, 4);
  let consumedShares = 0;
  let consumedCost = 0;
  while (remaining > 0 && lots.length) {
    const lot = lots[0];
    const lotShares = round(Number(lot.shares) || 0, 4);
    const lotCost = Number(lot.cost) || 0;
    if (!(lotShares > 0) || !(lotCost >= 0)) {
      lots.shift();
      continue;
    }
    const take = Math.min(lotShares, remaining);
    const unitCost = lotCost / lotShares;
    const takeCost = round(unitCost * take, 6);
    consumedShares = round(consumedShares + take, 4);
    consumedCost = round(consumedCost + takeCost, 6);
    const leftShares = round(lotShares - take, 4);
    if (leftShares <= 0.000001) {
      lots.shift();
    } else {
      lot.shares = leftShares;
      lot.cost = round(Math.max(lotCost - takeCost, 0), 6);
    }
    remaining = round(remaining - take, 4);
  }
  return {
    consumedShares,
    consumedCost,
    avgCost: consumedShares > 0 ? consumedCost / consumedShares : 0
  };
}

function summarizeCostLots(lots) {
  const totalShares = round(lots.reduce((sum, lot) => sum + (Number(lot.shares) || 0), 0), 4);
  const totalCost = round(lots.reduce((sum, lot) => sum + (Number(lot.cost) || 0), 0), 2);
  return {
    totalShares,
    totalCost,
    avgCost: totalShares > 0 ? round(totalCost / totalShares, 4) : 0
  };
}

export function aggregateByCode(transactions = [], snapshotsByCode = {}, options = {}) {
  const normalizedTxs = sanitizeTransactions(transactions, { filterInvalid: false });
  const map = new Map();
  const todayDate = String(options?.todayDate || getTodayShanghaiDate());

  for (const tx of normalizedTxs) {
    if (!tx.code) continue;
    if (!map.has(tx.code)) {
      map.set(tx.code, {
        code: tx.code,
        name: tx.name,
        kind: tx.kind,
        transactions: [],
        buyShares: 0,
        buyAmount: 0,
        sellShares: 0,
        sellAmount: 0,
        pendingSellShares: 0,
        firstBuyDate: '',
        lastTxDate: ''
      });
    }
    const bucket = map.get(tx.code);
    bucket.transactions.push(tx);
    if (tx.name && !bucket.name) {
      bucket.name = tx.name;
    }
    if (tx.kind) {
      bucket.kind = tx.kind;
    }
    if (tx.type === 'BUY') {
      bucket.buyShares = round(bucket.buyShares + tx.shares, 4);
      bucket.buyAmount = round(bucket.buyAmount + tx.price * tx.shares, 2);
      if (tx.date && (!bucket.firstBuyDate || tx.date < bucket.firstBuyDate)) {
        bucket.firstBuyDate = tx.date;
      }
    } else if (tx.type === 'SELL') {
      if (isPendingOtcSell(tx)) {
        // 待确认（场外/QDII、NAV 未回填）：记为 pending，不入 sellShares/sellAmount。
        bucket.pendingSellShares = round(bucket.pendingSellShares + tx.shares, 4);
      } else {
        // 即使 SELL 带 costPrice，也仍要作为卖出份额计入汇总；costPrice 只影响清仓收益口径。
        bucket.sellShares = round(bucket.sellShares + tx.shares, 4);
        bucket.sellAmount = round(bucket.sellAmount + tx.price * tx.shares, 2);
      }
    }
    if (tx.date && tx.date > bucket.lastTxDate) {
      bucket.lastTxDate = tx.date;
    }
  }

  // 第二趟：按交易日期逐笔走买入批次，计算剩余持仓 avgCost / totalCost。
  // SELL 按 FIFO 消耗买入批次；卖出后剩余批次的均价可能变化。
  for (const bucket of map.values()) {
    const sortedTxs = [...bucket.transactions].sort(compareTxChrono);
    const costLots = [];
    for (const tx of sortedTxs) {
      if (tx.type === 'BUY') {
        pushCostLot(costLots, tx.shares, tx.price);
      } else if (tx.type === 'SELL') {
        // 待确认 SELL（场外/QDII NAV 未回填）：份额不提前扣减，等 NAV 回填后自动生效。
        if (isPendingOtcSell(tx)) continue;
        // costPrice 只是该笔清仓收益的成本覆盖值；若本地存在 BUY 批次，基金汇总仍必须扣减这些份额。
        consumeCostLots(costLots, tx.shares);
      }
    }
    const lotSummary = summarizeCostLots(costLots);
    bucket.movingAvgCost = lotSummary.avgCost;
    bucket.movingTotalCost = lotSummary.totalCost;
    bucket.movingTotalShares = lotSummary.totalShares;
  }

  const aggregates = [];
  for (const bucket of map.values()) {
    const snapshot = snapshotsByCode?.[bucket.code] || null;
    const latestNav = round(Number(snapshot?.latestNav) || 0, 4);
    const previousNav = round(Number(snapshot?.previousNav) || 0, 4);
    const hasLatestNav = latestNav > 0;
    const hasPreviousNav = previousNav > 0;
    const latestNavDateStr = String(snapshot?.latestNavDate || '');
    // 重新根据代码 + 名称识别 QDII：存量交易 kind='otc' 的 QDII 基金会在此升级为 'qdii'。
    const resolvedName = bucket.name || snapshot?.name || '';
    const resolvedKind = normalizeFundKind(bucket.kind, bucket.code, resolvedName);
    bucket.kind = resolvedKind;
    const expectedLatestNavDate = getExpectedLatestNavDate(resolvedKind, todayDate);
    const isLatestNavToday = !!latestNavDateStr
      && latestNavDateStr >= expectedLatestNavDate
      && latestNavDateStr <= todayDate;

    // 场内基金用实时价格估值，场外/QDII 用净值
    const isExchange = resolvedKind === 'exchange';
    const price = round(Number(snapshot?.price) || 0, 4);
    const previousClose = round(Number(snapshot?.previousClose) || 0, 4);
    const hasPrice = isExchange && price > 0;
    const hasPreviousClose = isExchange && previousClose > 0;

    // 估值基准：场内用市场价，场外/QDII 用净值
    const valuationPrice = hasPrice ? price : latestNav;
    const hasValuation = hasPrice || hasLatestNav;
    // 今日涨跌基准：场内用昨收，场外/QDII 用前日净值
    const prevPrice = hasPreviousClose ? previousClose : previousNav;
    const hasPrevPrice = hasPreviousClose || hasPreviousNav;
    // 场内实时价格无需日期校验，场外/QDII 需要 NAV 日期新鲜度检查
    const isFreshForToday = hasPrice || isLatestNavToday;

    // 买入批次扣减法：详见上方第二趟计算。
    // BUY 追加批次；SELL 按 FIFO 消耗批次；剩余成本和均价只来自未卖出的批次。
    const totalShares = bucket.movingTotalShares;
    const avgCost = bucket.movingAvgCost;
    const totalCost = bucket.movingTotalCost;
    const marketValue = hasValuation && totalShares > 0 ? round(totalShares * valuationPrice, 2) : 0;
    const unrealizedProfit = hasValuation && totalShares > 0 ? round(marketValue - totalCost, 2) : 0;
    const unrealizedReturnRate = totalCost > 0 ? round((unrealizedProfit / totalCost) * 100, 2) : 0;
    const todayProfit = hasValuation && hasPrevPrice && totalShares > 0 && isFreshForToday
      ? round((valuationPrice - prevPrice) * totalShares, 2)
      : 0;
    const previousValue = hasPrevPrice && totalShares > 0 && isFreshForToday ? prevPrice * totalShares : 0;
    const todayReturnRate = previousValue > 0
      ? round((todayProfit / previousValue) * 100, 2)
      : 0;

    const aggLatestNavDateStr = String(snapshot?.latestNavDate || '');
    const aggPreviousNavDateStr = String(snapshot?.previousNavDate || '');
    const aggTodayProfitSpanDays = isLatestNavToday && aggPreviousNavDateStr && aggLatestNavDateStr
      ? Math.max(0, calendarDaysBetween(aggPreviousNavDateStr, aggLatestNavDateStr))
      : 0;
    const aggTodayProfitHolidayDays = isLatestNavToday && aggPreviousNavDateStr && aggLatestNavDateStr
      ? countHolidayWorkdaysBetween(aggPreviousNavDateStr, aggLatestNavDateStr)
      : 0;
    aggregates.push({
      code: bucket.code,
      name: bucket.name || snapshot?.name || '',
      kind: bucket.kind,
      transactions: bucket.transactions,
      buyShares: bucket.buyShares,
      sellShares: bucket.sellShares,
      pendingSellShares: bucket.pendingSellShares || 0,
      totalShares,
      avgCost,
      totalCost,
      latestNav,
      previousNav,
      latestNavDate: aggLatestNavDateStr,
      previousNavDate: aggPreviousNavDateStr,
      price,
      previousClose,
      hasPrice,
      valuationPrice,
      marketValue,
      unrealizedProfit,
      unrealizedReturnRate,
      todayProfit,
      todayReturnRate,
      previousValue: round(previousValue, 2),
      hasPosition: totalShares > 0,
      hasLatestNav,
      hasPreviousNav,
      hasTodayNav: isFreshForToday,
      todayProfitSpanDays: aggTodayProfitSpanDays,
      todayProfitHolidayDays: aggTodayProfitHolidayDays,
      snapshotError: String(snapshot?.error || ''),
      firstBuyDate: bucket.firstBuyDate,
      lastTxDate: bucket.lastTxDate,
      snapshotUpdatedAt: String(snapshot?.updatedAt || '')
    });
  }

  aggregates.sort((a, b) => {
    if (a.hasPosition !== b.hasPosition) return a.hasPosition ? -1 : 1;
    if (b.marketValue !== a.marketValue) return b.marketValue - a.marketValue;
    return a.code.localeCompare(b.code);
  });

  return aggregates;
}

/** Portfolio-level summary card numbers matching the Excel "投资组合概览". */
export function summarizePortfolio(aggregates = [], soldSummary = null) {
  const summary = {
    assetCount: 0,
    recordedCodeCount: (Array.isArray(aggregates) ? aggregates : []).length,
    totalCost: 0,
    marketValue: 0,
    unrealizedProfit: 0,
    unrealizedReturnRate: 0,
    todayProfit: 0,
    todayReturnRate: 0,
    previousMarketValue: 0,
    pricedCount: 0,
    todayReadyCount: 0,
    latestNavDate: '',
    latestSnapshotAt: '',
    failedCodes: []
  };

  const navDatesSeen = new Set();
  const exchangeNavDates = new Set();
  const otcNavDates = new Set();
  const qdiiNavDates = new Set();
  // 每个持仓 kind 不同，期望的最新 NAV 日期也不同：
  //   · exchange（场内 ETF）：盘中实时，预期 = 今日（非交易日回退）；
  //   · otc（境内场外）：T 日 NAV 当晚（约 21:00）发布，预期 = 今日（非交易日回退）；
  //   · qdii（场外 QDII，海外标的）：净值 T+1 发布，预期 = 上一个工作日；周一回退到上周五（T-3）。
  // 因此持仓总览不能用「同一 NAV 日期」做对齐，而是用 agg.hasTodayNav（latestNavDate 已达该 kind
  // 预期最新日期）来判断「当日数据已就绪」。三个 NAV 日期 Set 用于在徽章 tooltip 上分别展示
  // 场内 / 场外 / QDII 各自最新到的 NAV 日期，避免把 QDII 的天然滞后误标成「同步异常」。
  let navTodayReadyCount = 0;
  let qdiiCount = 0;

  for (const agg of Array.isArray(aggregates) ? aggregates : []) {
    if (agg.snapshotError && agg.hasPosition) {
      summary.failedCodes.push(agg.code);
    }
    if (!agg.hasPosition) {
      // 已卖光的仓位不计入组合总市值/总成本/当日收益。
      continue;
    }
    summary.assetCount += 1;
    summary.totalCost = round(summary.totalCost + agg.totalCost, 2);
    const hasValuation = agg.hasPrice || agg.hasLatestNav;
    if (hasValuation) {
      summary.pricedCount += 1;
      summary.marketValue = round(summary.marketValue + agg.marketValue, 2);
      if (agg.snapshotUpdatedAt && agg.snapshotUpdatedAt > summary.latestSnapshotAt) {
        summary.latestSnapshotAt = agg.snapshotUpdatedAt;
      }
      if (agg.latestNavDate && agg.latestNavDate > summary.latestNavDate) {
        summary.latestNavDate = agg.latestNavDate;
      }
      if (agg.latestNavDate) {
        navDatesSeen.add(agg.latestNavDate);
        if (agg.kind === 'exchange') exchangeNavDates.add(agg.latestNavDate);
        else if (agg.kind === 'qdii') qdiiNavDates.add(agg.latestNavDate);
        else if (agg.kind === 'otc') otcNavDates.add(agg.latestNavDate);
      }
      if (agg.hasTodayNav) navTodayReadyCount += 1;
    }
    if (agg.kind === 'qdii') qdiiCount += 1;
    if (hasValuation && (agg.hasPrice || agg.hasPreviousNav) && agg.hasTodayNav) {
      summary.todayReadyCount += 1;
      summary.todayProfit = round(summary.todayProfit + agg.todayProfit, 2);
      summary.previousMarketValue = round(summary.previousMarketValue + agg.previousValue, 2);
    }
  }

  summary.unrealizedProfit = round(summary.marketValue - summary.totalCost, 2);
  summary.unrealizedReturnRate = summary.totalCost > 0
    ? round((summary.unrealizedProfit / summary.totalCost) * 100, 2)
    : 0;
  summary.todayReturnRate = summary.previousMarketValue > 0
    ? round((summary.todayProfit / summary.previousMarketValue) * 100, 2)
    : 0;

  // 累计收益（含已实现）：把「持仓未实现」与「已卖出 lots 的累计已实现」拼起来，
  // 分母 = 当前剩余持仓成本 + 已卖出 lots 的成本基准（卖出时刻的移动平均成本 × 卖出份额）。
  // - 部分卖出：当前持仓 totalCost 是「剩余持仓」的成本；soldSummary.totalCostBasis 是「已卖出份额」的成本；
  //   两者相加 ≈ 用户在该基金上的累计投入（按移动摊薄口径），没有重复计算。
  // - 已清仓：当前 totalCost = 0（被 summarizePortfolio 跳过），soldSummary 里仍带它的 lots，所以
  //   它的已实现盈亏会在「累计收益」里出现，但不影响「总市值 / 总成本 / 当日收益」等持仓口径。
  // 字段命名与「已卖出」面板的 totalRealizedProfit 对齐，避免引入新口径概念。
  const realizedProfit = round(Number(soldSummary?.totalRealizedProfit) || 0, 2);
  const realizedCostBasis = round(Number(soldSummary?.totalCostBasis) || 0, 2);
  summary.realizedProfit = realizedProfit;
  summary.realizedCostBasis = realizedCostBasis;
  summary.realizedLotCount = Number(soldSummary?.lotCount) || 0;
  summary.cumulativeCostBasis = round(summary.totalCost + realizedCostBasis, 2);
  summary.cumulativeProfit = round(summary.unrealizedProfit + realizedProfit, 2);
  summary.cumulativeReturnRate = summary.cumulativeCostBasis > 0
    ? round((summary.cumulativeProfit / summary.cumulativeCostBasis) * 100, 2)
    : 0;

  // 场内基金交易时段会先更新，场外基金净值要等当晚才发布，QDII 周一是 T-3。
  // 因此不能强求所有持仓 latestNavDate 一致，只要每个持仓的 NAV 达到其期望最新日期即可视为「全部」。
  let navDateCoverage = 'none';
  if (summary.assetCount > 0 && summary.pricedCount > 0) {
    if (summary.pricedCount === summary.assetCount && navTodayReadyCount === summary.assetCount) {
      navDateCoverage = 'full';
    } else {
      navDateCoverage = 'partial';
    }
  }
  summary.navDateCoverage = navDateCoverage;
  summary.latestExchangeNavDate = exchangeNavDates.size
    ? Array.from(exchangeNavDates).sort().slice(-1)[0]
    : '';
  summary.latestOtcNavDate = otcNavDates.size
    ? Array.from(otcNavDates).sort().slice(-1)[0]
    : '';
  // QDII 的预期最新 NAV 日期天然落后一个工作日（周一为 T-3），需要单独暴露给 UI，
  // 在「最后更新」徽章 tooltip 上独立展示，避免与场内/场外混在一起被误判为同步异常。
  // 详见 docs/qdii-nav-rules.md。
  summary.latestQdiiNavDate = qdiiNavDates.size
    ? Array.from(qdiiNavDates).sort().slice(-1)[0]
    : '';
  summary.qdiiCount = qdiiCount;

  return summary;
}

/**
 * 把当前持仓归一化成 worker 通知服务可以消费的精简快照：只包含基金代码和组合权重，
 * 以及组合层面的几个汇总数字（市值 / 成本 / 当日盈亏 / 累计盈亏）—— 不包含 per-fund 的份额、
 * 成本、姓名等用户敏感数据。worker 拿到 weight 后，按当日净值计算
 * Σ weight_i × (latest_i / previous_i - 1) 得到组合层面的当日收益率；totals 用于在推送中
 * 直接展示「+¥XX (+0.XX%)」+「总收益 +¥XXXX (+X.XX%)」这种全仓总览样式。
 */
export function buildHoldingsNotifyDigest({ aggregates = [], summary = null } = {}) {
  const list = Array.isArray(aggregates) ? aggregates : [];
  const totalMarketValue = Number(summary?.marketValue) > 0
    ? Number(summary.marketValue)
    : list.reduce((sum, agg) => sum + (Number(agg?.marketValue) > 0 ? Number(agg.marketValue) : 0), 0);

  const exchange = [];
  const otc = [];

  if (totalMarketValue > 0) {
    for (const agg of list) {
      if (!agg || !agg.code) continue;
      if (!agg.hasPosition) continue;
      const shares = Number(agg.totalShares);
      const marketValue = Number(agg.marketValue);
      if (!Number.isFinite(shares) || shares <= 0) continue;
      if (!Number.isFinite(marketValue) || marketValue <= 0) continue;
      const weight = round(marketValue / totalMarketValue, 6);
      if (!Number.isFinite(weight) || weight <= 0) continue;
      const entry = { code: String(agg.code), weight };
      if (agg.kind === 'exchange') exchange.push(entry);
      else otc.push(entry);
    }
  }

  // 出于隐私考虑：digest 不上传任何资产/金额字段（market value、cost、profit、return rate 等）。
  // 仅上传 per-fund code 与组合内相对 weight，由 worker 拉取 NAV 后计算加权收益率；
  // 推送中只显示百分比，具体金额引导用户回到网页查看。

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    exchange,
    otc
  };
}

/**
 * 把所有 SELL 交易按笔拆成"已卖出"行，并附上「被卖出买入批次」的平均成本。
 * - 按交易日期顺序逐笔走：BUY 追加批次；SELL 按 FIFO 消耗批次。
 *   这与 aggregateByCode 中的剩余持仓成本口径一致。
 * - 已实现收益 = (sellPrice − avgCost) × sellShares
 * - 已实现收益率 = realizedProfit / (avgCost × sellShares)
 * - costBasis = avgCost × sellShares；proceeds = sellPrice × sellShares
 * - 该函数按 SELL 笔展开，部分卖出的基金会同时出现在基金汇总（剩余份额）和本列表（卖出份额）。
 */
export function buildSoldLots(transactions = []) {
  const normalizedTxs = sanitizeTransactions(transactions, { filterInvalid: false });
  const txById = new Map();
  const byCode = new Map();
  for (const tx of normalizedTxs) {
    if (!tx.code) continue;
    if (tx.id) txById.set(tx.id, tx);
    if (!byCode.has(tx.code)) {
      byCode.set(tx.code, { name: '', kind: tx.kind || 'otc', txs: [] });
    }
    const bucket = byCode.get(tx.code);
    if (tx.name && !bucket.name) bucket.name = tx.name;
    if (tx.kind) bucket.kind = tx.kind;
    bucket.txs.push(tx);
  }

  const lots = [];
  for (const bucket of byCode.values()) {
    const sortedTxs = [...bucket.txs].sort(compareTxChrono);
    const costLots = [];
    for (const tx of sortedTxs) {
      if (tx.type === 'BUY') {
        pushCostLot(costLots, tx.shares, tx.price);
        continue;
      }
      if (tx.type !== 'SELL') continue;
      // 优先使用本笔自带 costPrice 计算清仓收益；但只要本地有 BUY 批次，SELL 仍要消耗批次，避免基金汇总不扣减份额。
      const pending = isPendingOtcSell(tx);
      const consumed = pending ? null : consumeCostLots(costLots, tx.shares);
      const hasCostOverride = tx.costPrice > 0;
      const standalone = hasCostOverride && !(consumed?.consumedShares > 0);
      const avgCost = hasCostOverride ? tx.costPrice : round(consumed?.avgCost || 0, 4);
      const pairTx = tx.switchPairId ? txById.get(tx.switchPairId) : null;
      const isSwitch = Boolean(pairTx && pairTx.type === 'BUY' && pairTx.code && pairTx.code !== tx.code);
      const sellShares = tx.shares;
      const sellPrice = pending ? 0 : tx.price;
      const proceeds = pending ? null : round(sellPrice * sellShares, 2);
      const costBasis = hasCostOverride
        ? round(avgCost * sellShares, 2)
        : round(consumed?.consumedCost || avgCost * sellShares, 2);
      const hasAvgCost = avgCost > 0;
      const realizedProfit = pending
        ? null
        : (hasAvgCost ? round((sellPrice - avgCost) * sellShares, 2) : 0);
      const realizedReturnRate = pending
        ? null
        : (hasAvgCost && costBasis > 0 ? round((realizedProfit / costBasis) * 100, 2) : 0);
      lots.push({
        id: tx.id,
        code: tx.code,
        name: tx.name || bucket.name || '',
        kind: tx.kind || bucket.kind || 'otc',
        sellDate: tx.date || '',
        sellShares,
        sellPrice,
        avgCost,
        costBasis,
        proceeds,
        realizedProfit,
        realizedReturnRate,
        hasAvgCost,
        standalone,
        pending,
        isSwitch,
        switchPairId: isSwitch ? pairTx.id : '',
        switchTargetCode: isSwitch ? pairTx.code : '',
        switchTargetName: isSwitch ? (pairTx.name || '') : '',
        switchExtraCash: isSwitch ? round(Math.max(pairTx.price * pairTx.shares - proceeds, 0), 2) : 0,
        note: tx.note || '',
        tx
      });
      // 独立 / 待确认交易不扣减持仓；普通 SELL 已在生成 consumed 时同步消耗批次。
    }
  }

  lots.sort((a, b) => {
    const da = a.sellDate || '';
    const db = b.sellDate || '';
    if (da !== db) return db.localeCompare(da);
    return a.code.localeCompare(b.code);
  });
  return lots;
}

/** 已卖出 tab 的 footer 合计。 */
export function summarizeSoldLots(lots = []) {
  const summary = {
    lotCount: 0,
    codeCount: 0,
    totalSellShares: 0,
    totalCostBasis: 0,
    totalProceeds: 0,
    totalRealizedProfit: 0,
    totalRealizedReturnRate: 0
  };
  const codeSet = new Set();
  for (const lot of Array.isArray(lots) ? lots : []) {
    summary.lotCount += 1;
    if (lot.code) codeSet.add(lot.code);
    summary.totalSellShares = round(summary.totalSellShares + (lot.sellShares || 0), 4);
    summary.totalCostBasis = round(summary.totalCostBasis + (lot.costBasis || 0), 2);
    summary.totalProceeds = round(summary.totalProceeds + (lot.proceeds || 0), 2);
    summary.totalRealizedProfit = round(summary.totalRealizedProfit + (lot.realizedProfit || 0), 2);
  }
  summary.codeCount = codeSet.size;
  summary.totalRealizedReturnRate = summary.totalCostBasis > 0
    ? round((summary.totalRealizedProfit / summary.totalCostBasis) * 100, 2)
    : 0;
  return summary;
}

/** Flatten transactions into display-ready rows joined with snapshots. */
export function buildLedgerRows(transactions = [], snapshotsByCode = {}) {
  const normalizedTxs = sanitizeTransactions(transactions, { filterInvalid: false });
  const rows = normalizedTxs.map((tx) => {
    const snapshot = snapshotsByCode?.[tx.code] || null;
    return {
      tx,
      metrics: buildLotMetrics(tx, snapshot),
      snapshot
    };
  });
  rows.sort((a, b) => {
    const da = a.tx.date || '';
    const db = b.tx.date || '';
    if (da !== db) return db.localeCompare(da);
    return a.tx.code.localeCompare(b.tx.code);
  });
  return rows;
}
