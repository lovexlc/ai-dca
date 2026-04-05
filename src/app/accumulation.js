const ACCUMULATION_KEY = 'aiDcaAccumulationState';

export const defaultAccumulationState = {
  symbol: '纳指基金',
  frequency: '每周',
  totalCapital: 5480.55,
  basePrice: 601.3,
  maxDrawdown: 13.52,
  weights: [20, 30, 50]
};

function sanitizeWeights(weights) {
  const base = Array.isArray(weights) && weights.length ? weights : defaultAccumulationState.weights;
  const next = base.map((weight) => Math.max(Number(weight) || 0, 0));
  return next.some((weight) => weight > 0) ? next : [...defaultAccumulationState.weights];
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

export function parseNumber(value) {
  const raw = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '');
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatCurrency(value, currency = '$', digits = 2) {
  const amount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(round(value, digits));
  return currency === '¥' ? `${currency} ${amount}` : `${currency}${amount}`;
}

export function formatPercent(value, digits = 1, keepSign = false) {
  const amount = round(value, digits)
    .toFixed(digits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1');
  const prefix = keepSign && Number(value) > 0 ? '+' : '';
  return `${prefix}${amount}%`;
}

export function buildStages({ totalCapital, basePrice, maxDrawdown, weights }) {
  const safeWeights = sanitizeWeights(weights);
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0) || 1;
  const trailingTotal = safeWeights.slice(1).reduce((sum, weight) => sum + weight, 0);
  let cumulativeTrailingWeight = 0;

  const stages = safeWeights.map((weight, index) => {
    let drawdown = 0;

    if (index > 0) {
      cumulativeTrailingWeight += weight;
      const ratio = trailingTotal > 0
        ? cumulativeTrailingWeight / trailingTotal
        : index / Math.max(safeWeights.length - 1, 1);
      drawdown = (Number(maxDrawdown) || 0) * ratio;
    }

    const price = (Number(basePrice) || 0) * (1 - drawdown / 100);
    const amount = (Number(totalCapital) || 0) * (weight / totalWeight);
    const shares = price > 0 ? amount / price : 0;

    return {
      id: `stage-${index + 1}`,
      index,
      label: `阶段 ${String(index + 1).padStart(2, '0')}`,
      weight,
      weightPercent: weight / totalWeight * 100,
      drawdown,
      price,
      amount,
      shares
    };
  });

  const investedCapital = stages.reduce((sum, stage) => sum + stage.amount, 0);
  const totalShares = stages.reduce((sum, stage) => sum + stage.shares, 0);
  const averageCost = totalShares > 0 ? investedCapital / totalShares : Number(basePrice) || 0;

  return {
    stages,
    totalWeight,
    averageCost,
    totalShares,
    investedCapital
  };
}

function readSavedWeights(saved) {
  if (Array.isArray(saved?.weights) && saved.weights.length) {
    return saved.weights;
  }

  if (Array.isArray(saved?.stages) && saved.stages.length) {
    return saved.stages.map((stage) => stage.weight ?? stage.weightPercent ?? 0);
  }

  return defaultAccumulationState.weights;
}

function normalizeSavedSymbol(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === 'QQQ') {
    return defaultAccumulationState.symbol;
  }

  return normalized;
}

export function readAccumulationState() {
  if (typeof window === 'undefined') {
    return defaultAccumulationState;
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(ACCUMULATION_KEY) || 'null');
    if (!saved) {
      return defaultAccumulationState;
    }

    return {
      symbol: normalizeSavedSymbol(saved.symbol),
      frequency: saved.frequency || defaultAccumulationState.frequency,
      totalCapital: Number(saved.totalCapital) || defaultAccumulationState.totalCapital,
      basePrice: Number(saved.basePrice) || defaultAccumulationState.basePrice,
      maxDrawdown: Number(saved.maxDrawdown) || defaultAccumulationState.maxDrawdown,
      weights: sanitizeWeights(readSavedWeights(saved))
    };
  } catch (_error) {
    return defaultAccumulationState;
  }
}

export function persistAccumulationState(state, computed = buildStages(state)) {
  if (typeof window === 'undefined') {
    return;
  }

  const safeState = {
    symbol: normalizeSavedSymbol(state.symbol),
    frequency: state.frequency || defaultAccumulationState.frequency,
    totalCapital: Number(state.totalCapital) || 0,
    basePrice: Number(state.basePrice) || 0,
    maxDrawdown: Number(state.maxDrawdown) || 0,
    weights: sanitizeWeights(state.weights)
  };

  const payload = {
    source: 'react-accumulation',
    symbol: safeState.symbol,
    frequency: safeState.frequency,
    currency: '$',
    totalCapital: round(safeState.totalCapital, 2),
    basePrice: round(safeState.basePrice, 2),
    maxDrawdown: round(safeState.maxDrawdown, 2),
    averageCost: round(computed.averageCost, 2),
    weights: safeState.weights.map((weight) => round(weight, 4)),
    stages: computed.stages.map((stage) => ({
      ...stage,
      price: round(stage.price, 2),
      amount: round(stage.amount, 2),
      drawdown: round(stage.drawdown, 2),
      shares: round(stage.shares, 4)
    })),
    updatedAt: new Date().toISOString()
  };

  window.localStorage.setItem(ACCUMULATION_KEY, JSON.stringify(payload));
}
