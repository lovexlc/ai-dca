export const QUANT_PREMIUM_PAPER_STATE_PREFIX = 'quant:premium:paper:state:';

const DEFAULT_PAPER_STATE = {
  enabled: true,
  cash: 60000,
  feeRate: 0.01,
  minFee: 0,
  tickSize: 0.001,
  slippageTicks: 1,
  lotSize: 100,
  maxOrderCash: 16000,
  minOrderCash: 1000,
  maxExecutionsPerDay: 1,
  executionsToday: 0,
  lastExecutionDate: '',
  lastExecutionAt: '',
  lastStatus: 'idle',
  lastReason: '',
  updatedAt: '',
  positions: {
    '159513': {
      code: '159513',
      name: '纳指科技 ETF',
      shares: 20000,
      costPrice: 1.735
    },
    '513100': {
      code: '513100',
      name: '纳指 ETF',
      shares: 8000,
      costPrice: 1.486
    }
  },
  orders: [],
  cashEvents: []
};

const FUND_CODE_PATTERN = /^\d{6}$/;
const MAX_ORDERS = 120;
const MAX_CASH_EVENTS = 80;

export function quantPremiumPaperStateKey(clientId) {
  return `${QUANT_PREMIUM_PAPER_STATE_PREFIX}${String(clientId || '').trim()}`;
}

function clampNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((clampNumber(value) + Number.EPSILON) * factor) / factor;
}

function sanitizeCode(value = '') {
  const code = String(value || '').trim();
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

function positiveNumber(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

function nonNegativeNumber(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return 0;
}

function normalizePosition(raw = {}, fallbackCode = '') {
  const code = sanitizeCode(raw?.code || raw?.symbol || fallbackCode);
  if (!code) return null;
  return {
    code,
    name: String(raw?.name || code).trim().slice(0, 80),
    shares: Math.max(0, roundTo(raw?.shares, 4)),
    costPrice: Math.max(0, roundTo(raw?.costPrice ?? raw?.cost_price, 4))
  };
}

function normalizeOrder(raw = {}) {
  const side = raw?.side === 'BUY' || raw?.side === 'SELL' ? raw.side : '';
  const code = sanitizeCode(raw?.code || raw?.symbol);
  if (!side || !code) return null;
  const quantity = Math.max(0, roundTo(raw?.quantity ?? raw?.shares, 4));
  const price = Math.max(0, roundTo(raw?.price, 4));
  if (!(quantity > 0) || !(price > 0)) return null;
  return {
    id: String(raw?.id || '').trim() || createOrderId(side.toLowerCase()),
    eventId: String(raw?.eventId || '').trim(),
    ts: String(raw?.ts || raw?.createdAt || '').trim(),
    side,
    code,
    name: String(raw?.name || code).trim().slice(0, 80),
    price,
    quantity,
    amount: Math.max(0, roundTo(raw?.amount ?? quantity * price, 2)),
    fee: Math.max(0, roundTo(raw?.fee, 2)),
    status: String(raw?.status || 'filled').trim().slice(0, 30),
    reason: String(raw?.reason || '').trim().slice(0, 160)
  };
}

function normalizeCashEvent(raw = {}) {
  const amount = Math.abs(roundTo(raw?.amount, 2));
  const cashBefore = roundTo(raw?.cashBefore, 2);
  const cashAfter = roundTo(raw?.cashAfter, 2);
  if (!(amount > 0)) return null;
  return {
    id: String(raw?.id || '').trim() || createOrderId('cash'),
    ts: String(raw?.ts || raw?.createdAt || '').trim(),
    type: raw?.type === 'withdraw' ? 'withdraw' : 'deposit',
    amount,
    cashBefore,
    cashAfter,
    note: String(raw?.note || '').trim().slice(0, 120)
  };
}

export function normalizeSwitchPaperState(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const positions = {};
  const rawPositions = source.positions && typeof source.positions === 'object'
    ? source.positions
    : DEFAULT_PAPER_STATE.positions;
  for (const [code, rawPosition] of Object.entries(rawPositions || {})) {
    const normalized = normalizePosition(rawPosition, code);
    if (normalized) positions[normalized.code] = normalized;
  }

  return {
    enabled: source.enabled === undefined ? DEFAULT_PAPER_STATE.enabled : Boolean(source.enabled),
    cash: Math.max(0, roundTo(source.cash ?? DEFAULT_PAPER_STATE.cash, 2)),
    feeRate: Math.max(0, roundTo(source.feeRate ?? DEFAULT_PAPER_STATE.feeRate, 4)),
    minFee: Math.max(0, roundTo(source.minFee ?? DEFAULT_PAPER_STATE.minFee, 2)),
    tickSize: Math.max(0.0001, roundTo(source.tickSize ?? DEFAULT_PAPER_STATE.tickSize, 4)),
    slippageTicks: Math.max(0, Math.floor(clampNumber(source.slippageTicks, DEFAULT_PAPER_STATE.slippageTicks))),
    lotSize: Math.max(1, Math.floor(clampNumber(source.lotSize, DEFAULT_PAPER_STATE.lotSize))),
    maxOrderCash: Math.max(0, roundTo(source.maxOrderCash ?? DEFAULT_PAPER_STATE.maxOrderCash, 2)),
    minOrderCash: Math.max(0, roundTo(source.minOrderCash ?? DEFAULT_PAPER_STATE.minOrderCash, 2)),
    maxExecutionsPerDay: Math.max(1, Math.min(20, Math.floor(clampNumber(source.maxExecutionsPerDay, DEFAULT_PAPER_STATE.maxExecutionsPerDay)))),
    executionsToday: Math.max(0, Math.floor(clampNumber(source.executionsToday, 0))),
    lastExecutionDate: String(source.lastExecutionDate || '').slice(0, 10),
    lastExecutionAt: String(source.lastExecutionAt || '').trim(),
    lastStatus: String(source.lastStatus || DEFAULT_PAPER_STATE.lastStatus).trim().slice(0, 40),
    lastReason: String(source.lastReason || '').trim().slice(0, 200),
    updatedAt: String(source.updatedAt || '').trim(),
    positions,
    orders: Array.isArray(source.orders)
      ? source.orders.map((order) => normalizeOrder(order)).filter(Boolean).slice(0, MAX_ORDERS)
      : [],
    cashEvents: Array.isArray(source.cashEvents)
      ? source.cashEvents.map((event) => normalizeCashEvent(event)).filter(Boolean).slice(0, MAX_CASH_EVENTS)
      : []
  };
}

export function createDefaultSwitchPaperState(overrides = {}) {
  return normalizeSwitchPaperState({
    ...DEFAULT_PAPER_STATE,
    ...overrides,
    positions: overrides.positions || DEFAULT_PAPER_STATE.positions,
    orders: overrides.orders || [],
    cashEvents: overrides.cashEvents || []
  });
}

function shanghaiDateKey(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
    return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : '';
  } catch {
    return new Date(date).toISOString().slice(0, 10);
  }
}

function resetDailyExecutionWindow(state, timestamp) {
  const dateKey = shanghaiDateKey(new Date(timestamp));
  if (state.lastExecutionDate === dateKey) {
    return { dateKey, executionsToday: state.executionsToday };
  }
  return { dateKey, executionsToday: 0 };
}

function floorToLot(quantity, lotSize) {
  const lot = Math.max(1, Math.floor(clampNumber(lotSize, 1)));
  return Math.floor(Math.max(0, clampNumber(quantity, 0)) / lot) * lot;
}

function roundPriceToTick(price, tickSize) {
  const tick = Math.max(0.0001, clampNumber(tickSize, 0.001));
  return Math.max(tick, roundTo(Math.round(clampNumber(price, 0) / tick) * tick, 4));
}

function calcFee(amount, state) {
  if (!(amount > 0)) return 0;
  const raw = amount * (Math.max(0, clampNumber(state.feeRate, 0)) / 100);
  return roundTo(Math.max(raw, Math.max(0, clampNumber(state.minFee, 0))), 2);
}

function normalizeOrderBook(book = null) {
  if (!book || typeof book !== 'object') return null;
  const bidPrice = positiveNumber(book.bidPrice, book.bid_price, book.bp1);
  const askPrice = positiveNumber(book.askPrice, book.ask_price, book.sp1);
  const bidVolume = nonNegativeNumber(book.bidVolume, book.bid_volume, book.bc1);
  const askVolume = nonNegativeNumber(book.askVolume, book.ask_volume, book.sc1);
  if (!(bidPrice > 0) && !(askPrice > 0)) return null;
  return {
    bidPrice: bidPrice || null,
    bidVolume,
    askPrice: askPrice || null,
    askVolume
  };
}

function findTriggerLegs(snapshot = {}, trigger = {}) {
  if (trigger?.kind === 'otc' || String(trigger?.rule || '').startsWith('OTC_')) {
    return null;
  }
  const fromCode = sanitizeCode(trigger.fromCode);
  const toCode = sanitizeCode(trigger.toCode);
  if (!fromCode || !toCode) return null;
  const group = (Array.isArray(snapshot.byBenchmark) ? snapshot.byBenchmark : [])
    .find((item) => item?.benchmarkCode === fromCode) || null;
  const candidate = (group?.candidates || []).find((item) => item?.code === toCode) || null;
  if (!group || !candidate) return null;
  return {
    fromCode,
    fromName: trigger.fromName || group.benchmarkName || fromCode,
    toCode,
    toName: trigger.toName || candidate.name || toCode,
    sellOrderBook: normalizeOrderBook(group.benchmarkOrderBook),
    buyOrderBook: normalizeOrderBook(candidate.orderBook),
    sellFallbackPrice: positiveNumber(group.benchmarkPrice),
    buyFallbackPrice: positiveNumber(candidate.price)
  };
}

function buildTriggerReason(trigger = {}) {
  const rule = String(trigger.rule || '').trim();
  const gap = Number(trigger.gapPct ?? trigger.diffPct);
  const threshold = Number(trigger.threshold);
  const gapText = Number.isFinite(gap) ? `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}%` : '';
  const thresholdText = Number.isFinite(threshold) ? `${threshold.toFixed(2)}%` : '';
  if (rule === 'A') return `切换 A 触发 ${gapText} < ${thresholdText}`;
  if (rule === 'B') return `切换 B 触发 ${gapText} > ${thresholdText}`;
  return '溢价差触发';
}

export function buildSwitchPaperOrderPlan(stateInput, snapshot, trigger, timestamp = new Date().toISOString()) {
  const state = normalizeSwitchPaperState(stateInput);
  const { dateKey, executionsToday } = resetDailyExecutionWindow(state, timestamp);
  if (!state.enabled) {
    return { canTrade: false, rejectReason: 'paper-disabled', state, legs: null };
  }
  if (executionsToday >= state.maxExecutionsPerDay) {
    return { canTrade: false, rejectReason: 'daily-limit', state: { ...state, executionsToday, lastExecutionDate: dateKey }, legs: null };
  }

  const legs = findTriggerLegs(snapshot, trigger);
  if (!legs) {
    return { canTrade: false, rejectReason: 'unsupported-trigger', state: { ...state, executionsToday, lastExecutionDate: dateKey }, legs: null };
  }

  const sellPosition = state.positions[legs.fromCode] || { code: legs.fromCode, name: legs.fromName, shares: 0, costPrice: 0 };
  const slip = state.slippageTicks * state.tickSize;
  const bidPrice = positiveNumber(legs.sellOrderBook?.bidPrice, legs.sellFallbackPrice);
  const askPrice = positiveNumber(legs.buyOrderBook?.askPrice, legs.buyFallbackPrice);
  const sellPrice = roundPriceToTick(bidPrice - slip, state.tickSize);
  const buyPrice = roundPriceToTick(askPrice + slip, state.tickSize);
  const maxSellByCash = sellPrice > 0 ? state.maxOrderCash / sellPrice : 0;
  const sellQuantity = floorToLot(
    Math.min(
      sellPosition.shares,
      legs.sellOrderBook?.bidVolume || Number.POSITIVE_INFINITY,
      maxSellByCash
    ),
    state.lotSize
  );
  const sellAmount = roundTo(sellQuantity * sellPrice, 2);
  const sellFee = calcFee(sellAmount, state);
  const sellNet = Math.max(0, sellAmount - sellFee);
  const buyBudget = Math.min(state.maxOrderCash, state.cash + sellNet);
  const buyQuantity = floorToLot(
    Math.min(
      legs.buyOrderBook?.askVolume || Number.POSITIVE_INFINITY,
      buyPrice > 0 ? buyBudget / buyPrice : 0
    ),
    state.lotSize
  );
  const buyAmount = roundTo(buyQuantity * buyPrice, 2);
  const buyFee = calcFee(buyAmount, state);
  const canTrade = sellQuantity > 0
    && buyQuantity > 0
    && sellAmount >= state.minOrderCash
    && buyAmount >= state.minOrderCash;

  return {
    canTrade,
    rejectReason: canTrade
      ? ''
      : sellQuantity <= 0
        ? 'no-sell-position-or-depth'
        : buyQuantity <= 0
          ? 'no-buy-cash-or-depth'
          : 'below-min-order-cash',
    state: { ...state, executionsToday, lastExecutionDate: dateKey },
    legs,
    sell: {
      side: 'SELL',
      code: legs.fromCode,
      name: legs.fromName,
      price: sellPrice,
      quantity: sellQuantity,
      amount: sellAmount,
      fee: sellFee
    },
    buy: {
      side: 'BUY',
      code: legs.toCode,
      name: legs.toName,
      price: buyPrice,
      quantity: buyQuantity,
      amount: buyAmount,
      fee: buyFee
    }
  };
}

function createOrderId(prefix = 'paper') {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}`;
}

export function adjustSwitchPaperCash(stateInput, { amount = 0, note = '', timestamp = new Date().toISOString() } = {}) {
  const state = normalizeSwitchPaperState(stateInput);
  const requestedDelta = roundTo(amount, 2);
  if (!Number.isFinite(requestedDelta) || requestedDelta === 0) {
    return { state, event: null, adjusted: false };
  }
  const nextCash = roundTo(Math.max(0, state.cash + requestedDelta), 2);
  const appliedDelta = roundTo(nextCash - state.cash, 2);
  if (appliedDelta === 0) {
    return { state, event: null, adjusted: false };
  }
  const event = {
    id: createOrderId(appliedDelta > 0 ? 'cash-in' : 'cash-out'),
    ts: timestamp,
    type: appliedDelta > 0 ? 'deposit' : 'withdraw',
    amount: Math.abs(appliedDelta),
    cashBefore: state.cash,
    cashAfter: nextCash,
    note: String(note || '').trim().slice(0, 120)
  };
  return {
    state: normalizeSwitchPaperState({
      ...state,
      cash: nextCash,
      updatedAt: timestamp,
      lastStatus: 'cash-adjusted',
      lastReason: appliedDelta > 0 ? '手动增加模拟现金' : '手动减少模拟现金',
      cashEvents: [event, ...state.cashEvents].slice(0, MAX_CASH_EVENTS)
    }),
    event,
    adjusted: true
  };
}

function applySell(state, fill) {
  const position = state.positions[fill.code] || {
    code: fill.code,
    name: fill.name,
    shares: 0,
    costPrice: 0
  };
  const quantity = Math.min(position.shares, fill.quantity);
  const amount = roundTo(quantity * fill.price, 2);
  const fee = calcFee(amount, state);
  const nextShares = Math.max(0, position.shares - quantity);
  state.cash = roundTo(state.cash + amount - fee, 2);
  state.positions[fill.code] = {
    ...position,
    name: fill.name || position.name,
    shares: roundTo(nextShares, 4),
    costPrice: nextShares > 0 ? position.costPrice : 0
  };
  return { ...fill, quantity, amount, fee };
}

function applyBuy(state, fill) {
  const feeReserve = calcFee(fill.quantity * fill.price, state);
  const availableForAmount = Math.max(0, state.cash - feeReserve);
  const maxQuantity = fill.price > 0 ? floorToLot(availableForAmount / fill.price, state.lotSize) : 0;
  const quantity = Math.min(fill.quantity, maxQuantity);
  const amount = roundTo(quantity * fill.price, 2);
  const fee = calcFee(amount, state);
  if (amount + fee > state.cash || quantity <= 0) {
    return { ...fill, quantity: 0, amount: 0, fee: 0 };
  }
  const position = state.positions[fill.code] || {
    code: fill.code,
    name: fill.name,
    shares: 0,
    costPrice: 0
  };
  const currentCost = position.shares * position.costPrice;
  const nextShares = position.shares + quantity;
  const nextCostPrice = nextShares > 0 ? (currentCost + amount + fee) / nextShares : 0;
  state.cash = roundTo(state.cash - amount - fee, 2);
  state.positions[fill.code] = {
    ...position,
    name: fill.name || position.name,
    shares: roundTo(nextShares, 4),
    costPrice: roundTo(nextCostPrice, 4)
  };
  return { ...fill, quantity, amount, fee };
}

export function executeSwitchPaperTrade(stateInput, snapshot, trigger, timestamp = new Date().toISOString()) {
  const plan = buildSwitchPaperOrderPlan(stateInput, snapshot, trigger, timestamp);
  const nextState = normalizeSwitchPaperState(plan.state);
  const reason = buildTriggerReason(trigger);

  if (!plan.canTrade) {
    return {
      state: {
        ...nextState,
        lastStatus: 'skipped',
        lastReason: plan.rejectReason,
        updatedAt: timestamp
      },
      plan,
      fills: [],
      executed: false,
      skipped: plan.rejectReason
    };
  }

  const sellFill = applySell(nextState, plan.sell);
  const buyFill = applyBuy(nextState, plan.buy);
  const eventId = `paper:${trigger.pairKey || `${plan.sell.code}:${plan.buy.code}`}:${String(timestamp).slice(0, 16)}`;
  const fills = [sellFill, buyFill]
    .filter((fill) => fill.quantity > 0)
    .map((fill) => ({
      id: createOrderId(fill.side.toLowerCase()),
      eventId,
      ts: timestamp,
      side: fill.side,
      code: fill.code,
      name: fill.name,
      price: roundTo(fill.price, 4),
      quantity: roundTo(fill.quantity, 4),
      amount: roundTo(fill.amount, 2),
      fee: roundTo(fill.fee, 2),
      status: 'filled',
      reason
    }));

  const executed = fills.length === 2;
  const dateKey = shanghaiDateKey(new Date(timestamp));
  return {
    state: normalizeSwitchPaperState({
      ...nextState,
      executionsToday: executed ? nextState.executionsToday + 1 : nextState.executionsToday,
      lastExecutionDate: dateKey,
      lastExecutionAt: executed ? timestamp : nextState.lastExecutionAt,
      lastStatus: executed ? 'executed' : 'skipped',
      lastReason: executed ? reason : 'partial-fill',
      updatedAt: timestamp,
      orders: executed ? [...fills, ...nextState.orders].slice(0, MAX_ORDERS) : nextState.orders
    }),
    plan,
    fills: executed ? fills : [],
    executed,
    skipped: executed ? '' : 'partial-fill'
  };
}
