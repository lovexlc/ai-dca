// 持仓 (Holdings) 页的纯展示常量与工具函数。
// 从 HoldingsExperience.jsx 抽离，便于单元测试与复用。
import { formatCurrency, formatPercent } from './accumulation.js';
import { createEmptyTransaction } from './holdingsLedgerCore.js';
import { cx, tableInputClass } from '../components/experience-ui.jsx';

export const KIND_LABELS = { otc: '场外', exchange: '场内' };
export const KIND_PILL_TONES = { otc: 'indigo', exchange: 'amber' };
export const KIND_FILTER_LABELS = { all: '全部', otc: '场外', exchange: '场内' };
export const KIND_FILTER_KEYS = ['all', 'otc', 'exchange'];
export const LEDGER_COLUMN_COUNT = 18;
export const PRIMARY_BTN = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60';
export const GHOST_BTN = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60';
export const SUBTLE_BTN = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60';
export const EDITABLE_INPUT = cx(tableInputClass, 'h-9 rounded-lg bg-slate-50 px-2 text-xs');

export function nowIso() {
  return new Date().toISOString();
}

export function formatSignedCurrency(value, digits = 2) {
  const amount = formatCurrency(Math.abs(Number(value) || 0), '¥', digits);
  if (Number(value) > 0) return `+${amount}`;
  if (Number(value) < 0) return `-${amount}`;
  return amount;
}

export function formatSignedPercent(value, digits = 2) {
  const num = Number(value) || 0;
  const base = formatPercent(Math.abs(num), digits, false);
  if (num > 0) return `+${base}`;
  if (num < 0) return `-${base}`;
  return base;
}

export function formatNav(value) {
  if (!(Number(value) > 0)) return '—';
  return Number(value).toFixed(4);
}

export function formatShares(value) {
  const num = Number(value) || 0;
  if (num === 0) return '0';
  return num.toFixed(4).replace(/\.?0+$/, '');
}

export function formatRelativeTime(iso) {
  if (!iso) return '尚未同步';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '尚未同步';
  const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec} 秒前`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} 天前`;
}

export function sanitizeDecimalInput(value = '') {
  const raw = String(value || '').replace(/[^\d.]/g, '');
  const [integerPart, ...rest] = raw.split('.');
  if (!rest.length) return integerPart;
  return `${integerPart}.${rest.join('')}`;
}

export function sanitizeCodeInput(value = '') {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

export function emptyDraft(overrides = {}) {
  return createEmptyTransaction({ type: 'BUY', kind: 'otc', date: '', ...overrides });
}

export function transactionToDraft(tx) {
  return {
    id: tx.id,
    code: String(tx.code || ''),
    name: String(tx.name || ''),
    kind: tx.kind || 'otc',
    type: tx.type || 'BUY',
    date: String(tx.date || ''),
    price: tx.price > 0 ? String(tx.price) : '',
    shares: tx.shares > 0 ? String(tx.shares) : '',
    costPrice: tx.costPrice > 0 ? String(tx.costPrice) : '',
    note: String(tx.note || '')
  };
}

export function createOcrState(overrides = {}) {
  return {
    status: 'idle',
    progress: 0,
    message: '上传持仓截图可一键生成 BUY 交易草稿（需人工补录交易日期）。',
    error: '',
    recordCount: 0,
    ...overrides
  };
}
