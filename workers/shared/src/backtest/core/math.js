/** Pure numeric helpers for backtest calculations. */
export function roundTo(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

export function clampNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = finiteNumberOrNull(value);
    if (number !== null) return number;
  }
  return null;
}

export function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = finiteNumberOrNull(value);
    if (number !== null && number > 0) return number;
  }
  return null;
}
