import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Database,
  FileImage,
  History,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
  TableProperties,
  Trash2,
  Upload,
  Wallet,
  X
} from 'lucide-react';
import { formatCurrency } from '../app/accumulation.js';
import {
  createDefaultHoldingsState,
  persistHoldingsState,
  readHoldingsState,
  recognizeHoldingsFile,
  requestHoldingsNav
} from '../app/holdings.js';
import {
  buildHoldingMetrics,
  createEmptyHoldingRow,
  getHoldingCodeList,
  getHoldingRowErrors,
  hasMeaningfulHoldingRow,
  isHoldingCode,
  normalizeHoldingRow,
  sanitizeHoldingRows,
  summarizeHoldingRowErrors,
  summarizeHoldingRows
} from '../app/holdingsCore.js';
import { getPrimaryTabs } from '../app/screens.js';
import { showActionToast } from '../app/toast.js';
import {
  PageShell,
  Pill,
  TopBar,
  cx,
  tableInputClass
} from '../components/experience-ui.jsx';

const warmSurfaceClass = 'rounded-[1.75rem] border border-[#f0e3da] bg-white shadow-[0_18px_40px_rgba(144,92,67,0.08)]';
const coralPrimaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-full bg-[#ef5d4f] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(239,93,79,0.28)] transition-all hover:-translate-y-0.5 hover:bg-[#e34f41] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0';
const softButtonClass = 'inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-[#eaded5] transition-all hover:-translate-y-0.5 hover:bg-[#fff8f4] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0';
const heroButtonClass = 'inline-flex items-center justify-center gap-2 rounded-full bg-white/14 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 backdrop-blur-sm transition-all hover:bg-white/18 disabled:cursor-not-allowed disabled:opacity-60';
const mutedButtonClass = 'inline-flex items-center justify-center gap-2 rounded-full bg-[#fff7f3] px-4 py-2.5 text-sm font-semibold text-[#c75d4d] ring-1 ring-[#f3d7ce] transition-all hover:bg-[#fff1eb] disabled:cursor-not-allowed disabled:opacity-60';
const editorInputClass = 'h-11 w-full rounded-2xl border border-[#eaded5] bg-[#fffdfb] px-3.5 text-sm text-slate-700 outline-none transition-all placeholder:text-slate-300 hover:border-[#dcc7bb] focus:border-[#ef5d4f]';

const overviewToneClasses = {
  neutral: 'border-[#efe3d8] bg-[linear-gradient(180deg,#fffdfb_0%,#fff7f3_100%)]',
  blue: 'border-[#dbe2ff] bg-[linear-gradient(180deg,#f7f9ff_0%,#ffffff_100%)]',
  coral: 'border-[#f5d9d2] bg-[linear-gradient(180deg,#fff9f7_0%,#ffffff_100%)]',
  amber: 'border-[#f3dfc2] bg-[linear-gradient(180deg,#fffaf3_0%,#ffffff_100%)]',
  rose: 'border-[#f1d8d8] bg-[linear-gradient(180deg,#fff7f7_0%,#ffffff_100%)]',
  emerald: 'border-[#d7ece3] bg-[linear-gradient(180deg,#f6fffb_0%,#ffffff_100%)]'
};

const overviewValueClasses = {
  neutral: 'text-slate-900',
  blue: 'text-[#4360ee]',
  coral: 'text-[#ef5d4f]',
  amber: 'text-[#d28a32]',
  rose: 'text-[#d85a5a]',
  emerald: 'text-[#0f9f6e]'
};

function createOcrState(overrides = {}) {
  return {
    status: 'idle',
    progress: 0,
    message: '上传持仓截图后会先生成一个可替换的导入草稿。',
    durationMs: 0,
    error: '',
    lineCount: 0,
    ...overrides
  };
}

function toEditableRows(rows = []) {
  if (!Array.isArray(rows) || !rows.length) {
    return [createEmptyHoldingRow('holding-empty-1')];
  }

  return rows.map((row, index) => ({
    id: String(row?.id || '').trim() || `holding-edit-${index + 1}`,
    code: String(row?.code || '').trim(),
    name: String(row?.name || '').trim(),
    avgCost: row?.avgCost > 0 ? String(row.avgCost) : String(row?.avgCost || '').trim(),
    shares: row?.shares > 0 ? String(row.shares) : String(row?.shares || '').trim()
  }));
}

function sanitizeDecimalInput(value = '') {
  const raw = String(value || '').replace(/[^\d.]/g, '');
  const [integerPart, ...rest] = raw.split('.');
  if (!rest.length) {
    return integerPart;
  }

  return `${integerPart}.${rest.join('')}`;
}

function formatSignedCurrency(value) {
  const amount = formatCurrency(Math.abs(value), '¥', 2);
  if (value > 0) {
    return `+${amount}`;
  }
  if (value < 0) {
    return `-${amount}`;
  }
  return amount;
}

function formatNav(value) {
  const amount = Number(value);
  if (!(amount > 0)) {
    return '--';
  }

  return amount.toFixed(4);
}

function formatDateLabel(value = '') {
  if (!value) {
    return '--';
  }

  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) {
    return String(value || '');
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestamp)).replace(/\//g, '-');
}

function formatDateTimeLabel(value = '') {
  if (!value) {
    return '--';
  }

  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) {
    return String(value || '');
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp)).replace(/\//g, '-');
}

function formatDuration(durationMs = 0) {
  if (!(durationMs > 0)) {
    return '';
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function getProfitTextClass(value) {
  if (value > 0) {
    return 'text-emerald-600';
  }
  if (value < 0) {
    return 'text-red-500';
  }
  return 'text-slate-500';
}

function clampNumber(value, min = 0, max = 100) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function formatSignedPercent(value, digits = 2) {
  const normalized = Number(value) || 0;
  const absolute = Math.abs(normalized).toFixed(digits);
  if (normalized > 0) {
    return `+${absolute}%`;
  }
  if (normalized < 0) {
    return `-${absolute}%`;
  }
  return `${absolute}%`;
}

function formatPercent(value, digits = 2) {
  return `${clampNumber(value, 0, Number.POSITIVE_INFINITY).toFixed(digits)}%`;
}

function computeRatePercent(numerator, denominator) {
  const base = Number(denominator) || 0;
  if (!(base > 0)) {
    return 0;
  }
  return ((Number(numerator) || 0) / base) * 100;
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#d37b6f]">{eyebrow}</div>
        <div className="mt-2 text-[1.65rem] font-extrabold tracking-tight text-slate-900">{title}</div>
        {description ? <div className="mt-2 text-sm leading-6 text-slate-500">{description}</div> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

function OverviewCard({ title, value, detail, helper, tone = 'neutral', icon: Icon, visual }) {
  return (
    <div className={cx('overflow-hidden rounded-[1.6rem] border p-5 shadow-[0_18px_40px_rgba(150,97,70,0.08)]', overviewToneClasses[tone] || overviewToneClasses.neutral)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
            {Icon ? (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/85 text-slate-400 shadow-sm shadow-slate-200/60">
                <Icon className="h-4 w-4" />
              </span>
            ) : null}
            <span>{title}</span>
          </div>
          <div className={cx('mt-4 text-3xl font-extrabold tracking-tight', overviewValueClasses[tone] || overviewValueClasses.neutral)}>
            {value}
          </div>
          {detail ? <div className="mt-2 text-sm font-semibold text-slate-500">{detail}</div> : null}
          {helper ? <div className="mt-3 text-sm leading-6 text-slate-500">{helper}</div> : null}
        </div>
        {visual ? <div className="hidden min-w-[128px] justify-end md:flex">{visual}</div> : null}
      </div>
    </div>
  );
}

function MiniTrend({ tone = 'coral', mode = 'rise' }) {
  const stroke = tone === 'blue'
    ? '#4b6bfb'
    : tone === 'emerald'
      ? '#10b981'
      : tone === 'amber'
        ? '#d28a32'
        : '#ef5d4f';
  const fill = tone === 'blue'
    ? 'rgba(75,107,251,0.14)'
    : tone === 'emerald'
      ? 'rgba(16,185,129,0.14)'
      : tone === 'amber'
        ? 'rgba(210,138,50,0.14)'
        : 'rgba(239,93,79,0.14)';
  const points = mode === 'flat'
    ? '8,58 36,58 64,58 92,58 120,58 148,58'
    : mode === 'dip'
      ? '8,22 36,30 64,44 92,58 120,70 148,74'
      : mode === 'step'
        ? '8,66 42,66 76,66 110,30 148,30'
        : '8,70 34,68 60,66 94,46 122,26 148,18';

  return (
    <svg className="h-20 w-40" viewBox="0 0 156 80" fill="none" aria-hidden="true">
      <polyline points={`8,79 ${points} 148,79`} fill={fill} />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CoverageGauge({ value = 0, label = '' }) {
  const progress = clampNumber(value, 0, 100);

  return (
    <div className="flex min-w-[120px] justify-center">
      <div className="relative flex h-24 w-24 items-center justify-center rounded-full" style={{ background: `conic-gradient(#ef5d4f 0 ${progress}%, #f1e7e0 ${progress}% 100%)` }}>
        <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-white text-center shadow-inner shadow-[#f3e7dd]">
          <div className="text-sm font-extrabold text-slate-900">{progress.toFixed(0)}%</div>
          <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
        </div>
      </div>
    </div>
  );
}

function CompareBars({ primaryLabel, primaryValue, secondaryLabel, secondaryValue }) {
  const primary = Number(primaryValue) || 0;
  const secondary = Number(secondaryValue) || 0;
  const max = Math.max(Math.abs(primary), Math.abs(secondary), 1);
  const primaryWidth = `${28 + (Math.abs(primary) / max) * 64}%`;
  const secondaryWidth = `${28 + (Math.abs(secondary) / max) * 64}%`;

  return (
    <div className="min-w-[132px] space-y-3">
      <div>
        <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
          <span>{primaryLabel}</span>
          <span className={primary >= 0 ? 'text-[#ef5d4f]' : 'text-[#4b6bfb]'}>{formatSignedCurrency(primary)}</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-[#f4ece6]">
          <div className={cx('h-full rounded-full', primary >= 0 ? 'bg-[#ef5d4f]' : 'bg-[#4b6bfb]')} style={{ width: primaryWidth }} />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
          <span>{secondaryLabel}</span>
          <span className={secondary >= 0 ? 'text-[#ef5d4f]' : 'text-[#4b6bfb]'}>{formatSignedCurrency(secondary)}</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-[#f4ece6]">
          <div className={cx('h-full rounded-full', secondary >= 0 ? 'bg-[#ef5d4f]' : 'bg-[#4b6bfb]')} style={{ width: secondaryWidth }} />
        </div>
      </div>
    </div>
  );
}

function HeroMiniStat({ label, value, note }) {
  return (
    <div className="rounded-[1.2rem] bg-white/14 px-4 py-3 ring-1 ring-white/18 backdrop-blur-sm">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">{label}</div>
      <div className="mt-2 text-lg font-bold text-white">{value}</div>
      {note ? <div className="mt-1 text-xs leading-5 text-white/72">{note}</div> : null}
    </div>
  );
}

function WorkflowStep({ step, title, description }) {
  return (
    <div className="rounded-[1.35rem] border border-[#f0e3da] bg-[#fffaf7] p-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#d37b6f]">Step {step}</div>
      <div className="mt-2 text-sm font-bold text-slate-900">{title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-500">{description}</div>
    </div>
  );
}

function MetricChip({ label, value, valueClassName = 'text-slate-900' }) {
  return (
    <div className="rounded-[1.2rem] border border-[#f0e3da] bg-[#fffdfa] px-3.5 py-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className={cx('mt-2 text-sm font-bold', valueClassName)}>{value}</div>
    </div>
  );
}

function RowStatusIcon({ status }) {
  if (status === '已更新') {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  }
  if (status === '更新失败') {
    return <AlertTriangle className="h-4 w-4 text-red-500" />;
  }
  if (status === '更新中') {
    return <LoaderCircle className="h-4 w-4 animate-spin text-[#ef5d4f]" />;
  }
  return <Sparkles className="h-4 w-4 text-slate-400" />;
}

function ImportStatusPill({ importDraft, ocrState }) {
  let tone = 'slate';
  let label = '等待上传';

  if (importDraft?.rows?.length) {
    tone = 'indigo';
    label = '草稿待确认';
  } else if (ocrState.status === 'loading') {
    tone = 'indigo';
    label = '识别中';
  } else if (ocrState.status === 'success') {
    tone = 'emerald';
    label = '识别完成';
  } else if (ocrState.status === 'error') {
    tone = 'red';
    label = '识别失败';
  }

  return <Pill tone={tone}>{label}</Pill>;
}

function resolveSyncTone(status = 'idle') {
  if (status === 'loading') {
    return 'indigo';
  }
  if (status === 'success') {
    return 'emerald';
  }
  if (status === 'partial-error') {
    return 'amber';
  }
  if (status === 'error') {
    return 'red';
  }
  return 'slate';
}

function resolveSyncLabel(status = 'idle') {
  if (status === 'loading') {
    return '更新中';
  }
  if (status === 'success') {
    return '已更新';
  }
  if (status === 'partial-error') {
    return '部分更新失败';
  }
  if (status === 'error') {
    return '更新失败';
  }
  return '等待更新';
}

function describeCacheSource(cache = null) {
  const source = String(cache?.source || cache?.cacheSource || '').trim();
  if (source === 'edge-cache') {
    return '边缘缓存命中';
  }
  if (source === 'repo-baseline') {
    return '共享基线缓存';
  }
  if (source === 'live') {
    return '实时回源';
  }
  return '等待本次刷新';
}

function resolveTodayCard(summary, lastNavMeta) {
  if (!(summary.positionCount > 0)) {
    return {
      accent: 'slate',
      value: '--',
      note: '补全代码、买入均价和份数后开始计算。',
      badge: <Pill tone="slate">等待持仓</Pill>
    };
  }

  if (lastNavMeta?.status === 'loading') {
    return {
      accent: 'indigo',
      value: '更新中',
      note: summary.latestSnapshotAt
        ? `当前仍显示 ${formatDateTimeLabel(summary.latestSnapshotAt)} 之前的完整快照。`
        : '正在请求最新公布净值，不提前展示部分结果。',
      badge: <Pill tone="indigo">更新中</Pill>
    };
  }

  if (lastNavMeta?.status === 'partial-error') {
    const canRenderValue = summary.todayReadyCount >= summary.positionCount;
    return {
      accent: canRenderValue ? (summary.todayProfit >= 0 ? 'amber' : 'red') : 'amber',
      value: canRenderValue ? formatSignedCurrency(summary.todayProfit) : '--',
      note: canRenderValue
        ? '已保留最近一次完整快照，同时标记失败行。'
        : '部分持仓本次更新失败，组合今日收益暂不完整。',
      badge: <Pill tone="amber">部分更新失败</Pill>
    };
  }

  if (lastNavMeta?.status === 'success' && summary.todayReadyCount >= summary.positionCount) {
    return {
      accent: summary.todayProfit > 0 ? 'emerald' : summary.todayProfit < 0 ? 'red' : 'slate',
      value: formatSignedCurrency(summary.todayProfit),
      note: summary.latestNavDate ? `净值日期 ${formatDateLabel(summary.latestNavDate)}` : '已按最新净值重算。',
      badge: <Pill tone="emerald">已更新</Pill>
    };
  }

  return {
    accent: 'slate',
    value: '--',
    note: '等待完成净值刷新后展示。',
    badge: <Pill tone="slate">等待更新</Pill>
  };
}

export function HoldingsExperience({ links, embedded = false }) {
  const primaryTabs = useMemo(() => getPrimaryTabs(links), [links]);
  const [initialState] = useState(() => readHoldingsState());
  const [rows, setRows] = useState(() => toEditableRows(initialState.rows));
  const [fileName, setFileName] = useState(() => initialState.fileName || '');
  const [snapshotsByCode, setSnapshotsByCode] = useState(() => initialState.snapshotsByCode || {});
  const [lastNavMeta, setLastNavMeta] = useState(() => initialState.lastNavMeta || createDefaultHoldingsState().lastNavMeta);
  const [ocrState, setOcrState] = useState(() => createOcrState());
  const [importDraft, setImportDraft] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [rowRuntimeById, setRowRuntimeById] = useState({});
  const fileInputRef = useRef(null);
  const navRequestIdRef = useRef(0);

  const normalizedRows = useMemo(() => sanitizeHoldingRows(rows, { filterInvalid: false }), [rows]);
  const normalizedRowMap = useMemo(
    () => Object.fromEntries(normalizedRows.map((row) => [row.id, row])),
    [normalizedRows]
  );
  const rowErrorsById = useMemo(
    () => Object.fromEntries(normalizedRows.map((row) => [row.id, getHoldingRowErrors(row, { ignoreBlank: true })])),
    [normalizedRows]
  );
  const summary = useMemo(
    () => summarizeHoldingRows(normalizedRows, snapshotsByCode),
    [normalizedRows, snapshotsByCode]
  );
  const codes = useMemo(() => getHoldingCodeList(normalizedRows), [normalizedRows]);
  const codesKey = codes.join(',');
  const hasMeaningfulRows = summary.meaningfulRowCount > 0;
  const todayCard = useMemo(() => resolveTodayCard(summary, lastNavMeta), [summary, lastNavMeta]);

  useEffect(() => {
    persistHoldingsState({
      fileName,
      rows: normalizedRows,
      snapshotsByCode,
      lastNavMeta
    });
  }, [fileName, lastNavMeta, normalizedRows, snapshotsByCode]);

  useEffect(() => {
    if (!codes.length) {
      setLastNavMeta((current) => ({
        ...current,
        status: 'idle',
        successCount: 0,
        failureCount: 0,
        errors: []
      }));
      return undefined;
    }

    const requestId = navRequestIdRef.current + 1;
    navRequestIdRef.current = requestId;
    const startedAt = new Date().toISOString();

    setLastNavMeta((current) => ({
      ...current,
      status: 'loading',
      successCount: 0,
      failureCount: 0,
      errors: []
    }));

    setRowRuntimeById((current) => {
      const next = { ...current };
      for (const row of normalizedRows) {
        if (isHoldingCode(row.code)) {
          next[row.id] = {
            status: 'loading',
            error: '',
            updatedAt: next[row.id]?.updatedAt || '',
            cacheSource: next[row.id]?.cacheSource || '',
            cacheHit: next[row.id]?.cacheHit === true
          };
        }
      }
      return next;
    });

    let cancelled = false;

    requestHoldingsNav(codes)
      .then((payload) => {
        if (cancelled || navRequestIdRef.current !== requestId) {
          return;
        }

        const itemMap = new Map(payload.items.map((item) => [item.code, item]));
        const errors = payload.items
          .filter((item) => item.ok === false)
          .map((item) => `${item.code}：${item.error || '净值更新失败。'}`)
          .slice(0, 8);

        setSnapshotsByCode((current) => {
          const next = { ...current };
          for (const item of payload.items) {
            if (!item.ok || !(item.latestNav > 0) || !(item.previousNav > 0)) {
              continue;
            }

            next[item.code] = {
              code: item.code,
              name: item.name || next[item.code]?.name || '',
              latestNav: item.latestNav,
              latestNavDate: item.latestNavDate,
              previousNav: item.previousNav,
              previousNavDate: item.previousNavDate,
              updatedAt: item.updatedAt || payload.generatedAt || startedAt,
              cacheHit: item.cacheHit === true || payload?.cache?.hit === true,
              cacheSource: item.cacheSource || payload?.cache?.source || '',
              cacheKey: item.cacheKey || payload?.cache?.key || '',
              error: ''
            };
          }
          return next;
        });

        setRowRuntimeById(() => {
          const next = {};
          for (const row of normalizedRows) {
            if (!hasMeaningfulHoldingRow(row)) {
              continue;
            }

            const errorsForRow = rowErrorsById[row.id] || {};
            if (!isHoldingCode(row.code)) {
              next[row.id] = {
                status: Object.keys(errorsForRow).length ? 'idle' : 'idle',
                error: '',
                updatedAt: ''
              };
              continue;
            }

            const item = itemMap.get(row.code);
            if (item?.ok && item.latestNav > 0 && item.previousNav > 0) {
              next[row.id] = {
                status: 'success',
                error: '',
                updatedAt: item.updatedAt || payload.generatedAt || startedAt,
                cacheSource: item.cacheSource || payload?.cache?.source || '',
                cacheHit: item.cacheHit === true || payload?.cache?.hit === true
              };
              continue;
            }

            next[row.id] = {
              status: 'error',
              error: item?.error || '净值更新失败，已保留上次成功快照。',
              updatedAt: ''
            };
          }
          return next;
        });

        setLastNavMeta({
          status: payload.failureCount > 0
            ? (payload.successCount > 0 ? 'partial-error' : 'error')
            : 'success',
          updatedAt: payload.generatedAt || startedAt,
          successCount: payload.successCount,
          failureCount: payload.failureCount,
          cache: payload.cache,
          errors
        });
      })
      .catch((error) => {
        if (cancelled || navRequestIdRef.current !== requestId) {
          return;
        }

        const message = error instanceof Error ? error.message : '净值更新失败。';
        setRowRuntimeById((current) => {
          const next = { ...current };
          for (const row of normalizedRows) {
            if (!isHoldingCode(row.code)) {
              continue;
            }
            next[row.id] = {
              status: 'error',
              error: message,
              updatedAt: current[row.id]?.updatedAt || ''
            };
          }
          return next;
        });

        setLastNavMeta((current) => ({
          ...current,
          status: Object.keys(snapshotsByCode || {}).length ? 'partial-error' : 'error',
          successCount: 0,
          failureCount: codes.length,
          errors: [message]
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [codesKey, refreshSeed]);

  function updateRowField(rowId, field, value) {
    setRows((current) => current.map((row) => {
      if (row.id !== rowId) {
        return row;
      }

      if (field === 'code') {
        return {
          ...row,
          code: String(value || '').replace(/\D/g, '').slice(0, 6)
        };
      }

      if (field === 'avgCost' || field === 'shares') {
        return {
          ...row,
          [field]: sanitizeDecimalInput(value)
        };
      }

      return {
        ...row,
        [field]: value
      };
    }));
  }

  function handleAddRow() {
    setRows((current) => [...current, createEmptyHoldingRow()]);
  }

  function handleDeleteRow(rowId) {
    setRows((current) => {
      const next = current.filter((row) => row.id !== rowId);
      return next.length ? next : [createEmptyHoldingRow('holding-empty-1')];
    });
  }

  function handleClearRows() {
    setRows([createEmptyHoldingRow('holding-empty-1')]);
    setFileName('');
    setImportDraft(null);
    showActionToast('清空持仓', 'success', {
      description: '当前组合已清空，最近一次净值快照仍会保留到重新录入。'
    });
  }

  async function handleAnalyzeFile(file) {
    if (!file) {
      return;
    }

    setImportDraft(null);
    setOcrState(createOcrState({
      status: 'loading',
      progress: 8,
      message: '准备识别持仓截图'
    }));

    try {
      const result = await recognizeHoldingsFile(file, (progressState) => {
        setOcrState((current) => ({
          ...current,
          ...progressState
        }));
      });

      setImportDraft({
        fileName: file.name || '',
        rows: result.rows,
        warnings: result.warnings,
        confidence: result.confidence,
        durationMs: result.durationMs,
        recordCount: result.recordCount
      });

      setOcrState(createOcrState({
        status: 'success',
        progress: 100,
        lineCount: result.rows.length,
        durationMs: result.durationMs,
        message: result.rows.length
          ? `已识别 ${result.rows.length} 行持仓草稿，请确认是否替换当前组合。`
          : '未识别出可直接导入的完整持仓，请查看警告后手动录入。',
        error: ''
      }));

      showActionToast('持仓识别', result.rows.length ? 'success' : 'warning', {
        tone: result.rows.length ? 'emerald' : 'amber',
        description: result.rows.length
          ? `已生成 ${result.rows.length} 行可编辑草稿，当前组合尚未被覆盖。`
          : '识别结果没有形成完整持仓行，请根据提示补录。'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '识别持仓截图失败。';
      setOcrState(createOcrState({
        status: 'error',
        progress: 0,
        message: '识别失败',
        error: message
      }));

      showActionToast('持仓识别', 'error', {
        description: message
      });
    }
  }

  function handleApplyDraft() {
    if (!importDraft?.rows?.length) {
      return;
    }

    setRows(toEditableRows(importDraft.rows));
    setFileName(importDraft.fileName || '');
    setImportDraft(null);
    setOcrState(createOcrState({
      status: 'success',
      progress: 100,
      lineCount: importDraft.rows.length,
      durationMs: importDraft.durationMs || 0,
      message: `已用识别结果替换当前组合，共 ${importDraft.rows.length} 行。`
    }));
    showActionToast('导入持仓', 'success', {
      description: `已替换当前组合，文件来源：${importDraft.fileName || '持仓截图'}。`
    });
  }

  function handleSelectFileFromInput(event) {
    const file = event.target.files?.[0];
    if (file) {
      handleAnalyzeFile(file);
    }
    event.target.value = '';
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  const assetValue = summary.pricedCount ? summary.marketValue : summary.totalCost;
  const totalProfitRate = computeRatePercent(summary.totalProfit, summary.totalCost);
  const todayRateBase = (summary.marketValue - summary.todayProfit) > 0
    ? (summary.marketValue - summary.todayProfit)
    : summary.totalCost;
  const todayProfitRate = computeRatePercent(summary.todayProfit, todayRateBase);
  const coverageBase = summary.positionCount || summary.fetchableCount || 0;
  const coverageRate = computeRatePercent(summary.pricedCount, coverageBase);
  const completionRate = computeRatePercent(summary.positionCount, summary.meaningfulRowCount || summary.positionCount);
  const latestSyncLabel = summary.latestSnapshotAt
    ? formatDateTimeLabel(summary.latestSnapshotAt)
    : (lastNavMeta.updatedAt ? formatDateTimeLabel(lastNavMeta.updatedAt) : '--');

  const content = (
    <div className="bg-[radial-gradient(circle_at_top,_#fff7f1_0,_#f7f2ed_46%,_#f3ede7_100%)]">
      <input
        ref={fileInputRef}
        accept="image/png,image/jpeg,image/jpg"
        className="hidden"
        type="file"
        onChange={handleSelectFileFromInput}
      />

      <div className="mx-auto max-w-6xl px-5 pb-20 pt-6 sm:px-6">
        <div className="rounded-[2rem] bg-gradient-to-br from-[#ef6557] via-[#f07b62] to-[#f6b196] p-[1px] shadow-[0_28px_70px_rgba(210,104,82,0.30)]">
          <div className="relative overflow-hidden rounded-[2rem] bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.24),_transparent_32%),linear-gradient(135deg,#ee6356_0%,#f07a61_50%,#f7b39a_100%)] px-5 py-6 text-white sm:px-6 sm:py-7">
            <div className="pointer-events-none absolute -right-12 top-8 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
            <div className="pointer-events-none absolute -left-10 bottom-0 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
            <div className="relative">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/14 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/20">
                    <Wallet className="h-3.5 w-3.5" />
                    Fund Holdings
                  </div>
                  <h1 className="mt-4 text-[2rem] font-extrabold tracking-tight sm:text-[2.35rem]">基金持仓收益</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80">
                    参考投资账本的账户面板风格，把组合资产、当日盈亏、累计收益和净值同步状态放到同一个看板里。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className={heroButtonClass} type="button" onClick={openFilePicker}>
                    <Upload className="h-4 w-4" />
                    上传截图
                  </button>
                  <button
                    className={heroButtonClass}
                    disabled={!codes.length || lastNavMeta.status === 'loading'}
                    type="button"
                    onClick={() => setRefreshSeed((value) => value + 1)}
                  >
                    {lastNavMeta.status === 'loading' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    刷新净值
                  </button>
                </div>
              </div>

              <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.72fr)]">
                <div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[1.5rem] bg-white/14 p-4 ring-1 ring-white/18 backdrop-blur-sm">
                      <div className="text-sm font-semibold text-white/78">当日盈亏</div>
                      <div className="mt-3 text-3xl font-extrabold tracking-tight text-white">{todayCard.value}</div>
                      <div className="mt-2 text-sm font-semibold text-white/74">
                        {summary.todayReadyCount >= summary.positionCount && summary.positionCount > 0 ? formatSignedPercent(todayProfitRate) : '等待完整净值'}
                      </div>
                    </div>
                    <div className="rounded-[1.5rem] bg-white/14 p-4 ring-1 ring-white/18 backdrop-blur-sm">
                      <div className="text-sm font-semibold text-white/78">累计收益</div>
                      <div className="mt-3 text-3xl font-extrabold tracking-tight text-white">
                        {summary.pricedCount ? formatSignedCurrency(summary.totalProfit) : '--'}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-white/74">
                        {summary.pricedCount ? formatSignedPercent(totalProfitRate) : '等待净值快照'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[1.75rem] bg-white/12 p-5 ring-1 ring-white/18 backdrop-blur-sm">
                    <div className="text-sm font-semibold text-white/78">账户资产</div>
                    <div className="mt-2 text-[2.2rem] font-extrabold tracking-tight text-white sm:text-[2.65rem]">
                      {assetValue > 0 ? formatCurrency(assetValue, '¥', 2) : '--'}
                    </div>
                    <div className="mt-2 text-sm text-white/72">
                      {summary.pricedCount
                        ? `最近净值日期 ${formatDateLabel(summary.latestNavDate)}`
                        : '当前以持仓成本作为账户基线，等待首次净值同步。'}
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <HeroMiniStat
                        label="持仓成本"
                        value={summary.totalCost > 0 ? formatCurrency(summary.totalCost, '¥', 2) : '--'}
                        note="按买入均价与份数汇总"
                      />
                      <HeroMiniStat
                        label="持有收益"
                        value={summary.pricedCount ? formatSignedCurrency(summary.totalProfit) : '--'}
                        note={summary.pricedCount ? formatSignedPercent(totalProfitRate) : '等待净值'}
                      />
                      <HeroMiniStat
                        label="净值覆盖"
                        value={coverageBase ? formatPercent(coverageRate) : '--'}
                        note={`${summary.pricedCount}/${coverageBase || 0} 已同步`}
                      />
                      <HeroMiniStat
                        label="持仓数量"
                        value={`${summary.positionCount || 0} 只`}
                        note={`${summary.meaningfulRowCount || 0} 行有效录入`}
                      />
                      <HeroMiniStat
                        label="组合完成度"
                        value={summary.meaningfulRowCount ? formatPercent(completionRate) : '--'}
                        note="已形成完整仓位的占比"
                      />
                      <HeroMiniStat
                        label="最近快照"
                        value={latestSyncLabel}
                        note={resolveSyncLabel(lastNavMeta.status)}
                      />
                    </div>
                  </div>
                </div>

                <div
                  className={cx(
                    'rounded-[1.75rem] bg-white/12 p-5 ring-1 ring-white/18 backdrop-blur-sm',
                    dragActive && 'bg-white/18'
                  )}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    if (event.currentTarget.contains(event.relatedTarget)) {
                      return;
                    }
                    setDragActive(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                    const file = event.dataTransfer.files?.[0];
                    if (file) {
                      handleAnalyzeFile(file);
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white/80">导入工作台</div>
                      <div className="mt-2 text-2xl font-extrabold tracking-tight text-white">截图识别持仓</div>
                    </div>
                    <ImportStatusPill importDraft={importDraft} ocrState={ocrState} />
                  </div>
                  <div className="mt-3 text-sm leading-6 text-white/76">
                    默认导入策略仍然是“先出草稿，再由你确认替换当前组合”，不会静默覆盖列表。
                  </div>

                  <button
                    className={cx(
                      'mt-5 flex min-h-[168px] w-full flex-col items-center justify-center rounded-[1.6rem] border border-dashed border-white/30 bg-white/12 px-6 py-8 text-center transition-all',
                      dragActive ? 'scale-[1.01] bg-white/18' : 'hover:bg-white/16'
                    )}
                    type="button"
                    onClick={openFilePicker}
                  >
                    {ocrState.status === 'loading' ? (
                      <LoaderCircle className="h-10 w-10 animate-spin text-white" />
                    ) : (
                      <CloudUpload className="h-10 w-10 text-white" />
                    )}
                    <div className="mt-4 text-base font-bold text-white">
                      {ocrState.status === 'loading' ? '正在识别截图' : '拖拽或点击上传 PNG / JPG / JPEG'}
                    </div>
                    <div className="mt-2 max-w-xs text-sm leading-6 text-white/76">{ocrState.message}</div>
                    {ocrState.status === 'loading' ? (
                      <div className="mt-5 h-2 w-full max-w-xs overflow-hidden rounded-full bg-white/18">
                        <div className="h-full rounded-full bg-white transition-all" style={{ width: `${clampNumber(ocrState.progress, 0, 100)}%` }} />
                      </div>
                    ) : null}
                  </button>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <div className="rounded-[1.35rem] bg-white/14 px-4 py-4 ring-1 ring-white/16">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <FileImage className="h-4 w-4 text-white/72" />
                        最近导入
                      </div>
                      <div className="mt-3 text-sm text-white/80">{importDraft?.fileName || fileName || '尚未导入截图'}</div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {ocrState.durationMs > 0 ? <Pill tone="slate">{formatDuration(ocrState.durationMs)}</Pill> : null}
                        {importDraft?.rows?.length ? <Pill tone="indigo">{importDraft.rows.length} 行草稿</Pill> : null}
                      </div>
                    </div>
                    <div className="rounded-[1.35rem] bg-white/14 px-4 py-4 ring-1 ring-white/16">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <TableProperties className="h-4 w-4 text-white/72" />
                        导入策略
                      </div>
                      <div className="mt-3 text-sm leading-6 text-white/76">
                        识别结果先放进草稿区，确认后才替换当前组合。适合先拍一张截图，再针对识别错行做手动微调。
                      </div>
                    </div>
                  </div>

                  {ocrState.error ? (
                    <div className="mt-4 rounded-[1.2rem] bg-[#6e2018]/25 px-4 py-3 text-sm text-white ring-1 ring-white/14">
                      {ocrState.error}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <OverviewCard
            detail={summary.totalCost > 0 ? `持仓成本 ${formatCurrency(summary.totalCost, '¥', 2)}` : '等待录入持仓'}
            helper={summary.positionCount ? `${summary.positionCount} 只基金纳入组合` : '先补全代码、均价和份数后开始汇总'}
            icon={Wallet}
            title="总资产"
            tone="blue"
            value={assetValue > 0 ? formatCurrency(assetValue, '¥', 2) : '--'}
            visual={<MiniTrend tone="blue" mode={assetValue > summary.totalCost ? 'rise' : assetValue < summary.totalCost ? 'dip' : 'flat'} />}
          />
          <OverviewCard
            detail={summary.todayReadyCount >= summary.positionCount && summary.positionCount > 0 ? formatSignedPercent(todayProfitRate) : '等待完整净值'}
            helper={todayCard.note}
            icon={History}
            title="当日盈亏"
            tone={todayCard.accent === 'red' ? 'rose' : todayCard.accent === 'amber' ? 'amber' : todayCard.accent === 'emerald' ? 'emerald' : 'coral'}
            value={todayCard.value}
            visual={<MiniTrend tone="coral" mode={summary.todayProfit > 0 ? 'step' : summary.todayProfit < 0 ? 'dip' : 'flat'} />}
          />
          <OverviewCard
            detail={summary.pricedCount ? formatSignedPercent(totalProfitRate) : '等待净值快照'}
            helper={summary.latestSnapshotAt ? `最近快照 ${formatDateTimeLabel(summary.latestSnapshotAt)}` : '进入页面后会自动刷新净值'}
            icon={Sparkles}
            title="累计收益"
            tone={summary.totalProfit > 0 ? 'coral' : summary.totalProfit < 0 ? 'rose' : 'neutral'}
            value={summary.pricedCount ? formatSignedCurrency(summary.totalProfit) : '--'}
            visual={<MiniTrend tone={summary.totalProfit < 0 ? 'blue' : 'coral'} mode={summary.totalProfit > 0 ? 'rise' : summary.totalProfit < 0 ? 'dip' : 'flat'} />}
          />
          <OverviewCard
            detail={coverageBase ? `${summary.pricedCount}/${coverageBase} 已同步` : '等待有效持仓'}
            helper={summary.latestNavDate ? `最新净值日 ${formatDateLabel(summary.latestNavDate)}` : '尚未拿到最新净值日期'}
            icon={Database}
            title="净值覆盖"
            tone="amber"
            value={coverageBase ? formatPercent(coverageRate) : '--'}
            visual={<CoverageGauge label="覆盖" value={coverageBase ? coverageRate : 0} />}
          />
          <OverviewCard
            detail={`${resolveSyncLabel(lastNavMeta.status)} · ${describeCacheSource(lastNavMeta.cache)}`}
            helper={lastNavMeta.updatedAt ? `最近触发 ${formatDateTimeLabel(lastNavMeta.updatedAt)}` : '进入页面后自动刷新'}
            icon={RefreshCw}
            title="收益对比"
            tone="neutral"
            value={summary.pricedCount ? formatSignedCurrency(summary.totalProfit) : '--'}
            visual={<CompareBars primaryLabel="今日" primaryValue={summary.todayProfit} secondaryLabel="累计" secondaryValue={summary.totalProfit} />}
          />
          <OverviewCard
            detail={`${summary.meaningfulRowCount || 0} 行录入 · ${summary.positionCount || 0} 只成仓`}
            helper="完成度反映录入行里有多少已经形成完整仓位。"
            icon={TableProperties}
            title="组合完成度"
            tone="emerald"
            value={summary.meaningfulRowCount ? formatPercent(completionRate) : '--'}
            visual={<CoverageGauge label="完成" value={summary.meaningfulRowCount ? completionRate : 0} />}
          />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]">
          <div className="space-y-6">
            <div className={cx(warmSurfaceClass, 'p-6')}>
              <SectionHeader
                action={(
                  <>
                    <button className={softButtonClass} type="button" onClick={handleAddRow}>
                      <Plus className="h-4 w-4" />
                      新增持仓
                    </button>
                    <button className={mutedButtonClass} type="button" onClick={handleClearRows}>
                      <Trash2 className="h-4 w-4" />
                      清空全部
                    </button>
                  </>
                )}
                description="列表模式参考基金账本明细页，保留可编辑字段，但把净值、今日盈亏和累计收益改成更聚焦的收益列。"
                eyebrow="List Mode"
                title="持仓列表"
              />

              {!hasMeaningfulRows ? (
                <div className="mt-6 rounded-[1.75rem] border border-dashed border-[#e7d6cc] bg-[#fffaf7] px-6 py-12 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm shadow-[#ead7cb]">
                    <Wallet className="h-6 w-6 text-[#ef5d4f]" />
                  </div>
                  <div className="mt-4 text-lg font-bold text-slate-900">当前还没有持仓组合</div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    你可以先上传截图生成导入草稿，也可以直接新增一行，录入基金代码、买入均价和持有份数。
                  </p>
                </div>
              ) : null}

              <div className="mt-6 hidden grid-cols-[minmax(0,1.35fr)_minmax(0,0.84fr)_minmax(0,0.84fr)_minmax(0,0.9fr)_minmax(0,0.95fr)_minmax(0,1fr)_auto] gap-3 px-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 xl:grid">
                <span>基金 / 代码</span>
                <span>买入均价</span>
                <span>持有份数</span>
                <span>最新净值</span>
                <span>当日盈亏</span>
                <span>累计收益</span>
                <span className="text-right">操作</span>
              </div>

              <div className="mt-6 space-y-4">
                {rows.map((editableRow, index) => {
                  const normalizedRow = normalizedRowMap[editableRow.id] || normalizeHoldingRow(editableRow);
                  const errors = rowErrorsById[editableRow.id] || {};
                  const snapshot = snapshotsByCode[normalizedRow.code] || null;
                  const metrics = buildHoldingMetrics(normalizedRow, snapshot);
                  const runtime = rowRuntimeById[editableRow.id] || {};
                  const rowTotalRate = computeRatePercent(metrics.totalProfit, metrics.cost);
                  const rowTodayRateBase = (metrics.marketValue - metrics.todayProfit) > 0
                    ? (metrics.marketValue - metrics.todayProfit)
                    : metrics.cost;
                  const rowTodayRate = computeRatePercent(metrics.todayProfit, rowTodayRateBase);

                  let rowStatusLabel = '待完善';
                  let rowStatusTone = 'slate';
                  let rowStatusNote = '补全代码、均价和份数后自动计算。';

                  if (Object.keys(errors).length) {
                    rowStatusLabel = '待完善';
                    rowStatusTone = 'slate';
                    rowStatusNote = summarizeHoldingRowErrors(errors);
                  } else if (runtime.status === 'loading') {
                    rowStatusLabel = '更新中';
                    rowStatusTone = 'indigo';
                    rowStatusNote = '正在请求该基金的最新公布净值。';
                  } else if (runtime.status === 'error') {
                    rowStatusLabel = '更新失败';
                    rowStatusTone = 'red';
                    rowStatusNote = runtime.error || '净值更新失败，已保留上次成功快照。';
                  } else if (snapshot?.latestNav > 0 && snapshot?.previousNav > 0) {
                    rowStatusLabel = '已更新';
                    rowStatusTone = 'emerald';
                    rowStatusNote = snapshot.latestNavDate
                      ? `净值日期 ${formatDateLabel(snapshot.latestNavDate)}`
                      : '已同步到最近成功快照。';
                  }

                  return (
                    <div key={editableRow.id} className="rounded-[1.75rem] border border-[#f0e3da] bg-[linear-gradient(180deg,#fffdfa_0%,#fff8f5_100%)] p-4 shadow-[0_16px_36px_rgba(150,100,74,0.06)]">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#cf776b] shadow-sm shadow-[#ead7cb]">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          当前持仓
                        </div>
                        <div className="flex items-center gap-2">
                          <Pill tone={rowStatusTone}>{rowStatusLabel}</Pill>
                          <button
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-[#eaded5] transition-colors hover:bg-red-50 hover:text-red-500"
                            type="button"
                            onClick={() => handleDeleteRow(editableRow.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.84fr)_minmax(0,0.84fr)_minmax(0,0.9fr)_minmax(0,0.95fr)_minmax(0,1fr)_auto]">
                        <div className="min-w-0 space-y-3">
                          <div className="grid gap-3 sm:grid-cols-[minmax(120px,0.6fr)_minmax(0,1fr)]">
                            <label className="space-y-2">
                              <span className="text-xs font-semibold text-slate-500">基金代码</span>
                              <input
                                className={cx(
                                  tableInputClass,
                                  editorInputClass,
                                  errors.code && 'border-red-200 bg-red-50 focus:border-red-300'
                                )}
                                inputMode="numeric"
                                maxLength={6}
                                placeholder="例如 110022"
                                value={editableRow.code}
                                onChange={(event) => updateRowField(editableRow.id, 'code', event.target.value)}
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-xs font-semibold text-slate-500">基金名称</span>
                              <input
                                className={editorInputClass}
                                placeholder="可选，支持手动补全"
                                value={editableRow.name}
                                onChange={(event) => updateRowField(editableRow.id, 'name', event.target.value)}
                              />
                            </label>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                            <RowStatusIcon status={rowStatusLabel} />
                            <span>{rowStatusNote}</span>
                            {snapshot?.cacheSource ? <Pill tone="slate">{snapshot.cacheHit ? '缓存命中' : '实时更新'}</Pill> : null}
                          </div>
                        </div>

                        <label className="space-y-2">
                          <span className="text-xs font-semibold text-slate-500">买入均价</span>
                          <input
                            className={cx(
                              tableInputClass,
                              editorInputClass,
                              errors.avgCost && 'border-red-200 bg-red-50 focus:border-red-300'
                            )}
                            inputMode="decimal"
                            placeholder="0.0000"
                            value={editableRow.avgCost}
                            onChange={(event) => updateRowField(editableRow.id, 'avgCost', event.target.value)}
                          />
                        </label>

                        <label className="space-y-2">
                          <span className="text-xs font-semibold text-slate-500">持有份数</span>
                          <input
                            className={cx(
                              tableInputClass,
                              editorInputClass,
                              errors.shares && 'border-red-200 bg-red-50 focus:border-red-300'
                            )}
                            inputMode="decimal"
                            placeholder="0.00"
                            value={editableRow.shares}
                            onChange={(event) => updateRowField(editableRow.id, 'shares', event.target.value)}
                          />
                        </label>

                        <div className="rounded-[1.25rem] border border-[#f0e3da] bg-white px-4 py-3">
                          <div className="text-xs font-semibold text-slate-500">最新净值</div>
                          <div className="mt-2 text-lg font-bold text-slate-900">{formatNav(snapshot?.latestNav)}</div>
                          <div className="mt-1 text-xs leading-5 text-slate-400">
                            {snapshot?.latestNavDate ? `最新 ${formatDateLabel(snapshot.latestNavDate)}` : '等待净值刷新'}
                          </div>
                        </div>

                        <div className="rounded-[1.25rem] border border-[#f0e3da] bg-white px-4 py-3">
                          <div className="text-xs font-semibold text-slate-500">当日盈亏</div>
                          <div className={cx('mt-2 text-lg font-bold', metrics.hasLatestNav && metrics.hasPreviousNav ? getProfitTextClass(metrics.todayProfit) : 'text-slate-400')}>
                            {metrics.hasLatestNav && metrics.hasPreviousNav ? formatSignedCurrency(metrics.todayProfit) : '--'}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-slate-400">
                            {metrics.hasLatestNav && metrics.hasPreviousNav ? formatSignedPercent(rowTodayRate) : '上一交易日待同步'}
                          </div>
                        </div>

                        <div className="rounded-[1.25rem] border border-[#f0e3da] bg-white px-4 py-3">
                          <div className="text-xs font-semibold text-slate-500">累计收益</div>
                          <div className={cx('mt-2 text-lg font-bold', metrics.hasLatestNav ? getProfitTextClass(metrics.totalProfit) : 'text-slate-400')}>
                            {metrics.hasLatestNav ? formatSignedCurrency(metrics.totalProfit) : '--'}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-slate-400">
                            {metrics.hasLatestNav ? `${formatSignedPercent(rowTotalRate)} · 市值 ${formatCurrency(metrics.marketValue, '¥', 2)}` : '当前市值待同步'}
                          </div>
                        </div>

                        <div className="flex items-start justify-end xl:pt-7">
                          <button
                            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-[#eaded5] transition-colors hover:bg-red-50 hover:text-red-500"
                            type="button"
                            onClick={() => handleDeleteRow(editableRow.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <MetricChip label="前值日期" value={snapshot?.previousNavDate ? formatDateLabel(snapshot.previousNavDate) : '--'} />
                        <MetricChip label="快照时间" value={snapshot?.updatedAt ? formatDateTimeLabel(snapshot.updatedAt) : '--'} />
                        <MetricChip label="缓存来源" value={snapshot?.cacheSource ? describeCacheSource(snapshot) : '等待刷新'} />
                        <MetricChip
                          label="状态"
                          value={rowStatusLabel}
                          valueClassName={rowStatusTone === 'red' ? 'text-red-500' : rowStatusTone === 'emerald' ? 'text-emerald-600' : rowStatusTone === 'indigo' ? 'text-[#ef5d4f]' : 'text-slate-900'}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className={cx(warmSurfaceClass, 'p-6')}>
              <SectionHeader
                description="组合级今日收益只在全部持仓完成净值拉取后展示最终结果。"
                eyebrow="NAV Sync"
                title="净值同步状态"
              />

              <div className="mt-5 space-y-4">
                <div className="rounded-[1.5rem] border border-[#f0e3da] bg-[#fff8f4] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">组合状态</div>
                      <div className="mt-2 text-lg font-bold text-slate-900">{resolveSyncLabel(lastNavMeta.status)}</div>
                    </div>
                    <Pill tone={resolveSyncTone(lastNavMeta.status)}>{resolveSyncLabel(lastNavMeta.status)}</Pill>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-slate-500">
                    {lastNavMeta.updatedAt ? `最近触发 ${formatDateTimeLabel(lastNavMeta.updatedAt)}` : '进入页面后自动刷新。'}
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-[#f0e3da] bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Database className="h-4 w-4 text-slate-400" />
                    缓存命中
                  </div>
                  <div className="mt-2 text-sm leading-6 text-slate-500">
                    {describeCacheSource(lastNavMeta.cache)}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {lastNavMeta.cache?.key ? <Pill tone="slate">key: {lastNavMeta.cache.key.slice(0, 12)}</Pill> : null}
                    {lastNavMeta.cache?.codeCount ? <Pill tone="slate">{lastNavMeta.cache.codeCount} 个代码</Pill> : null}
                    {lastNavMeta.cache?.hit ? <Pill tone="indigo">缓存命中</Pill> : null}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="rounded-[1.5rem] border border-[#f0e3da] bg-white p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">成功更新</div>
                    <div className="mt-2 text-2xl font-extrabold text-slate-900">{lastNavMeta.successCount || 0}</div>
                  </div>
                  <div className="rounded-[1.5rem] border border-[#f0e3da] bg-white p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">失败代码</div>
                    <div className="mt-2 text-2xl font-extrabold text-slate-900">{lastNavMeta.failureCount || 0}</div>
                  </div>
                </div>

                {lastNavMeta.errors?.length ? (
                  <div className="rounded-[1.5rem] border border-red-100 bg-red-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-red-600">
                      <AlertTriangle className="h-4 w-4" />
                      失败明细
                    </div>
                    <div className="mt-3 space-y-2 text-sm leading-6 text-red-600">
                      {lastNavMeta.errors.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className={cx(warmSurfaceClass, 'p-6')}>
              <SectionHeader
                description="识别结果不会直接覆盖当前组合，需要你确认后才会替换。"
                eyebrow="OCR Draft"
                title="导入草稿"
              />

              <div className="mt-5 space-y-4">
                {importDraft ? (
                  <>
                    <div className="rounded-[1.5rem] border border-[#f3d6ce] bg-[#fff7f4] p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#c85e4d]">
                        <FileImage className="h-4 w-4" />
                        {importDraft.fileName || '持仓截图'}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Pill tone="indigo">{importDraft.rows.length} 行草稿</Pill>
                        <Pill tone="slate">置信度 {(Number(importDraft.confidence || 0) * 100).toFixed(0)}%</Pill>
                        {importDraft.durationMs > 0 ? <Pill tone="slate">{formatDuration(importDraft.durationMs)}</Pill> : null}
                      </div>
                      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                        <button className={coralPrimaryButtonClass} disabled={!importDraft.rows.length} type="button" onClick={handleApplyDraft}>
                          <CheckCircle2 className="h-4 w-4" />
                          用草稿替换当前组合
                        </button>
                        <button className={softButtonClass} type="button" onClick={() => setImportDraft(null)}>
                          <X className="h-4 w-4" />
                          放弃本次草稿
                        </button>
                      </div>
                    </div>

                    {importDraft.warnings?.length ? (
                      <div className="rounded-[1.5rem] border border-amber-100 bg-amber-50 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
                          <AlertTriangle className="h-4 w-4" />
                          OCR 警告
                        </div>
                        <div className="mt-3 space-y-2 text-sm leading-6 text-amber-700">
                          {importDraft.warnings.map((item) => (
                            <div key={item}>{item}</div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-[1.5rem] border border-dashed border-[#e7d6cc] bg-[#fffaf7] p-5 text-sm leading-6 text-slate-500">
                    当前没有待确认的 OCR 草稿。上传截图后，完整识别行会先出现在这里，再由你决定是否替换当前组合。
                  </div>
                )}
              </div>
            </div>

            <div className={cx(warmSurfaceClass, 'p-6')}>
              <SectionHeader
                description="延续现有工作台的编辑节奏：先识别，再校正，最后看组合收益。"
                eyebrow="Guide"
                title="操作提示"
              />

              <div className="mt-5 grid gap-3">
                <WorkflowStep
                  description="上传截图后先生成草稿，不会覆盖当前列表。识别出的行可以先看数量、置信度和警告，再决定是否应用。"
                  step="01"
                  title="先识别，再确认替换"
                />
                <WorkflowStep
                  description="只有基金代码、买入均价和持有份数三项完整时，当前行才会被纳入资产与收益汇总。"
                  step="02"
                  title="补全代码、均价和份数"
                />
                <WorkflowStep
                  description="页面会自动保存最近一次成功净值快照。即使本次回源失败，也会优先展示最近成功结果。"
                  step="03"
                  title="看收益时同步检查净值状态"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <PageShell>
      <TopBar activeKey="fundHoldings" tabs={primaryTabs} />
      {content}
    </PageShell>
  );
}
