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
  Card,
  PageShell,
  Pill,
  SectionHeading,
  TopBar,
  cx,
  primaryButtonClass,
  secondaryButtonClass,
  subtleButtonClass,
  tableInputClass
} from '../components/experience-ui.jsx';

const summaryAccentClasses = {
  slate: 'border-slate-200 bg-white',
  indigo: 'border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white',
  emerald: 'border-emerald-100 bg-emerald-50/70',
  red: 'border-red-100 bg-red-50/70',
  amber: 'border-amber-100 bg-amber-50/70'
};

const summaryValueClasses = {
  slate: 'text-slate-900',
  indigo: 'text-indigo-700',
  emerald: 'text-emerald-600',
  red: 'text-red-500',
  amber: 'text-amber-600'
};

function SummaryCard({ eyebrow, value, note, accent = 'slate', badge, icon: Icon }) {
  return (
    <Card className={cx('rounded-[1.75rem] p-5', summaryAccentClasses[accent] || summaryAccentClasses.slate)}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{eyebrow}</div>
        {Icon ? (
          <div className="rounded-full bg-white/80 p-2 text-slate-400 shadow-sm shadow-slate-200/60">
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>
      <div className={cx('mt-4 text-3xl font-extrabold tracking-tight', summaryValueClasses[accent] || summaryValueClasses.slate)}>
        {value}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {badge}
        {note ? <div className="text-sm leading-6 text-slate-500">{note}</div> : null}
      </div>
    </Card>
  );
}

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
  const source = String(cache?.source || '').trim();
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

  const content = (
    <>
      <div className="border-b border-slate-200 bg-white/75 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-5 py-6 sm:px-6">
          <SectionHeading
            eyebrow="Fund Holdings"
            title="基金持仓收益"
            description="上传持仓截图生成可编辑草稿，或直接在表格里维护单个基金组合。页面每次打开都会通过 Worker 拉取最新净值，并保留最近一次成功快照。"
            action={(
              <>
                <button className={secondaryButtonClass} type="button" onClick={openFilePicker}>
                  <Upload className="h-4 w-4" />
                  上传截图
                </button>
                <button
                  className={subtleButtonClass}
                  disabled={!codes.length || lastNavMeta.status === 'loading'}
                  type="button"
                  onClick={() => setRefreshSeed((value) => value + 1)}
                >
                  {lastNavMeta.status === 'loading' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  刷新净值
                </button>
              </>
            )}
          />
        </div>
      </div>

      <input
        ref={fileInputRef}
        accept="image/png,image/jpeg,image/jpg"
        className="hidden"
        type="file"
        onChange={handleSelectFileFromInput}
      />

      <div className="mx-auto max-w-6xl px-5 pb-20 pt-6 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            accent="slate"
            badge={<Pill tone="slate">{summary.positionCount} 只持仓</Pill>}
            eyebrow="组合总成本"
            icon={Wallet}
            note={summary.positionCount ? '按买入均价和持有份数汇总。' : '先录入持仓后再计算。'}
            value={summary.positionCount ? formatCurrency(summary.totalCost, '¥', 2) : '--'}
          />
          <SummaryCard
            accent={summary.pricedCount >= summary.positionCount && summary.positionCount > 0 ? 'indigo' : 'slate'}
            badge={<Pill tone={summary.pricedCount >= summary.positionCount && summary.positionCount > 0 ? 'indigo' : 'slate'}>{summary.pricedCount}/{summary.positionCount || 0} 已覆盖</Pill>}
            eyebrow="当前市值"
            icon={Sparkles}
            note={summary.pricedCount ? `最近净值日期 ${formatDateLabel(summary.latestNavDate)}` : '等待净值快照。'}
            value={summary.pricedCount ? formatCurrency(summary.marketValue, '¥', 2) : '--'}
          />
          <SummaryCard
            accent={todayCard.accent}
            badge={todayCard.badge}
            eyebrow="今日收益"
            icon={History}
            note={todayCard.note}
            value={todayCard.value}
          />
          <SummaryCard
            accent={summary.totalProfit > 0 ? 'emerald' : summary.totalProfit < 0 ? 'red' : 'slate'}
            badge={<Pill tone={summary.totalProfit > 0 ? 'emerald' : summary.totalProfit < 0 ? 'red' : 'slate'}>{summary.pricedCount}/{summary.positionCount || 0} 已重算</Pill>}
            eyebrow="总收益"
            icon={Database}
            note={summary.latestSnapshotAt ? `最近快照 ${formatDateTimeLabel(summary.latestSnapshotAt)}` : '等待首次净值同步。'}
            value={summary.pricedCount ? formatSignedCurrency(summary.totalProfit) : '--'}
          />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(300px,0.9fr)]">
          <div className="space-y-6">
            <Card className="overflow-hidden rounded-[2rem] border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-0">
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
                <div
                  className={cx(
                    'relative flex min-h-[260px] flex-col justify-between border-b border-indigo-100 p-6 lg:border-b-0 lg:border-r',
                    dragActive && 'bg-indigo-50/80'
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
                  <div>
                    <div className="mb-2 inline-flex rounded-full bg-white/90 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-indigo-500 shadow-sm shadow-indigo-100">
                      OCR 导入区
                    </div>
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">把持仓截图接到当前工作台里</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                      默认导入策略为替换当前组合。识别完成后会先生成草稿，不会静默覆盖你正在维护的持仓表。
                    </p>
                  </div>

                  <button
                    className={cx(
                      'mt-6 flex min-h-[140px] flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-indigo-200 bg-white/80 px-6 py-8 text-center shadow-sm shadow-indigo-100/70 transition-all',
                      dragActive ? 'scale-[1.01] border-indigo-400 bg-indigo-50' : 'hover:-translate-y-0.5 hover:border-indigo-300'
                    )}
                    type="button"
                    onClick={openFilePicker}
                  >
                    {ocrState.status === 'loading' ? (
                      <LoaderCircle className="h-10 w-10 animate-spin text-indigo-500" />
                    ) : (
                      <CloudUpload className="h-10 w-10 text-indigo-500" />
                    )}
                    <div className="mt-4 text-base font-bold text-slate-900">
                      {ocrState.status === 'loading' ? '正在识别截图' : '拖拽或点击上传 PNG / JPG / JPEG'}
                    </div>
                    <div className="mt-2 text-sm text-slate-500">
                      {ocrState.message}
                    </div>
                    {ocrState.status === 'loading' ? (
                      <div className="mt-5 h-2 w-full max-w-xs overflow-hidden rounded-full bg-indigo-100">
                        <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.max(Math.min(ocrState.progress, 100), 0)}%` }} />
                      </div>
                    ) : null}
                  </button>
                </div>

                <div className="flex flex-col justify-between bg-white/70 p-6">
                  <div className="space-y-4">
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <FileImage className="h-4 w-4 text-slate-400" />
                        最近导入
                      </div>
                      <div className="mt-3 text-sm text-slate-500">
                        {importDraft?.fileName || fileName || '尚未导入截图'}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Pill tone={ocrState.status === 'error' ? 'red' : ocrState.status === 'success' ? 'emerald' : ocrState.status === 'loading' ? 'indigo' : 'slate'}>
                          {ocrState.status === 'error' ? '识别失败' : ocrState.status === 'success' ? '草稿已生成' : ocrState.status === 'loading' ? '识别中' : '等待上传'}
                        </Pill>
                        {ocrState.durationMs > 0 ? <Pill tone="slate">{formatDuration(ocrState.durationMs)}</Pill> : null}
                      </div>
                    </div>

                    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <TableProperties className="h-4 w-4 text-slate-400" />
                        导入策略
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-500">
                        本版本默认以“替换当前组合”为主；识别结果会先进入草稿，再由你确认应用。
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row lg:flex-col">
                    <button className={primaryButtonClass} type="button" onClick={openFilePicker}>
                      <Upload className="h-4 w-4" />
                      重新上传截图
                    </button>
                    <button className={secondaryButtonClass} type="button" onClick={handleAddRow}>
                      <Plus className="h-4 w-4" />
                      手动新增一行
                    </button>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="rounded-[2rem] p-6">
              <SectionHeading
                eyebrow="Portfolio Ledger"
                title="持仓明细"
                description="代码、名称、买入均价和持有份数都可手动编辑。修改后会立即重算；代码变化会自动触发净值更新。"
                action={(
                  <>
                    <button className={secondaryButtonClass} type="button" onClick={handleAddRow}>
                      <Plus className="h-4 w-4" />
                      新增持仓
                    </button>
                    <button className={subtleButtonClass} type="button" onClick={handleClearRows}>
                      <Trash2 className="h-4 w-4" />
                      清空全部
                    </button>
                  </>
                )}
              />

              {!hasMeaningfulRows ? (
                <div className="mt-6 rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm shadow-slate-200">
                    <Wallet className="h-6 w-6 text-indigo-500" />
                  </div>
                  <div className="mt-4 text-lg font-bold text-slate-900">当前还没有持仓组合</div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    你可以先上传截图生成导入草稿，也可以直接在下面的空白行录入代码、均价和份数。
                  </p>
                </div>
              ) : null}

              <div className="mt-6 space-y-4">
                {rows.map((editableRow, index) => {
                  const normalizedRow = normalizedRowMap[editableRow.id] || normalizeHoldingRow(editableRow);
                  const errors = rowErrorsById[editableRow.id] || {};
                  const snapshot = snapshotsByCode[normalizedRow.code] || null;
                  const metrics = buildHoldingMetrics(normalizedRow, snapshot);
                  const runtime = rowRuntimeById[editableRow.id] || {};

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
                    <div key={editableRow.id} className="rounded-[1.75rem] border border-slate-200 bg-slate-50/70 p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm shadow-slate-200">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          当前持仓
                        </div>
                        <div className="flex items-center gap-2">
                          <Pill tone={rowStatusTone}>{rowStatusLabel}</Pill>
                          <button
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 transition-colors hover:bg-red-50 hover:text-red-500"
                            type="button"
                            onClick={() => handleDeleteRow(editableRow.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 xl:grid-cols-[1.05fr_1.35fr_1fr_1fr_1.2fr_1fr_1fr]">
                        <label className="space-y-2">
                          <span className="text-xs font-semibold text-slate-500">基金代码</span>
                          <input
                            className={cx(
                              tableInputClass,
                              'border border-slate-200 bg-white hover:border-slate-300',
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
                            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-all hover:border-slate-300 focus:border-indigo-400"
                            placeholder="可选，支持手动补全"
                            value={editableRow.name}
                            onChange={(event) => updateRowField(editableRow.id, 'name', event.target.value)}
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-semibold text-slate-500">买入均价</span>
                          <input
                            className={cx(
                              tableInputClass,
                              'border border-slate-200 bg-white hover:border-slate-300',
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
                              'border border-slate-200 bg-white hover:border-slate-300',
                              errors.shares && 'border-red-200 bg-red-50 focus:border-red-300'
                            )}
                            inputMode="decimal"
                            placeholder="0.00"
                            value={editableRow.shares}
                            onChange={(event) => updateRowField(editableRow.id, 'shares', event.target.value)}
                          />
                        </label>

                        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                          <div className="text-xs font-semibold text-slate-500">最新净值</div>
                          <div className="text-lg font-bold text-slate-900">{formatNav(snapshot?.latestNav)}</div>
                          <div className="text-xs leading-5 text-slate-400">
                            {snapshot?.latestNavDate ? `最新 ${formatDateLabel(snapshot.latestNavDate)}` : '等待净值刷新'}
                            <br />
                            {snapshot?.previousNavDate ? `前值 ${formatDateLabel(snapshot.previousNavDate)}` : '上一交易日待同步'}
                          </div>
                        </div>

                        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                          <div className="text-xs font-semibold text-slate-500">今日收益</div>
                          <div className={cx('text-lg font-bold', metrics.hasLatestNav && metrics.hasPreviousNav ? getProfitTextClass(metrics.todayProfit) : 'text-slate-400')}>
                            {metrics.hasLatestNav && metrics.hasPreviousNav ? formatSignedCurrency(metrics.todayProfit) : '--'}
                          </div>
                          <div className="text-xs leading-5 text-slate-400">
                            公式：(最新净值 - 上一交易日净值) × 份数
                          </div>
                        </div>

                        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                          <div className="text-xs font-semibold text-slate-500">总收益</div>
                          <div className={cx('text-lg font-bold', metrics.hasLatestNav ? getProfitTextClass(metrics.totalProfit) : 'text-slate-400')}>
                            {metrics.hasLatestNav ? formatSignedCurrency(metrics.totalProfit) : '--'}
                          </div>
                          <div className="text-xs leading-5 text-slate-400">
                            当前市值 {metrics.hasLatestNav ? formatCurrency(metrics.marketValue, '¥', 2) : '--'}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                        {rowStatusLabel === '已更新' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : rowStatusLabel === '更新失败' ? <AlertTriangle className="h-4 w-4 text-red-500" /> : rowStatusLabel === '更新中' ? <LoaderCircle className="h-4 w-4 animate-spin text-indigo-500" /> : <Sparkles className="h-4 w-4 text-slate-400" />}
                        <span>{rowStatusNote}</span>
                        {snapshot?.cacheSource ? <Pill tone="slate">{snapshot.cacheHit ? '缓存命中' : '实时更新'}</Pill> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="rounded-[2rem] p-6">
              <SectionHeading
                eyebrow="NAV Sync"
                title="净值同步状态"
                description="组合级今日收益只在全部持仓完成净值拉取后展示最终结果。"
              />

              <div className="mt-5 space-y-4">
                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
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

                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
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
                  <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">成功更新</div>
                    <div className="mt-2 text-2xl font-extrabold text-slate-900">{lastNavMeta.successCount || 0}</div>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
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
            </Card>

            <Card className="rounded-[2rem] p-6">
              <SectionHeading
                eyebrow="OCR Draft"
                title="导入草稿"
                description="识别结果不会直接覆盖当前组合，需要你确认后才会替换。"
              />

              <div className="mt-5 space-y-4">
                {importDraft ? (
                  <>
                    <div className="rounded-[1.5rem] border border-indigo-100 bg-indigo-50 p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-indigo-700">
                        <FileImage className="h-4 w-4" />
                        {importDraft.fileName || '持仓截图'}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Pill tone="indigo">{importDraft.rows.length} 行草稿</Pill>
                        <Pill tone="slate">置信度 {(Number(importDraft.confidence || 0) * 100).toFixed(0)}%</Pill>
                        {importDraft.durationMs > 0 ? <Pill tone="slate">{formatDuration(importDraft.durationMs)}</Pill> : null}
                      </div>
                      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                        <button className={primaryButtonClass} disabled={!importDraft.rows.length} type="button" onClick={handleApplyDraft}>
                          <CheckCircle2 className="h-4 w-4" />
                          用草稿替换当前组合
                        </button>
                        <button className={secondaryButtonClass} type="button" onClick={() => setImportDraft(null)}>
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
                  <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-500">
                    当前没有待确认的 OCR 草稿。上传截图后，完整识别行会先出现在这里，再由你决定是否替换当前组合。
                  </div>
                )}
              </div>
            </Card>

            <Card className="rounded-[2rem] p-6">
              <SectionHeading
                eyebrow="Guide"
                title="操作提示"
                description="延续现有工作台的编辑节奏：先识别，再校正，最后看组合收益。"
              />

              <div className="mt-5 space-y-3">
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-500">
                  只有代码、买入均价、持有份数三项完整时，组合摘要才会纳入该持仓。
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-500">
                  行级状态固定为“更新中 / 已更新 / 更新失败”；组合级今日收益会统一显示“更新中 / 已更新 / 部分更新失败”。
                </div>
                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-500">
                  页面会自动把持仓和最近一次成功净值快照保存在本地，刷新后会继续沿用。
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
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
