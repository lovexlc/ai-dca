import { MARKET_EMPTY_VALUE, formatNumber } from './marketDisplayUtils.js';

export function formatRevenue(n) {
  if (n == null || !Number.isFinite(Number(n))) return MARKET_EMPTY_VALUE;
  const v = Math.abs(Number(n));
  if (v >= 1e12) return (Number(n) / 1e12).toFixed(2) + ' 万亿';
  if (v >= 1e8) return (Number(n) / 1e8).toFixed(2) + ' 亿';
  if (v >= 1e4) return (Number(n) / 1e4).toFixed(2) + ' 万';
  return String(n);
}

export function formatCnMoney(value) {
  if (value == null || !Number.isFinite(Number(value))) return MARKET_EMPTY_VALUE;
  return formatRevenue(Number(value));
}

export function formatCnAmount(value) {
  if (value == null || !Number.isFinite(Number(value))) return MARKET_EMPTY_VALUE;
  return formatRevenue(Number(value));
}

export function formatXueqiuDateMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return MARKET_EMPTY_VALUE;
  return new Date(n).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

export function detailValueRow(label, value, className = '') {
  return { label, value, className };
}

export function formatFinancialCompact(value) {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n)) return MARKET_EMPTY_VALUE;
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  return formatNumber(n, 0);
}
