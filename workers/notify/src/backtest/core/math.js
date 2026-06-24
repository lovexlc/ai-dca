/**
 * 数学工具函数 - 回测统一真源
 */

/**
 * 四舍五入到指定小数位
 * @param {number} value - 待处理数值
 * @param {number} digits - 小数位数（默认 2）
 * @returns {number} 四舍五入后的结果，非有限数返回 0
 */
export function roundTo(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** digits;
  return Math.round((num + Number.EPSILON) * factor) / factor;
}

/**
 * 钳位数值 - 非有限数返回 fallback
 * @param {number} value - 待处理数值
 * @param {number} fallback - 降级值（默认 0）
 * @returns {number} 有限数返回原值，否则返回 fallback
 */
export function clampNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

/**
 * 将值转为有限数或 null
 * @param {*} value - 任意值
 * @returns {number|null} 有限数或 null
 */
export function finiteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 返回第一个有限数
 * @param {...*} values - 候选值列表
 * @returns {number|null} 第一个有限数或 null
 */
export function firstFiniteNumber(...values) {
  for (const value of values) {
    const n = finiteNumberOrNull(value);
    if (n != null) return n;
  }
  return null;
}

/**
 * 返回第一个正数
 * @param {...*} values - 候选值列表
 * @returns {number|null} 第一个正数或 null
 */
export function firstPositiveNumber(...values) {
  for (const value of values) {
    const n = finiteNumberOrNull(value);
    if (n != null && n > 0) return n;
  }
  return null;
}
