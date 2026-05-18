// portfolioSeries.js
//
// 「周/月/年收益看板」的计算引擎：
//   输入 = 成交流水 tx[] + 每只基金的 NAV 日级序列 + 区间 [from, to]
//   输出 = 区间起始市值、末状市值、现金流、Modified Dietz 收益率、年化、每日市值/盈亏序列
//
// 与现有 holdingsLedgerCore 对齐的决策：
//   - tx 只认 BUY / SELL。同日 BUY 在 SELL 之前。
//   - 跨基转换 = 同日 SELL(A) + BUY(B)，两笔在本模块看来是两笔独立现金流，净额近于 0。
//   - 现金不参与计算 (视为 0% return)。
//   - 首笔 BUY 日期 = 调用方决定。本模块只负责「说到区间 [from, to] 是什么收益」。
//
// Modified Dietz 公式：
//   R = (V_end - V_start - NetCF) / (V_start + Σ w_i · CF_i)
//   其中 w_i = (T - t_i) / T，t_i = CF 发生日距区间起点的天数。
//   BUY 资金流入为正；SELL 资金流出为负。

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EPSILON = 1e-9;

function toIsoDate(d) {
  if (!d) return null;
  if (typeof d === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(d);
    return m ? m[1] : null;
  }
  if (d instanceof Date) {
    const y = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  return null;
}

function daysBetween(fromIso, toIso) {
  const f = Date.parse(`${fromIso}T00:00:00Z`);
  const t = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return 0;
  return Math.round((t - f) / MS_PER_DAY);
}

export function shiftDays(iso, deltaDays) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  const next = new Date(t + deltaDays * MS_PER_DAY);
  return toIsoDate(next);
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeNavSeries(navByCode) {
  const out = {};
  if (!navByCode) return out;
  const entries = navByCode instanceof Map
    ? Array.from(navByCode.entries())
    : Object.entries(navByCode);
  for (const [rawCode, rawSeries] of entries) {
    if (!Array.isArray(rawSeries)) continue;
    const code = String(rawCode);
    const cleaned = rawSeries
      .map((it) => ({ date: toIsoDate(it?.date), nav: safeNumber(it?.nav, NaN) }))
      .filter((it) => it.date && Number.isFinite(it.nav));
    cleaned.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    out[code] = cleaned;
  }
  return out;
}

function findNavOnOrBefore(series, isoDate) {
  if (!Array.isArray(series) || series.length === 0) return null;
  let lo = 0;
  let hi = series.length - 1;
  let ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= isoDate) {
      ans = series[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function normalizeTxList(txList) {
  if (!Array.isArray(txList)) return [];
  return txList
    .map((tx) => ({
      id: tx?.id || tx?.txId || `${tx?.code || ''}|${tx?.date || ''}|${tx?.type || ''}`,
      code: String(tx?.code || '').trim(),
      type: tx?.type === 'SELL' ? 'SELL' : 'BUY',
      date: toIsoDate(tx?.date),
      shares: safeNumber(tx?.shares, 0),
      price: safeNumber(tx?.price, 0),
      amount: Number.isFinite(Number(tx?.amount))
        ? Number(tx.amount)
        : safeNumber(tx?.shares, 0) * safeNumber(tx?.price, 0)
    }))
    .filter((tx) => tx.code && tx.date && tx.shares > 0);
}

// 同 holdingsLedgerCore L399：日期升序 → 同日 BUY 先于 SELL。
function sortTx(txs) {
  return txs.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ta = a.type === 'BUY' ? 0 : 1;
    const tb = b.type === 'BUY' ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// 某个日期结束时每只基金的持仓 (含该日)
function sharesAtEndOfDay(txs, isoDate) {
  const byCode = new Map();
  for (const tx of sortTx(txs)) {
    if (tx.date > isoDate) continue;
    const prev = byCode.get(tx.code) || 0;
    if (tx.type === 'BUY') byCode.set(tx.code, prev + tx.shares);
    else byCode.set(tx.code, Math.max(0, prev - tx.shares));
  }
  return byCode;
}

function portfolioMarketValue(sharesByCode, navMap, isoDate) {
  let total = 0;
  const missing = [];
  for (const [code, shares] of sharesByCode.entries()) {
    if (shares <= EPSILON) continue;
    const series = navMap[code];
    const point = series ? findNavOnOrBefore(series, isoDate) : null;
    if (!point) {
      missing.push(code);
      continue;
    }
    total += shares * point.nav;
  }
  return { value: total, missingCodes: missing };
}

function modifiedDietz({ vStart, vEnd, cashFlows, fromIso, toIso }) {
  const T = Math.max(1, daysBetween(fromIso, toIso));
  let netCF = 0;
  let weighted = 0;
  for (const cf of cashFlows) {
    const t = Math.max(0, Math.min(T, daysBetween(fromIso, cf.date)));
    const w = (T - t) / T;
    netCF += cf.amount;
    weighted += w * cf.amount;
  }
  const denominator = vStart + weighted;
  const numerator = vEnd - vStart - netCF;
  if (Math.abs(denominator) < EPSILON) {
    return { return_: null, netCF, weightedCashFlow: weighted, profit: numerator, denominator: 0, days: T };
  }
  return {
    return_: numerator / denominator,
    netCF,
    weightedCashFlow: weighted,
    profit: numerator,
    denominator,
    days: T
  };
}

function annualize(returnRate, days) {
  if (returnRate === null || !Number.isFinite(returnRate)) return null;
  if (!Number.isFinite(days) || days <= 0) return null;
  // v3 护栏：不足 1 年不年化，避免 137天 +559%→+15729% 误导
  if (days < 365) return null;
  return Math.pow(1 + returnRate, 365 / days) - 1;
}

function buildDailySeries({ txs, navMap, fromIso, toIso }) {
  const result = [];
  const totalDays = Math.max(0, daysBetween(fromIso, toIso));
  const sortedTx = sortTx(txs);

  const sharesAtStart = sharesAtEndOfDay(sortedTx, shiftDays(fromIso, -1));
  const startMv = portfolioMarketValue(sharesAtStart, navMap, fromIso);
  const vStart = startMv.value;

  const sharesByCode = new Map(sharesAtStart);
  let txIdx = 0;
  // 跳过区间之前的 tx (已被 sharesAtStart 含入)
  while (txIdx < sortedTx.length && sortedTx[txIdx].date < fromIso) txIdx += 1;

  let cumulativeNetCF = 0;
  let cumulativeWeightedCF = 0;
  // 新口径：pnl 不再用 MV-vStart-CF (会被 nav fallback + 当日 BUY 双算扶动)，
  // 改为 per-fund 真·当日 nav 增量累加（仅当 nav.date === day 才计）。
  // 这样 dailySeries.pnl[i] 严格等于 「起始日到 day_i 的当日明细加和」，
  // 与 ReturnCalendar / DailyFundBreakdown / BigKpi 全部同源。
  let cumulativeFundPnl = 0;
  // TWR 累乘：r_i = pnl_i / V_{i-1}，cumLogReturn += log(1 + r_i)
  // 与现金流时间无关，等价于「假设投入 1 元从首日持有到末日」，与沪深300 endNav/startNav-1 同口径。
  let cumLogReturn = 0;
  let prevMv = vStart;

  for (let d = 0; d <= totalDays; d += 1) {
    const day = shiftDays(fromIso, d);
    // 1. 先算当日 per-fund 真·nav 增量（基于昨日收盘 sharesByCode，未含当日 tx）
    const fundRows = singleDayFundPnl({ tx: sortedTx, navByCode: navMap, date: day });
    let dayFundPnl = 0;
    for (const r of fundRows) {
      if (Number.isFinite(r.pnl)) dayFundPnl += r.pnl;
    }
    // 当日 TWR 收益率：用「前一日收盘市值 prevMv」作分母，与当日新增资金无关。
    // prevMv ≤ ε 时（首日尚无持仓 / 全部赎回）记 0，避免除零。
    const dayReturn = prevMv > EPSILON ? dayFundPnl / prevMv : 0;
    if (Number.isFinite(dayReturn) && 1 + dayReturn > EPSILON) {
      cumLogReturn += Math.log(1 + dayReturn);
    }
    cumulativeFundPnl += dayFundPnl;

    // 2. 再应用当日 tx、更新 sharesByCode 与 cashflow
    while (txIdx < sortedTx.length && sortedTx[txIdx].date <= day) {
      const tx = sortedTx[txIdx];
      const signedAmount = tx.type === 'BUY' ? tx.amount : -tx.amount;
      cumulativeNetCF += signedAmount;
      const t = Math.max(0, Math.min(totalDays || 1, daysBetween(fromIso, tx.date)));
      const w = totalDays > 0 ? (totalDays - t) / totalDays : 0;
      cumulativeWeightedCF += w * signedAmount;
      const prev = sharesByCode.get(tx.code) || 0;
      const next = tx.type === 'BUY' ? prev + tx.shares : Math.max(0, prev - tx.shares);
      sharesByCode.set(tx.code, next);
      txIdx += 1;
    }
    const mv = portfolioMarketValue(sharesByCode, navMap, day);
    const denom = vStart + cumulativeWeightedCF;
    // pnl 改用 per-fund 真·当日 nav 增量累加（避免当日 BUY × fallback nav 伪增值）
    const pnl = cumulativeFundPnl;
    const pnlRate = Math.abs(denom) < EPSILON ? null : pnl / denom;
    const twrCumulative = Math.exp(cumLogReturn) - 1;
    result.push({
      date: day,
      marketValue: mv.value,
      cumulativeNetCashFlow: cumulativeNetCF,
      pnl,
      pnlRate,
      dailyReturn: dayReturn,
      twrCumulative
    });
    prevMv = mv.value;
  }

  return { dailySeries: result, vStart, startMissingCodes: startMv.missingCodes };
}

export function buildPortfolioSeries({ tx, navByCode, from, to }) {
  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);
  if (!fromIso || !toIso) {
    throw new Error('buildPortfolioSeries: from/to 必须是有效日期。');
  }
  if (fromIso > toIso) {
    throw new Error('buildPortfolioSeries: from 不能晚于 to。');
  }
  const allTx = normalizeTxList(tx);
  const navMap = normalizeNavSeries(navByCode);

  const sharesAtStart = sharesAtEndOfDay(allTx, shiftDays(fromIso, -1));
  const startMv = portfolioMarketValue(sharesAtStart, navMap, fromIso);
  // 安全网：vStart 窗口起点 nav 必须全覆盖，否则 modified Dietz 分母 / 日历累计差均会崩块。
  // 消费方 fetchAllNav 需要提供足够左缓冲（>= 最长节假日空窗）以保证这个不变量。
  if (startMv.missingCodes.length > 0 && typeof console !== 'undefined') {
    console.warn(
      '[buildPortfolioSeries] vStart 缺 nav fallback，窗口统计将偏差。from=%s missing=%o tip=fetchAllNav 需在 from 左侧预留 ≥30d 缓冲。',
      fromIso,
      startMv.missingCodes
    );
  }

  const inWindowCashFlows = [];
  for (const txItem of allTx) {
    if (txItem.date < fromIso || txItem.date > toIso) continue;
    inWindowCashFlows.push({
      date: txItem.date,
      amount: txItem.type === 'BUY' ? txItem.amount : -txItem.amount,
      type: txItem.type,
      code: txItem.code
    });
  }

  const sharesAtEnd = sharesAtEndOfDay(allTx, toIso);
  const endMv = portfolioMarketValue(sharesAtEnd, navMap, toIso);

  const md = modifiedDietz({
    vStart: startMv.value,
    vEnd: endMv.value,
    cashFlows: inWindowCashFlows,
    fromIso,
    toIso
  });

  const daily = buildDailySeries({ txs: allTx, navMap, fromIso, toIso });

  // 以 dailySeries 末项 pnl（per-fund 真·当日 nav 增量累加）作为 profit 权威口径。
  // 该口径与 ReturnCalendar / DailyFundBreakdown 同源，避免 nav fallback + 当日 BUY 双算造成的伪增值，与 Modified-Dietz 有细微偏差。
  const lastDaily = daily.dailySeries.length ? daily.dailySeries[daily.dailySeries.length - 1] : null;
  const fundProfit = lastDaily ? lastDaily.pnl : 0;
  // returnRate 切换到 TWR（时间加权收益率），与沪深300 endNav/startNav-1 同口径，图表可直接对比。
  // Modified-Dietz 结果保留到 diagnostics.modifiedDietz 供对账。
  const twrReturn = lastDaily && Number.isFinite(lastDaily.twrCumulative) ? lastDaily.twrCumulative : null;
  const annualized = annualize(twrReturn, md.days);

  return {
    window: { from: fromIso, to: toIso, days: md.days },
    startValue: startMv.value,
    endValue: endMv.value,
    netCashFlow: md.netCF,
    weightedCashFlow: md.weightedCashFlow,
    profit: fundProfit,
    returnRate: twrReturn,
    annualizedReturn: annualized,
    dailySeries: daily.dailySeries,
    holdings: {
      atStart: Array.from(sharesAtStart.entries()).map(([code, shares]) => ({ code, shares })),
      atEnd: Array.from(sharesAtEnd.entries()).map(([code, shares]) => ({ code, shares }))
    },
    cashFlows: inWindowCashFlows,
    diagnostics: {
      startMissingNavCodes: startMv.missingCodes,
      endMissingNavCodes: endMv.missingCodes,
      modifiedDietz: { profit: md.profit, returnRate: md.return_, denominator: md.denominator },
      twr: { returnRate: twrReturn }
    }
  };
}

// 单日 per-fund 盈亏：基于上一交易日持仓 × (当日 nav - 上一交易日 nav)。
// 当日新买入/卖出的现金流不计入 pnl，与 Modified-Dietz 思路一致。
//
// 入参：
//   tx        — 完整 transactions 列表（含 name/code/shares/price/type/date）
//   navByCode — { [code]: Array<{date, nav}> } 至少覆盖 [date-30d, date]
//   date      — 目标 ISO 日期
// 返回：Array<{ code, shares, nav, prevNav, prevDate, navDate, pnl, txsToday }>，仅含 shares>0 或当日有交易的基金。
export function singleDayFundPnl({ tx, navByCode, date }) {
  const isoDate = toIsoDate(date);
  if (!isoDate) return [];
  const allTx = normalizeTxList(tx);
  const navMap = normalizeNavSeries(navByCode);
  const prevIso = shiftDays(isoDate, -1);
  const sharesPrev = sharesAtEndOfDay(allTx, prevIso);

  const codes = new Set();
  for (const code of sharesPrev.keys()) {
    if ((sharesPrev.get(code) || 0) > EPSILON) codes.add(code);
  }
  for (const t of allTx) {
    if (t.date === isoDate) codes.add(t.code);
  }

  const out = [];
  for (const code of codes) {
    const series = navMap[code] || [];
    const pointToday = findNavOnOrBefore(series, isoDate);
    const pointPrev = pointToday ? findNavOnOrBefore(series, shiftDays(pointToday.date, -1)) : null;
    const shares = sharesPrev.get(code) || 0;
    const nav = pointToday ? pointToday.nav : null;
    const prevNav = pointPrev ? pointPrev.nav : null;
    const prevDate = pointPrev ? pointPrev.date : null;
    const navDate = pointToday ? pointToday.date : null;
    const hasUpdate = !!pointToday && pointToday.date === isoDate;
    const pnl = hasUpdate && Number.isFinite(nav) && Number.isFinite(prevNav)
      ? shares * (nav - prevNav)
      : null;
    const txsToday = allTx.filter((t) => t.date === isoDate && t.code === code);
    out.push({ code, shares, nav, prevNav, prevDate, navDate, pnl, txsToday });
  }
  out.sort((a, b) => {
    const av = Number.isFinite(a.pnl) ? Math.abs(a.pnl) : -1;
    const bv = Number.isFinite(b.pnl) ? Math.abs(b.pnl) : -1;
    return bv - av;
  });
  return out;
}

// 区间内每天 per-fund 真·当日 pnl 加和，作为「日历单日 pnl」的权威源。
// 仅当某基金 nav.date === day (singleDayFundPnl 内的 hasUpdate=true) 时才计入；未披露基金贡献 0。
// 从而保证「日历单日格 ≡ 当日明细 finite pnl 之和」，避免与 DailyFundBreakdown 反号。
//
// 入参：
//   tx        — 完整 transactions 列表
//   navByCode — { [code]: Array<{date, nav}> }；建议覆盖 [fromIso-30d, toIso]
//   fromIso, toIso — ISO 日期，闭区间
// 返回：{ [isoDate: string]: number }，仅含至少一只基金 finite pnl 的日期。
export function buildDailyFundPnlMap({ tx, navByCode, fromIso, toIso }) {
  const out = {};
  const from = toIsoDate(fromIso);
  const to = toIsoDate(toIso);
  if (!from || !to) return out;
  const total = Math.max(0, daysBetween(from, to));
  for (let d = 0; d <= total; d += 1) {
    const day = shiftDays(from, d);
    const rows = singleDayFundPnl({ tx, navByCode, date: day });
    let sum = 0;
    let hasAny = false;
    for (const r of rows) {
      if (Number.isFinite(r.pnl)) {
        sum += r.pnl;
        hasAny = true;
      }
    }
    if (hasAny) out[day] = sum;
  }
  return out;
}

// 镜头 → {from, to} 。UI 只传镜头名。
export function resolveRangeWindow(range, { today, inceptionDate, custom } = {}) {
  const t = toIsoDate(today) || toIsoDate(new Date());
  if (!t) throw new Error('resolveRangeWindow: 无法判定当前日期。');
  const [yy, mm] = t.split('-').map(Number);
  const firstOfMonth = `${yy}-${String(mm).padStart(2, '0')}-01`;
  const firstOfYear = `${yy}-01-01`;
  const dow = new Date(`${t}T00:00:00Z`).getUTCDay();
  const isoDow = dow === 0 ? 7 : dow;
  const mondayThisWeek = shiftDays(t, -(isoDow - 1));
  const inceptionIso = toIsoDate(inceptionDate);

  switch (range) {
    case 'today':
      return { from: t, to: t };
    case 'week':
      return { from: mondayThisWeek, to: t };
    case 'lastWeek': {
      const lastMon = shiftDays(mondayThisWeek, -7);
      const lastSun = shiftDays(mondayThisWeek, -1);
      return { from: lastMon, to: lastSun };
    }
    case 'month':
      return { from: firstOfMonth, to: t };
    case 'lastMonth': {
      const lastMonthEnd = shiftDays(firstOfMonth, -1);
      const [ly, lm] = lastMonthEnd.split('-').map(Number);
      const lastMonthStart = `${ly}-${String(lm).padStart(2, '0')}-01`;
      return { from: lastMonthStart, to: lastMonthEnd };
    }
    case 'year':
    case 'ytd':
      return { from: firstOfYear, to: t };
    case 'lastYear': {
      const lyStart = `${yy - 1}-01-01`;
      const lyEnd = `${yy - 1}-12-31`;
      return { from: lyStart, to: lyEnd };
    }
    case 'last365d':
      return { from: shiftDays(t, -365), to: t };
    case 'sinceInception':
      if (!inceptionIso) throw new Error('resolveRangeWindow: sinceInception 需要 inceptionDate。');
      return { from: inceptionIso, to: t };
    case 'custom':
      if (!custom || !toIsoDate(custom.from) || !toIsoDate(custom.to)) {
        throw new Error('resolveRangeWindow: custom 需要 {from, to}。');
      }
      return { from: toIsoDate(custom.from), to: toIsoDate(custom.to) };
    default:
      throw new Error(`resolveRangeWindow: 未知镜头 ${range}。`);
  }
}

export const __internals = {
  toIsoDate,
  daysBetween,
  shiftDays,
  normalizeNavSeries,
  findNavOnOrBefore,
  normalizeTxList,
  sortTx,
  sharesAtEndOfDay,
  portfolioMarketValue,
  modifiedDietz,
  annualize,
  buildDailySeries
};
