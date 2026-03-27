import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudUpload,
  FileImage,
  LoaderCircle,
  Plus,
  Trash2,
  Upload
} from 'lucide-react';
import { formatCurrency } from '../app/accumulation.js';
import {
  buildFundSwitchSummary,
  createEmptyFundSwitchRow,
  deriveFundSwitchComparison,
  FUND_SWITCH_STRATEGIES,
  persistFundSwitchState,
  readFundSwitchState
} from '../app/fundSwitch.js';
import { findLatestNasdaqPrice, formatPriceAsOf, loadLatestNasdaqPrices } from '../app/nasdaqPrices.js';
import {
  Card,
  Field,
  NumberInput,
  PageHero,
  PageShell,
  SectionHeading,
  TextInput,
  cx,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  tableInputClass
} from '../components/experience-ui.jsx';

const FUND_CODE_PATTERN = /^\d{6}$/;
const STRATEGY_LABELS = {
  direct: '直接来源',
  trace: '穿透来源'
};

function createOcrState(overrides = {}) {
  return {
    status: 'idle',
    progress: 0,
    message: '等待上传交易截图。',
    durationMs: 0,
    error: '',
    lineCount: 0,
    ...overrides
  };
}

function getStatusMeta(status) {
  if (status === 'loading') {
    return {
      Icon: LoaderCircle,
      label: '正在识别',
      detail: '正在提取截图中的交易记录，请稍候。',
      colorClass: 'border border-amber-200 bg-amber-50 text-amber-600',
      iconClassName: 'animate-spin'
    };
  }

  if (status === 'error') {
    return {
      Icon: AlertCircle,
      label: '识别失败',
      detail: '请检查截图清晰度，或重新上传交易凭证。',
      colorClass: 'border border-red-200 bg-red-50 text-red-600'
    };
  }

  if (status === 'warning') {
    return {
      Icon: AlertTriangle,
      label: '完成识别 (需复核)',
      detail: '识别结果已回填，但仍有字段建议人工复核。',
      colorClass: 'border border-amber-200 bg-amber-50 text-amber-600'
    };
  }

  if (status === 'success') {
    return {
      Icon: CheckCircle2,
      label: '已完成智能识别',
      detail: '识别结果已成功回填为可编辑交易数据。',
      colorClass: 'border border-emerald-200 bg-emerald-50 text-emerald-600'
    };
  }

  return {
    Icon: Upload,
    label: '待上传截图',
    detail: '支持 PNG / JPG / WebP 格式的交易凭证截图。',
    colorClass: 'border border-slate-200 bg-slate-100 text-slate-600'
  };
}

function formatSignedCurrency(value, prefix = '¥ ') {
  const absoluteValue = formatCurrency(Math.abs(value), prefix);
  if (value > 0) {
    return `+${absoluteValue}`;
  }
  if (value < 0) {
    return `-${absoluteValue}`;
  }
  return absoluteValue;
}

function getAdvantageTone(value) {
  if (value > 0) {
    return { className: 'border border-emerald-200 bg-emerald-50 text-emerald-600', label: '当前领先' };
  }
  if (value < 0) {
    return { className: 'border border-red-200 bg-red-50 text-red-600', label: '当前落后' };
  }
  return { className: 'border border-slate-200 bg-slate-50 text-slate-600', label: '基本持平' };
}

function getFundCodeError(code) {
  const value = String(code || '').trim();
  if (!value) {
    return '';
  }
  return FUND_CODE_PATTERN.test(value) ? '' : '代码必须是 6 位纯数字。';
}

function buildTrackedCodes(comparison = {}) {
  const codeSet = new Set();

  for (const position of comparison.sourcePositions || []) {
    if (position?.code) {
      codeSet.add(position.code);
    }
  }

  for (const position of comparison.targetPositions || []) {
    if (position?.code) {
      codeSet.add(position.code);
    }
  }

  if (comparison.sourceCode) {
    codeSet.add(comparison.sourceCode);
  }

  if (comparison.targetCode) {
    codeSet.add(comparison.targetCode);
  }

  return [...codeSet];
}

function formatPositionMeta(position, snapshot) {
  if (position.currentPrice > 0) {
    const base = `${position.code} · ${position.shares} 份 × ${Number(position.currentPrice).toFixed(4)}`;
    return snapshot ? `${base} · 现价日期 ${formatPriceAsOf(snapshot)}` : `${base} · 手动现价`;
  }

  return `${position.code} · ${position.shares} 份 · 待补现价`;
}

function roundToCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function hasMeaningfulRowContent(row) {
  return Boolean(
    String(row?.date || '').trim()
      || String(row?.code || '').trim()
      || Number(row?.price) > 0
      || Number(row?.shares) > 0
      || Number(row?.amount) > 0
  );
}

function isValidRowDate(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }

  return Number.isFinite(Date.parse(normalized.replace(' ', 'T')));
}

function buildRowValidationIssues(rows = []) {
  const normalizedRows = (Array.isArray(rows) ? rows : []).filter((row) => hasMeaningfulRowContent(row));
  if (!normalizedRows.length) {
    return ['请至少保留一条有效交易记录。'];
  }

  const issues = [];
  normalizedRows.forEach((row, index) => {
    const rowLabel = `第 ${index + 1} 条记录`;
    const price = Number(row?.price) || 0;
    const shares = Number(row?.shares) || 0;
    const amount = Number(row?.amount) || 0;
    const expectedAmount = roundToCurrency(price * shares);

    if (!isValidRowDate(row?.date)) {
      issues.push(`${rowLabel} 日期不完整或格式不正确。`);
    }
    if (getFundCodeError(row?.code)) {
      issues.push(`${rowLabel} 基金代码必须是 6 位纯数字。`);
    }
    if (row?.type !== '买入' && row?.type !== '卖出') {
      issues.push(`${rowLabel} 交易类型不正确。`);
    }
    if (price <= 0) {
      issues.push(`${rowLabel} 价格必须大于 0。`);
    }
    if (shares <= 0) {
      issues.push(`${rowLabel} 份额必须大于 0。`);
    }
    if (amount <= 0) {
      issues.push(`${rowLabel} 成交额不能为空。`);
    } else if (price > 0 && shares > 0 && Math.abs(amount - expectedAmount) > 0.05) {
      issues.push(`${rowLabel} 成交额与价格份额不一致。`);
    }
  });

  return issues;
}

function summarizeValidationIssues(issues = []) {
  if (!issues.length) {
    return '';
  }

  const preview = issues.slice(0, 2).join('；');
  return issues.length > 2 ? `${preview}；另有 ${issues.length - 2} 项待修正。` : preview;
}

function buildOcrPreviewRows(rows = []) {
  const previewRows = rows
    .filter((row) => String(row?.date || '').trim() || String(row?.code || '').trim() || Number(row?.shares) > 0 || Number(row?.price) > 0)
    .slice(0, 3)
    .map((row) => {
      const dateText = String(row?.date || '').trim();
      const priceValue = Number(row?.price) || 0;
      return {
        id: row.id || `${row.code}-${dateText}`,
        code: String(row?.code || '').trim() || '待补代码',
        type: String(row?.type || '').trim() || '--',
        shares: Number(row?.shares) > 0 ? `${row.shares} 份` : '--',
        detail: [dateText || '待补日期', priceValue > 0 ? `@ ${priceValue.toFixed(4)}` : '待补价格'].join(' · ')
      };
    });

  return {
    rows: previewRows,
    hasMore: rows.filter((row) => String(row?.date || '').trim() || String(row?.code || '').trim() || Number(row?.shares) > 0 || Number(row?.price) > 0).length > previewRows.length
  };
}

function StrategyToggle({ strategy, onChange }) {
  return (
    <div className="grid w-full grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1 sm:inline-flex sm:w-auto sm:rounded-full">
      {FUND_SWITCH_STRATEGIES.map((item) => (
        <button
          key={item}
          className={cx(
            'min-h-[40px] rounded-xl px-3 py-2 text-xs font-semibold transition-colors sm:min-h-0 sm:rounded-full sm:py-1.5',
            strategy === item ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
          )}
          type="button"
          onClick={() => onChange(item)}
        >
          {STRATEGY_LABELS[item]}
        </button>
      ))}
    </div>
  );
}

function PositionEditorSection({
  kind,
  positions,
  comparison,
  priceSnapshotByCode,
  onSingleFieldChange,
  onPriceChange
}) {
  const isSource = kind === 'source';
  const title = isSource ? '原持有方案 (不切换)' : '目标切换方案';
  const titleClassName = isSource ? 'border-slate-100 text-slate-700' : 'border-indigo-100 text-indigo-700';
  const singleCode = isSource ? comparison.sourceCode : comparison.targetCode;
  const singleShares = isSource ? comparison.sourceSellShares : comparison.targetBuyShares;
  const singlePrice = isSource ? comparison.sourceCurrentPrice : comparison.targetCurrentPrice;
  const isSingle = positions.length <= 1;

  return (
    <div className="space-y-4">
      <h3 className={cx('border-b pb-2 font-bold', titleClassName)}>{title}</h3>

      {isSingle ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isSource ? '基金代码' : '目标基金代码'}>
            <TextInput value={singleCode} onChange={(event) => onSingleFieldChange(kind, 'code', event.target.value)} placeholder={isSource ? '如 159660' : '如 513100'} />
          </Field>
          <Field label={isSource ? '持有份额' : '换入份额'}>
            <NumberInput step="0.01" value={singleShares} onChange={(event) => onSingleFieldChange(kind, 'shares', event.target.value)} />
          </Field>
          <Field
            className="sm:col-span-2"
            label="当前计算单价"
            helper={singleCode && priceSnapshotByCode[singleCode] ? `(已同步 ${formatPriceAsOf(priceSnapshotByCode[singleCode])} 实时行情)` : '手动输入'}
          >
            <input
              className={cx(
                inputClass,
                singleCode && priceSnapshotByCode[singleCode] ? 'cursor-default border-indigo-200 bg-indigo-50 font-bold text-indigo-700' : ''
              )}
              type="number"
              step="0.0001"
              readOnly={Boolean(singleCode && priceSnapshotByCode[singleCode])}
              disabled={!singleCode}
              value={singlePrice}
              onChange={(event) => onPriceChange(kind, singleCode, event.target.value)}
            />
          </Field>
        </div>
      ) : (
        <div className="space-y-3">
          {positions.map((position) => {
            const snapshot = priceSnapshotByCode[position.code];
            return (
              <div key={`${kind}-${position.code}`} className="grid gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-3">
                <Field label="基金代码">
                  <input className={cx(inputClass, 'bg-white text-slate-700')} readOnly value={position.code} />
                </Field>
                <Field label={isSource ? '来源份额' : '目标份额'}>
                  <input className={cx(inputClass, 'bg-white text-slate-700')} readOnly value={position.shares} />
                </Field>
                <Field label="当前计算单价" helper={snapshot ? `(已同步 ${formatPriceAsOf(snapshot)} 实时行情)` : '手动输入'}>
                  <input
                    className={cx(inputClass, snapshot ? 'cursor-default border-indigo-200 bg-indigo-50 font-bold text-indigo-700' : 'bg-white')}
                    type="number"
                    step="0.0001"
                    readOnly={Boolean(snapshot)}
                    value={position.currentPrice}
                    onChange={(event) => onPriceChange(kind, position.code, event.target.value)}
                  />
                </Field>
              </div>
            );
          })}
          <p className="text-xs leading-6 text-slate-500">多基金来源场景下，代码和份额由上方交易明细回放生成；如需调整，请修改交易明细后重新点击“确认数据与收益”。</p>
        </div>
      )}
    </div>
  );
}

function SummaryValueCard({ value, advantageMeta, strategy, onStrategyChange }) {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-indigo-100 bg-gradient-to-br from-white via-indigo-50 to-indigo-100/80 p-5 shadow-sm sm:p-6">
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-900/45">Conclusion</div>
            <div className="mt-2 text-sm font-semibold text-indigo-900/65">切换额外收益 (元)</div>
          </div>
          <span className={cx('rounded-full px-3 py-1 text-xs font-bold', advantageMeta.className)}>{advantageMeta.label}</span>
        </div>

        <div className="text-4xl font-extrabold tracking-tight text-indigo-700 sm:text-[2.75rem]">{value}</div>
        <p className="text-xs font-medium leading-6 text-indigo-900/45">真实额外收益 = 切换后现值 - 不切换现值 - 额外补入现金 - 手续费</p>
        <StrategyToggle strategy={strategy} onChange={onStrategyChange} />
      </div>
    </div>
  );
}

function PositionValueCard({ title, value, positions, priceSnapshotByCode, emptyText }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</div>
      <div className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">{value}</div>
      <div className="mt-3 space-y-2 text-[11px] leading-5 text-slate-500">
        {positions.length ? (
          positions.map((position) => (
            <div key={`${title}-${position.code}`} className="rounded-xl bg-white px-3 py-2 text-slate-500 shadow-sm shadow-slate-100/60">
              {formatPositionMeta(position, priceSnapshotByCode[position.code])}
            </div>
          ))
        ) : (
          <div className="rounded-xl bg-white px-3 py-2 text-slate-400 shadow-sm shadow-slate-100/60">{emptyText}</div>
        )}
      </div>
    </div>
  );
}

function CompactMetricCard({ title, value, note, tone = 'slate' }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm shadow-slate-100/70">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{title}</div>
      <div className={cx('mt-2 text-xl font-extrabold tracking-tight', tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-red-500' : 'text-slate-900')}>
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-5 text-slate-400">{note}</div>
    </div>
  );
}

function TransactionEditorCard({ row, index, codeError, onUpdateRow, onRemoveRow }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50/90 p-4 shadow-sm shadow-slate-100/70">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">记录 {String(index + 1).padStart(2, '0')}</div>
          <div className="mt-2 text-xs font-semibold text-slate-500">成交额</div>
          <div className="mt-1 text-lg font-extrabold tracking-tight text-slate-800">{formatCurrency(row.amount, '¥ ')}</div>
        </div>
        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-500"
          type="button"
          onClick={() => onRemoveRow(index)}
          title="删除记录"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <Field label="日期">
          <input className={cx(inputClass, 'bg-white')} placeholder="YYYY-MM-DD" value={row.date} onChange={(event) => onUpdateRow(index, 'date', event.target.value)} />
        </Field>

        <Field label="基金代码" helper={codeError || '基金代码为 6 位纯数字。'}>
          <input
            className={cx(
              inputClass,
              'bg-white',
              codeError ? 'border-red-300 text-red-900 placeholder:text-red-300 focus:border-red-500' : ''
            )}
            placeholder="纯数字代码"
            value={row.code}
            onChange={(event) => onUpdateRow(index, 'code', event.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="交易类型">
            <select
              className={cx(
                inputClass,
                row.type === '卖出'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              )}
              value={row.type}
              onChange={(event) => onUpdateRow(index, 'type', event.target.value)}
            >
              <option value="卖出">卖出</option>
              <option value="买入">买入</option>
            </select>
          </Field>
          <Field label="价格">
            <input
              className={cx(inputClass, 'bg-white')}
              step="0.0001"
              type="number"
              placeholder="0.0000"
              value={row.price}
              onChange={(event) => onUpdateRow(index, row.type === '卖出' ? 'sellPrice' : 'buyPrice', event.target.value)}
            />
          </Field>
        </div>

        <Field label="份额 (股数)">
          <input className={cx(inputClass, 'bg-white')} step="0.01" type="number" placeholder="0.00" value={row.shares} onChange={(event) => onUpdateRow(index, 'shares', event.target.value)} />
        </Field>
      </div>
    </div>
  );
}

function CompactOcrStatusCard({ fileName, statusMeta, recognizedCount, resultConfirmed, previewRows, hasMorePreviewRows, onReupload, onEdit }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">OCR Status</div>
            <div className="mt-2 truncate text-base font-bold text-slate-800">{fileName || '未命名文件'}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold', statusMeta.colorClass)}>
              <statusMeta.Icon className={cx('h-4 w-4', statusMeta.iconClassName)} />
              {statusMeta.label}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
              {recognizedCount} 条记录
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className={cx('rounded-full px-2.5 py-1 font-semibold', resultConfirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
            {resultConfirmed ? '已生成结果摘要' : '待确认识别明细'}
          </span>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">OCR 结果预览</div>
          {previewRows.length ? (
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-100 bg-white">
              {previewRows.map((row) => (
                <div key={row.id} className="border-b border-slate-100 last:border-b-0">
                  <div className="grid grid-cols-[1.1fr,0.8fr,1fr] gap-3 px-3 py-2.5 text-sm font-semibold text-slate-700">
                    <div className="truncate">{row.code}</div>
                    <div className={cx('truncate', row.type === '卖出' ? 'text-emerald-600' : row.type === '买入' ? 'text-red-600' : 'text-slate-500')}>{row.type}</div>
                    <div className="truncate text-right">{row.shares}</div>
                  </div>
                  <div className="truncate px-3 pb-2.5 text-[11px] leading-5 text-slate-400">{row.detail}</div>
                </div>
              ))}
              {hasMorePreviewRows ? (
                <div className="px-3 py-2 text-center text-sm font-semibold text-slate-400">...</div>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-sm text-slate-400">OCR 结果会在这里显示。</div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button className={secondaryButtonClass} type="button" onClick={onReupload}>
            <Upload className="h-4 w-4" />
            重新上传
          </button>
          <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100" type="button" onClick={onEdit}>
            修改识别明细
          </button>
        </div>
      </div>
    </Card>
  );
}

function PendingResultCard({ issueSummary, onEdit }) {
  return (
    <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 sm:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-white p-2 text-amber-600 shadow-sm shadow-amber-100">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-700/70">Pending Confirmation</div>
            <div className="mt-2 text-lg font-bold text-amber-900">请先确认识别明细</div>
            <div className="mt-2 text-sm leading-6 text-amber-900/75">
              {issueSummary || '交易明细校验通过后，系统才会生成结果摘要。'}
            </div>
          </div>
        </div>

        <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100" type="button" onClick={onEdit}>
          修改识别明细
        </button>
      </div>
    </div>
  );
}

function EditingSummaryStrip({ strategy, recognizedCount, onExit }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Edit Mode</div>
          <div className="mt-2 text-sm font-semibold text-slate-500">正在编辑识别明细，确认后会重新计算摘要结果。</div>
        </div>
        <button className="inline-flex items-center gap-2 self-start rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200 sm:self-auto" type="button" onClick={onExit}>
          返回摘要
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-slate-50 px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">状态</div>
          <div className="mt-1 text-sm font-extrabold text-slate-800">待确认</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">策略</div>
          <div className="mt-1 text-sm font-extrabold text-slate-800">{STRATEGY_LABELS[strategy]}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">条目</div>
          <div className="mt-1 text-sm font-extrabold text-slate-800">{recognizedCount}</div>
        </div>
      </div>
    </Card>
  );
}

export function FundSwitchExperience({ links, inPagesDir }) {
  const [state, setState] = useState(() => readFundSwitchState());
  const [ocrState, setOcrState] = useState(() => createOcrState());
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [showCalculationDetails, setShowCalculationDetails] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [priceState, setPriceState] = useState(() => ({ status: 'idle', entries: [], error: '' }));
  const fileInputRef = useRef(null);

  const trackedCodes = useMemo(() => buildTrackedCodes(state.comparison), [state.comparison]);
  const priceSnapshotByCode = useMemo(
    () => Object.fromEntries(
      trackedCodes
        .map((code) => [code, findLatestNasdaqPrice(priceState.entries, code)])
        .filter(([, snapshot]) => Boolean(snapshot))
    ),
    [trackedCodes, priceState.entries]
  );

  const summary = useMemo(
    () => buildFundSwitchSummary(state, {
      getCurrentPrice: (code) => Number(priceSnapshotByCode[code]?.current_price) || 0
    }),
    [state, priceSnapshotByCode]
  );
  const recognizedCount = summary.validRecordCount;
  const hasImportedData = Boolean(state.fileName) || recognizedCount > 0;
  const effectiveOcrStatus = hasImportedData && ocrState.status === 'idle' ? 'success' : ocrState.status;
  const effectiveOcrMessage = hasImportedData && ocrState.status === 'idle'
    ? `已同步 ${recognizedCount} 条记录，可继续确认收益或修改明细。`
    : ocrState.message;
  const ocrPreview = useMemo(() => buildOcrPreviewRows(summary.rows), [summary.rows]);
  const validationIssues = useMemo(() => buildRowValidationIssues(summary.rows), [summary.rows]);
  const validationIssueSummary = useMemo(() => summarizeValidationIssues(validationIssues), [validationIssues]);
  const statusMeta = getStatusMeta(effectiveOcrStatus);
  const advantageMeta = getAdvantageTone(summary.switchAdvantage);
  const shouldShowBottomAdvantage = state.resultConfirmed && !isEditingDetails;
  const bottomAdvantageText = shouldShowBottomAdvantage ? formatSignedCurrency(summary.switchAdvantage, '¥ ') : '待重算';
  const bottomAdvantageTone = shouldShowBottomAdvantage
    ? (summary.switchAdvantage >= 0 ? 'text-emerald-600' : 'text-red-600')
    : 'text-slate-500';

  useEffect(() => {
    persistFundSwitchState({ ...state, comparison: summary.comparison }, summary);
  }, [state, summary]);

  useEffect(() => {
    let cancelled = false;
    setPriceState((current) => ({ status: current.entries.length ? 'success' : 'loading', entries: current.entries, error: '' }));

    loadLatestNasdaqPrices({ inPagesDir })
      .then((entries) => {
        if (cancelled) {
          return;
        }
        setPriceState({ status: 'success', entries, error: '' });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setPriceState({ status: 'error', entries: [], error: error instanceof Error ? error.message : '加载失败。' });
      });

    return () => {
      cancelled = true;
    };
  }, [inPagesDir]);

  function updateComparisonScalar(key, value) {
    setConfirmError('');
    setState((current) => ({
      ...current,
      comparison: {
        ...current.comparison,
        [key]: ['switchCost', 'extraCash', 'feeTradeCount'].includes(key) ? Number(value) || 0 : value
      }
    }));
  }

  function updateSinglePosition(kind, field, value) {
    setConfirmError('');
    setState((current) => {
      const isSource = kind === 'source';
      const codeKey = isSource ? 'sourceCode' : 'targetCode';
      const sharesKey = isSource ? 'sourceSellShares' : 'targetBuyShares';
      const positionsKey = isSource ? 'sourcePositions' : 'targetPositions';
      const nextCode = field === 'code' ? String(value || '').trim() : String(current.comparison?.[codeKey] || '').trim();
      const nextShares = field === 'shares' ? Number(value) || 0 : Number(current.comparison?.[sharesKey]) || 0;

      return {
        ...current,
        comparison: {
          ...current.comparison,
          [codeKey]: nextCode,
          [sharesKey]: nextShares,
          [positionsKey]: nextCode && nextShares > 0 ? [{ code: nextCode, shares: nextShares }] : []
        }
      };
    });
  }

  function updatePriceOverride(kind, code, value) {
    setConfirmError('');
    setState((current) => {
      const normalizedCode = String(code || '').trim();
      const nextValue = Number(value) || 0;
      const nextPriceOverrides = { ...(current.comparison?.priceOverrides || {}) };

      if (normalizedCode) {
        if (nextValue > 0) {
          nextPriceOverrides[normalizedCode] = nextValue;
        } else {
          delete nextPriceOverrides[normalizedCode];
        }
      }

      const nextComparison = {
        ...current.comparison,
        priceOverrides: nextPriceOverrides
      };

      if (kind === 'source' && current.comparison?.sourceCode === normalizedCode) {
        nextComparison.sourceCurrentPrice = nextValue;
      }

      if (kind === 'target' && current.comparison?.targetCode === normalizedCode) {
        nextComparison.targetCurrentPrice = nextValue;
      }

      return {
        ...current,
        comparison: nextComparison
      };
    });
  }

  function updateStrategy(strategy) {
    setConfirmError('');
    setState((current) => ({
      ...current,
      comparison: deriveFundSwitchComparison(current.rows, { ...current.comparison, strategy }, strategy)
    }));
  }

  function updateFeePerTrade(value) {
    setConfirmError('');
    setState((current) => ({ ...current, feePerTrade: Number(value) || 0 }));
  }

  function updateRow(index, key, value) {
    setConfirmError('');
    setState((current) => {
      const nextRows = [...current.rows];
      const currentRow = nextRows[index] || createEmptyFundSwitchRow();
      const nextRow = {
        ...currentRow,
        [key]: ['buyPrice', 'sellPrice', 'shares'].includes(key) ? Number(value) || 0 : value
      };

      if (key === 'type') {
        const nextType = value === '卖出' ? '卖出' : '买入';
        const previousActivePrice = currentRow.type === '卖出' ? Number(currentRow.sellPrice) || 0 : Number(currentRow.buyPrice) || 0;
        nextRow.type = nextType;
        if (nextType === '买入' && !nextRow.buyPrice && previousActivePrice) {
          nextRow.buyPrice = previousActivePrice;
        }
        if (nextType === '卖出' && !nextRow.sellPrice && previousActivePrice) {
          nextRow.sellPrice = previousActivePrice;
        }
      }

      const activePrice = nextRow.type === '卖出' ? Number(nextRow.sellPrice) || 0 : Number(nextRow.buyPrice) || 0;
      const activeShares = Number(nextRow.shares) || 0;
      nextRow.price = activePrice;
      nextRow.amount = activePrice > 0 && activeShares > 0 ? roundToCurrency(activePrice * activeShares) : 0;
      nextRows[index] = nextRow;
      return { ...current, rows: nextRows, recognizedRecords: nextRows.length, resultConfirmed: false };
    });
  }

  function removeRow(index) {
    setConfirmError('');
    setState((current) => {
      const nextRows = current.rows.filter((_, rowIndex) => rowIndex !== index);
      const safeRows = nextRows.length ? nextRows : [createEmptyFundSwitchRow()];
      return { ...current, rows: safeRows, recognizedRecords: safeRows.length, resultConfirmed: false };
    });
  }

  function addRow() {
    setConfirmError('');
    setState((current) => {
      const nextRows = [...current.rows, createEmptyFundSwitchRow()];
      return {
        ...current,
        rows: nextRows,
        recognizedRecords: nextRows.length,
        resultConfirmed: false
      };
    });
  }

  async function processOcrFile(file) {
    setOcrState(createOcrState({ status: 'loading', progress: 12, message: '准备上传截图' }));
    try {
      const { recognizeFundSwitchFile } = await import('../app/fundSwitchOcr.js');
      const result = await recognizeFundSwitchFile(file, state.comparison, (progress) => {
        setOcrState((current) => createOcrState({ ...current, ...progress }));
      });

      const parsedRows = result.rows.length ? result.rows : [createEmptyFundSwitchRow()];
      setState((current) => ({
        ...current,
        fileName: file.name,
        recognizedRecords: result.recordCount || parsedRows.length,
        resultConfirmed: false,
        rows: parsedRows,
        comparison: {
          ...current.comparison,
          ...result.comparison
        }
      }));
      setConfirmError('');
      setIsEditingDetails(false);
      setShowCalculationDetails(false);

      if (result.rows.length) {
        const hasWarnings = Array.isArray(result.warnings) && result.warnings.length > 0;
        setOcrState(createOcrState({
          status: hasWarnings ? 'warning' : 'success',
          progress: 100,
          durationMs: result.durationMs,
          lineCount: result.recordCount || result.rows.length,
          message: hasWarnings ? `已提取 ${result.rows.length} 条记录，请复核。` : `提取完成，已解析 ${result.rows.length} 条记录。`
        }));
      } else {
        setOcrState(createOcrState({
          status: 'warning',
          progress: 100,
          durationMs: result.durationMs,
          lineCount: 0,
          message: '未能解析出记录。'
        }));
      }
    } catch (error) {
      setOcrState(createOcrState({
        status: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : '提取失败',
        message: '服务异常'
      }));
    }
  }

  function handleFileInputChange(event) {
    const file = event.target.files?.[0];
    if (file) {
      void processOcrFile(file);
    }
    event.target.value = '';
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function openDetailEditor() {
    setIsEditingDetails(true);
    setShowCalculationDetails(false);
  }

  function closeDetailEditor() {
    setIsEditingDetails(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void processOcrFile(file);
    }
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  function handleConfirmDataAndYield() {
    if (validationIssues.length) {
      setConfirmError(summarizeValidationIssues(validationIssues));
      setIsEditingDetails(true);
      setShowCalculationDetails(false);
      return;
    }

    setConfirmError('');
    setState((current) => ({
      ...current,
      comparison: deriveFundSwitchComparison(current.rows, current.comparison),
      recognizedRecords: current.rows.length,
      resultConfirmed: true
    }));
    setIsEditingDetails(false);
    setShowCalculationDetails(false);
  }

  return (
    <PageShell>
      <input ref={fileInputRef} accept="image/*" hidden onChange={handleFileInputChange} type="file" />

      <PageHero
        backHref={links.catalog || './catalog.html'}
        backLabel="返回页面目录"
        eyebrow="Fund Switch Assistant"
        title="基金切换收益助手"
        description="上传交易截图后，系统会智能识别整理成可编辑交易数据，并按 direct / trace 两种来源策略比较切换前后的真实收益。"
        badges={hasImportedData ? [] : [
          <span key="status" className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold', statusMeta.colorClass)}>
            <statusMeta.Icon className={cx('h-4 w-4', statusMeta.iconClassName)} />
            {statusMeta.label}
          </span>
        ]}
        actions={!hasImportedData ? (
          <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={openFilePicker}>
            <Upload className="h-4 w-4" />
            上传截图
          </button>
        ) : null}
      />

      <div className="mx-auto max-w-6xl space-y-4 px-4 pt-6 sm:space-y-6 sm:px-6 sm:pt-8">
        {!hasImportedData ? (
          <Card className="flex flex-col p-4 sm:p-6">
            <SectionHeading eyebrow="OCR Import" title="交易凭证导入" description={statusMeta.detail} />

            <button
              className={cx(
                'mt-5 flex min-h-[200px] flex-1 flex-col items-center justify-center rounded-[28px] border-2 border-dashed p-5 text-center transition-all sm:mt-6 sm:min-h-[220px] sm:rounded-[24px] sm:p-6',
                ocrState.status === 'loading' ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:border-indigo-400 hover:bg-slate-50'
              )}
              onClick={openFilePicker}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              type="button"
            >
              {ocrState.status === 'loading' ? (
                <LoaderCircle className="mb-3 h-10 w-10 animate-spin text-indigo-500" />
              ) : (
                <CloudUpload className="mb-3 h-10 w-10 text-slate-400" />
              )}
              <div className="font-semibold text-slate-700">点击或拖拽上传截图</div>
              <div className="mt-1 text-xs text-slate-500">支持 PNG, JPG, WebP 格式</div>
              {ocrState.status === 'idle' ? null : (
                <div className="mt-4 w-full max-w-xs">
                  <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>识别进度</span>
                    <span className="text-indigo-600">{ocrState.progress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: `${ocrState.progress}%` }} />
                  </div>
                </div>
              )}
            </button>

            {(ocrState.status !== 'idle' || state.fileName) && (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <FileImage className="h-8 w-8 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-700">{state.fileName || '未命名文件'}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{effectiveOcrMessage}</div>
                  {ocrState.error ? <div className="mt-2 text-xs text-red-500">{ocrState.error}</div> : null}
                  {priceState.status === 'error' ? <div className="mt-2 text-xs text-amber-600">{priceState.error}</div> : null}
                </div>
              </div>
            )}
          </Card>
        ) : isEditingDetails ? (
          <>
            <EditingSummaryStrip
              strategy={summary.strategy}
              recognizedCount={recognizedCount}
              onExit={closeDetailEditor}
            />

            <Card className="overflow-hidden p-0">
              <div className="flex flex-col justify-between gap-4 border-b border-slate-200 bg-white p-4 sm:p-6 md:flex-row md:items-center">
                <SectionHeading
                  eyebrow="Editable Data"
                  title="交易数据明细"
                  description="识别结果需要修正时，在这里集中修改；确认后会自动重新计算摘要结果。"
                />
                <div className="grid w-full grid-cols-2 gap-3 md:flex md:w-auto md:items-center">
                  <button className={cx(secondaryButtonClass, 'w-full')} type="button" onClick={closeDetailEditor}>
                    返回摘要
                  </button>
                  <button className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100" type="button" onClick={addRow}>
                    <Plus className="h-4 w-4" />
                    新增条目
                  </button>
                </div>
              </div>

              {confirmError ? (
                <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600 sm:px-6">
                  {confirmError}
                </div>
              ) : null}

              <div className="space-y-3 p-4 md:hidden">
                {summary.rows.map((row, index) => (
                  <TransactionEditorCard
                    key={row.id}
                    row={row}
                    index={index}
                    codeError={getFundCodeError(row.code)}
                    onUpdateRow={updateRow}
                    onRemoveRow={removeRow}
                  />
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full whitespace-nowrap text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-6 py-4 font-semibold">日期</th>
                      <th className="px-6 py-4 font-semibold">基金代码</th>
                      <th className="px-6 py-4 font-semibold">交易类型</th>
                      <th className="px-6 py-4 font-semibold">价格</th>
                      <th className="px-6 py-4 font-semibold">份额 (股数)</th>
                      <th className="px-6 py-4 font-semibold">成交额</th>
                      <th className="w-16 px-6 py-4 text-right font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {summary.rows.map((row, index) => {
                      const codeError = getFundCodeError(row.code);
                      return (
                        <tr key={row.id} className="group transition-colors hover:bg-slate-50/50">
                          <td className="px-6 py-3">
                            <input className={cx(tableInputClass, 'w-36')} placeholder="YYYY-MM-DD" value={row.date} onChange={(event) => updateRow(index, 'date', event.target.value)} />
                          </td>
                          <td className="px-6 py-3">
                            <div className="relative">
                              <input
                                className={cx(
                                  tableInputClass,
                                  'w-32',
                                  codeError ? 'border-red-300 text-red-900 focus:border-red-500' : 'border-transparent'
                                )}
                                placeholder="纯数字代码"
                                value={row.code}
                                onChange={(event) => updateRow(index, 'code', event.target.value)}
                              />
                              {codeError ? <div className="absolute left-0 top-10 z-10 rounded bg-red-600 px-2 py-1 text-[10px] text-white shadow-sm">{codeError}</div> : null}
                            </div>
                          </td>
                          <td className="px-6 py-3">
                            <select
                              className={cx(
                                'rounded-lg border px-3 py-2 pr-8 text-sm font-semibold outline-none transition-all',
                                row.type === '卖出'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                              )}
                              value={row.type}
                              onChange={(event) => updateRow(index, 'type', event.target.value)}
                            >
                              <option value="卖出">卖出</option>
                              <option value="买入">买入</option>
                            </select>
                          </td>
                          <td className="px-6 py-3">
                            <input className={cx(tableInputClass, 'w-28')} step="0.0001" type="number" placeholder="0.0000" value={row.price} onChange={(event) => updateRow(index, row.type === '卖出' ? 'sellPrice' : 'buyPrice', event.target.value)} />
                          </td>
                          <td className="px-6 py-3">
                            <input className={cx(tableInputClass, 'w-32')} step="0.01" type="number" placeholder="0.00" value={row.shares} onChange={(event) => updateRow(index, 'shares', event.target.value)} />
                          </td>
                          <td className="px-6 py-3">
                            <div className="w-28 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 font-semibold text-slate-600">{formatCurrency(row.amount, '¥ ')}</div>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <button className="rounded-lg p-2 text-slate-400 opacity-0 transition-colors group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 focus:opacity-100" type="button" onClick={() => removeRow(index)} title="删除记录">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[1.1fr,1.9fr]">
              <CompactOcrStatusCard
                fileName={state.fileName}
                statusMeta={statusMeta}
                recognizedCount={recognizedCount}
                resultConfirmed={state.resultConfirmed}
                previewRows={ocrPreview.rows}
                hasMorePreviewRows={ocrPreview.hasMore}
                onReupload={openFilePicker}
                onEdit={openDetailEditor}
              />

              <Card className="p-4 sm:p-6">
                <SectionHeading eyebrow={state.resultConfirmed ? 'Conclusion' : 'Pending'} title={state.resultConfirmed ? '当前切换判断' : '等待确认识别明细'} />

                <div className="mt-5 space-y-3 sm:space-y-4">
                  {state.resultConfirmed ? (
                    <>
                      <SummaryValueCard
                        value={formatSignedCurrency(summary.switchAdvantage, '')}
                        advantageMeta={advantageMeta}
                        strategy={summary.strategy}
                        onStrategyChange={updateStrategy}
                      />

                      <div className="grid gap-3 lg:grid-cols-2">
                        <PositionValueCard
                          title="不切换现值"
                          value={formatCurrency(summary.stayValue, '¥ ')}
                          positions={summary.sourcePositions}
                          priceSnapshotByCode={priceSnapshotByCode}
                          emptyText="尚未回放出来源持仓，请先确认交易数据。"
                        />
                        <PositionValueCard
                          title="切换后现值"
                          value={formatCurrency(summary.switchedValue, '¥ ')}
                          positions={summary.targetPositions}
                          priceSnapshotByCode={priceSnapshotByCode}
                          emptyText="尚未回放出目标持仓，请先确认交易数据。"
                        />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <CompactMetricCard
                          title="现持仓浮盈"
                          value={formatSignedCurrency(summary.switchedPositionProfit, '¥ ')}
                          note="现值 - 成本 - 手续费"
                          tone={summary.switchedPositionProfit >= 0 ? 'positive' : 'negative'}
                        />
                        <CompactMetricCard title="预估处理金额" value={formatCurrency(summary.processedAmount, '¥ ')} note="已识别记录累计成交额" />
                      </div>
                    </>
                  ) : (
                    <PendingResultCard issueSummary={confirmError || validationIssueSummary} onEdit={openDetailEditor} />
                  )}
                </div>

                {state.resultConfirmed && summary.missingPriceCodes.length ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                    以下基金暂未匹配到现价，请在下方参数面板中手动补入：{summary.missingPriceCodes.join('、')}
                  </div>
                ) : null}
              </Card>
            </div>

            {state.resultConfirmed ? (
              <Card className="overflow-hidden p-0">
                <div className="flex cursor-pointer flex-col gap-4 border-b border-slate-200 bg-slate-50 p-4 transition-colors hover:bg-slate-100 sm:flex-row sm:items-center sm:justify-between sm:p-6" onClick={() => setShowCalculationDetails((current) => !current)}>
                  <SectionHeading eyebrow="Parameters" title="计算详细参数预设" description="默认保持收起，只有在需要补现价或校准参数时再展开修改。" />
                  <button className="flex items-center gap-2 self-start text-sm font-semibold text-slate-500 transition-colors hover:text-slate-800 sm:self-auto" type="button">
                    {showCalculationDetails ? '收起面板' : '展开修改'}
                    {showCalculationDetails ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                  </button>
                </div>

                {showCalculationDetails ? (
                  <div className="space-y-6 bg-white p-4 sm:space-y-8 sm:p-6">
                    <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">来源策略</div>
                        <div className="mt-1 text-sm text-slate-600">切换 direct / trace 会重新按交易链路回放当前来源仓位。</div>
                      </div>
                      <StrategyToggle strategy={summary.strategy} onChange={updateStrategy} />
                    </div>

                    <div className="grid gap-6 xl:grid-cols-2">
                      <PositionEditorSection
                        kind="source"
                        positions={summary.sourcePositions}
                        comparison={summary.comparison}
                        priceSnapshotByCode={priceSnapshotByCode}
                        onSingleFieldChange={updateSinglePosition}
                        onPriceChange={updatePriceOverride}
                      />

                      <PositionEditorSection
                        kind="target"
                        positions={summary.targetPositions}
                        comparison={summary.comparison}
                        priceSnapshotByCode={priceSnapshotByCode}
                        onSingleFieldChange={updateSinglePosition}
                        onPriceChange={updatePriceOverride}
                      />
                    </div>

                    <div className="border-t border-slate-100 pt-6">
                      <SectionHeading eyebrow="Cost Adjustments" title="切换成本调整项" />
                      <div className="mt-5 grid gap-4 xl:grid-cols-3 xl:gap-6">
                        <label className="block rounded-xl border border-slate-100 bg-slate-50 p-4">
                          <span className="block text-sm font-bold text-slate-700">额外补入现金 (元)</span>
                          <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">direct 模式只累计当前目标仓位的直接补现金；trace 会继续把中间链路补现金穿透累加。</span>
                          <input className="mt-3 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-800 outline-none transition-all focus:border-indigo-400" type="number" step="0.01" value={summary.comparison.extraCash} onChange={(event) => updateComparisonScalar('extraCash', event.target.value)} />
                        </label>

                        <label className="block rounded-xl border border-slate-100 bg-slate-50 p-4">
                          <span className="block text-sm font-bold text-slate-700">目标仓位原始成本 (元)</span>
                          <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">这里是当前剩余目标仓位的成本合计，默认由 lot 回放自动生成，必要时可以人工校准。</span>
                          <input className="mt-3 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-800 outline-none transition-all focus:border-indigo-400" type="number" step="0.01" value={summary.comparison.switchCost} onChange={(event) => updateComparisonScalar('switchCost', event.target.value)} />
                        </label>

                        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                          <span className="block text-sm font-bold text-slate-700">预估交易手续费 (元)</span>
                          <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">默认同步为当前明细记录行数，可继续手动校准。</span>
                          <div className="mt-3 flex items-center gap-2">
                            <input className="h-11 w-20 rounded-lg border border-slate-200 bg-white px-2 text-center font-semibold text-slate-800 outline-none transition-all focus:border-indigo-400" type="number" step="0.01" placeholder="单笔" value={summary.feePerTrade} onChange={(event) => updateFeePerTrade(event.target.value)} />
                            <span className="text-xs font-bold text-slate-400">×</span>
                            <div className="relative flex-1">
                              <input className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-semibold text-slate-800 outline-none transition-all focus:border-indigo-400" type="number" step="1" value={summary.comparison.feeTradeCount} onChange={(event) => updateComparisonScalar('feeTradeCount', event.target.value)} />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">笔</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </Card>
            ) : (
              <Card className="p-4 sm:p-6">
                <SectionHeading eyebrow="Parameters" title="计算详细参数预设" description="请先确认 OCR 识别明细，校验通过后再生成和调整参数。" />
              </Card>
            )}
          </>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/85 p-3 shadow-[0_-4px_24px_rgba(0,0,0,0.04)] backdrop-blur-md sm:p-4">
        <div className="mx-auto max-w-6xl">
          {hasImportedData ? (
            <>
              <div className={cx('mb-3 grid gap-2 sm:hidden', shouldShowBottomAdvantage ? 'grid-cols-3' : 'grid-cols-2')}>
                <div className="rounded-2xl bg-slate-100 px-3 py-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">条目</div>
                  <div className="mt-1 text-sm font-extrabold text-slate-700">{recognizedCount}</div>
                </div>
                <div className="rounded-2xl bg-slate-100 px-3 py-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{isEditingDetails ? '状态' : '策略'}</div>
                  <div className="mt-1 text-sm font-extrabold text-slate-700">{isEditingDetails || !state.resultConfirmed ? '待确认' : STRATEGY_LABELS[summary.strategy]}</div>
                </div>
                {shouldShowBottomAdvantage ? (
                  <div className="rounded-2xl bg-slate-100 px-3 py-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">额外收益</div>
                    <div className={cx('mt-1 text-sm font-extrabold', bottomAdvantageTone)}>
                      {bottomAdvantageText}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="hidden items-center gap-6 sm:flex">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">识别条目</div>
                    <div className="mt-1 text-sm font-extrabold text-slate-700">{recognizedCount}</div>
                  </div>
                  <div className="h-8 w-px bg-slate-200" />
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{isEditingDetails ? '当前状态' : '当前策略'}</div>
                    <div className="mt-1 text-sm font-extrabold text-slate-700">{isEditingDetails || !state.resultConfirmed ? '待确认' : STRATEGY_LABELS[summary.strategy]}</div>
                  </div>
                  {shouldShowBottomAdvantage ? (
                    <>
                      <div className="h-8 w-px bg-slate-200" />
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">当前额外收益</div>
                        <div className={cx('mt-1 text-sm font-extrabold', bottomAdvantageTone)}>
                          {bottomAdvantageText}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>

                {isEditingDetails ? (
                  <div className="grid w-full gap-3 sm:flex sm:w-auto sm:items-center">
                    <button className={cx(secondaryButtonClass, 'w-full sm:flex-none')} type="button" onClick={closeDetailEditor}>
                      返回摘要
                    </button>
                    <button className={cx(primaryButtonClass, 'w-full whitespace-nowrap sm:flex-none')} type="button" onClick={handleConfirmDataAndYield}>
                      确认修改并重新计算
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="grid w-full gap-3 sm:flex sm:w-auto sm:items-center">
                    <button className={cx(primaryButtonClass, 'w-full sm:flex-none')} type="button" onClick={handleConfirmDataAndYield}>
                      {state.resultConfirmed ? '确认数据与收益' : '校验并生成结果'}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-500">上传交易截图后，系统会自动识别并生成切换收益摘要。</div>
              <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={openFilePicker}>
                上传截图
                <Upload className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
