// FundSwitch (换仓分析) 页的叶子展示组件与工作流辅助函数。
// 从 FundSwitchExperience.jsx 抽离，全部为无状态呈现组件。
import { AlertTriangle, FolderOpen, History, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../app/accumulation.js';
import { FUND_SWITCH_STRATEGIES } from '../../app/fundSwitch.js';
import {
  STRATEGY_DESCRIPTIONS,
  STRATEGY_LABELS,
  formatDateTimeLabel,
  formatPositionMeta,
  formatSignedCurrency,
  getAdvantageTone
} from '../../app/fundSwitchHelpers.js';
import { formatPriceAsOf } from '../../app/nasdaqPrices.js';
import {
  Card,
  Field,
  NumberInput,
  Pill,
  SectionHeading,
  TextInput,
  cx,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass
} from '../../components/experience-ui.jsx';

export function StrategyToggle({ strategy, onChange }) {
  return (
    <div className="grid w-full grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1 sm:inline-flex sm:w-auto sm:rounded-full">
      {FUND_SWITCH_STRATEGIES.map((item) => (
        <button
          key={item}
          className={cx(
            'min-h-[40px] rounded-xl px-3 py-2 text-xs font-semibold leading-tight transition-colors sm:min-h-0 sm:rounded-full sm:py-1.5',
            strategy === item ? 'border border-slate-300 bg-white text-slate-900 ring-1 ring-slate-400' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
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

export function PositionEditorSection({
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

export function SummaryValueCard({ value, advantageMeta, strategy, onStrategyChange }) {
  return (
    <div className="rounded-[32px] bg-transparent px-1 py-1 sm:px-2 sm:py-2">
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

        <div className="flex flex-col gap-4 rounded-[28px] bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
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

export function PositionValueCard({ title, value, positions, priceSnapshotByCode, emptyText }) {
  return (
    <div className="rounded-[28px] bg-slate-50/80 p-5">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{title}</div>
      <div className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">{value}</div>
      <div className="mt-4 space-y-2 text-[11px] leading-5 text-slate-500">
        {positions.length ? (
          positions.map((position) => (
            <div key={`${title}-${position.code}`} className="rounded-2xl bg-white px-3 py-3 text-slate-600">
              {formatPositionMeta(position, priceSnapshotByCode[position.code])}
            </div>
          ))
        ) : (
          <div className="rounded-2xl bg-white/70 px-3 py-3 text-slate-400">{emptyText}</div>
        )}
      </div>
    </div>
  );
}

export function CompactMetricCard({ title, value, note, tone = 'slate' }) {
  return (
    <div className="rounded-[24px] bg-slate-50/80 p-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{title}</div>
      <div className={cx('mt-2 text-xl font-extrabold tracking-tight', tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-red-500' : 'text-slate-900')}>
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-5 text-slate-400">{note}</div>
    </div>
  );
}

export function HistoryRecordCard({ entry, isActive, onOpen, onDelete }) {
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

export function FundSwitchHistorySection({ entries, activeEntryId, onOpen, onDelete }) {
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

export function DocumentRecordCard({ entry, isActive, onOpen, onDelete }) {
  const workflowMeta = getDocumentWorkflowMeta(entry);

  return (
    <div
      className={cx(
        'w-full rounded-[24px] border p-4 text-left transition-colors sm:p-5',
        isActive ? 'border-indigo-200 bg-indigo-50/60' : 'border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-white'
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold', workflowMeta.className)}>
              {workflowMeta.label}
            </span>
            {entry.resultConfirmed ? (
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                可直接重算
              </span>
            ) : null}
          </div>

          <div className="mt-3 text-base font-bold text-slate-900">{entry.fileName || entry.title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            最近更新 {formatDateTimeLabel(entry.updatedAt)} · {entry.recognizedRecords} 条记录
          </div>

          <p className="mt-3 text-xs leading-5 text-slate-500">
            {entry.resultConfirmed
              ? '打开后会按当前最新价格重算这次基金切换收益。'
              : '打开后会回到待确认工作台，继续校验识别明细。'}
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
          <button
            type="button"
            className={cx(primaryButtonClass, 'whitespace-nowrap')}
            onClick={() => onOpen(entry.id)}
          >
            打开文档
          </button>
          {onDelete ? (
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-rose-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-50"
              onClick={() => onDelete(entry.id)}
            >
              <Trash2 className="h-4 w-4" />
              删除
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function FundSwitchDocumentSection({ entries, activeDocId, onOpen, onDelete }) {
  return (
    <Card>
      <SectionHeading eyebrow="最近文档" title="最近上传" />

      {entries.length ? (
        <div className="mt-6 space-y-3">
          {entries.map((entry) => (
            <DocumentRecordCard
              key={entry.id}
              entry={entry}
              isActive={activeDocId === entry.id}
              onOpen={onOpen}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm leading-6 text-slate-500">
          暂无最近文档。
        </div>
      )}
    </Card>
  );
}

export function LandingQuestionChip({ children }) {
  return (
    <div className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-slate-200 bg-[#f5f5f7] px-3.5 py-2 text-[13px] font-medium text-slate-600 shadow-[0_0_10px_rgba(15,23,42,0.08),0_1px_3px_rgba(15,23,42,0.05)]">
      {children}
    </div>
  );
}

export function LandingQuestionWall({ rows, className = '' }) {
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

export function WorkspaceNavButton({ panel, active, onSelect, badge = '' }) {
  const { key, label, Icon } = panel;

  return (
    <button
      className={cx(
        'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all',
        active ? 'border-slate-300 bg-white text-slate-900 shadow-sm shadow-slate-200 ring-1 ring-slate-400' : 'border-transparent bg-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900'
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

export function getDocumentWorkflowMeta(entry = {}) {
  const workflowStatus = String(entry.workflowStatus || '').trim();
  if (workflowStatus === 'error') {
    return {
      label: '处理失败',
      className: 'border-red-200 bg-red-50 text-red-600'
    };
  }

  if (workflowStatus === 'processing' || workflowStatus === 'uploading') {
    return {
      label: workflowStatus === 'uploading' ? '上传中' : '处理中',
      className: 'border-amber-200 bg-amber-50 text-amber-600'
    };
  }

  if (entry.resultConfirmed) {
    return {
      label: '结果已确认',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-600'
    };
  }

  return {
    label: '已回填待确认',
    className: 'border-slate-200 bg-slate-100 text-slate-600'
  };
}

export function buildWorkflowSteps({
  fileName,
  hasImportedData,
  recognizedCount,
  ocrState,
  resultConfirmed,
  effectiveOcrMessage,
  validationDiagnostics = [],
  summary
}) {
  const normalizedStatus = String(ocrState?.status || '').trim();
  const hasOcrResult = normalizedStatus === 'success' || normalizedStatus === 'warning' || resultConfirmed;
  const isProcessing = normalizedStatus === 'loading';
  const isError = normalizedStatus === 'error';
  const hasValidationIssues = validationDiagnostics.length > 0;

  return [
    {
      key: 'upload',
      label: '截图已接收',
      detail: hasImportedData ? '文件已进入识别流程。' : '等待上传截图。',
      tone: hasImportedData ? 'done' : 'pending',
      lines: [
        fileName ? `当前文档：${fileName}` : '上传后会为这次分析创建单独文档。'
      ]
    },
    {
      key: 'ocr',
      label: isProcessing ? 'OCR 识别中' : 'OCR 识别与解析',
      detail: isError
        ? '识别失败，请重新上传清晰截图。'
        : hasOcrResult
          ? `已解析 ${recognizedCount} 条记录。`
          : '等待开始识别。',
      tone: isError ? 'error' : hasOcrResult ? 'done' : isProcessing ? 'current' : 'pending',
      lines: [
        effectiveOcrMessage || '等待 OCR 开始。',
        ocrState.durationMs > 0 ? `OCR 用时约 ${(ocrState.durationMs / 1000).toFixed(1)} 秒。` : '',
        recognizedCount > 0 ? `已回填 ${recognizedCount} 条可计算记录。` : ''
      ].filter(Boolean)
    },
    {
      key: 'sheet',
      label: '明细工作表已准备',
      detail: hasValidationIssues
        ? `发现 ${validationDiagnostics.length} 项待修正，建议先定位处理。`
        : recognizedCount > 0
          ? '可以直接在表格里确认明细。'
          : '等待回填识别结果。',
      tone: hasValidationIssues ? 'error' : recognizedCount > 0 ? 'done' : isError ? 'pending' : isProcessing ? 'current' : 'pending',
      lines: hasValidationIssues
        ? ['']
        : recognizedCount > 0
          ? [`共 ${recognizedCount} 条识别记录，当前可以继续确认收益。`]
          : [],
      issues: validationDiagnostics.slice(0, 4),
      extraIssueCount: Math.max(validationDiagnostics.length - 4, 0)
    },
    {
      key: 'result',
      label: resultConfirmed ? '收益结果已确认' : '等待确认收益结果',
      detail: resultConfirmed ? '当前结果会按最新价格持续重算。' : '确认后会保存这次收益分析。',
      tone: resultConfirmed ? 'done' : recognizedCount > 0 && !hasValidationIssues ? 'current' : 'pending',
      lines: resultConfirmed
        ? [
            `收益口径：${STRATEGY_LABELS[summary?.strategy || 'trace']}`,
            `切换额外收益：${formatSignedCurrency(summary?.switchAdvantage || 0, '¥ ')}`,
            `不切换现值：${formatCurrency(summary?.stayValue || 0, '¥ ')}`,
            `换后现值：${formatCurrency(summary?.switchedValue || 0, '¥ ')}`
          ]
        : recognizedCount > 0 && !hasValidationIssues
          ? ['确认识别明细后，会自动切到收益摘要。']
          : ['先完成明细校验，再生成收益结果。']
    }
  ];
}

export function WorkflowStepList({
  steps = [],
  expandedStepKey = '',
  onToggleStep,
  onOpenDetails,
  onOpenSummary,
  onJumpToIssue
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">处理状态</div>
      <div className="mt-4 space-y-3">
        {steps.map((step, index) => (
          <div key={step.key} className="rounded-[22px] border border-slate-200 bg-slate-50/80 px-3 py-3">
            <button className="flex w-full gap-3 text-left" type="button" onClick={() => onToggleStep(step.key)}>
            <div className="flex flex-col items-center">
              <div
                className={cx(
                  'flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold',
                  step.tone === 'done'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                    : step.tone === 'current'
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                      : step.tone === 'error'
                        ? 'border-red-200 bg-red-50 text-red-600'
                        : 'border-slate-200 bg-slate-100 text-slate-400'
                )}
              >
                {index + 1}
              </div>
              {index < steps.length - 1 ? <div className="mt-1 h-6 w-px bg-slate-200" /> : null}
            </div>
            <div className="min-w-0 pb-2">
              <div className="flex items-start justify-between gap-3">
                <div className={cx(
                  'text-sm font-semibold',
                  step.tone === 'error' ? 'text-red-600' : step.tone === 'pending' ? 'text-slate-400' : 'text-slate-900'
                )}>
                  {step.label}
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-slate-400">
                  {expandedStepKey === step.key ? '收起' : '展开'}
                </span>
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500">{step.detail}</div>
            </div>
            </button>

            {expandedStepKey === step.key ? (
              <div className="ml-10 space-y-3 border-t border-slate-200/80 pt-3">
                {step.lines?.length ? (
                  <div className="space-y-2">
                    {step.lines.map((line) => (
                      <div key={`${step.key}-${line}`} className="text-xs leading-5 text-slate-500">
                        {line}
                      </div>
                    ))}
                  </div>
                ) : null}

                {step.issues?.length ? (
                  <div className="space-y-2">
                    {step.issues.map((issue) => (
                      <button
                        key={issue.id}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-red-200 bg-white px-3 py-2 text-left transition-colors hover:bg-red-50"
                        type="button"
                        onClick={() => onJumpToIssue(issue.rowIndex)}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-red-600">{issue.rowLabel || '待修正问题'}</div>
                          <div className="mt-1 text-xs leading-5 text-slate-600">{issue.message}</div>
                        </div>
                        {issue.rowIndex >= 0 ? (
                          <span className="shrink-0 text-[11px] font-semibold text-red-500">定位</span>
                        ) : null}
                      </button>
                    ))}
                    {step.extraIssueCount ? (
                      <div className="text-xs leading-5 text-slate-400">另有 {step.extraIssueCount} 项待修正，可在明细表里继续处理。</div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {step.key === 'sheet' && (step.tone === 'done' || step.tone === 'error') ? (
                    <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={onOpenDetails}>
                      去确认识别明细
                    </button>
                  ) : null}
                  {step.key === 'result' && step.tone === 'current' ? (
                    <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={onOpenDetails}>
                      完成确认后生成收益
                    </button>
                  ) : null}
                  {step.key === 'result' && step.tone === 'done' ? (
                    <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={onOpenSummary}>
                      查看收益摘要
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnalysisWorkspaceSidebar({
  activeDocId,
  documentEntries = [],
  expandedStepKey,
  workflowSteps = [],
  onToggleStep,
  onJumpToIssue,
  onOpenDocument,
  onEdit,
  onShowSummary
}) {
  const latestDocuments = documentEntries.slice(0, 5);

  return (
    <aside className="space-y-4">
      <WorkflowStepList
        steps={workflowSteps}
        expandedStepKey={expandedStepKey}
        onToggleStep={onToggleStep}
        onOpenDetails={onEdit}
        onOpenSummary={onShowSummary}
        onJumpToIssue={onJumpToIssue}
      />

      {latestDocuments.length ? (
        <div className="rounded-[28px] border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">最近文档</div>

            </div>
            <Pill tone="slate">{documentEntries.length} 条</Pill>
          </div>

          <div className="mt-4 space-y-3">
            {latestDocuments.map((entry) => {
              const workflowMeta = getDocumentWorkflowMeta(entry);
              const isActive = activeDocId === entry.id;

              return (
                <button
                  key={entry.id}
                  className={cx(
                    'w-full rounded-[22px] border px-3 py-3 text-left transition-colors',
                    isActive ? 'border-indigo-200 bg-indigo-50/70' : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                  )}
                  type="button"
                  onClick={() => onOpenDocument(entry.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-800">{entry.fileName || entry.title}</div>
                      <div className="mt-1 text-xs text-slate-400">{formatDateTimeLabel(entry.updatedAt)}</div>
                    </div>
                    <span className={cx('shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold', workflowMeta.className)}>
                      {workflowMeta.label}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>{entry.recognizedRecords} 条记录</span>
                    <span>·</span>
                    <span>{entry.resultConfirmed ? '打开后直接重算' : '打开后继续确认'}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export function TransactionEditorCard({ row, index, codeError, highlighted = false, onUpdateRow, onRemoveRow }) {
  return (
    <div
      data-row-index={index}
      className={cx(
        'rounded-[24px] bg-slate-50/90 p-4',
        highlighted ? 'ring-2 ring-indigo-100' : ''
      )}
    >
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

export function PendingResultCard({ issueSummary }) {
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
      </div>
    </div>
  );
}
