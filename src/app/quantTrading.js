import { clampNumber, roundTo } from './backtest/core/math.js';

export { clampNumber, roundTo } from './backtest/core/math.js';

export const QUANT_PROJECT_STORAGE_KEY = 'aiDcaQuantProjectState';

export const DEFAULT_QUANT_STATE = {
  account: {
    cash: 60000,
    feeRate: 0.01,
    minFee: 0,
    tickSize: 0.001,
    slippageTicks: 1,
    positions: {
      '159513': {
        symbol: '159513',
        name: '纳指科技 ETF',
        shares: 20000,
        costPrice: 1.735
      },
      '513100': {
        symbol: '513100',
        name: '纳指 ETF',
        shares: 8000,
        costPrice: 1.486
      }
    }
  },
  strategy: {
    name: '纳指 ETF 溢价差',
    sellSymbol: '159513',
    buySymbol: '513100',
    triggerSpreadPct: 0.3,
    closeSpreadPct: 0.12,
    feeBufferPct: 0.04,
    maxOrderCash: 16000,
    minOrderCash: 1000,
    lotSize: 100,
    cooldownDays: 2
  },
  quotes: {
    '159513': {
      symbol: '159513',
      name: '纳指科技 ETF',
      bid: 1.772,
      bidSize: 83000,
      ask: 1.773,
      askSize: 64000,
      iopv: 1.762
    },
    '513100': {
      symbol: '513100',
      name: '纳指 ETF',
      bid: 1.498,
      bidSize: 92000,
      ask: 1.499,
      askSize: 78000,
      iopv: 1.496
    }
  },
  realtime: {
    enabled: false,
    autoExecute: false,
    onlyTradingSession: true,
    refreshIntervalSec: 10,
    maxExecutionsPerDay: 1,
    executionsToday: 0,
    lastExecutionDate: '',
    lastExecutionAt: '',
    lastRefreshAt: '',
    lastQuoteAt: '',
    lastStatus: 'idle',
    lastError: ''
  },
  settings: {
    dataSource: 'xueqiu',
    broker: 'paper',
    brokerAccount: 'PAPER-001',
    brokerApiKey: '',
    viewDensity: 'standard',
    paperTradeOnly: true,
    useV2Logic: true,  // 新增：默认启用V2逻辑（admin专用）
    enableEnhancedRiskControl: true  // 新增：默认启用增强风控
  },
  orders: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSymbol(value, fallback = '') {
  const next = String(value || '').trim().toUpperCase();
  return next || fallback;
}

function normalizeAccount(account = {}) {
  const fallback = DEFAULT_QUANT_STATE.account;
  const positions = {};
  const sourcePositions = account.positions && typeof account.positions === 'object'
    ? account.positions
    : fallback.positions;
  for (const [key, item] of Object.entries(sourcePositions || {})) {
    const symbol = normalizeSymbol(item?.symbol, normalizeSymbol(key));
    if (!symbol) continue;
    positions[symbol] = {
      symbol,
      name: String(item?.name || symbol),
      shares: Math.max(0, clampNumber(item?.shares, 0)),
      costPrice: Math.max(0, clampNumber(item?.costPrice, 0))
    };
  }
  return {
    cash: Math.max(0, clampNumber(account.cash, fallback.cash)),
    feeRate: Math.max(0, clampNumber(account.feeRate, fallback.feeRate)),
    minFee: Math.max(0, clampNumber(account.minFee, fallback.minFee)),
    tickSize: Math.max(0.0001, clampNumber(account.tickSize, fallback.tickSize)),
    slippageTicks: Math.max(0, clampNumber(account.slippageTicks, fallback.slippageTicks)),
    positions
  };
}

function normalizeStrategy(strategy = {}) {
  const fallback = DEFAULT_QUANT_STATE.strategy;
  return {
    name: String(strategy.name || fallback.name),
    sellSymbol: normalizeSymbol(strategy.sellSymbol, fallback.sellSymbol),
    buySymbol: normalizeSymbol(strategy.buySymbol, fallback.buySymbol),
    triggerSpreadPct: Math.max(0, clampNumber(strategy.triggerSpreadPct, fallback.triggerSpreadPct)),
    closeSpreadPct: Math.max(0, clampNumber(strategy.closeSpreadPct, fallback.closeSpreadPct)),
    feeBufferPct: Math.max(0, clampNumber(strategy.feeBufferPct, fallback.feeBufferPct)),
    maxOrderCash: Math.max(0, clampNumber(strategy.maxOrderCash, fallback.maxOrderCash)),
    minOrderCash: Math.max(0, clampNumber(strategy.minOrderCash, fallback.minOrderCash)),
    lotSize: Math.max(1, Math.floor(clampNumber(strategy.lotSize, fallback.lotSize))),
    cooldownDays: Math.max(0, Math.floor(clampNumber(strategy.cooldownDays, fallback.cooldownDays)))
  };
}

function normalizeQuote(quote = {}, fallbackQuote = {}) {
  const symbol = normalizeSymbol(quote.symbol, normalizeSymbol(fallbackQuote.symbol));
  return {
    symbol,
    name: String(quote.name || fallbackQuote.name || symbol),
    bid: Math.max(0, clampNumber(quote.bid, fallbackQuote.bid || 0)),
    bidSize: Math.max(0, clampNumber(quote.bidSize, fallbackQuote.bidSize || 0)),
    ask: Math.max(0, clampNumber(quote.ask, fallbackQuote.ask || 0)),
    askSize: Math.max(0, clampNumber(quote.askSize, fallbackQuote.askSize || 0)),
    iopv: Math.max(0, clampNumber(quote.iopv, fallbackQuote.iopv || 0)),
    price: Math.max(0, clampNumber(quote.price, fallbackQuote.price || quote.bid || quote.ask || 0)),
    asOf: String(quote.asOf || fallbackQuote.asOf || '').trim(),
    source: String(quote.source || fallbackQuote.source || '').trim(),
    marketState: String(quote.marketState || fallbackQuote.marketState || '').trim(),
    cached: quote.cached === true
  };
}

function normalizeQuotes(quotes = {}) {
  const next = {};
  const symbols = new Set([
    ...Object.keys(DEFAULT_QUANT_STATE.quotes),
    ...Object.keys(quotes || {})
  ]);
  for (const symbol of symbols) {
    const normalized = normalizeQuote(quotes?.[symbol], DEFAULT_QUANT_STATE.quotes[symbol]);
    if (normalized.symbol) next[normalized.symbol] = normalized;
  }
  return next;
}

export function shanghaiDateKey(date = new Date()) {
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
    return '';
  }
}

function normalizeRealtime(realtime = {}) {
  const fallback = DEFAULT_QUANT_STATE.realtime;
  const lastExecutionDate = String(realtime.lastExecutionDate || '').slice(0, 10);
  const today = shanghaiDateKey();
  const executionsToday = lastExecutionDate && lastExecutionDate === today
    ? Math.max(0, Math.floor(clampNumber(realtime.executionsToday, fallback.executionsToday)))
    : 0;
  return {
    enabled: realtime.enabled === true,
    autoExecute: realtime.autoExecute === true,
    onlyTradingSession: realtime.onlyTradingSession !== false,
    refreshIntervalSec: Math.max(5, Math.min(60, Math.floor(clampNumber(realtime.refreshIntervalSec, fallback.refreshIntervalSec)))),
    maxExecutionsPerDay: Math.max(1, Math.min(20, Math.floor(clampNumber(realtime.maxExecutionsPerDay, fallback.maxExecutionsPerDay)))),
    executionsToday,
    lastExecutionDate,
    lastExecutionAt: String(realtime.lastExecutionAt || '').trim(),
    lastRefreshAt: String(realtime.lastRefreshAt || '').trim(),
    lastQuoteAt: String(realtime.lastQuoteAt || '').trim(),
    lastStatus: String(realtime.lastStatus || fallback.lastStatus).trim(),
    lastError: String(realtime.lastError || '').trim().slice(0, 240)
  };
}

function normalizeSettings(settings = {}) {
  const fallback = DEFAULT_QUANT_STATE.settings;
  const dataSource = ['xueqiu', 'manual'].includes(settings.dataSource) ? settings.dataSource : fallback.dataSource;
  const broker = ['paper', 'ptrade', 'qmt'].includes(settings.broker) ? settings.broker : fallback.broker;
  const viewDensity = ['standard', 'compact'].includes(settings.viewDensity) ? settings.viewDensity : fallback.viewDensity;
  return {
    dataSource,
    broker,
    brokerAccount: String(settings.brokerAccount || fallback.brokerAccount).trim().slice(0, 64),
    brokerApiKey: String(settings.brokerApiKey || '').trim().slice(0, 160),
    viewDensity,
    paperTradeOnly: settings.paperTradeOnly !== false,
    useV2Logic: settings.useV2Logic !== false,  // 默认启用V2逻辑
    enableEnhancedRiskControl: settings.enableEnhancedRiskControl !== false  // 默认启用增强风控
  };
}

export function normalizeQuantState(input = {}) {
  const account = normalizeAccount(input.account);
  const strategy = normalizeStrategy(input.strategy);
  const quotes = normalizeQuotes(input.quotes);
  const realtime = normalizeRealtime(input.realtime);
  const settings = normalizeSettings(input.settings);
  for (const symbol of [strategy.sellSymbol, strategy.buySymbol]) {
    if (!quotes[symbol]) {
      quotes[symbol] = normalizeQuote({ symbol }, {});
    }
    if (!account.positions[symbol]) {
      account.positions[symbol] = {
        symbol,
        name: quotes[symbol]?.name || symbol,
        shares: 0,
        costPrice: 0
      };
    }
  }
  const orders = Array.isArray(input.orders)
    ? input.orders
      .filter(Boolean)
      .slice(-80)
      .map((order) => ({
        id: String(order.id || `${Date.now()}-${Math.random()}`),
        ts: String(order.ts || ''),
        side: order.side === 'BUY' ? 'BUY' : 'SELL',
        symbol: normalizeSymbol(order.symbol),
        name: String(order.name || order.symbol || ''),
        price: Math.max(0, clampNumber(order.price, 0)),
        quantity: Math.max(0, clampNumber(order.quantity, 0)),
        amount: Math.max(0, clampNumber(order.amount, 0)),
        fee: Math.max(0, clampNumber(order.fee, 0)),
        status: String(order.status || 'filled'),
        reason: String(order.reason || '')
      }))
    : [];
  return { account, strategy, quotes, realtime, settings, orders };
}

export function readQuantProjectState() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return normalizeQuantState(DEFAULT_QUANT_STATE);
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUANT_PROJECT_STORAGE_KEY) || 'null');
    return normalizeQuantState(parsed || DEFAULT_QUANT_STATE);
  } catch {
    return normalizeQuantState(DEFAULT_QUANT_STATE);
  }
}

export function saveQuantProjectState(state) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  window.localStorage.setItem(QUANT_PROJECT_STORAGE_KEY, JSON.stringify(normalizeQuantState(state)));
}

export function resetQuantProjectState() {
  const next = normalizeQuantState(DEFAULT_QUANT_STATE);
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(QUANT_PROJECT_STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function premiumPct(price, iopv) {
  const base = clampNumber(iopv, 0);
  if (base <= 0) return 0;
  return ((clampNumber(price, 0) - base) / base) * 100;
}

export function getQuotePair(state) {
  const normalized = normalizeQuantState(state);
  const { strategy, quotes } = normalized;
  return {
    sellQuote: quotes[strategy.sellSymbol],
    buyQuote: quotes[strategy.buySymbol]
  };
}

export function evaluatePremiumSpread(state) {
  const normalized = normalizeQuantState(state);
  const { strategy } = normalized;
  const { sellQuote, buyQuote } = getQuotePair(normalized);
  const sellPremiumPct = premiumPct(sellQuote?.bid, sellQuote?.iopv);
  const buyPremiumPct = premiumPct(buyQuote?.ask, buyQuote?.iopv);
  const rawSpreadPct = sellPremiumPct - buyPremiumPct;
  const netSpreadPct = rawSpreadPct - strategy.feeBufferPct;
  const hasValidQuotes = Boolean(sellQuote?.bid > 0 && sellQuote?.iopv > 0 && buyQuote?.ask > 0 && buyQuote?.iopv > 0);
  const action = hasValidQuotes && netSpreadPct >= strategy.triggerSpreadPct ? 'switch' : 'wait';
  const reason = !hasValidQuotes
    ? '盘口或 IOPV 不完整'
    : action === 'switch'
      ? '溢价差达到触发线'
      : netSpreadPct <= strategy.closeSpreadPct
        ? '差价低于观察线'
        : '等待更高安全垫';
  return {
    action,
    reason,
    sellPremiumPct: roundTo(sellPremiumPct, 4),
    buyPremiumPct: roundTo(buyPremiumPct, 4),
    rawSpreadPct: roundTo(rawSpreadPct, 4),
    netSpreadPct: roundTo(netSpreadPct, 4),
    triggerSpreadPct: strategy.triggerSpreadPct,
    closeSpreadPct: strategy.closeSpreadPct
  };
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function firstNonNegativeNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

function quoteLookupKeys(symbol = '') {
  const raw = String(symbol || '').trim();
  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();
  const digits = upper.replace(/^(SH|SZ|BJ)/, '');
  const exchange = digits.startsWith('6') || digits.startsWith('5') ? `SH${digits}` : `SZ${digits}`;
  return Array.from(new Set([raw, upper, lower, digits, digits.toLowerCase(), exchange, exchange.toLowerCase()].filter(Boolean)));
}

export function pickMarketQuote(quoteMap = {}, symbol = '') {
  if (!quoteMap || typeof quoteMap !== 'object') return null;
  for (const key of quoteLookupKeys(symbol)) {
    if (quoteMap[key]) return quoteMap[key];
  }
  const digits = String(symbol || '').replace(/^(sh|sz|bj)/i, '');
  return Object.values(quoteMap).find((quote) => {
    const code = String(quote?.code || '').trim();
    const quoteSymbol = String(quote?.symbol || '').replace(/^(sh|sz|bj)/i, '').trim();
    return code === digits || quoteSymbol === digits;
  }) || null;
}

export function normalizeMarketQuoteToQuantQuote(marketQuote = {}, fallbackQuote = {}) {
  if (!marketQuote || typeof marketQuote !== 'object' || marketQuote.error) return null;
  const orderBook = marketQuote.orderBook && typeof marketQuote.orderBook === 'object' ? marketQuote.orderBook : {};
  const symbol = normalizeSymbol(marketQuote.code, normalizeSymbol(marketQuote.symbol, fallbackQuote.symbol));
  if (!symbol) return null;
  const price = firstPositiveNumber(marketQuote.price, marketQuote.currentPrice, marketQuote.close, fallbackQuote.price, fallbackQuote.bid, fallbackQuote.ask);
  const bid = firstPositiveNumber(orderBook.bidPrice, marketQuote.bid, marketQuote.bidPrice, price);
  const ask = firstPositiveNumber(orderBook.askPrice, marketQuote.ask, marketQuote.askPrice, price);
  const iopv = firstPositiveNumber(marketQuote.iopv, marketQuote.navBase, marketQuote.latestNav, fallbackQuote.iopv);
  return normalizeQuote({
    symbol,
    name: marketQuote.name || fallbackQuote.name || symbol,
    bid,
    bidSize: firstNonNegativeNumber(orderBook.bidVolume, marketQuote.bidSize, marketQuote.bidVolume),
    ask,
    askSize: firstNonNegativeNumber(orderBook.askVolume, marketQuote.askSize, marketQuote.askVolume),
    iopv,
    price,
    asOf: marketQuote.asOf || fallbackQuote.asOf || '',
    source: marketQuote.source || orderBook.source || fallbackQuote.source || '',
    marketState: marketQuote.marketState || fallbackQuote.marketState || '',
    cached: marketQuote.cached === true
  }, fallbackQuote);
}

export function applyMarketQuotesToQuantState(state, quoteMap = {}, { refreshedAt = new Date().toISOString() } = {}) {
  const normalized = normalizeQuantState(state);
  const symbols = Array.from(new Set([normalized.strategy.sellSymbol, normalized.strategy.buySymbol].filter(Boolean)));
  const quotes = { ...normalized.quotes };
  const updatedSymbols = [];
  const errors = [];
  let lastQuoteAt = '';
  for (const symbol of symbols) {
    const marketQuote = pickMarketQuote(quoteMap, symbol);
    const nextQuote = normalizeMarketQuoteToQuantQuote(marketQuote, quotes[symbol]);
    if (!nextQuote) {
      errors.push(symbol);
      continue;
    }
    quotes[nextQuote.symbol] = nextQuote;
    updatedSymbols.push(nextQuote.symbol);
    if (nextQuote.asOf && (!lastQuoteAt || nextQuote.asOf > lastQuoteAt)) {
      lastQuoteAt = nextQuote.asOf;
    }
  }
  const lastError = errors.length ? `行情未更新：${errors.join('、')}` : '';
  return {
    state: normalizeQuantState({
      ...normalized,
      quotes,
      realtime: {
        ...normalized.realtime,
        lastRefreshAt: refreshedAt,
        lastQuoteAt: lastQuoteAt || normalized.realtime.lastQuoteAt,
        lastStatus: updatedSymbols.length ? 'updated' : 'empty',
        lastError
      }
    }),
    updatedSymbols,
    errors
  };
}

export function markRealtimeStatus(state, patch = {}) {
  const normalized = normalizeQuantState(state);
  return normalizeQuantState({
    ...normalized,
    realtime: {
      ...normalized.realtime,
      ...patch,
      lastError: String(patch.lastError ?? normalized.realtime.lastError ?? '').slice(0, 240)
    }
  });
}

export function recordRealtimeExecution(state, timestamp = new Date().toISOString()) {
  const normalized = normalizeQuantState(state);
  const dateKey = shanghaiDateKey(new Date(timestamp));
  const currentCount = normalized.realtime.lastExecutionDate === dateKey ? normalized.realtime.executionsToday : 0;
  return normalizeQuantState({
    ...normalized,
    realtime: {
      ...normalized.realtime,
      executionsToday: currentCount + 1,
      lastExecutionDate: dateKey,
      lastExecutionAt: timestamp,
      lastStatus: 'executed',
      lastError: ''
    }
  });
}

export function evaluateRealtimeAutoExecution(state, { now = new Date(), isTradingSession = false } = {}) {
  const normalized = normalizeQuantState(state);
  const realtime = normalized.realtime;
  if (!realtime.autoExecute) return { ok: false, reason: '自动撮合未开启' };
  if (realtime.onlyTradingSession && !isTradingSession) return { ok: false, reason: '非 A 股交易时段' };
  if (realtime.executionsToday >= realtime.maxExecutionsPerDay) return { ok: false, reason: '已达到今日自动执行上限' };
  const plan = buildSimulatedOrderPlan(normalized);
  if (!plan.canTrade) return { ok: false, reason: plan.rejectReason || plan.signal.reason, plan };
  return { ok: true, reason: '满足自动执行条件', plan, now };
}

function floorToLot(quantity, lotSize) {
  const lot = Math.max(1, Math.floor(clampNumber(lotSize, 1)));
  return Math.floor(Math.max(0, clampNumber(quantity, 0)) / lot) * lot;
}

function roundPriceToTick(price, tickSize) {
  const tick = Math.max(0.0001, clampNumber(tickSize, 0.001));
  return Math.max(tick, roundTo(Math.round(clampNumber(price, 0) / tick) * tick, 4));
}

function calcFee(amount, account) {
  if (amount <= 0) return 0;
  const raw = amount * (Math.max(0, clampNumber(account.feeRate, 0)) / 100);
  return roundTo(Math.max(raw, Math.max(0, clampNumber(account.minFee, 0))), 2);
}

export function buildSimulatedOrderPlan(state) {
  const normalized = normalizeQuantState(state);
  const { account, strategy } = normalized;
  const { sellQuote, buyQuote } = getQuotePair(normalized);
  const signal = evaluatePremiumSpread(normalized);
  const tickSize = account.tickSize;
  const slip = account.slippageTicks * tickSize;
  const sellPosition = account.positions[strategy.sellSymbol] || { shares: 0, costPrice: 0 };
  const sellPrice = roundPriceToTick((sellQuote?.bid || 0) - slip, tickSize);
  const buyPrice = roundPriceToTick((buyQuote?.ask || 0) + slip, tickSize);
  const maxSellByCash = sellPrice > 0 ? strategy.maxOrderCash / sellPrice : 0;
  const sellQuantity = floorToLot(
    Math.min(sellPosition.shares, sellQuote?.bidSize || 0, maxSellByCash),
    strategy.lotSize
  );
  const sellAmount = roundTo(sellQuantity * sellPrice, 2);
  const sellFee = calcFee(sellAmount, account);
  const sellNet = Math.max(0, sellAmount - sellFee);
  const buyBudget = signal.action === 'switch'
    ? Math.min(strategy.maxOrderCash, account.cash + sellNet)
    : Math.min(strategy.maxOrderCash, account.cash);
  const buyQuantity = floorToLot(
    Math.min(buyQuote?.askSize || 0, buyPrice > 0 ? Math.max(0, buyBudget) / buyPrice : 0),
    strategy.lotSize
  );
  const buyAmount = roundTo(buyQuantity * buyPrice, 2);
  const buyFee = calcFee(buyAmount, account);
  const canTrade = signal.action === 'switch'
    && sellQuantity > 0
    && buyQuantity > 0
    && sellAmount >= strategy.minOrderCash
    && buyAmount >= strategy.minOrderCash;
  return {
    signal,
    canTrade,
    rejectReason: canTrade
      ? ''
      : signal.action !== 'switch'
        ? signal.reason
        : sellQuantity <= 0
          ? '可卖持仓或卖一量不足'
          : buyQuantity <= 0
            ? '现金或买一量不足'
            : '订单金额低于最小交易额',
    sell: {
      side: 'SELL',
      symbol: strategy.sellSymbol,
      name: sellQuote?.name || strategy.sellSymbol,
      price: sellPrice,
      quantity: sellQuantity,
      amount: sellAmount,
      fee: sellFee
    },
    buy: {
      side: 'BUY',
      symbol: strategy.buySymbol,
      name: buyQuote?.name || strategy.buySymbol,
      price: buyPrice,
      quantity: buyQuantity,
      amount: buyAmount,
      fee: buyFee
    },
    totalFee: roundTo(sellFee + buyFee, 2),
    estimatedCapture: roundTo(Math.min(sellAmount, buyAmount) * Math.max(0, signal.netSpreadPct) / 100, 2)
  };
}

function applySell(account, fill) {
  const position = account.positions[fill.symbol] || {
    symbol: fill.symbol,
    name: fill.name,
    shares: 0,
    costPrice: 0
  };
  const quantity = Math.min(position.shares, fill.quantity);
  const amount = roundTo(quantity * fill.price, 2);
  const fee = calcFee(amount, account);
  const nextShares = Math.max(0, position.shares - quantity);
  account.cash = roundTo(account.cash + amount - fee, 2);
  account.positions[fill.symbol] = {
    ...position,
    shares: roundTo(nextShares, 4),
    costPrice: nextShares > 0 ? position.costPrice : 0
  };
  return { ...fill, quantity, amount, fee };
}

function applyBuy(account, fill) {
  const availableForAmount = Math.max(0, account.cash - account.minFee);
  const maxQuantity = fill.price > 0 ? floorToLot(availableForAmount / fill.price, 1) : 0;
  const quantity = Math.min(fill.quantity, maxQuantity);
  const amount = roundTo(quantity * fill.price, 2);
  const fee = calcFee(amount, account);
  if (amount + fee > account.cash || quantity <= 0) {
    return { ...fill, quantity: 0, amount: 0, fee: 0 };
  }
  const position = account.positions[fill.symbol] || {
    symbol: fill.symbol,
    name: fill.name,
    shares: 0,
    costPrice: 0
  };
  const currentCost = position.shares * position.costPrice;
  const nextShares = position.shares + quantity;
  const nextCostPrice = nextShares > 0 ? (currentCost + amount + fee) / nextShares : 0;
  account.cash = roundTo(account.cash - amount - fee, 2);
  account.positions[fill.symbol] = {
    ...position,
    name: fill.name,
    shares: roundTo(nextShares, 4),
    costPrice: roundTo(nextCostPrice, 4)
  };
  return { ...fill, quantity, amount, fee };
}

export function executeSimulatedSwitch(state, timestamp = new Date().toISOString()) {
  const normalized = normalizeQuantState(state);
  const plan = buildSimulatedOrderPlan(normalized);
  if (!plan.canTrade) {
    return { state: normalized, plan, fills: [] };
  }
  const next = clone(normalized);
  const sellFill = applySell(next.account, plan.sell);
  const buyFill = applyBuy(next.account, plan.buy);
  const fills = [sellFill, buyFill]
    .filter((fill) => fill.quantity > 0)
    .map((fill, index) => ({
      id: `${Date.now()}-${index}-${fill.side}`,
      ts: timestamp,
      side: fill.side,
      symbol: fill.symbol,
      name: fill.name,
      price: roundTo(fill.price, 4),
      quantity: fill.quantity,
      amount: roundTo(fill.amount, 2),
      fee: roundTo(fill.fee, 2),
      status: 'filled',
      reason: plan.signal.reason
    }));
  next.orders = [...fills, ...next.orders].slice(0, 80);
  return { state: normalizeQuantState(next), plan, fills };
}

export function computeAccountSummary(state) {
  const normalized = normalizeQuantState(state);
  const { account, quotes } = normalized;
  const positions = Object.values(account.positions || {}).map((position) => {
    const quote = quotes[position.symbol] || {};
    const lastPrice = quote.bid > 0 ? quote.bid : quote.ask > 0 ? quote.ask : position.costPrice;
    const marketValue = roundTo(position.shares * lastPrice, 2);
    const cost = roundTo(position.shares * position.costPrice, 2);
    const pnl = roundTo(marketValue - cost, 2);
    const pnlPct = cost > 0 ? roundTo((pnl / cost) * 100, 2) : 0;
    return {
      ...position,
      lastPrice: roundTo(lastPrice, 4),
      marketValue,
      cost,
      pnl,
      pnlPct
    };
  });
  const marketValue = roundTo(positions.reduce((sum, item) => sum + item.marketValue, 0), 2);
  const cost = roundTo(positions.reduce((sum, item) => sum + item.cost, 0), 2);
  const equity = roundTo(account.cash + marketValue, 2);
  return {
    cash: roundTo(account.cash, 2),
    positions,
    marketValue,
    cost,
    equity,
    pnl: roundTo(marketValue - cost, 2),
    positionCount: positions.filter((item) => item.shares > 0).length
  };
}

export { buildSampleBacktestRows, runBacktest, runPremiumSpreadBacktest } from './backtest/index.js';
export { buildOrderPlanV2 } from './quantOrderPlanV2.js';
export { RiskMonitor, performRiskCheck } from './quantRiskMonitor.js';
export { getCachedHistoricalData, generateRealisticSimulation, clearHistoricalDataCache } from './quantHistoricalData.js';
export { RECOMMENDED_STRATEGY_CONFIGS, applyConfigPreset, recommendParameters, validateStrategyParameters } from './quantConfigPresets.js';
