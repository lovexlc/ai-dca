// 建仓计划生成器：纯逻辑层，不含 React，便于单元测试。
// 所有函数从 NewPlanExperience.jsx 抽离而来，行为与原文件一致。
import { formatPercent } from './accumulation.js';

export const BENCHMARK_CODE = 'nas-daq100';
export const frequencyOptions = ['每日', '每周', '每月', '每季'];
export const strategyOptions = [
  {
    key: 'ma120-risk',
    label: '均线分层',
    note: '以120日均线为主触发，以200日均线为风控'
  },
  {
    key: 'peak-drawdown',
    label: '固定回撤',
    note: '按阶段高点固定跌幅 8 档执行'
  }
];
export const fixedDrawdownBlueprint = [
  { drawdown: 9, label: '首次建仓' },
  { drawdown: 12.5, label: '第1次加仓' },
  { drawdown: 16, label: '第2次加仓' },
  { drawdown: 19.5, label: '第3次加仓' },
  { drawdown: 23, label: '第4次加仓' },
  { drawdown: 26.5, label: '第5次加仓' },
  { drawdown: 30, label: '第6次加仓' },
  { drawdown: 33.5, label: '第7次加仓，极端档' }
];

export function buildMovingAverageValues(bars = [], period = 5) {
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

    values.push(closes.length >= period ? rollingSum / period : rollingSum / closes.length);
  });

  return values;
}

export function findLatestFiniteValue(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

export function buildMovingAverageTemplatePlan(state) {
  const triggerPrice = Math.max(Number(state.basePrice) || 0, 0);
  const fallbackRiskPrice = triggerPrice > 0 ? triggerPrice * 0.85 : 0;
  const explicitRiskPrice = Math.max(Number(state.riskControlPrice) || 0, 0);
  const deepestMaLayerPrice = triggerPrice > 0 ? triggerPrice * 0.9 : 0;
  const usesRiskLayer = explicitRiskPrice > 0 && deepestMaLayerPrice > 0 && explicitRiskPrice < deepestMaLayerPrice;
  const totalBudget = Math.max(Number(state.totalBudget) || 0, 0);
  const cashReservePct = Math.max(Number(state.cashReservePct) || 0, 0);
  const investableCapital = totalBudget * Math.max(0, 1 - cashReservePct / 100);
  const reserveCapital = totalBudget - investableCapital;
  const layers = [
    {
      id: 'ma120-base',
      label: '120日线基准',
      signal: '靠近120日线',
      drawdown: 0,
      weight: 1,
      price: triggerPrice
    },
    {
      id: 'ma120-minus-5',
      label: '120日线下方 5%',
      signal: '低于120日线 5%',
      drawdown: 5,
      weight: 1.5,
      price: triggerPrice > 0 ? triggerPrice * 0.95 : 0
    },
    {
      id: 'ma120-minus-10',
      label: '120日线下方 10%',
      signal: '低于120日线 10%',
      drawdown: 10,
      weight: 2,
      price: triggerPrice > 0 ? triggerPrice * 0.9 : 0
    },
    usesRiskLayer
      ? {
          id: 'ma200-risk',
          label: '200日线风控',
          signal: '跌破200日线',
          drawdown: triggerPrice > 0 ? Math.max((1 - explicitRiskPrice / triggerPrice) * 100, 0) : 0,
          weight: 2.5,
          price: explicitRiskPrice
        }
      : {
          id: 'deep-defense',
          label: '深水防守',
          signal: explicitRiskPrice > 0 ? '200日线仅作风控，不单列加仓' : '低于120日线 15%',
          drawdown: 15,
          weight: 2.5,
          price: fallbackRiskPrice
        }
  ].filter((layer) => layer.price > 0);
  const totalWeight = layers.reduce((sum, layer) => sum + layer.weight, 0) || 1;
  const normalizedLayers = layers.map((layer, index) => {
    const amount = investableCapital * (layer.weight / totalWeight);
    const shares = layer.price > 0 ? amount / layer.price : 0;
    return {
      ...layer,
      order: index + 1,
      amount,
      shares
    };
  });
  const totalAmount = normalizedLayers.reduce((sum, layer) => sum + layer.amount, 0);
  const totalShares = normalizedLayers.reduce((sum, layer) => sum + layer.shares, 0);

  return {
    mode: 'ma120-risk',
    anchorLabel: '120日线触发价',
    anchorPrice: triggerPrice,
    riskLabel: '200日线风控价',
    riskPrice: explicitRiskPrice || fallbackRiskPrice,
    investableCapital,
    reserveCapital,
    averageCost: totalShares > 0 ? totalAmount / totalShares : 0,
    totalWeight,
    layers: normalizedLayers,
    layerWeights: normalizedLayers.map((layer) => layer.weight),
    triggerDrops: normalizedLayers.map((layer) => layer.drawdown)
  };
}

export function buildFixedDrawdownPlan(state) {
  const peakPrice = Math.max(Number(state.basePrice) || 0, 0);
  const totalBudget = Math.max(Number(state.totalBudget) || 0, 0);
  const cashReservePct = Math.max(Number(state.cashReservePct) || 0, 0);
  const investableCapital = totalBudget * Math.max(0, 1 - cashReservePct / 100);
  const reserveCapital = totalBudget - investableCapital;
  const totalWeight = fixedDrawdownBlueprint.reduce((sum, _, index) => sum + index + 1, 0) || 1;
  const layers = fixedDrawdownBlueprint.map((layer, index) => {
    const weight = index + 1;
    const price = peakPrice > 0 ? peakPrice * (1 - layer.drawdown / 100) : 0;
    const amount = investableCapital * (weight / totalWeight);
    const shares = price > 0 ? amount / price : 0;

    return {
      id: `peak-drawdown-${index + 1}`,
      order: index + 1,
      label: layer.label,
      signal: `较历史高点累计跌幅 ${formatPercent(layer.drawdown, 1)}`,
      drawdown: layer.drawdown,
      weight,
      price,
      amount,
      shares,
      isExtreme: index === fixedDrawdownBlueprint.length - 1
    };
  }).filter((layer) => layer.price > 0);
  const totalAmount = layers.reduce((sum, layer) => sum + layer.amount, 0);
  const totalShares = layers.reduce((sum, layer) => sum + layer.shares, 0);

  return {
    mode: 'peak-drawdown',
    anchorLabel: '阶段高点',
    anchorPrice: peakPrice,
    riskLabel: '极端档',
    riskPrice: layers[layers.length - 1]?.price || 0,
    investableCapital,
    reserveCapital,
    averageCost: totalShares > 0 ? totalAmount / totalShares : 0,
    totalWeight,
    layers,
    layerWeights: layers.map((layer) => layer.weight),
    triggerDrops: layers.map((layer) => layer.drawdown)
  };
}

export function resolveMarketCurrency(entry = null) {
  return String(entry?.currency || '').trim() || '¥';
}

export function formatFundPrice(value, currency = '¥') {
  return formatCurrency(value, currency, 3);
}
