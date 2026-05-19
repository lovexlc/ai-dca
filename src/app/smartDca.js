export function calculateDropPct(currentPrice = 0, rollingHigh = 0) {
  const price = Number(currentPrice) || 0;
  const high = Number(rollingHigh) || 0;
  if (!(high > 0) || !(price > 0)) return 0;
  return Math.max(((high - price) / high) * 100, 0);
}

export function calculateSmartDcaAmount({
  monthlyBudget = 0,
  currentPrice = 0,
  rollingHigh = 0,
  capitalPool = 0,
  params = {}
} = {}) {
  const budget = Math.max(Number(monthlyBudget) || 0, 0);
  const pool = Math.max(Number(capitalPool) || 0, 0);
  const firstBuyDrop = Math.max(Number(params.firstBuyDrop) || 0, 0);
  const highLevelRatio = Math.max(Math.min(Number(params.highLevelRatio) || 0.1, 1), 0);
  const dropPct = calculateDropPct(currentPrice, rollingHigh);

  if (dropPct < firstBuyDrop) {
    const investAmount = budget * highLevelRatio;
    const poolAmount = budget - investAmount;
    return {
      mode: 'high-level',
      investAmount,
      poolAmount,
      poolBalance: pool + poolAmount,
      dropPct,
      level: 0
    };
  }

  return {
    mode: 'pyramid',
    investAmount: 0,
    poolAmount: budget,
    poolBalance: pool + budget,
    dropPct,
    level: null
  };
}

export function resolvePyramidLevel(dropPct = 0, params = {}) {
  const firstBuyDrop = Math.max(Number(params.firstBuyDrop) || 0, 0);
  const stepDrop = Math.max(Number(params.stepDrop) || 1, 1);
  const levels = Array.isArray(params.multipliers) && params.multipliers.length
    ? params.multipliers.length
    : Math.max(Number(params.levels) || 0, 0);

  if (!(Number(dropPct) >= firstBuyDrop) || levels <= 0) return -1;
  return Math.min(Math.floor((Number(dropPct) - firstBuyDrop) / stepDrop), levels - 1);
}

export function calculatePyramidBuyAmount({
  capitalPool = 0,
  monthlyBudget = 0,
  level = 0,
  params = {}
} = {}) {
  const multipliers = Array.isArray(params.multipliers) ? params.multipliers.map((m) => Math.max(Number(m) || 0, 0)) : [];
  if (level < 0 || level >= multipliers.length) return 0;
  const totalUnits = multipliers.reduce((sum, multiplier) => sum + multiplier, 0) || 1;
  const amount = Math.min(
    (Number(monthlyBudget) || 0) * multipliers[level] / totalUnits,
    Math.max(Number(capitalPool) || 0, 0)
  );
  return amount > 100 ? amount : 0;
}
