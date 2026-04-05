export const PEAK_DRAWDOWN_LAYERS = [
  { drawdown: 9, label: '首次建仓', signal: '较阶段高点累计跌幅 9%' },
  { drawdown: 12.5, label: '第1次加仓', signal: '较阶段高点累计跌幅 12.5%' },
  { drawdown: 16, label: '第2次加仓', signal: '较阶段高点累计跌幅 16%' },
  { drawdown: 19.5, label: '第3次加仓', signal: '较阶段高点累计跌幅 19.5%' },
  { drawdown: 23, label: '第4次加仓', signal: '较阶段高点累计跌幅 23%' },
  { drawdown: 26.5, label: '第5次加仓', signal: '较阶段高点累计跌幅 26.5%' },
  { drawdown: 30, label: '第6次加仓', signal: '较阶段高点累计跌幅 30%' },
  { drawdown: 33.5, label: '第7次加仓', signal: '较阶段高点累计跌幅 33.5%' }
];

export function mapReferencePrice(value, ratio = 1) {
  const numericValue = Number(value);
  const numericRatio = Number(ratio);

  if (!(numericValue > 0)) {
    return 0;
  }

  if (!(numericRatio > 0) || !Number.isFinite(numericRatio)) {
    return numericValue;
  }

  return numericValue * numericRatio;
}

export function findLatestFiniteValue(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

export function buildMovingAverageValues(bars = [], period = 5, { allowPartial = false } = {}) {
  const values = [];
  const closes = [];
  let rollingSum = 0;

  bars.forEach((bar, index) => {
    const close = Number(bar.close) || 0;
    closes.push(close);
    rollingSum += close;

    if (closes.length > period) {
      rollingSum -= closes[index - period];
    }

    if (allowPartial) {
      values.push(rollingSum / closes.length);
      return;
    }

    values.push(closes.length >= period ? rollingSum / period : null);
  });

  return values;
}

export function buildNasdaqStrategyPlan({
  totalBudget = 0,
  cashReservePct = 0,
  ma120 = 0,
  ma200 = 0,
  fallbackPrice = 0
} = {}) {
  const triggerPrice = Number(ma120) > 0 ? Number(ma120) : Number(fallbackPrice) || 0;
  const riskPrice = Number(ma200) > 0 ? Number(ma200) : 0;
  const normalizedBudget = Math.max(Number(totalBudget) || 0, 0);
  const normalizedReservePct = Math.max(Number(cashReservePct) || 0, 0);
  const investableCapital = normalizedBudget * Math.max(0, 1 - normalizedReservePct / 100);
  const reserveCapital = normalizedBudget - investableCapital;
  const baseLayers = [
    {
      id: 'ma120-base',
      label: '120日线基准',
      signal: '靠近120日线',
      weight: 1,
      price: triggerPrice,
      drawdown: 0,
      tone: 'violet'
    },
    {
      id: 'ma120-minus-5',
      label: '120日线下方 5%',
      signal: '低于120日线 5%',
      weight: 1.5,
      price: triggerPrice > 0 ? triggerPrice * 0.95 : 0,
      drawdown: 5,
      tone: 'indigo'
    },
    {
      id: 'ma120-minus-10',
      label: '120日线下方 10%',
      signal: '低于120日线 10%',
      weight: 2,
      price: triggerPrice > 0 ? triggerPrice * 0.9 : 0,
      drawdown: 10,
      tone: 'slate'
    }
  ].filter((layer) => layer.price > 0);
  const deepestBaseLayerPrice = baseLayers[baseLayers.length - 1]?.price || 0;
  const canUseIndependentRiskLayer = riskPrice > 0 && deepestBaseLayerPrice > 0 && riskPrice < deepestBaseLayerPrice;
  const layerBlueprints = [
    ...baseLayers,
    canUseIndependentRiskLayer
      ? {
          id: 'ma200-risk',
          label: '200日线风控',
          signal: '跌破200日线',
          weight: 2.5,
          price: riskPrice,
          drawdown: triggerPrice > 0 ? Math.max((1 - riskPrice / triggerPrice) * 100, 0) : 0,
          tone: 'amber'
        }
      : {
          id: 'ma120-minus-15',
          label: '120日线下方 15%',
          signal: riskPrice > 0 ? '200日线仅作风控，不单列加仓' : '低于120日线 15%',
          weight: 2.5,
          price: triggerPrice > 0 ? triggerPrice * 0.85 : 0,
          drawdown: 15,
          tone: 'amber'
        }
  ].filter((layer) => layer.price > 0);
  const totalWeight = layerBlueprints.reduce((sum, layer) => sum + layer.weight, 0) || 1;
  const layers = layerBlueprints.map((layer, index) => {
    const amount = investableCapital * (layer.weight / totalWeight);
    const shares = layer.price > 0 ? amount / layer.price : 0;

    return {
      ...layer,
      amount,
      shares,
      order: index + 1
    };
  });
  const totalAmount = layers.reduce((sum, layer) => sum + layer.amount, 0);
  const totalShares = layers.reduce((sum, layer) => sum + layer.shares, 0);

  return {
    layers,
    totalWeight,
    investableCapital,
    reserveCapital,
    averageCost: totalShares > 0 ? totalAmount / totalShares : 0,
    triggerPrice,
    riskPrice,
    usesIndependentRiskLayer: canUseIndependentRiskLayer
  };
}

export function buildPeakDrawdownStrategyPlan({
  totalBudget = 0,
  cashReservePct = 0,
  peakPrice = 0,
  fallbackPrice = 0
} = {}) {
  const anchorPrice = Number(peakPrice) > 0 ? Number(peakPrice) : Number(fallbackPrice) || 0;
  const normalizedBudget = Math.max(Number(totalBudget) || 0, 0);
  const normalizedReservePct = Math.max(Number(cashReservePct) || 0, 0);
  const investableCapital = normalizedBudget * Math.max(0, 1 - normalizedReservePct / 100);
  const reserveCapital = normalizedBudget - investableCapital;
  const totalWeight = PEAK_DRAWDOWN_LAYERS.reduce((sum, _, index) => sum + index + 1, 0) || 1;
  const layers = PEAK_DRAWDOWN_LAYERS.map((layer, index) => {
    const weight = index + 1;
    const price = anchorPrice > 0 ? anchorPrice * (1 - layer.drawdown / 100) : 0;
    const amount = investableCapital * (weight / totalWeight);
    const shares = price > 0 ? amount / price : 0;

    return {
      id: `peak-drawdown-${index + 1}`,
      label: layer.label,
      signal: layer.signal,
      weight,
      price,
      amount,
      shares,
      drawdown: layer.drawdown,
      order: index + 1,
      tone: index === PEAK_DRAWDOWN_LAYERS.length - 1 ? 'amber' : index === 0 ? 'violet' : 'slate',
      isExtreme: index === PEAK_DRAWDOWN_LAYERS.length - 1
    };
  }).filter((layer) => layer.price > 0);
  const totalAmount = layers.reduce((sum, layer) => sum + layer.amount, 0);
  const totalShares = layers.reduce((sum, layer) => sum + layer.shares, 0);

  return {
    layers,
    totalWeight,
    investableCapital,
    reserveCapital,
    averageCost: totalShares > 0 ? totalAmount / totalShares : 0,
    triggerPrice: anchorPrice,
    riskPrice: layers[layers.length - 1]?.price || 0,
    anchorPrice,
    usesIndependentRiskLayer: false
  };
}

export function resolveNextTriggerLayer(layers = [], currentPrice = 0) {
  const sortedLayers = [...layers]
    .filter((layer) => Number.isFinite(layer.price) && layer.price > 0)
    .sort((left, right) => right.price - left.price);

  if (!sortedLayers.length) {
    return null;
  }

  if (!(Number(currentPrice) > 0)) {
    return sortedLayers[0];
  }

  return sortedLayers.find((layer) => currentPrice > layer.price) || null;
}
