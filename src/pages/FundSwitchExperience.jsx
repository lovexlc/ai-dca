import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CloudUpload,
  FileImage,
  FolderOpen,
  History,
  LoaderCircle,
  Plus,
  Sparkles,
  SlidersHorizontal,
  TableProperties,
  Trash2,
  Upload
} from 'lucide-react';
import { formatCurrency } from '../app/accumulation.js';
import {
  buildFundSwitchStateFromHistoryEntry,
  buildFundSwitchSummary,
  createDefaultFundSwitchState,
  createEmptyFundSwitchRow,
  deleteFundSwitchHistoryEntry,
  deriveFundSwitchComparison,
  FUND_SWITCH_STRATEGIES,
  persistFundSwitchState,
  readFundSwitchHistory,
  readFundSwitchState,
  saveFundSwitchHistoryEntry
} from '../app/fundSwitch.js';
import { findLatestNasdaqPrice, formatPriceAsOf, loadLatestNasdaqPrices } from '../app/nasdaqPrices.js';
import {
  Card,
  Field,
  NumberInput,
  PageHero,
  PageShell,
  PageTabs,
  Pill,
  SectionHeading,
  TextInput,
  cx,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  subtleButtonClass,
  tableInputClass
} from '../components/experience-ui.jsx';
import { getPrimaryTabs } from '../app/screens.js';
import { showActionToast } from '../app/toast.js';

const FUND_CODE_PATTERN = /^\d{6}$/;
const OCR_MAX_FILE_SIZE = 10 * 1024 * 1024;
const STRATEGY_LABELS = {
  trace: '追溯最初买入',
  direct: '只看最后一次'
};
const STRATEGY_DESCRIPTIONS = {
  trace: '推荐。把中间几次换仓一起算进去，更接近“如果当初不换，现在值多少”。',
  direct: '只判断最后一步换仓是否划算，不追溯更早的来源基金。'
};
const LANDING_SCROLL_PANELS = [
  [
    {
      duration: '22s',
      delay: '-8s',
      items: [
        '如果当初不换，现在值多少？',
        '换到现在这只后，当前多赚还是少赚？',
        '中间补进去的钱算进去了吗？',
        '哪几笔识别结果需要我手动改？'
      ]
    },
    {
      duration: '26s',
      delay: '-5s',
      items: [
        '来源仓位到底是从哪只基金来的？',
        '只看最后一次还是追溯最初买入？',
        'OCR 识别错的代码和份额可以改吗？',
        '现价同步到了哪一天？'
      ]
    },
    {
      duration: '20s',
      delay: '-11s',
      items: [
        '如果不换，现在会比现在多多少？',
        '手续费和额外补入现金算进去了吗？',
        '保存过的分析还能直接重算吗？',
        '这次换仓现在到底赚了还是亏了？'
      ]
    }
  ],
  [
    {
      duration: '22s',
      delay: '-13s',
      items: [
        '识别截图里的买入和卖出记录',
        '自动回放来源仓位和目标仓位',
        '按最新价格重算当前切换收益',
        '保存历史分析，后续一键打开重算'
      ]
    },
    {
      duration: '26s',
      delay: '-9s',
      items: [
        '修改识别明细后可以立刻重新计算',
        '来源基金会按你的收益口径回溯',
        '切换成本和手续费都可以手动校准',
        '历史记录点开就会用最新价格重算'
      ]
    },
    {
      duration: '20s',
      delay: '-6s',
      items: [
        '当前不切换现值是多少？',
        '当前换后现值是多少？',
        '哪条识别记录需要人工复核？',
        '收益摘要会自动保存进历史吗？'
      ]
    }
  ]
];
const LANDING_MOBILE_SCROLL_ROWS = [
  LANDING_SCROLL_PANELS[0][0],
  LANDING_SCROLL_PANELS[1][1],
  LANDING_SCROLL_PANELS[0][2]
];
const WORKSPACE_PANELS = [
  { key: 'details', label: '识别明细', Icon: TableProperties },
  { key: 'summary', label: '收益摘要', Icon: Sparkles },
  { key: 'settings', label: '计算参数', Icon: SlidersHorizontal },
  { key: 'history', label: '历史分析', Icon: History }
];

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
    detail: '支持常见图片格式的交易凭证截图。',
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

function formatDateTimeLabel(value = '') {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) {
    return '--';
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

function getFundCodeError(code) {
  const value = String(code || '').trim();
  if (!value) {
    return '';
  }
  return FUND_CODE_PATTERN.test(value) ? '' : '代码必须是 6 位纯数字。';
}

function validateOcrUploadFile(file) {
  if (!file || typeof file !== 'object') {
    throw new Error('未找到要上传的截图。');
  }

  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('当前仅支持常见图片格式。');
  }

  if (Number(file.size) > OCR_MAX_FILE_SIZE) {
    throw new Error('图片请控制在 10MB 内。');
  }
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
    const base = `${position.code}，${position.shares} 份，单价 ${Number(position.currentPrice).toFixed(4)}`;
    return snapshot ? `${base}，现价日期 ${formatPriceAsOf(snapshot)}` : `${base}，手动现价`;
  }

  return `${position.code}，${position.shares} 份，待补现价`;
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

function StrategyToggle({ strategy, onChange }) {
  return (
    <div className="grid w-full grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1 sm:inline-flex sm:w-auto sm:rounded-full">
      {FUND_SWITCH_STRATEGIES.map((item) => (
        <button
          key={item}
          className={cx(
            'min-h-[40px] rounded-xl px-3 py-2 text-xs font-semibold leading-tight transition-colors sm:min-h-0 sm:rounded-full sm:py-1.5',
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
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] sm:p-7">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">当前收益判断</div>
            <div className="mt-2 text-sm font-semibold text-slate-500">切换额外收益 (元)</div>
          </div>
          <span className={cx('rounded-full px-3 py-1 text-xs font-bold', advantageMeta.className)}>{advantageMeta.label}</span>
        </div>

        <div className={cx(
          'text-5xl font-extrabold tracking-tight sm:text-[3.25rem]',
          value.startsWith('-') ? 'text-red-600' : value.startsWith('+') ? 'text-emerald-600' : 'text-slate-900'
        )}>
          {value}
        </div>

        <p className="max-w-2xl text-sm leading-7 text-slate-500">真实额外收益 = 切换后现值 - 不切换现值 - 额外补入现金 - 手续费</p>

        <div className="flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">当前收益口径</div>
            <div className="mt-1 text-sm font-bold text-slate-900">{STRATEGY_LABELS[strategy]}</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{STRATEGY_DESCRIPTIONS[strategy]}</p>
          </div>
          <StrategyToggle strategy={strategy} onChange={onStrategyChange} />
        </div>
      </div>
    </div>
  );
}

function PositionValueCard({ title, value, positions, priceSnapshotByCode, emptyText }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_12px_36px_rgba(15,23,42,0.04)]">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{title}</div>
      <div className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">{value}</div>
      <div className="mt-4 space-y-2 text-[11px] leading-5 text-slate-500">
        {positions.length ? (
          positions.map((position) => (
            <div key={`${title}-${position.code}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-600">
              {formatPositionMeta(position, priceSnapshotByCode[position.code])}
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-slate-400">{emptyText}</div>
        )}
      </div>
    </div>
  );
}

function CompactMetricCard({ title, value, note, tone = 'slate' }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{title}</div>
      <div className={cx('mt-2 text-xl font-extrabold tracking-tight', tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-red-500' : 'text-slate-900')}>
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-5 text-slate-400">{note}</div>
    </div>
  );
}

function HistoryRecordCard({ entry, isActive, onOpen, onDelete }) {
  const savedAdvantageTone = getAdvantageTone(entry.snapshot.switchAdvantage);

  return (
    <div className={cx(
      'rounded-[24px] border p-4 transition-colors sm:p-5',
      isActive ? 'border-indigo-200 bg-indigo-50/60' : 'border-slate-200 bg-slate-50/80'
    )}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-white text-slate-500'
            )}>
              <History className="h-3.5 w-3.5" />
              {isActive ? '当前打开' : '历史记录'}
            </span>
            <span className={cx('rounded-full px-2.5 py-1 text-[11px] font-semibold', savedAdvantageTone.className)}>
              {STRATEGY_LABELS[entry.snapshot.strategy]}
            </span>
          </div>

          <div className="mt-3 text-base font-bold text-slate-900">{entry.title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            上次保存 {formatDateTimeLabel(entry.updatedAt)} · {entry.snapshot.recordCount} 条记录
            {entry.fileName ? ` · ${entry.fileName}` : ''}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-100 bg-white px-3 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">上次记录额外收益</div>
              <div className={cx(
                'mt-1 text-sm font-extrabold',
                entry.snapshot.switchAdvantage > 0 ? 'text-emerald-600' : entry.snapshot.switchAdvantage < 0 ? 'text-red-500' : 'text-slate-700'
              )}>
                {formatSignedCurrency(entry.snapshot.switchAdvantage, '¥ ')}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white px-3 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">上次记录不切换现值</div>
              <div className="mt-1 text-sm font-extrabold text-slate-700">{formatCurrency(entry.snapshot.stayValue, '¥ ')}</div>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white px-3 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">上次记录切换后现值</div>
              <div className="mt-1 text-sm font-extrabold text-slate-700">{formatCurrency(entry.snapshot.switchedValue, '¥ ')}</div>
            </div>
          </div>

          <p className="mt-3 text-xs leading-5 text-slate-500">重新打开后，会直接按当前最新价格重算，不沿用当时保存时的旧价格。</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <button className={cx(primaryButtonClass, 'w-full whitespace-nowrap sm:w-auto')} type="button" onClick={() => onOpen(entry)}>
            <FolderOpen className="h-4 w-4" />
            打开重算
          </button>
          <button
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 sm:w-auto"
            type="button"
            onClick={() => onDelete(entry.id)}
          >
            <Trash2 className="h-4 w-4" />
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function FundSwitchHistorySection({ entries, activeEntryId, onOpen, onDelete }) {
  return (
    <Card>
      <SectionHeading eyebrow="收益分析历史" title="历史分析" />

      {entries.length ? (
        <div className="mt-6 space-y-3">
          {entries.map((entry) => (
            <HistoryRecordCard
              key={entry.id}
              entry={entry}
              isActive={activeEntryId === entry.id}
              onOpen={onOpen}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm leading-6 text-slate-500">
          暂无历史分析。
        </div>
      )}
    </Card>
  );
}

function LandingQuestionChip({ children }) {
  return (
    <div className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-slate-200 bg-[#f5f5f7] px-3.5 py-2 text-[13px] font-medium text-slate-600 shadow-[0_0_10px_rgba(15,23,42,0.08),0_1px_3px_rgba(15,23,42,0.05)]">
      {children}
    </div>
  );
}

function LandingQuestionWall({ rows, className = '' }) {
  return (
    <div aria-hidden="true" className={cx('landing-question-wall flex flex-col gap-2.5 overflow-hidden', className)}>
      {rows.map((row, index) => (
        <div key={`${row.duration}-${index}`} className="landing-question-row overflow-hidden">
          <div
            className="landing-question-row-inner"
            style={{
              animationDuration: row.duration,
              animationDelay: row.delay
            }}
          >
            {[...row.items, ...row.items].map((item, itemIndex) => (
              <LandingQuestionChip key={`${index}-${itemIndex}-${item}`}>{item}</LandingQuestionChip>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkspaceNavButton({ panel, active, onSelect, badge = '' }) {
  const { key, label, Icon } = panel;

  return (
    <button
      className={cx(
        'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all',
        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900'
      )}
      type="button"
      onClick={() => onSelect(key)}
    >
      <Icon className="h-4 w-4" />
      {label}
      {badge ? (
        <span className={cx('rounded-full px-2 py-0.5 text-[10px] font-bold', active ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500')}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function ReadonlyTransactionsTable({ rows = [] }) {
  const meaningfulRows = rows.filter((row) => hasMeaningfulRowContent(row));

  if (!meaningfulRows.length) {
    return (
      <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center text-sm leading-6 text-slate-500">
        识别完成后，这里会像工作表一样展示回填后的交易明细。
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-100/80">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">已回填交易表</div>
        </div>
        <div className="text-xs text-slate-500">{meaningfulRows.length} 条识别记录</div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full whitespace-nowrap text-left text-sm">
          <thead className="border-b border-slate-200 bg-white text-xs uppercase tracking-[0.14em] text-slate-400">
            <tr>
              <th className="px-4 py-3 font-semibold">日期</th>
              <th className="px-4 py-3 font-semibold">基金代码</th>
              <th className="px-4 py-3 font-semibold">交易类型</th>
              <th className="px-4 py-3 font-semibold">价格</th>
              <th className="px-4 py-3 font-semibold">份额</th>
              <th className="px-4 py-3 font-semibold">成交额</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {meaningfulRows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50/80">
                <td className="px-4 py-3 font-medium text-slate-700">{row.date || '--'}</td>
                <td className="px-4 py-3 font-semibold text-slate-900">{row.code || '--'}</td>
                <td className="px-4 py-3">
                  <span className={cx(
                    'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold',
                    row.type === '卖出' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                  )}>
                    {row.type || '--'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{Number(row.price) > 0 ? Number(row.price).toFixed(4) : '--'}</td>
                <td className="px-4 py-3 text-slate-600">{Number(row.shares) > 0 ? row.shares : '--'}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{Number(row.amount) > 0 ? formatCurrency(row.amount, '¥ ') : '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SidebarQuickStat({ label, value, tone = 'slate' }) {
  return (
    <div className={cx(
      'flex items-center justify-between gap-3 rounded-2xl border px-3 py-3',
      tone === 'positive' ? 'border-emerald-200 bg-emerald-50/70' : tone === 'negative' ? 'border-red-200 bg-red-50/70' : 'border-slate-200 bg-slate-50'
    )}>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className={cx(
        'text-sm font-extrabold text-right',
        tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-red-600' : 'text-slate-800'
      )}>
        {value}
      </div>
    </div>
  );
}

function AnalysisWorkspaceSidebar({
  fileName,
  statusMeta,
  effectiveOcrMessage,
  ocrState,
  recognizedCount,
  resultConfirmed,
  summary,
  validationIssueSummary,
  onReupload,
  onEdit,
  onReset,
  onShowSummary,
  onShowHistory,
  historyEntries = []
}) {
  const latestHistoryEntries = historyEntries.slice(0, 3);
  const hasConfirmedResult = resultConfirmed;
  const quickTone = summary.switchAdvantage > 0 ? 'positive' : summary.switchAdvantage < 0 ? 'negative' : 'slate';

  return (
    <aside className="flex h-full flex-col gap-4 bg-slate-50/55 p-4 sm:p-5">
      <button className="inline-flex items-center gap-2 self-start text-sm font-semibold text-slate-500 transition-colors hover:text-slate-800" type="button" onClick={onReset}>
        返回上传入口
      </button>

      <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500">
            <FileImage className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">当前文档</div>
            <div className="mt-2 truncate text-sm font-bold text-slate-900">{fileName || '未命名文件'}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold', statusMeta.colorClass)}>
                <statusMeta.Icon className={cx('h-4 w-4', statusMeta.iconClassName)} />
                {statusMeta.label}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">
                {recognizedCount} 条记录
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-white p-2 text-indigo-600 ring-1 ring-slate-200">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900">
                {hasConfirmedResult ? '当前收益判断已生成' : '识别明细已回填，等待你确认'}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {hasConfirmedResult ? effectiveOcrMessage : validationIssueSummary || effectiveOcrMessage}
              </p>
              {ocrState.durationMs > 0 ? (
                <div className="mt-2 text-xs font-semibold text-slate-400">OCR 用时约 {(ocrState.durationMs / 1000).toFixed(1)} 秒</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2.5">
          <SidebarQuickStat label="当前口径" value={hasConfirmedResult ? STRATEGY_LABELS[summary.strategy] : '待确认'} />
          <SidebarQuickStat
            label="切换额外收益"
            value={hasConfirmedResult ? formatSignedCurrency(summary.switchAdvantage, '¥ ') : '待生成'}
            tone={hasConfirmedResult ? quickTone : 'slate'}
          />
          <SidebarQuickStat label="不切换现值" value={hasConfirmedResult ? formatCurrency(summary.stayValue, '¥ ') : '--'} />
          <SidebarQuickStat label="换后现值" value={hasConfirmedResult ? formatCurrency(summary.switchedValue, '¥ ') : '--'} />
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
        <button className={cx(primaryButtonClass, 'w-full')} type="button" onClick={hasConfirmedResult ? onShowSummary : onEdit}>
          {hasConfirmedResult ? '查看收益摘要' : '去确认识别明细'}
        </button>
        <button className={cx(subtleButtonClass, 'w-full')} type="button" onClick={onEdit}>
          修改识别明细
        </button>
        <button className={cx(subtleButtonClass, 'w-full')} type="button" onClick={onReupload}>
          重新上传
        </button>
        <button className={cx(subtleButtonClass, 'w-full')} type="button" onClick={onShowHistory}>
          历史分析
        </button>
      </div>

      {latestHistoryEntries.length ? (
        <div className="rounded-[28px] border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">最近历史</div>
              <div className="mt-1 text-sm font-bold text-slate-900">可以直接打开后重算</div>
            </div>
            <Pill tone="slate">{historyEntries.length} 条</Pill>
          </div>

          <div className="mt-4 space-y-3">
            {latestHistoryEntries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="truncate text-sm font-semibold text-slate-800">{entry.title}</div>
                <div className="mt-1 text-xs text-slate-400">{formatDateTimeLabel(entry.updatedAt)}</div>
                <div className="mt-2 text-xs font-semibold text-slate-500">
                  上次结果 {formatSignedCurrency(entry.snapshot.switchAdvantage, '¥ ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
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
          <input className={cx(inputClass, 'bg-white')} placeholder="例如 2026-03-29" value={row.date} onChange={(event) => onUpdateRow(index, 'date', event.target.value)} />
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

function PendingResultCard({ issueSummary, onEdit }) {
  return (
    <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-5 sm:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-white p-2 text-amber-600 shadow-sm shadow-amber-100">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-700/70">待确认</div>
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

export function FundSwitchExperience({ links, inPagesDir, embedded = false }) {
  const [state, setState] = useState(() => readFundSwitchState());
  const [historyEntries, setHistoryEntries] = useState(() => readFundSwitchHistory());
  const [ocrState, setOcrState] = useState(() => createOcrState());
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [activeWorkspacePanel, setActiveWorkspacePanel] = useState(() => (state.resultConfirmed ? 'summary' : 'details'));
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
  const validationIssues = useMemo(() => buildRowValidationIssues(summary.rows), [summary.rows]);
  const validationIssueSummary = useMemo(() => summarizeValidationIssues(validationIssues), [validationIssues]);
  const statusMeta = getStatusMeta(effectiveOcrStatus);
  const primaryTabs = getPrimaryTabs(links);
  const advantageMeta = getAdvantageTone(summary.switchAdvantage);

  useEffect(() => {
    persistFundSwitchState({ ...state, comparison: summary.comparison }, summary);
  }, [state, summary]);

  function refreshHistoryEntries() {
    setHistoryEntries(readFundSwitchHistory());
  }

  function buildSummaryWithLatestPrices(nextState) {
    return buildFundSwitchSummary(nextState, {
      getCurrentPrice: (code) => Number(findLatestNasdaqPrice(priceState.entries, code)?.current_price) || 0
    });
  }

  function saveAnalysisToHistory(nextState) {
    const nextSummary = buildSummaryWithLatestPrices(nextState);
    const savedEntry = saveFundSwitchHistoryEntry(nextState, nextSummary);
    refreshHistoryEntries();
    return savedEntry;
  }

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
    try {
      validateOcrUploadFile(file);
      setOcrState(createOcrState({ status: 'loading', progress: 12, message: '准备上传截图' }));
      setActiveWorkspacePanel('details');
      const { recognizeFundSwitchFile } = await import('../app/fundSwitchOcr.js');
      const result = await recognizeFundSwitchFile(file, state.comparison, (progress) => {
        setOcrState((current) => createOcrState({ ...current, ...progress }));
      });

      const parsedRows = result.rows.length ? result.rows : [createEmptyFundSwitchRow()];
      setState((current) => ({
        ...current,
        historyEntryId: '',
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
      setActiveWorkspacePanel('details');

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

  function resetToUploadEntry() {
    setState(createDefaultFundSwitchState());
    setOcrState(createOcrState());
    setConfirmError('');
    setIsEditingDetails(false);
    setActiveWorkspacePanel('details');
  }

  function openDetailEditor() {
    setIsEditingDetails(true);
    setActiveWorkspacePanel('details');
  }

  function closeDetailEditor() {
    setIsEditingDetails(false);
    setActiveWorkspacePanel(state.resultConfirmed ? 'summary' : 'details');
  }

  function selectWorkspacePanel(panelKey) {
    setActiveWorkspacePanel(panelKey);
    if (panelKey !== 'details') {
      setIsEditingDetails(false);
    }
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
    const actionLabel = isEditingDetails
      ? '确认修改并重新计算'
      : state.resultConfirmed
        ? '确认数据与收益'
        : '校验并生成结果';

    if (validationIssues.length) {
      const message = summarizeValidationIssues(validationIssues);
      setConfirmError(message);
      setIsEditingDetails(true);
      showActionToast(actionLabel, 'error', {
        description: message
      });
      return;
    }

    setConfirmError('');
    const nextComparison = deriveFundSwitchComparison(state.rows, state.comparison);
    const nextState = {
      ...state,
      comparison: nextComparison,
      recognizedRecords: state.rows.length,
      resultConfirmed: true
    };
    const savedEntry = saveAnalysisToHistory(nextState);
    setState({
      ...nextState,
      historyEntryId: savedEntry?.id || nextState.historyEntryId
    });
    setIsEditingDetails(false);
    setActiveWorkspacePanel('summary');
    showActionToast(actionLabel, 'success');
  }

  function openHistoryAnalysis(entry) {
    const nextState = buildFundSwitchStateFromHistoryEntry(entry);
    setState(nextState);
    setOcrState(createOcrState({
      status: 'success',
      progress: 100,
      message: '已从历史载入，将按当前最新价格重新分析。',
      lineCount: nextState.recognizedRecords
    }));
    setConfirmError('');
    setIsEditingDetails(false);
    setActiveWorkspacePanel('summary');
    showActionToast('打开历史分析', 'success', {
      description: '已载入历史记录，当前页面会直接用最新价格重算。'
    });
  }

  function removeHistoryAnalysis(entryId) {
    deleteFundSwitchHistoryEntry(entryId);
    refreshHistoryEntries();
    if (state.historyEntryId === entryId) {
      setState((current) => ({ ...current, historyEntryId: '' }));
    }
    showActionToast('删除历史分析', 'success');
  }

  const detailsPanel = isEditingDetails ? (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="可编辑工作表"
        title="交易数据明细"
        description="识别结果需要修正时，在这里直接改。确认后会立刻按最新价格重新计算收益。"
        action={(
          <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto">
            <button className={cx(secondaryButtonClass, 'w-full')} type="button" onClick={closeDetailEditor}>
              返回摘要
            </button>
            <button className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 sm:w-auto" type="button" onClick={addRow}>
              <Plus className="h-4 w-4" />
              新增条目
            </button>
          </div>
        )}
      />

      {confirmError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {confirmError}
        </div>
      ) : null}

      <div className="space-y-3 md:hidden">
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

      <div className="hidden overflow-hidden rounded-[24px] border border-slate-200 bg-white md:block">
        <div className="overflow-x-auto">
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
                      <input className={cx(tableInputClass, 'w-36')} placeholder="例如 2026-03-29" value={row.date} onChange={(event) => updateRow(index, 'date', event.target.value)} />
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
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={closeDetailEditor}>
          返回摘要
        </button>
        <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={handleConfirmDataAndYield}>
          确认修改并重新计算
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  ) : (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="识别明细"
        title="OCR 回填结果"
        description="上传后的第一步先确认这里。它会像工作表一样把每条买入、卖出、价格和份额铺开。"
        action={(
          <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={openDetailEditor}>
            修改识别明细
          </button>
        )}
      />

      {confirmError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {confirmError}
        </div>
      ) : null}

      {!state.resultConfirmed && validationIssueSummary ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {validationIssueSummary}
        </div>
      ) : null}

      <ReadonlyTransactionsTable rows={summary.rows} />

      <div className="grid gap-3 lg:grid-cols-3">
        <CompactMetricCard title="识别条目" value={`${recognizedCount} 条`} note="有效买卖记录数量" />
        <CompactMetricCard title="预估处理金额" value={formatCurrency(summary.processedAmount, '¥ ')} note="按当前识别结果汇总" />
        <CompactMetricCard title="当前状态" value={state.resultConfirmed ? '已生成收益' : '待确认'} note={state.resultConfirmed ? '可以继续改口径或补现价' : '确认后才会生成收益判断'} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={openDetailEditor}>
          修改识别明细
        </button>
        <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={handleConfirmDataAndYield}>
          {state.resultConfirmed ? '确认数据与收益' : '校验并生成结果'}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const summaryPanel = state.resultConfirmed ? (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="收益摘要"
        title="当前切换判断"
        description="这里直接回答两个问题：如果不换，现在值多少；换成现在这只后，当前值多少。"
        action={(
          <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => selectWorkspacePanel('settings')}>
            去调计算参数
          </button>
        )}
      />

      <SummaryValueCard
        value={formatSignedCurrency(summary.switchAdvantage, '')}
        advantageMeta={advantageMeta}
        strategy={summary.strategy}
        onStrategyChange={updateStrategy}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <PositionValueCard
          title="如果不换，现在值多少"
          value={formatCurrency(summary.stayValue, '¥ ')}
          positions={summary.sourcePositions}
          priceSnapshotByCode={priceSnapshotByCode}
          emptyText="尚未回放出来源持仓，请先确认交易数据。"
        />
        <PositionValueCard
          title="换到现在这只后，值多少"
          value={formatCurrency(summary.switchedValue, '¥ ')}
          positions={summary.targetPositions}
          priceSnapshotByCode={priceSnapshotByCode}
          emptyText="尚未回放出目标持仓，请先确认交易数据。"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <CompactMetricCard
          title="现持仓浮盈"
          value={formatSignedCurrency(summary.switchedPositionProfit, '¥ ')}
          note="现值 - 成本 - 手续费"
          tone={summary.switchedPositionProfit >= 0 ? 'positive' : 'negative'}
        />
        <CompactMetricCard title="预估处理金额" value={formatCurrency(summary.processedAmount, '¥ ')} note="已识别记录累计成交额" />
        <CompactMetricCard title="额外补入现金" value={formatCurrency(summary.comparison.extraCash, '¥ ')} note="已计入最终真实额外收益" />
      </div>

      {state.resultConfirmed && summary.missingPriceCodes.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          以下基金暂未匹配到现价，请到“计算参数”里手动补入：{summary.missingPriceCodes.join('、')}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={openDetailEditor}>
          修改识别明细
        </button>
        <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={handleConfirmDataAndYield}>
          确认数据与收益
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  ) : (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="收益摘要"
        title="等待确认识别明细"
        description="收益摘要不会先猜结果。先把识别明细确认下来，再生成切换判断。"
      />
      <PendingResultCard issueSummary={confirmError || validationIssueSummary} onEdit={openDetailEditor} />
      <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => selectWorkspacePanel('details')}>
        去看识别明细
      </button>
    </div>
  );

  const settingsPanel = state.resultConfirmed ? (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="计算参数"
        title="收益口径与价格校准"
        description="默认推荐“追溯最初买入”。只有在你要补现价、切换口径或校准成本时，才需要改这里。"
      />

      <div className="flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">收益口径</div>
          <div className="mt-1 text-sm leading-6 text-slate-600">推荐口径会沿交易链往前追，把中间换仓和补入现金一起算进去；另一档只看最后一次换仓。</div>
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

      {priceState.status === 'error' ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {priceState.error}
        </div>
      ) : null}

      <div className="border-t border-slate-100 pt-6">
        <SectionHeading eyebrow="成本调整" title="切换成本调整项" />
        <div className="mt-5 grid gap-4 xl:grid-cols-3 xl:gap-6">
          <label className="block rounded-xl border border-slate-100 bg-slate-50 p-4">
            <span className="block text-sm font-bold text-slate-700">额外补入现金 (元)</span>
            <span className="mt-1 block text-[10px] leading-relaxed text-slate-500">推荐口径会把中间换仓时补进去的钱一起算上；“只看最后一次”只统计最后一跳补的钱。</span>
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

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={openDetailEditor}>
          修改识别明细
        </button>
        <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={handleConfirmDataAndYield}>
          确认数据与收益
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  ) : (
    <div className="space-y-5">
      <SectionHeading eyebrow="计算参数" title="收益口径与价格校准" description="请先确认识别明细，校验通过后再生成和调整参数。" />
      <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm leading-6 text-slate-500">
        先去“识别明细”里确认交易数据，然后这里才会开放收益口径、现价补录和成本校准。
      </div>
      <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => selectWorkspacePanel('details')}>
        去确认识别明细
      </button>
    </div>
  );

  const historyPanel = (
    <div className="space-y-5">
      <FundSwitchHistorySection
        entries={historyEntries}
        activeEntryId={state.historyEntryId}
        onOpen={openHistoryAnalysis}
        onDelete={removeHistoryAnalysis}
      />
    </div>
  );

  const content = !hasImportedData ? (
    <div className="mx-auto max-w-6xl space-y-10 px-5 pt-12 sm:px-8 sm:pt-16">
      <div className="overflow-hidden rounded-[40px] border border-transparent bg-transparent shadow-none">
        <div className="relative px-8 py-14 sm:px-14 sm:py-18">
          <div className="relative mx-auto max-w-4xl text-center">
            <Pill tone="indigo" className="!bg-transparent !px-0 !py-0 !text-slate-400">
              基金切换收益分析
            </Pill>
            <h2 className="mx-auto mt-6 max-w-3xl text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
              上传截图，直接重算基金切换收益
            </h2>
          </div>

          <div className="relative mx-auto mt-16 max-w-6xl">
            <div className="xl:hidden">
              <LandingQuestionWall className="mx-auto mb-8 max-w-2xl" rows={LANDING_MOBILE_SCROLL_ROWS} />
            </div>

            <div className="hidden xl:block">
              <LandingQuestionWall className="absolute left-0 top-1/2 w-[300px] -translate-y-1/2" rows={LANDING_SCROLL_PANELS[0]} />
              <LandingQuestionWall className="absolute right-0 top-1/2 w-[300px] -translate-y-1/2" rows={LANDING_SCROLL_PANELS[1]} />
            </div>

            <div className="mx-auto w-full max-w-[456px] rounded-[32px] bg-white/58 p-7 shadow-[0_12px_32px_rgba(15,23,42,0.06)] backdrop-blur-xl sm:p-8 xl:relative xl:z-10">
              <div className="text-center">
                <div className={cx(
                  'mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] shadow-sm shadow-slate-200/40',
                  ocrState.status === 'loading' ? 'bg-indigo-50/90 text-indigo-600' : 'bg-white/80 text-slate-500'
                )}>
                  {ocrState.status === 'loading' ? <LoaderCircle className="h-7 w-7 animate-spin" /> : <CloudUpload className="h-7 w-7" />}
                </div>
                <div className="mt-5 text-xl font-extrabold tracking-tight text-slate-900">上传基金交易截图</div>
                <div className="mt-2 text-sm text-slate-500">支持常见图片格式，10MB 内</div>
              </div>

              <button
                className={cx(
                  'mt-7 flex min-h-[208px] w-full flex-col items-center justify-center rounded-[24px] border border-dashed p-6 text-center transition-all',
                  ocrState.status === 'loading'
                    ? 'border-indigo-200/80 bg-indigo-50/70'
                    : 'border-slate-300/70 bg-white/44 hover:border-slate-400/70 hover:bg-white/58'
                )}
                onClick={openFilePicker}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                type="button"
              >
                {ocrState.status === 'loading' ? (
                  <LoaderCircle className="mb-4 h-9 w-9 animate-spin text-indigo-500" />
                ) : (
                  <CloudUpload className="mb-4 h-9 w-9 text-slate-400" />
                )}
                <div className="text-base font-semibold text-slate-700">点击或拖拽上传</div>
                <div className="mt-2 text-xs font-medium text-slate-400">PNG / JPG / JPEG</div>
                {ocrState.status === 'idle' ? null : (
                  <div className="mt-5 w-full max-w-xs">
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

              <button
                className="mt-5 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-[0_12px_28px_rgba(79,70,229,0.26)] transition-all hover:-translate-y-0.5 hover:bg-indigo-700"
                type="button"
                onClick={openFilePicker}
              >
                上传截图
                <Upload className="h-4 w-4" />
              </button>

              {(ocrState.status !== 'idle' || state.fileName) && (
                <div className="mt-5 flex items-start gap-3 rounded-[24px] bg-white/52 px-4 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
                  <FileImage className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-semibold text-slate-700">{state.fileName || '未命名文件'}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{effectiveOcrMessage}</div>
                    {ocrState.error ? <div className="mt-2 text-xs text-red-500">{ocrState.error}</div> : null}
                    {priceState.status === 'error' ? <div className="mt-2 text-xs text-amber-600">{priceState.error}</div> : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div>
        <FundSwitchHistorySection
          entries={historyEntries}
          activeEntryId={state.historyEntryId}
          onOpen={openHistoryAnalysis}
          onDelete={removeHistoryAnalysis}
        />
      </div>
    </div>
  ) : (
    <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
      <div className="overflow-hidden rounded-[36px] border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.08)]">
        <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">基金切换收益工作台</div>
              <div className="mt-2 text-xl font-extrabold tracking-tight text-slate-900">{state.fileName || '当前上传截图'}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold', statusMeta.colorClass)}>
                <statusMeta.Icon className={cx('h-4 w-4', statusMeta.iconClassName)} />
                {statusMeta.label}
              </span>
              <Pill tone="slate">{recognizedCount} 条记录</Pill>
              <Pill tone={priceState.status === 'error' ? 'amber' : 'emerald'}>
                {priceState.status === 'error' ? '行情未同步' : '已按最新价格重算'}
              </Pill>
            </div>
          </div>
        </div>

        <div className="grid xl:min-h-[760px] xl:grid-cols-[310px,minmax(0,1fr)]">
          <div className="border-b border-slate-200 bg-slate-50/55 xl:border-b-0 xl:border-r">
            <AnalysisWorkspaceSidebar
              fileName={state.fileName}
              statusMeta={statusMeta}
              effectiveOcrMessage={effectiveOcrMessage}
              ocrState={ocrState}
              recognizedCount={recognizedCount}
              resultConfirmed={state.resultConfirmed}
              summary={summary}
              validationIssueSummary={validationIssueSummary}
              onReupload={openFilePicker}
              onEdit={openDetailEditor}
              onReset={resetToUploadEntry}
              onShowSummary={() => selectWorkspacePanel('summary')}
              onShowHistory={() => selectWorkspacePanel('history')}
              historyEntries={historyEntries}
            />
          </div>

          <div className="min-w-0 bg-white">
            <div className="border-b border-slate-200 bg-slate-50/55 px-4 py-4 sm:px-6">
              <div className="flex flex-wrap gap-2">
                {WORKSPACE_PANELS.map((panel) => (
                  <WorkspaceNavButton
                    key={panel.key}
                    panel={panel}
                    active={activeWorkspacePanel === panel.key}
                    onSelect={selectWorkspacePanel}
                    badge={panel.key === 'details' ? String(recognizedCount) : panel.key === 'history' ? String(historyEntries.length) : ''}
                  />
                ))}
              </div>
            </div>

            <div className="p-5 sm:p-7">
              {activeWorkspacePanel === 'details' ? detailsPanel : null}
              {activeWorkspacePanel === 'summary' ? summaryPanel : null}
              {activeWorkspacePanel === 'settings' ? settingsPanel : null}
              {activeWorkspacePanel === 'history' ? historyPanel : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return (
      <>
        <input ref={fileInputRef} accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden onChange={handleFileInputChange} type="file" />
        {content}
      </>
    );
  }

  return (
    <PageShell>
      <input ref={fileInputRef} accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden onChange={handleFileInputChange} type="file" />

      <PageHero
        backHref={links.home}
        backLabel="返回加仓计划"
        eyebrow="基金切换分析"
        title="基金切换收益助手"
        description="上传截图后自动计算基金切换收益。"
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
      >
        <PageTabs activeKey="fundSwitch" tabs={primaryTabs} />
      </PageHero>

      {content}
    </PageShell>
  );
}
