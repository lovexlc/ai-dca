/**
 * Holdings ledger core: lot-level BUY / SELL transactions + per-code aggregation
 * + portfolio-level summary. Mirrors the Excel model the user already uses:
 *   - 每笔交易单单独一行（BUY/SELL）
 *   - 按基金代码聚合 → 总份额 / 平均成本 / 总收益 / 当日收益
 *   - 平均成本 = 按时间顺序跟踪的当前持仓加权均价（移动加权平均）。
 *     中间被全部卖光后成本重置，仅后续买入计入本轮成本。
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

const FUND_CODE_PATTERN = /^\d{6}$/;
const EXCHANGE_PREFIXES = ['15', '50', '51', '52', '56', '58', '53', '54'];
/**
 * QDII 基金（海外标的，T+1 发布 NAV）名称关键词。前端通过持仓名称启发式识别，
 * 命中任意一个即视为 qdii。覆盖纳指/标普/美股/港股/恒生/海外/全球类基金。
 */
const QDII_NAME_KEYWORDS = [
  'QDII', '纳指', '纳斯达克', '标普', 'S&P', '美国', '美股', '北美',
  '香港', '恒生', 'H股', '港股',
  '日经', '日本', '德国', '法国', '英国', '欧洲', '欧洲股',
  '亚太', '亚洲', '新兴市场', '印度', '越南', '东南亚', '中东', '沙特', '俄罗斯',
  '全球', '海外', '国际', '中概互联', '中概', '原油', '油气', '石油'
];
/** 已知 QDII 基金代码白名单，作为名称识别失败时的兜底。 */
const QDII_CODE_WHITELIST = new Set([
  '021000', // 南方纳斯达克100指数发起(QDII)I
  '006075', // 博时标普500ETF联接(QDII)C
  '019172'  // 摩根纳斯达克100(QDII)人民币A
]);

export const TRANSACTION_TYPES = ['BUY', 'SELL'];
export const FUND_KINDS = ['otc', 'exchange', 'qdii'];

export function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

/**
 * 获取上海时区的"今日"日期字符串（YYYY-MM-DD），用于和 snapshot.latestNavDate 做比对。
 * 对场内 ETF 而言今日就是预期的最新 NAV 日期；对场外基金（包括 QDII）预期是"上一个工作日"，
 * 详见 getExpectedLatestNavDate。
 */
export function getTodayShanghaiDate() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  } catch {
    const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  }
}

/**
 * 返回指定 kind 在 todayDate 当日预期的"最新 NAV 日期"。
 * - exchange（场内 ETF）：盘中实时，交易日 = today；周六/日上一个工作日。
 * - otc（境内场外）：T 日 NAV 在 T 日晚发布，预期 = 今日（周六/日回退到周五）。
 *     早晨 T 日 NAV 尚未公布时 latestNavDate 仍为 T-1，会判 isLatestNavToday=false（"当日收益"留空）。
 * - qdii（场外 QDII）：净值 T+1 发布，取上一个工作日。
 *     周一 → 上周五（today - 3，T-3）、周二~五 → today - 1（T-1）、周六 → today - 1、周日 → today - 2。
 * 返回 YYYY-MM-DD 字符串。todayDate 默认取上海时区今日。
 */
export function getExpectedLatestNavDate(kind = 'otc', todayDate = getTodayShanghaiDate()) {
  const today = String(todayDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return today;
  }
  const [y, m, d] = today.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = base.getUTCDay(); // 0=日, 1=一, ..., 6=六
  const subtractDays = (delta) => {
    const next = new Date(base.getTime() - delta * 86400000);
    const yy = next.getUTCFullYear();
    const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(next.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };
  const normalizedKind = kind === 'exchange' || kind === 'qdii' ? kind : 'otc';
  if (normalizedKind === 'exchange' || normalizedKind === 'otc') {
    // 场内 ETF：盘中实时；境内场外：T 日 NAV 当晚发布。两者预期最新日期都是"今日（非交易日回退）"。
    if (dayOfWeek === 0) return subtractDays(2); // 周日 → 上周五
    if (dayOfWeek === 6) return subtractDays(1); // 周六 → 上周五
    return today;
  }
  // qdii：T+1 发布，取上一个工作日
  if (dayOfWeek === 1) return subtractDays(3); // 周一 → 上周五（T-3）
  if (dayOfWeek === 0) return subtractDays(2); // 周日 → 上周五
  if (dayOfWeek === 6) return subtractDays(1); // 周六 → 周五
  return subtractDays(1); // 周二~五 → 前一天（T-1）
}

/** Pad leading zeros so Excel's stripped codes (e.g. 21000, 18738) come back as 6-digit. */
export function normalizeFundCode(code = '') {
  const raw = String(code ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    return raw;
  }
  if (digits.length === 6) {
    return digits;
  }
  if (digits.length < 6) {
    return digits.padStart(6, '0');
  }
  return digits.slice(-6);
}

export function isValidFundCode(code = '') {
  return FUND_CODE_PATTERN.test(normalizeFundCode(code));
}

/**
 * 名称启发式判断是否 QDII 基金（海外标的，T+1 发布 NAV）。
 * 命中关键词或代码白名单即返回 true。
 */
export function detectQdiiByName(name = '', code = '') {
  const normalizedCode = normalizeFundCode(code);
  if (normalizedCode && QDII_CODE_WHITELIST.has(normalizedCode)) {
    return true;
  }
  const text = String(name || '').toUpperCase();
  if (!text) return false;
  return QDII_NAME_KEYWORDS.some((kw) => text.includes(String(kw).toUpperCase()));
}

/**
 * 按代码前缀 + 名称启发式推断基金类别：
 * - 5xx/15x/56x/58x/... 等 ETF 前缀 → exchange（场内）。
 * - 名称命中 QDII 关键词或在 QDII 代码白名单内 → qdii（场外 QDII，T+1）。
 * - 其余 → otc（境内场外，T 日 NAV 当晚发布）。
 */
export function detectFundKind(code = '', name = '') {
  const normalized = normalizeFundCode(code);
  if (FUND_CODE_PATTERN.test(normalized)) {
    const prefix = normalized.slice(0, 2);
    if (EXCHANGE_PREFIXES.includes(prefix)) {
      return 'exchange';
    }
  }
  if (detectQdiiByName(name, normalized)) {
    return 'qdii';
  }
  return 'otc';
}

/**
 * 归一 transaction.kind：保留显式 'exchange' / 'qdii'；'otc' 或缺省时按代码 + 名称重新检测，
 * 这样存量数据里 kind='otc' 的 QDII 基金也能自动升级为 'qdii'。
 */
export function normalizeFundKind(value = '', code = '', name = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'exchange' || raw === 'qdii') {
    return raw;
  }
  // 'otc' 或为空：重新按代码+名称识别（升级 QDII）。
  return detectFundKind(code, name);
}

export function normalizeTransactionType(value = '') {
  const raw = String(value || '').trim().toUpperCase();
  return TRANSACTION_TYPES.includes(raw) ? raw : 'BUY';
}

export function normalizeFundName(name = '') {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

export function normalizeIsoDate(value = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  // Accept YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, or timestamp-parseable strings.
  const directMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (directMatch) {
    const [, y, m, d] = directMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp)) {
    const dateObj = new Date(timestamp);
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

function parsePositiveDecimal(value, precision = 4) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const normalized = typeof value === 'string'
    ? value.replace(/[,\s¥$]/g, '')
    : value;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return round(num, precision);
}

export function buildTransactionId(prefix = 'tx') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyTransaction(overrides = {}) {
  return {
    id: buildTransactionId('tx'),
    code: '',
    name: '',
    kind: 'otc',
    type: 'BUY',
    date: '',
    price: '',
    shares: '',
    costPrice: '',
    switchPairId: '',
    note: '',
    ...overrides
  };
}

export function normalizeTransaction(tx = {}, { idPrefix = 'tx' } = {}) {
  const code = normalizeFundCode(tx?.code || '');
  const kind = normalizeFundKind(tx?.kind, code);
  return {
    id: String(tx?.id || '').trim() || buildTransactionId(idPrefix),
    code,
    name: normalizeFundName(tx?.name || ''),
    kind,
    type: normalizeTransactionType(tx?.type),
    date: normalizeIsoDate(tx?.date),
    price: parsePositiveDecimal(tx?.price, 4),
    shares: parsePositiveDecimal(tx?.shares, 4),
    costPrice: parsePositiveDecimal(tx?.costPrice, 4),
    switchPairId: String(tx?.switchPairId || '').trim(),
    note: String(tx?.note || '').trim()
  };
}

export function hasMeaningfulTransaction(tx = {}) {
  return Boolean(
    String(tx?.code || '').trim()
      || String(tx?.name || '').trim()
      || String(tx?.date || '').trim()
      || Number(tx?.price) > 0
      || Number(tx?.shares) > 0
      || Number(tx?.costPrice) > 0
      || String(tx?.note || '').trim()
  );
}

export function sanitizeTransactions(list = [], { filterInvalid = false, idPrefix = 'tx' } = {}) {
  const normalized = (Array.isArray(list) ? list : []).map((tx) => normalizeTransaction(tx, { idPrefix }));
  if (!filterInvalid) {
    return normalized;
  }
  return normalized.filter((tx) => Object.keys(getTransactionErrors(tx)).length === 0);
}

export function getTransactionErrors(tx = {}, { ignoreBlank = false } = {}) {
  const meaningful = hasMeaningfulTransaction(tx);
  if (ignoreBlank && !meaningful) {
    return {};
  }
  const normalized = normalizeTransaction(tx);
  const errors = {};
  if (!normalized.code) {
    errors.code = '基金代码必填。';
  } else if (!FUND_CODE_PATTERN.test(normalized.code)) {
    errors.code = '基金代码必须为 6 位数字。';
  }
  if (!TRANSACTION_TYPES.includes(normalized.type)) {
    errors.type = '交易类型只允许 BUY / SELL。';
  }
  if (!(normalized.price > 0)) {
    errors.price = '交易价格必须大于 0。';
  }
  if (!(normalized.shares > 0)) {
    errors.shares = '交易份额必须大于 0。';
  }
  return errors;
}

export function summarizeTransactionErrors(errors = {}) {
  return Object.values(errors).filter(Boolean).join(' ');
}

export function getLedgerCodeList(transactions = []) {
  const codeSet = new Set();
  for (const tx of Array.isArray(transactions) ? transactions : []) {
    const code = normalizeFundCode(tx?.code || '');
    if (FUND_CODE_PATTERN.test(code)) {
      codeSet.add(code);
    }
  }
  return [...codeSet].sort();
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
      totalProfit: 0,
      totalReturnRate: 0,
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

  const marketValue = hasLatestNav ? round(latestNav * normalized.shares, 2) : 0;
  const totalProfit = hasLatestNav ? round((latestNav - normalized.price) * normalized.shares, 2) : 0;
  const totalReturnRate = hasLatestNav && cost > 0 ? round((totalProfit / cost) * 100, 2) : 0;
  const todayProfit = hasLatestNav && hasPreviousNav && isLatestNavToday
    ? round((latestNav - previousNav) * normalized.shares, 2)
    : 0;
  const previousValue = hasPreviousNav && isLatestNavToday ? previousNav * normalized.shares : 0;
  const todayReturnRate = hasLatestNav && hasPreviousNav && isLatestNavToday && previousValue > 0
    ? round((todayProfit / previousValue) * 100, 2)
    : 0;

  return {
    tx: normalized,
    isSell: false,
    isBuy: true,
    displayShares: normalized.shares,
    costBasis: cost,
    proceeds: 0,
    marketValue,
    totalProfit,
    totalReturnRate,
    todayProfit,
    todayReturnRate,
    hasLatestNav,
    hasPreviousNav,
    hasTodayNav: isLatestNavToday,
    latestNav,
    previousNav,
    latestNavDate,
    previousNavDate: String(snapshot?.previousNavDate || '')
  };
}

/** Group transactions by fund code and produce the Excel "基金汇总" sheet shape. */
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
      // 自洽的“已结清交易”（自带 costPrice）独立成笔，不参与持仓份额扣减。
      if (!(tx.costPrice > 0)) {
        bucket.sellShares = round(bucket.sellShares + tx.shares, 4);
        bucket.sellAmount = round(bucket.sellAmount + tx.price * tx.shares, 2);
      }
    }
    if (tx.date && tx.date > bucket.lastTxDate) {
      bucket.lastTxDate = tx.date;
    }
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

    const totalShares = round(bucket.buyShares - bucket.sellShares, 4);
    // 按时间顺序的移动加权平均成本：全部卖光后重置，后续买入仅计入本轮。
    // BUY: openShares、openAmount 同步增加。
    // SELL（非独立已结清）：按当前均价按比例减少 openAmount，均价不变；卖光则两者归零。
    // 独立已结清交易（costPrice > 0）不参与仓位。
    const sortedTxs = bucket.transactions.slice().sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return da < db ? -1 : 1;
      // 同一天：BUY 在 SELL 之前，避免本轮买入被上一轮卖出推变成本。
      if (a.type !== b.type) return a.type === 'BUY' ? -1 : 1;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
    let openShares = 0;
    let openAmount = 0;
    for (const tx of sortedTxs) {
      if (tx.type === 'BUY') {
        openShares = round(openShares + (Number(tx.shares) || 0), 4);
        openAmount = round(openAmount + (Number(tx.shares) || 0) * (Number(tx.price) || 0), 4);
      } else if (tx.type === 'SELL') {
        if (Number(tx.costPrice) > 0) continue; // 独立已结清交易不动仓位
        if (openShares <= 0) continue;
        const sellQty = Math.min(Number(tx.shares) || 0, openShares);
        const avg = openShares > 0 ? openAmount / openShares : 0;
        openShares = round(openShares - sellQty, 4);
        openAmount = round(Math.max(0, openAmount - avg * sellQty), 4);
        if (openShares <= 0.0001) {
          openShares = 0;
          openAmount = 0;
        }
      }
    }
    const avgCost = openShares > 0 ? round(openAmount / openShares, 4) : 0;
    const totalCost = openShares > 0 ? round(openShares * avgCost, 2) : 0;
    const marketValue = hasLatestNav && totalShares > 0 ? round(totalShares * latestNav, 2) : 0;
    const totalProfit = hasLatestNav && totalShares > 0 ? round(marketValue - totalCost, 2) : 0;
    const totalReturnRate = totalCost > 0 ? round((totalProfit / totalCost) * 100, 2) : 0;
    const todayProfit = hasLatestNav && hasPreviousNav && totalShares > 0 && isLatestNavToday
      ? round((latestNav - previousNav) * totalShares, 2)
      : 0;
    const previousValue = hasPreviousNav && totalShares > 0 && isLatestNavToday ? previousNav * totalShares : 0;
    const todayReturnRate = previousValue > 0
      ? round((todayProfit / previousValue) * 100, 2)
      : 0;

    aggregates.push({
      code: bucket.code,
      name: bucket.name || snapshot?.name || '',
      kind: bucket.kind,
      transactions: bucket.transactions,
      buyShares: bucket.buyShares,
      sellShares: bucket.sellShares,
      totalShares,
      avgCost,
      totalCost,
      latestNav,
      previousNav,
      latestNavDate: String(snapshot?.latestNavDate || ''),
      previousNavDate: String(snapshot?.previousNavDate || ''),
      marketValue,
      totalProfit,
      totalReturnRate,
      todayProfit,
      todayReturnRate,
      previousValue: round(previousValue, 2),
      hasPosition: totalShares > 0,
      hasLatestNav,
      hasPreviousNav,
      hasTodayNav: isLatestNavToday,
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
export function summarizePortfolio(aggregates = []) {
  const summary = {
    assetCount: 0,
    recordedCodeCount: (Array.isArray(aggregates) ? aggregates : []).length,
    totalCost: 0,
    marketValue: 0,
    totalProfit: 0,
    totalReturnRate: 0,
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
  // 每个持仓 kind 不同，期望的最新 NAV 日期也不同（场内当日、场外/QDII 上一个交易日，QDII 周一为 T-3）。
  // 这里用 agg.hasTodayNav 表示该持仓的 latestNavDate 已达预期最新日期，作为「当日数据已就绪」的判据。
  let navTodayReadyCount = 0;

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
    if (agg.hasLatestNav) {
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
        else if (agg.kind === 'otc') otcNavDates.add(agg.latestNavDate);
      }
      if (agg.hasTodayNav) navTodayReadyCount += 1;
    }
    if (agg.hasLatestNav && agg.hasPreviousNav && agg.hasTodayNav) {
      summary.todayReadyCount += 1;
      summary.todayProfit = round(summary.todayProfit + agg.todayProfit, 2);
      summary.previousMarketValue = round(summary.previousMarketValue + agg.previousValue, 2);
    }
  }

  summary.totalProfit = round(summary.marketValue - summary.totalCost, 2);
  summary.totalReturnRate = summary.totalCost > 0
    ? round((summary.totalProfit / summary.totalCost) * 100, 2)
    : 0;
  summary.todayReturnRate = summary.previousMarketValue > 0
    ? round((summary.todayProfit / summary.previousMarketValue) * 100, 2)
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

  return summary;
}

/**
 * 把当前持仓归一化成 worker 通知服务可以消费的精简快照：只包含基金代码和组合权重，
 * 不带任何成本/份额/金额/姓名等用户敏感数据。worker 拿到 weight 后，按当日净值
 * 计算 Σ weight_i × (latest_i / previous_i - 1) 即可得到组合层面的当日收益率。
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

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    exchange,
    otc
  };
}

/**
 * 把所有 SELL 交易按笔拆成"已卖出"行，并附上对应基金的加权平均成本
 * （= 所有 BUY 的 price 按 shares 加权）。
 * - 已实现收益 = (sellPrice − avgCost) × sellShares
 * - 已实现收益率 = realizedProfit / (avgCost × sellShares)
 * - costBasis = avgCost × sellShares；proceeds = sellPrice × sellShares
 * - 该函数按 SELL 笔展开，部分卖出的基金会同时出现在基金汇总（剩余份额）和本列表（卖出份额）。
 */
export function buildSoldLots(transactions = []) {
  const normalizedTxs = sanitizeTransactions(transactions, { filterInvalid: false });
  const costMap = new Map();
  const txById = new Map();
  for (const tx of normalizedTxs) {
    if (!tx.code) continue;
    if (tx.id) txById.set(tx.id, tx);
    if (!costMap.has(tx.code)) {
      costMap.set(tx.code, { name: '', kind: tx.kind || 'otc', buyShares: 0, buyAmount: 0 });
    }
    const bucket = costMap.get(tx.code);
    if (tx.name && !bucket.name) bucket.name = tx.name;
    if (tx.kind) bucket.kind = tx.kind;
    if (tx.type === 'BUY') {
      bucket.buyShares = round(bucket.buyShares + tx.shares, 4);
      bucket.buyAmount = round(bucket.buyAmount + tx.price * tx.shares, 2);
    }
  }

  const lots = [];
  for (const tx of normalizedTxs) {
    if (tx.type !== 'SELL' || !tx.code) continue;
    const bucket = costMap.get(tx.code) || { name: '', kind: tx.kind || 'otc', buyShares: 0, buyAmount: 0 };
    // 优先使用本笔自带的 costPrice（已卖出快速登记），否则按全部 BUY 加权平均
    const standalone = tx.costPrice > 0;
    const avgCost = standalone
      ? tx.costPrice
      : (bucket.buyShares > 0 ? round(bucket.buyAmount / bucket.buyShares, 4) : 0);
    // 基金切换配对：查找本笔卖出手动指定的反向买入
    const pairTx = tx.switchPairId ? txById.get(tx.switchPairId) : null;
    const isSwitch = Boolean(pairTx && pairTx.type === 'BUY' && pairTx.code && pairTx.code !== tx.code);
    const sellShares = tx.shares;
    const sellPrice = tx.price;
    const proceeds = round(sellPrice * sellShares, 2);
    const costBasis = round(avgCost * sellShares, 2);
    const hasAvgCost = avgCost > 0;
    const realizedProfit = hasAvgCost ? round((sellPrice - avgCost) * sellShares, 2) : 0;
    const realizedReturnRate = hasAvgCost && costBasis > 0
      ? round((realizedProfit / costBasis) * 100, 2)
      : 0;
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
      isSwitch,
      switchPairId: isSwitch ? pairTx.id : '',
      switchTargetCode: isSwitch ? pairTx.code : '',
      switchTargetName: isSwitch ? (pairTx.name || '') : '',
      switchExtraCash: isSwitch ? round(Math.max(pairTx.price * pairTx.shares - proceeds, 0), 2) : 0,
      note: tx.note || '',
      tx
    });
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

const EXCEL_HEADER_KEYWORDS = {
  code: ['代码', '基金代码', 'code'],
  name: ['名称', '基金名称', '基金', 'name'],
  kind: ['场内场外', '场内/场外', '场内外', '标签', 'kind'],
  type: ['类型', '方向', '交易类型', 'type'],
  date: ['日期', '交易日', '交易日期', 'date'],
  price: ['价', '净值', '单价', '价格', '交易价', 'price'],
  shares: ['份额', '数量', 'shares'],
  note: ['备注', '说明', 'note'],
  switch: ['基金切换', '切换标记', '切换', 'switch']
};

function normalizeTypeCell(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (upper === 'BUY' || upper === 'B' || upper === '买' || raw.includes('买')) return 'BUY';
  if (upper === 'SELL' || upper === 'S' || upper === '卖' || raw.includes('卖')) return 'SELL';
  if (raw.includes('申购') || raw.includes('定投')) return 'BUY';
  if (raw.includes('赎回') || raw.includes('清仓')) return 'SELL';
  return upper;
}

function normalizeKindCell(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower === 'otc' || raw.includes('场外')) return 'otc';
  if (lower === 'exchange' || raw.includes('场内') || raw.includes('ETF') || raw.includes('etf')) return 'exchange';
  return '';
}

function detectPasteDelimiter(firstLine = '') {
  if (firstLine.includes('\t')) return '\t';
  if (firstLine.includes(',')) return ',';
  if (firstLine.includes(';')) return ';';
  if (/\s{2,}/.test(firstLine)) return /\s{2,}/;
  return '\t';
}

function splitPasteLine(line, delimiter) {
  if (delimiter instanceof RegExp) {
    return line.split(delimiter).map((cell) => cell.trim());
  }
  return line.split(delimiter).map((cell) => cell.trim());
}

function detectPasteHeader(cells = []) {
  const map = {};
  cells.forEach((cell, index) => {
    const value = String(cell || '').trim();
    if (!value) return;
    const lower = value.toLowerCase();
    for (const [field, keywords] of Object.entries(EXCEL_HEADER_KEYWORDS)) {
      if (map[field] !== undefined) continue;
      const match = keywords.some((kw) => {
        const kwLower = kw.toLowerCase();
        return value === kw || lower === kwLower || value.includes(kw) || lower.includes(kwLower);
      });
      if (match) {
        map[field] = index;
        break;
      }
    }
  });
  return map;
}

/**
 * Parse pasted Excel / TSV / CSV text into draft transactions.
 * - Auto-detects delimiter (tab > comma > semicolon > whitespace run).
 * - Auto-detects header row via keyword match (代码 / 名称 / 类型 / 日期 / 价 / 份额 / ...);
 *   falls back to positional order: code, name, kind, type, date, price, shares, note.
 * - Each row returns { index, raw, cells, draft, errors }. `draft` is a normalized
 *   transaction with a fresh id; callers decide to keep/discard per row.
 */
export function parseExcelPaste(text = '') {
  const raw = String(text || '').replace(/\r\n?/g, '\n');
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/\u3000/g, ' ').trimEnd())
    .filter((line) => line.trim().length > 0);
  if (!lines.length) {
    return { rows: [], headerDetected: false, columnMap: null, delimiter: null, totalLines: 0 };
  }

  const delimiter = detectPasteDelimiter(lines[0]);
  const firstCells = splitPasteLine(lines[0], delimiter);
  const headerMap = detectPasteHeader(firstCells);
  const headerDetected = headerMap.code !== undefined && Object.keys(headerMap).length >= 2;

  let columnMap;
  let dataStart;
  if (headerDetected) {
    columnMap = headerMap;
    dataStart = 1;
  } else {
    columnMap = { code: 0, name: 1, kind: 2, type: 3, date: 4, price: 5, shares: 6, note: 7, switch: 8 };
    dataStart = 0;
  }

  const rows = [];
  for (let i = dataStart; i < lines.length; i += 1) {
    const cells = splitPasteLine(lines[i], delimiter);
    const pick = (field) => {
      const idx = columnMap[field];
      if (idx === undefined || idx === null) return '';
      return cells[idx] !== undefined ? cells[idx] : '';
    };

    const rawDraft = {
      code: pick('code'),
      name: pick('name'),
      kind: normalizeKindCell(pick('kind')),
      type: normalizeTypeCell(pick('type')) || 'BUY',
      date: pick('date'),
      price: pick('price'),
      shares: pick('shares'),
      note: pick('note')
    };
    if (!hasMeaningfulTransaction(rawDraft)) continue;

    const draft = normalizeTransaction(rawDraft);
    const errors = getTransactionErrors(draft);
    const switchHint = String(pick('switch') || '').trim();
    rows.push({ index: i, raw: lines[i], cells, draft, errors, switchHint });
  }

  // 第二轮：根据「切换标记」列把买/卖两腿配对。
  // 支持 '切换至 159501'、'由 159660 切换'、'→ 513100'、纯 6 位代码。
  const pairUsed = new Set();
  rows.forEach((row, idx) => {
    if (pairUsed.has(idx)) return;
    if (!row.switchHint) return;
    const hint = row.switchHint;
    const match = hint.match(/切换至\s*(\d{6})/)
      || hint.match(/由\s*(\d{6})\s*切换/)
      || hint.match(/→\s*(\d{6})/)
      || hint.match(/(\d{6})/);
    const target = match && match[1];
    if (!target || target === row.draft.code) return;
    let bestIdx = -1;
    for (let j = 0; j < rows.length; j += 1) {
      if (j === idx || pairUsed.has(j)) continue;
      const candidate = rows[j].draft;
      if (!candidate || candidate.code !== target) continue;
      if (candidate.type === row.draft.type) continue;
      const sameDate = candidate.date && row.draft.date && candidate.date === row.draft.date;
      if (sameDate) { bestIdx = j; break; }
      if (bestIdx < 0) bestIdx = j;
    }
    if (bestIdx >= 0) {
      row.draft.switchPairId = rows[bestIdx].draft.id;
      rows[bestIdx].draft.switchPairId = row.draft.id;
      pairUsed.add(idx);
      pairUsed.add(bestIdx);
    }
  });

  return {
    rows,
    headerDetected,
    columnMap,
    delimiter: delimiter instanceof RegExp ? 'whitespace' : delimiter === '\t' ? 'tab' : delimiter,
    totalLines: lines.length
  };
}

// ===========================================================================
// 基金切换链路 (Switch Chains)
// ---------------------------------------------------------------------------
// 一条链路 = 用户挑选的若干段持仓：a 段 → b 段 → c 段 → ...
// 每段 = 一笔 BUY 交易 + 可选的 SELL 交易（同代码、SELL 日期 ≥ BUY 日期）。
// 末段的 sellTxId 可为空，代表当前仍在持仓，用最新净值结算。
// 链路收益率 = 每段净值乘积 - 1。
// 未切换基准 = 一直持有第一段那只基金到链路终点的收益率。
//   - 如果末段卖出的代码恰好等于第一段的代码，可用末段卖出价对齐时间；
//   - 否则用第一段基金的最新净值（与“持有至今”对齐）。
// ===========================================================================

function buildChainId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `chain-${Date.now().toString(36)}-${rand}`;
}

export function normalizeSwitchChain(raw = {}) {
  const id = String(raw?.id || '').trim() || buildChainId();
  const name = String(raw?.name || '').trim();
  const rawLegs = Array.isArray(raw?.legs) ? raw.legs : [];
  const legs = rawLegs
    .map((leg) => ({
      buyTxId: String(leg?.buyTxId || '').trim(),
      sellTxId: leg?.sellTxId ? String(leg.sellTxId).trim() : ''
    }))
    .filter((leg) => leg.buyTxId);
  return { id, name, legs };
}

export function normalizeSwitchChains(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(normalizeSwitchChain);
}

function emptyChainMetrics(extra = {}) {
  return {
    segments: [],
    valid: false,
    validationError: '',
    chainReturn: 0,
    chainMultiple: 1,
    baselineCode: '',
    baselineStartPrice: 0,
    baselineEndPrice: 0,
    baselineEndSource: '',
    baselineAlignedToChainEnd: false,
    baselineReturn: 0,
    baselineMultiple: 1,
    advantage: 0,
    multipleAdvantage: 0,
    missingPriceCodes: [],
    // 份额延续口径（元）
    initialCapital: 0,
    chainFinalValue: 0,
    chainProfit: 0,
    chainProfitRate: 0,
    baselineFinalValue: 0,
    baselineProfit: 0,
    advantageProfit: 0,
    cashFlowValid: false,
    cashFlowNote: '',
    ...extra
  };
}

/**
 * 计算某条切换链路的关键指标。
 * 入参:
 *   - chain: { id, name, legs: [{ buyTxId, sellTxId? }] }
 *   - transactions: 交易流水数组
 *   - snapshotsByCode: { [code]: { latestNav, latestNavDate, ... } }
 * 返回:
 *   { segments, chainReturn, chainMultiple, baselineReturn, baselineMultiple,
 *     advantage, multipleAdvantage, valid, validationError, missingPriceCodes }
 */
export function computeSwitchChainMetrics(chain, transactions = [], snapshotsByCode = {}) {
  if (!chain || !Array.isArray(chain.legs) || chain.legs.length === 0) {
    return emptyChainMetrics({ validationError: '链路至少需要一段。' });
  }

  const txById = new Map();
  for (const tx of transactions || []) {
    if (tx && tx.id) txById.set(tx.id, tx);
  }

  const segments = [];
  const missingPriceCodes = new Set();
  let segmentsValid = true;

  for (let i = 0; i < chain.legs.length; i += 1) {
    const leg = chain.legs[i];
    const buyTx = txById.get(leg.buyTxId);
    if (!buyTx) {
      return emptyChainMetrics({ validationError: `第 ${i + 1} 段未找到买入交易。` });
    }
    if (buyTx.type !== 'BUY') {
      return emptyChainMetrics({
        validationError: `第 ${i + 1} 段需选择 BUY 交易（${buyTx.code}）。`
      });
    }

    const sellTx = leg.sellTxId ? txById.get(leg.sellTxId) : null;
    if (leg.sellTxId && !sellTx) {
      return emptyChainMetrics({ validationError: `第 ${i + 1} 段未找到卖出交易。` });
    }
    if (sellTx) {
      if (sellTx.type !== 'SELL') {
        return emptyChainMetrics({
          validationError: `第 ${i + 1} 段需选择 SELL 交易（${sellTx.code}）。`
        });
      }
      if (sellTx.code !== buyTx.code) {
        return emptyChainMetrics({
          validationError: `第 ${i + 1} 段买卖代码不一致（${buyTx.code} vs ${sellTx.code}）。`
        });
      }
      if (sellTx.date && buyTx.date && sellTx.date < buyTx.date) {
        return emptyChainMetrics({
          validationError: `第 ${i + 1} 段卖出日期早于买入日期。`
        });
      }
    }

    const segStart = Number(buyTx.price) || 0;
    let segEnd = 0;
    let segEndDate = '';
    let segEndSource = sellTx ? 'sell' : 'latestNav';

    if (sellTx) {
      segEnd = Number(sellTx.price) || 0;
      segEndDate = sellTx.date || '';
    } else {
      const snap = snapshotsByCode?.[buyTx.code] || null;
      segEnd = Number(snap?.latestNav) || 0;
      segEndDate = String(snap?.latestNavDate || '');
      if (!(segEnd > 0)) missingPriceCodes.add(buyTx.code);
    }

    if (!(segStart > 0)) {
      missingPriceCodes.add(buyTx.code);
    }

    const segValid = segStart > 0 && segEnd > 0;
    const segMultiple = segValid ? segEnd / segStart : 1;
    const segReturn = segValid ? segMultiple - 1 : 0;
    if (!segValid) segmentsValid = false;

    segments.push({
      buyTxId: leg.buyTxId,
      sellTxId: leg.sellTxId || '',
      code: buyTx.code,
      name: buyTx.name || '',
      kind: buyTx.kind,
      buyDate: buyTx.date || '',
      buyPrice: round(segStart, 6),
      sellDate: segEndDate,
      sellPrice: round(segEnd, 6),
      segEndSource,
      segMultiple: round(segMultiple, 6),
      segReturn: round(segReturn, 6),
      buyShares: Number(buyTx.shares) || 0,
      sellShares: sellTx ? (Number(sellTx.shares) || 0) : 0,
      valid: segValid
    });
  }

  // 链路乘积
  let chainMultiple = 1;
  for (const seg of segments) {
    chainMultiple *= seg.valid ? seg.segMultiple : 1;
  }
  const chainReturn = chainMultiple - 1;

  // 未切换基准：持有第一段那只基金
  const firstSeg = segments[0];
  const lastSeg = segments[segments.length - 1];
  const baselineCode = firstSeg.code;
  const baselineStartPrice = firstSeg.buyPrice;

  let baselineEndPrice = 0;
  let baselineEndSource = '';
  let baselineAlignedToChainEnd = false;

  if (lastSeg.code === baselineCode && lastSeg.segEndSource === 'sell') {
    // 完美对齐：链路终点正好卖出基准基金
    baselineEndPrice = lastSeg.sellPrice;
    baselineEndSource = 'leg-end';
    baselineAlignedToChainEnd = true;
  } else {
    const snap = snapshotsByCode?.[baselineCode] || null;
    baselineEndPrice = Number(snap?.latestNav) || 0;
    baselineEndSource = 'latestNav';
    if (!(baselineEndPrice > 0)) missingPriceCodes.add(baselineCode);
  }

  const baselineValid = baselineStartPrice > 0 && baselineEndPrice > 0;
  const baselineMultiple = baselineValid ? baselineEndPrice / baselineStartPrice : 1;
  const baselineReturn = baselineValid ? baselineMultiple - 1 : 0;

  const valid = segmentsValid && baselineValid;
  const advantage = valid ? chainReturn - baselineReturn : 0;
  const multipleAdvantage = valid ? chainMultiple - baselineMultiple : 0;

  // 份额延续口径（现金滚动）
  // 初始资金 = 首段 buy.shares × buy.price
  // 每段卖出后的现金全额转入下一段，按下一段 buy.price 换算为理论份额
  // 末段“持有至今”时用理论份额 × latestNav
  let initialCapital = 0;
  let chainFinalValue = 0;
  let chainProfit = 0;
  let chainProfitRate = 0;
  let baselineFinalValue = 0;
  let baselineProfit = 0;
  let advantageProfit = 0;
  let cashFlowValid = false;
  let cashFlowNote = '';

  if (valid && firstSeg.buyShares > 0) {
    initialCapital = firstSeg.buyShares * firstSeg.buyPrice;
    let theoreticalShares = firstSeg.buyShares;
    let cashOnHand = 0;
    cashFlowValid = true;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      // 本段取得份额：首段用用户实际 buy.shares；后续段用现金滚动
      if (i === 0) {
        theoreticalShares = seg.buyShares;
      } else {
        if (!(seg.buyPrice > 0)) {
          cashFlowValid = false;
          cashFlowNote = `第 ${i + 1} 段买价为 0，无法换算份额。`;
          break;
        }
        theoreticalShares = cashOnHand / seg.buyPrice;
      }
      // 本段末现金
      if (seg.segEndSource === 'sell') {
        // 有真实卖单：首段用用户实际 sell.shares；后续段不知道用户实际卖了多少（理论份额不一定等于用户买入份额），按理论份额 × sellPrice
        if (i === 0 && seg.sellShares > 0) {
          cashOnHand = seg.sellShares * seg.sellPrice;
        } else {
          cashOnHand = theoreticalShares * seg.sellPrice;
        }
      } else {
        // 持有至今: 理论份额 × latestNav
        cashOnHand = theoreticalShares * seg.sellPrice;
      }
    }
    if (cashFlowValid) {
      chainFinalValue = cashOnHand;
      chainProfit = chainFinalValue - initialCapital;
      chainProfitRate = initialCapital > 0 ? chainProfit / initialCapital : 0;
      baselineFinalValue = firstSeg.buyShares * baselineEndPrice;
      baselineProfit = baselineFinalValue - initialCapital;
      advantageProfit = chainProfit - baselineProfit;
    }
  } else if (!valid) {
    cashFlowNote = '缺净值或段不完整，无法计算实际盈亏。';
  } else {
    cashFlowNote = '首段买入份额为 0，无法计算实际盈亏。';
  }

  return {
    segments,
    valid,
    validationError: '',
    chainReturn: round(chainReturn, 6),
    chainMultiple: round(chainMultiple, 6),
    baselineCode,
    baselineStartPrice: round(baselineStartPrice, 6),
    baselineEndPrice: round(baselineEndPrice, 6),
    baselineEndSource,
    baselineAlignedToChainEnd,
    baselineReturn: round(baselineReturn, 6),
    baselineMultiple: round(baselineMultiple, 6),
    advantage: round(advantage, 6),
    multipleAdvantage: round(multipleAdvantage, 6),
    missingPriceCodes: Array.from(missingPriceCodes),
    initialCapital: round(initialCapital, 4),
    chainFinalValue: round(chainFinalValue, 4),
    chainProfit: round(chainProfit, 4),
    chainProfitRate: round(chainProfitRate, 6),
    baselineFinalValue: round(baselineFinalValue, 4),
    baselineProfit: round(baselineProfit, 4),
    advantageProfit: round(advantageProfit, 4),
    cashFlowValid,
    cashFlowNote
  };
}
