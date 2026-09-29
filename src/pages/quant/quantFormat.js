// 量化模拟盘看板共享格式化工具与配色常量。

export function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `¥${num.toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

export function formatPct(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num >= 0 ? '+' : '−'}${Math.abs(num).toFixed(digits)}%`;
}

export function formatShares(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('zh-CN');
}

export function formatClock(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatAxisTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

export function premiumClass(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'text-slate-400';
  return num >= 0 ? 'text-rose-600' : 'text-emerald-600';
}

export const DARK_TOOLTIP = {
  backgroundColor: '#1f2937',
  border: 'none',
  borderRadius: 12,
  color: '#fff',
  fontSize: 12,
  padding: '10px 12px'
};

// 4 个并行盘的固定配色（按组合顺序分配）。
export const PORTFOLIO_COLORS = ['#2563eb', '#16a34a', '#9333ea', '#ea580c'];

export function portfolioColor(index) {
  return PORTFOLIO_COLORS[index % PORTFOLIO_COLORS.length];
}
