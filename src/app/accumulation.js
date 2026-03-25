const ACCUMULATION_KEY = 'aiDcaAccumulationState';

export const defaultAccumulationState = {
  symbol: 'QQQ',
  frequency: '每周',
  totalCapital: 5480.55,
  basePrice: 601.3,
  maxDrawdown: 13.52,
  weights: [20, 30, 50]
};

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
  const amount = round(value, digits).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  const prefix = keepSign && Number(value) > 0 ? '+' : '';
  return `${prefix}${amount}%`;
}

export function buildStages({ totalCapital, basePrice, maxDrawdown, weights }) {
  const safeWeights = weights.map((weight) => Math.max(Number(weight) || 0, 0));
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0) || 1;
  const trailingWeights = safeWeights.slice(1);
  const trailingTotal = trailingWeights.reduce((sum, weight) => sum + weight, 0);
  let cumulative = 0;

  const stages = safeWeights.map((weight, index) => {
    let drawdown = 0;
    if (index > 0) {
      cumulative += weight;
      const ratio = trailingTotal > 0 ? cumulative / trailingTotal : index / Math.max(safeWeights.length - 1, 1);
      drawdown = maxDrawdown * ratio;
    }

    const price = basePrice * (1 - drawdown / 100);
    const amount = totalCapital * (weight / totalWeight);
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
  const averageCost = totalShares > 0 ? investedCapital / totalShares : basePrice;

  return {
    stages,
    totalWeight,
    averageCost,
    totalShares,
    investedCapital
  };
}

export function readAccumulationState() {
  if (typeof window === 'undefined') {
    return defaultAccumulationState;
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(ACCUMULATION_KEY) || 'null');
    if (!saved || !Array.isArray(saved.stages) || !saved.stages.length) {
      return defaultAccumulationState;
    }

    return {
      symbol: saved.symbol || defaultAccumulationState.symbol,
      frequency: saved.frequency || defaultAccumulationState.frequency,
      totalCapital: saved.totalCapital || defaultAccumulationState.totalCapital,
      basePrice: saved.basePrice || defaultAccumulationState.basePrice,
      maxDrawdown: saved.maxDrawdown || defaultAccumulationState.maxDrawdown,
      weights: saved.stages.map((stage) => stage.weight || stage.weightPercent || 0)
    };
  } catch (_error) {
    return defaultAccumulationState;
  }
}

export function persistAccumulationState(state, computed) {
  if (typeof window === 'undefined') {
    return;
  }

  const payload = {
    source: 'accum_edit',
    symbol: state.symbol,
    frequency: state.frequency,
    currency: '$',
    totalCapital: round(state.totalCapital, 2),
    basePrice: round(state.basePrice, 2),
    maxDrawdown: round(state.maxDrawdown, 2),
    averageCost: round(computed.averageCost, 2),
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
