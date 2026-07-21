import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  Check,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  TrendingUp,
  X
} from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { readLedgerState } from '../../app/holdingsLedger.js';
import { aggregateByCode } from '../../app/holdingsLedgerCore.js';
import {
  buildSwitchRuleId,
  createSwitchRuleFromOpportunity,
  generateSwitchRecommendation,
  loadLatestSwitchRun,
  loadSwitchOpportunities,
  loadSwitchConfigFromWorker,
  loadSwitchSnapshotFromWorker,
  normalizeSwitchConfigShape,
  readSwitchConfigCache,
  removeSwitchRule,
  runSwitchOnce,
  saveSwitchConfigToWorker
} from '../../app/switchStrategySync.js';
import { showActionToast } from '../../app/toast.js';
import {
  DEFAULT_SWITCH_FEE_CONFIG,
  DEFAULT_SWITCH_HIGH_CODES,
  estimateSwitchCost,
  getSwitchConditionText,
  normalizeFeeConfig,
  normalizeSwitchRuleModel,
  validateFeeConfig
} from '../../app/switchRuleModel.js';
import { SWITCH_STRATEGY_ETFS } from '../../app/nasdaqCatalog.js';
import { StrategyEditor } from '../../components/fund-switch/StrategyEditor.jsx';
import { StrategyRunStatus } from '../../components/fund-switch/StrategyRunStatus.jsx';
import { StrategyTestModal } from '../../components/fund-switch/StrategyTestModal.jsx';
import { SwitchRuleDetailView } from '../../components/fund-switch/SwitchRuleDetailView.jsx';
import { SwitchStrategyCard } from '../../components/fund-switch/SwitchStrategyCard.jsx';
import { SwitchPageMotion } from '../../components/fund-switch/SwitchPageMotion.jsx';
import { formatSwitchPercent, SwitchButton, SwitchPanel } from '../../components/fund-switch/ui.jsx';
import {
  collectSnapshotMarketMeta,
  collectSnapshotPremiums,
  getSwitchRealtimeSymbols,
  mergeSwitchRealtimeViews
} from './switchStrategyRealtime.js';
import {
  filterExchangeSwitchHoldings,
  normalizeManualSwitchCode,
  normalizeManualSwitchCodeInput
} from './switchStrategyHoldings.js';
import { SwitchOpportunityPanel } from './SwitchOpportunityPanel.jsx';
import { navigateWorkspace } from '../notify/workspaceNavigation.js';

const TABS = [
  { id: 'opportunities', label: '推荐机会' },
  { id: 'plans', label: '我的方案' },
  { id: 'records', label: '切换记录' }
];

const BACKTEST_TIMEFRAME_OPTIONS = Object.freeze([
  { key: '5m',  label: '5分钟',  desc: '约5500根，约5.5个月' },
  { key: '15m', label: '15分钟', desc: '约5500根，约1.5年' },
  { key: '30m', label: '30分钟', desc: '约5500根，约3年' },
  { key: '60m', label: '60分钟', desc: '约5500根，约6年' },
  { key: '1d',  label: '日线',   desc: '约500根，约2年' },
]);

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
}

function formatRunTime(value) {
  if (!value) return '尚未运行';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function resolveHoldingNotional(holding = {}, fallbackQuantity = 0) {
  const marketValue = positiveNumber(holding?.marketValue, holding?.totalValue, holding?.holdingValue);
  if (marketValue > 0) return marketValue;
  const quantity = positiveNumber(
    holding?.totalShares,
    holding?.movingTotalShares,
    holding?.holdingQuantity,
    fallbackQuantity
  );
  const price = positiveNumber(holding?.currentPrice, holding?.price, holding?.latestNav, holding?.nav);
  return quantity > 0 && price > 0 ? quantity * price : 0;
}

function resolveRuleHoldingNotional(rule, holdings = [], snapshot = null) {
  const holding = holdings.find((item) => item.code === rule?.holdingFundCode);
  const liveNotional = resolveHoldingNotional(holding, rule?.holdingQuantity);
  if (liveNotional > 0) return liveNotional;
  const savedNotional = positiveNumber(rule?.holdingNotional);
  if (savedNotional > 0) return savedNotional;
  const group = Array.isArray(snapshot?.byBenchmark)
    ? snapshot.byBenchmark.find((item) => item.benchmarkCode === rule?.holdingFundCode)
    : null;
  const price = positiveNumber(group?.benchmarkPrice, group?.price);
  const quantity = positiveNumber(rule?.holdingQuantity);
  return quantity > 0 && price > 0 ? quantity * price : 0;
}

function resolveRuleHoldingQuantity(rule, holdings = []) {
  const holding = holdings.find((item) => item.code === rule?.holdingFundCode);
  if (!holding) return 0;
  return positiveNumber(holding.totalShares, holding.movingTotalShares, holding.holdingQuantity);
}

function StepIndicator({ step }) {
  const steps = [
    ['holding', '选择持仓'],
    ['fee', '切换费用'],
    ['recommend', '生成推荐']
  ];
  const activeIndex = Math.max(0, steps.findIndex(([id]) => id === step));
  const progress = activeIndex === 0 ? 10 : (activeIndex / (steps.length - 1)) * 100;
  return (
    <div className="mb-6" aria-label={`创建切换方案，第 ${activeIndex + 1} 步，共 ${steps.length} 步`}>
      <div className="flex items-center justify-between gap-3 text-xs font-semibold">
        <span className="text-slate-800">创建切换方案</span>
        <span className="text-slate-400">第 {activeIndex + 1} 步 / 共 {steps.length} 步</span>
      </div>
      <div className="relative mt-3 h-1.5 rounded-full bg-slate-100" role="progressbar" aria-valuemin="1" aria-valuemax={steps.length} aria-valuenow={activeIndex + 1}>
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-indigo-600 transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] font-semibold">
        {steps.map(([id, label], index) => (
          <div key={id} className={cx('flex items-center gap-1.5', index <= activeIndex ? 'text-indigo-700' : 'text-slate-400')}>
            <span className={cx('flex h-5 w-5 items-center justify-center rounded-full text-[10px]', index <= activeIndex ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-400')}>
              {index < activeIndex ? <Check className="h-3 w-3" /> : index + 1}
            </span>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onCreate, onRun, running }) {
  return (
    <SwitchPanel className="flex min-h-[360px] flex-col items-center justify-center text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
        <ArrowLeftRight className="h-7 w-7" />
      </div>
      <h2 className="mt-5 text-xl font-bold text-slate-900">还没有切换规则</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
        选择一只当前持仓，系统会自动寻找同类基金，并根据手续费和历史数据生成提醒条件。
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <SwitchButton onClick={onCreate}>
          <Plus className="h-4 w-4" />
          添加第一条规则
        </SwitchButton>
        <SwitchButton variant="secondary" onClick={onRun} disabled={running}>
          <Play className="h-4 w-4" />
          手动跑一次
        </SwitchButton>
      </div>
    </SwitchPanel>
  );
}

function AddPlanEntry({ onCreate, allHoldingsCovered = false }) {
  if (allHoldingsCovered) {
    return (
      <div className="flex min-h-[88px] w-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 text-center">
        <span className="text-sm font-semibold text-slate-500">所有持仓均已创建方案</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onCreate}
      className="flex min-h-[88px] w-full items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-5 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50/40"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-2xl font-light text-indigo-600">+</span>
      <span>
        <span className="block font-bold text-slate-900">添加新的切换方案</span>
        <span className="mt-1 block text-xs text-slate-500">选择一只持仓基金，系统会为您生成推荐提醒条件</span>
      </span>
    </button>
  );
}

function HoldingPicker({
  holdings,
  rules,
  replacingRuleId = '',
  selectedCode,
  setSelectedCode,
  manualCode,
  setManualCode,
  onBack,
  onNext
}) {
  const existing = new Set(
    rules
      .filter((rule) => rule.id !== replacingRuleId)
      .map((rule) => rule.holdingFundCode || rule.benchmarkCodes?.[0])
  );
  const manualSwitchCode = normalizeManualSwitchCode(manualCode);
  const manualCodeReady = Boolean(manualSwitchCode);
  const applyManualCode = () => {
    if (!manualCodeReady) return;
    setSelectedCode(manualSwitchCode);
  };
  return (
    <SwitchPanel data-switch-motion-item>
      <StepIndicator step="holding" />
      <h2 className="text-xl font-bold text-slate-900">选择当前持仓</h2>
      <p className="mt-1 text-sm text-slate-500">选择一只需要持续分析切换机会的基金。</p>
      <div className="mt-5 space-y-2">
        {holdings.map((holding) => {
          const disabled = existing.has(holding.code);
          return (
            <button
              type="button"
              key={holding.code}
              disabled={disabled}
              onClick={() => setSelectedCode(holding.code)}
              className={cx(
                'flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left',
                selectedCode === holding.code
                  ? 'border-slate-900 bg-slate-50'
                  : 'border-slate-200 hover:border-slate-300',
                disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              <span>
                <span className="block font-semibold text-slate-900">
                  {holding.code} {holding.name || ''}
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  持有 {Number(holding.totalShares || holding.movingTotalShares || 0).toLocaleString('zh-CN')}{' '}
                  份
                </span>
              </span>
              {disabled ? (
                <span className="text-xs font-semibold text-slate-400">已有规则</span>
              ) : selectedCode === holding.code ? (
                <Check className="h-5 w-5 text-slate-900" />
              ) : null}
            </button>
          );
        })}
        {!holdings.length ? (
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
            暂时没有可用持仓，可以手动添加基金。
          </div>
        ) : null}
      </div>
      <div className="mt-5 border-t border-slate-100 pt-4">
        <div className="text-sm font-semibold text-slate-700">手动添加基金</div>
        <div className="mt-2 flex gap-2">
          <input
            value={manualCode}
            onChange={(event) => setManualCode(normalizeManualSwitchCodeInput(event.target.value))}
            placeholder="输入 6 位基金代码"
            aria-label="手动添加基金代码"
            inputMode="numeric"
            maxLength={6}
            className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
          />
          <SwitchButton
            variant="secondary"
            onClick={applyManualCode}
            disabled={!manualCodeReady}
          >
            {selectedCode === manualSwitchCode && manualCodeReady ? '已选择' : '使用'}
          </SwitchButton>
        </div>
        {selectedCode === manualSwitchCode && manualCodeReady ? (
          <div className="mt-2 text-xs font-semibold text-emerald-600">已选择 {manualSwitchCode}，点击“下一步”继续。</div>
        ) : null}
      </div>
      <div className="mt-6 flex justify-between gap-3">
        <SwitchButton variant="secondary" onClick={onBack}>
          取消
        </SwitchButton>
        <SwitchButton onClick={onNext} disabled={!normalizeManualSwitchCode(selectedCode)}>
          下一步
          <ArrowRight className="h-4 w-4" />
        </SwitchButton>
      </div>
    </SwitchPanel>
  );
}

function FeeForm({ fee, setFee, holdingNotional = 0, backtestTimeframe, setBacktestTimeframe, onBack, onNext }) {
  const validation = validateFeeConfig(fee);
  const update = (field, value) => setFee((current) => ({ ...current, [field]: value }));
  const fields = [
    ['sellCommissionRate', '卖出手续费', '%'],
    ['buyCommissionRate', '买入手续费', '%'],
    ['minimumCommission', '最低佣金', '元'],
    ['otherFee', '其他费用', '元']
  ];
  return (
    <SwitchPanel data-switch-motion-item>
      <StepIndicator step="fee" />
      <h2 className="text-xl font-bold text-slate-900">切换费用</h2>
      <p className="mt-1 text-sm text-slate-500">手续费会纳入推荐提醒值和历史回测。</p>
      <div className="mt-5 inline-flex rounded-xl bg-slate-100 p-1 text-sm">
        {[
          ['detailed', '按明细计算'],
          ['estimated_total', '直接填写预计总费用']
        ].map(([mode, label]) => (
          <button
            type="button"
            key={mode}
            onClick={() => update('mode', mode)}
            className={cx(
              'rounded-lg px-3 py-2 font-semibold',
              fee.mode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {fee.mode === 'detailed' ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {fields.map(([field, label, suffix]) => (
            <label key={field} className="text-sm font-semibold text-slate-700">
              {label}
              <div className="relative mt-1.5">
                <input
                  inputMode="decimal"
                  value={fee[field] ?? ''}
                  onChange={(event) => update(field, event.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 pr-12 text-sm"
                />
                <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-400">
                  {suffix}
                </span>
              </div>
              {validation.errors[field] ? (
                <span className="mt-1 block text-xs font-normal text-rose-600">
                  {validation.errors[field]}
                </span>
              ) : null}
            </label>
          ))}
        </div>
      ) : (
        <label className="mt-5 block max-w-sm text-sm font-semibold text-slate-700">
          预计单次切换总费用
          <div className="relative mt-1.5">
            <input
              inputMode="decimal"
              value={fee.estimatedTotalFee ?? ''}
              onChange={(event) => update('estimatedTotalFee', event.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 pr-12 text-sm"
            />
            <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-400">元</span>
          </div>
          {validation.errors.estimatedTotalFee ? (
            <span className="mt-1 block text-xs font-normal text-rose-600">
              {validation.errors.estimatedTotalFee}
            </span>
          ) : null}
        </label>
      )}
      <div className="mt-5 rounded-xl bg-slate-50 p-4">
        <div className="text-xs text-slate-500">预计单次切换成本</div>
        <div className="mt-1 text-2xl font-bold text-slate-900">
          约{' '}
          {formatNumber(
            fee.mode === 'estimated_total' ? fee.estimatedTotalFee : estimateSwitchCost(fee, holdingNotional)
          )}{' '}
          元
        </div>
        <div className="mt-1 text-xs text-slate-400">实际金额会根据切换金额和券商规则变化。</div>
      </div>
      <div className="mt-5">
        <div className="mb-2 text-sm font-semibold text-slate-700">K 线周期</div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {BACKTEST_TIMEFRAME_OPTIONS.map((option) => {
            const selected = backtestTimeframe === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setBacktestTimeframe(option.key)}
                className={cx(
                  'h-10 rounded-xl border px-3 text-sm font-semibold transition',
                  selected
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs leading-5 text-slate-400">
          {BACKTEST_TIMEFRAME_OPTIONS.find((item) => item.key === backtestTimeframe)?.desc || ''}
        </p>
      </div>
      <div className="mt-6 flex justify-between gap-3">
        <SwitchButton variant="secondary" onClick={onBack}>
          上一步
        </SwitchButton>
        <SwitchButton onClick={() => onNext(validation.value)} disabled={!validation.valid}>
          生成推荐规则
          <ArrowRight className="h-4 w-4" />
        </SwitchButton>
      </div>
    </SwitchPanel>
  );
}

function RecommendationLoading() {
  const phases = ['正在匹配同类基金', '正在计算切换费用', '正在分析历史溢价差', '正在寻找更合适的提醒条件'];
  return (
    <SwitchPanel data-switch-motion-item className="min-h-[360px] text-center">
      <div className="mx-auto flex max-w-xl flex-col items-center justify-center py-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-slate-900">正在生成推荐规则</h2>
        <p className="mt-1 text-sm text-slate-500">系统正在准备候选基金和历史回测，请稍候。</p>
        <div className="mt-6 w-full" role="status" aria-label="推荐规则生成进度">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-2/5 rounded-full bg-indigo-600 animate-[switchProgress_1.5s_ease-in-out_infinite]" />
          </div>
          <div className="mt-4 grid gap-2 text-left sm:grid-cols-2">
            {phases.map((phase) => (
              <div key={phase} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
                {phase}
              </div>
            ))}
          </div>
        </div>
      </div>
    </SwitchPanel>
  );
}

function RecommendationView({ recommendation, fee, holdingNotional = 0, backtestTimeframe, setBacktestTimeframe, onBack, onUse, onBacktest, onRerun }) {
  const backtest = recommendation?.backtest || {};
  const optimized = backtest.selectionStatus === 'optimized';
  const fixedRule = backtest.selectionStatus === 'fixed';
  return (
    <SwitchPanel data-switch-motion-item>
      <StepIndicator step="recommend" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">已生成推荐规则</h2>
          <p className="mt-1 text-sm text-slate-500">系统已完成候选匹配、费用计算和历史分析。</p>
        </div>
        <ArrowLeftRight className="h-6 w-6 text-indigo-600" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-xs text-slate-500">当前持仓</div>
          <div className="mt-2 font-bold text-slate-900">
            {recommendation?.holdingFundCode} {recommendation?.holdingFundName}
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-xs text-slate-500">推荐提醒条件</div>
          <div className="mt-2 text-sm font-bold leading-6 text-slate-900">
            {recommendation?.holdingSide === 'low'
              ? `当切回候选基金的价差收窄到 ${formatNumber(recommendation?.thresholdValue)}% 以内时提醒`
              : `当当前持仓比同类候选基金贵 ${formatNumber(recommendation?.thresholdValue)}% 时提醒`}
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-xs text-slate-500">预计单次切换成本</div>
          <div className="mt-2 font-bold text-slate-900">
            约{' '}
            {formatNumber(
              fee.mode === 'estimated_total'
                ? fee.estimatedTotalFee
                : estimateSwitchCost(fee, positiveNumber(recommendation?.holdingNotional, holdingNotional))
            )}{' '}
            元
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-slate-100 bg-white p-4">
        <div className="text-xs text-slate-500">推荐切换目标</div>
        {recommendation?.recommendedCandidate ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-slate-900">
              {recommendation.recommendedCandidate.code} {recommendation.recommendedCandidate.name}
            </div>
            <div className="text-sm font-semibold text-slate-700">
              当前切换优势 {formatSwitchPercent(recommendation.recommendedCandidate.currentAdvantagePct)}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-sm text-slate-500">暂无可用的对手方历史数据。</div>
        )}
      </div>
      <div className="mt-5 rounded-xl border border-slate-100 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-900">历史回测</h3>
          <span
            className={cx(
              'rounded-full px-2.5 py-1 text-xs font-semibold',
              backtest.status !== 'passed'
                ? 'bg-amber-50 text-amber-700'
                  : optimized
                    ? 'bg-emerald-50 text-emerald-700'
                    : fixedRule
                      ? 'bg-blue-50 text-blue-700'
                  : 'bg-slate-100 text-slate-600'
            )}
          >
            {backtest.status !== 'passed'
              ? '数据不足'
              : optimized
                ? '自动推荐'
                : fixedRule
                  ? '固定规则'
                  : '参考值'}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500">触发</div>
            <div className="mt-1 text-xl font-bold">{backtest.triggerCount ?? 0} 次</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">胜率</div>
            <div className="mt-1 text-xl font-bold text-emerald-600">
              {formatSwitchPercent(backtest.winRatePct, 1)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">年化提升</div>
            <div className="mt-1 text-xl font-bold text-emerald-600">
              {formatSwitchPercent(backtest.annualizedReturnPct, 1)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">最大回撤</div>
            <div className="mt-1 text-xl font-bold">{formatSwitchPercent(backtest.maxDrawdownPct)}</div>
          </div>
        </div>
        {backtest.selectionReason && (!optimized || fixedRule) ? (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">
            {backtest.selectionReason}
          </div>
        ) : null}
      </div>
      {recommendation?.historyIssues?.length ? (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          部分历史数据暂不可用，推荐值会在数据补齐后重新分析。
        </div>
      ) : null}
      <div className="mt-5">
        <div className="mb-2 text-sm font-semibold text-slate-700">K 线周期</div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {BACKTEST_TIMEFRAME_OPTIONS.map((option) => {
            const selected = backtestTimeframe === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setBacktestTimeframe(option.key)}
                className={cx(
                  'h-10 rounded-xl border px-3 text-sm font-semibold transition',
                  selected
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs leading-5 text-slate-400">
          {BACKTEST_TIMEFRAME_OPTIONS.find((item) => item.key === backtestTimeframe)?.desc || ''}，切换周期后点击「重新回测」可用新周期重新分析。
        </p>
      </div>
      <div className="mt-6 flex flex-wrap justify-between gap-3">
        <SwitchButton variant="secondary" onClick={onBack}>
          上一步
        </SwitchButton>
        <div className="flex flex-wrap gap-2">
          <SwitchButton variant="secondary" onClick={onRerun}>
            <RefreshCw className="h-4 w-4" />
            重新回测
          </SwitchButton>
          <SwitchButton variant="secondary" onClick={onBacktest}>
            <TrendingUp className="h-4 w-4" />
            查看回测结果
          </SwitchButton>
          <SwitchButton onClick={onUse}>
            使用推荐规则
            <Check className="h-4 w-4" />
          </SwitchButton>
        </div>
      </div>
    </SwitchPanel>
  );
}

function BacktestView({ recommendation, onBack, onUse }) {
  const comparison = recommendation?.backtest?.comparison || [];
  const fixedRule = recommendation?.backtest?.selectionStatus === 'fixed';
  return (
    <SwitchPanel data-switch-motion-item>
      <div className="flex items-center gap-3">
        <SwitchButton variant="quiet" className="px-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </SwitchButton>
        <div>
          <h2 className="text-xl font-bold text-slate-900">历史回测</h2>
          <p className="mt-1 text-sm text-slate-500">
            {fixedRule
              ? '低侧提醒值按“价差收窄到 1% 以内”的业务规则固定；下方对照值用于查看历史表现。'
              : '回测区间、手续费和候选基金范围由系统自动完成。'}
          </p>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="text-xs text-slate-500">推荐提醒值</div>
          <div className="mt-1 text-xl font-bold">
            {formatSwitchPercent(recommendation?.backtest?.recommendedValue)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">触发次数</div>
          <div className="mt-1 text-xl font-bold">{recommendation?.backtest?.triggerCount || 0} 次</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">胜率</div>
          <div className="mt-1 text-xl font-bold text-emerald-600">
            {formatSwitchPercent(recommendation?.backtest?.winRatePct, 1)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">年化提升</div>
          <div className="mt-1 text-xl font-bold text-emerald-600">
            {formatSwitchPercent(recommendation?.backtest?.annualizedReturnPct, 1)}
          </div>
        </div>
      </div>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs text-slate-400">
            <tr>
              <th className="px-3 py-3">提醒值</th>
              <th className="px-3 py-3">触发次数</th>
              <th className="px-3 py-3">胜率</th>
              <th className="px-3 py-3">年化提升</th>
              <th className="px-3 py-3">最大回撤</th>
            </tr>
          </thead>
          <tbody>
            {comparison.map((item) => (
              <tr
                key={item.threshold}
                className={cx(
                  'border-b border-slate-50',
                  item.threshold === recommendation?.backtest?.recommendedValue && 'bg-emerald-50/60'
                )}
              >
                <td className="px-3 py-3 font-semibold">
                  {formatSwitchPercent(item.threshold)}{' '}
                  {item.threshold === recommendation?.backtest?.recommendedValue ? (
                    <span className="ml-1 text-xs text-emerald-700">{fixedRule ? '固定' : '推荐'}</span>
                  ) : null}
                </td>
                <td className="px-3 py-3">{item.triggerCount} 次</td>
                <td className="px-3 py-3">{formatSwitchPercent(item.winRatePct, 1)}</td>
                <td className="px-3 py-3">{formatSwitchPercent(item.annualizedReturnPct, 1)}</td>
                <td className="px-3 py-3">{formatSwitchPercent(item.maxDrawdownPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 flex justify-between gap-3">
        <SwitchButton variant="secondary" onClick={onBack}>
          返回上一步
        </SwitchButton>
        <SwitchButton onClick={onUse}>
          使用推荐值 {formatSwitchPercent(recommendation?.backtest?.recommendedValue)}
        </SwitchButton>
      </div>
    </SwitchPanel>
  );
}

export function SwitchRuleExperience() {
  const [tab, setTab] = useState('plans');
  const [config, setConfig] = useState(() => readSwitchConfigCache());
  const [snapshot, setSnapshot] = useState(null);
  const [runtimeViews, setRuntimeViews] = useState({});
  const [latestRun, setLatestRun] = useState(null);
  const [nextScheduledAt, setNextScheduledAt] = useState(null);
  const [scheduleStatus, setScheduleStatus] = useState('unknown');
  const [notificationStatus, setNotificationStatus] = useState('unknown');
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('list');
  const [step, setStep] = useState('holding');
  const [selectedCode, setSelectedCode] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [fee, setFee] = useState(() => ({ ...DEFAULT_SWITCH_FEE_CONFIG }));
  const [backtestTimeframe, setBacktestTimeframe] = useState('5m');
  const [highCodes, setHighCodes] = useState(() => [...DEFAULT_SWITCH_HIGH_CODES]);
  const [recommendation, setRecommendation] = useState(null);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const [reanalysisRuleId, setReanalysisRuleId] = useState('');
  const [editFee, setEditFee] = useState(() => ({ ...DEFAULT_SWITCH_FEE_CONFIG }));
  const [editThresholdMode, setEditThresholdMode] = useState('backtest');
  const [editThreshold, setEditThreshold] = useState('');
  const [editHighCodes, setEditHighCodes] = useState(() => [...DEFAULT_SWITCH_HIGH_CODES]);
  const [quickRule, setQuickRule] = useState(null);
  const [expandedRuleId, setExpandedRuleId] = useState('');
  const [running, setRunning] = useState(false);
  const [realtimeAt, setRealtimeAt] = useState(null);
  const [opportunityResult, setOpportunityResult] = useState(null);
  const [opportunityLoading, setOpportunityLoading] = useState(false);
  const [opportunityError, setOpportunityError] = useState('');
  const [creatingOpportunityId, setCreatingOpportunityId] = useState('');
  const [backtestReturnView, setBacktestReturnView] = useState('create');
  const recommendationInFlight = useRef(new Map());
  const opportunityRequestRef = useRef({ sequence: 0, inflight: new Map() });
  const realtimePremiumMapRef = useRef({});
  const realtimeMarketMetaMapRef = useRef({});
  const realtimeViewsRef = useRef(runtimeViews);
  const realtimeTimestampRef = useRef(0);

  const rules = Array.isArray(config?.rules) ? config.rules : [];
  const selectedHolding = useMemo(
    () => holdings.find((item) => item.code === selectedCode) || { code: selectedCode, name: '' },
    [holdings, selectedCode]
  );
  const selectedHoldingNotional = useMemo(
    () => resolveHoldingNotional(selectedHolding),
    [selectedHolding]
  );
  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId) || rules[0] || null,
    [rules, selectedRuleId]
  );
  const realtimeSymbols = useMemo(() => getSwitchRealtimeSymbols(rules), [rules]);
  const recentFeeConfig = useMemo(
    () => rules.find((rule) => rule?.feeConfig)?.feeConfig || DEFAULT_SWITCH_FEE_CONFIG,
    [rules]
  );

  const reloadOpportunities = useCallback(async ({ force = false } = {}) => {
    const requestKey = JSON.stringify(
      holdings.map((item) => [item.code, item.totalShares, item.marketValue])
    );
    const existing = opportunityRequestRef.current.inflight.get(requestKey);
    if (!force && existing) return existing;
    const sequence = opportunityRequestRef.current.sequence + 1;
    opportunityRequestRef.current.sequence = sequence;
    setOpportunityLoading(true);
    setOpportunityError('');
    const request = (async () => {
      try {
        const result = await loadSwitchOpportunities({ mode: 'auto', limit: 10, holdings });
        if (sequence === opportunityRequestRef.current.sequence) setOpportunityResult(result);
        return result;
      } catch (error) {
        if (sequence === opportunityRequestRef.current.sequence) {
          setOpportunityError(error?.message || '推荐机会暂时无法加载。');
        }
        return null;
      } finally {
        if (opportunityRequestRef.current.inflight.get(requestKey) === request) {
          opportunityRequestRef.current.inflight.delete(requestKey);
        }
        if (sequence === opportunityRequestRef.current.sequence) setOpportunityLoading(false);
      }
    })();
    opportunityRequestRef.current.inflight.set(requestKey, request);
    return request;
  }, [holdings]);

  useEffect(() => {
    if (tab !== 'opportunities' || loading) return;
    reloadOpportunities();
  }, [loading, reloadOpportunities, tab]);

  useEffect(() => {
    realtimeViewsRef.current = runtimeViews;
  }, [runtimeViews]);

  useEffect(() => {
    realtimePremiumMapRef.current = snapshot ? collectSnapshotPremiums(snapshot, {}) : {};
    realtimeMarketMetaMapRef.current = snapshot ? collectSnapshotMarketMeta(snapshot, {}) : {};
  }, [snapshot]);

  // 规则列表只订阅当前规则涉及的基金，并复用全局通知 WS 的 market.premium 主题。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (tab !== 'plans' || view !== 'list' || !realtimeSymbols.length) {
      setRealtimeAt(null);
      return undefined;
    }
    let subscribed = false;
    const subscribeRules = () => {
      if (typeof window.__aiDcaSubscribeMarketData !== 'function') return;
      window.__aiDcaSubscribeMarketData(realtimeSymbols, {
        scope: 'switch-rules',
        topics: ['market.premium']
      });
      subscribed = true;
    };
    if (typeof window.__aiDcaSubscribeMarketData === 'function') {
      subscribeRules();
    }
    window.addEventListener('ai-dca-notify-ws-ready', subscribeRules);
    return () => {
      window.removeEventListener('ai-dca-notify-ws-ready', subscribeRules);
      if (subscribed && typeof window.__aiDcaSubscribeMarketData === 'function') {
        window.__aiDcaSubscribeMarketData([], { scope: 'switch-rules' });
      }
    };
  }, [realtimeSymbols, tab, view]);

  useEffect(() => {
    if (typeof window === 'undefined' || tab !== 'plans' || view !== 'list') return undefined;
    const handleMarketSnapshot = (event) => {
      const detail = event?.detail || {};
      const items = Array.isArray(detail.items) ? detail.items : [];
      if (!items.length) return;
      const rawTimestamp = Number(detail.ts);
      const timestamp = Number.isFinite(rawTimestamp)
        ? rawTimestamp
        : Date.parse(String(detail.ts || '')) || Date.now();
      if (timestamp <= realtimeTimestampRef.current) return;
      realtimeTimestampRef.current = timestamp;
      const merged = mergeSwitchRealtimeViews({
        rules,
        runtimeViews: realtimeViewsRef.current,
        premiumMap: realtimePremiumMapRef.current,
        marketMetaMap: realtimeMarketMetaMapRef.current,
        items
      });
      realtimePremiumMapRef.current = merged.premiumMap;
      realtimeMarketMetaMapRef.current = merged.marketMetaMap;
      if (!merged.changed) return;
      realtimeViewsRef.current = merged.runtimeViews;
      setRuntimeViews(merged.runtimeViews);
      setRealtimeAt(timestamp);
    };
    window.addEventListener('ai-dca-market-snapshot', handleMarketSnapshot);
    return () => window.removeEventListener('ai-dca-market-snapshot', handleMarketSnapshot);
  }, [rules, tab, view]);

  const reload = async () => {
    const ledger = readLedgerState();
    const aggregate = filterExchangeSwitchHoldings(
      aggregateByCode(ledger.transactions || [], ledger.snapshotsByCode || {})
        .filter((item) => item.totalShares > 0 || item.pendingBuyAmount > 0)
        .map((item) => ({ ...item, totalShares: item.totalShares || item.movingTotalShares || 0 }))
    );
    setHoldings(aggregate);
    try {
      const [remoteConfig, remoteSnapshot, run] = await Promise.all([
        loadSwitchConfigFromWorker(),
        loadSwitchSnapshotFromWorker(),
        loadLatestSwitchRun()
      ]);
      setConfig(remoteConfig);
      setSnapshot(remoteSnapshot?.snapshot || null);
      setRuntimeViews(remoteSnapshot?.runtimeViews || {});
      setLatestRun(run?.run || null);
      setNextScheduledAt(run?.nextScheduledAt || run?.run?.nextScheduledAt || null);
      setScheduleStatus(run?.scheduleStatus || run?.run?.scheduleStatus || 'unknown');
      setNotificationStatus(run?.notificationStatus || run?.run?.notificationStatus || 'unknown');
    } catch (error) {
      setNotice(error?.message || '暂时无法连接远端服务，已显示本机缓存。');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    reload();
  }, []);

  const startCreate = () => {
    const existing = new Set(rules.map((rule) => rule.holdingFundCode || rule.benchmarkCodes?.[0]));
    setSelectedCode(holdings.find((item) => !existing.has(item.code))?.code || '');
    setManualCode('');
    setFee({ ...DEFAULT_SWITCH_FEE_CONFIG });
    setBacktestTimeframe('5m');
    setHighCodes([...DEFAULT_SWITCH_HIGH_CODES]);
    setRecommendation(null);
    setReanalysisRuleId('');
    setStep('holding');
    setView('create');
    setTab('plans');
    setNotice('');
  };

  const requestRecommendation = async ({
    code,
    name = '',
    quantity,
    holdingNotional,
    feeConfig,
    highCodes: selectedHighCodes,
    timeframe
  }) => {
    const normalizedFee = normalizeFeeConfig(feeConfig);
    const normalizedHighCodes = Array.isArray(selectedHighCodes) && selectedHighCodes.length
      ? selectedHighCodes
      : DEFAULT_SWITCH_HIGH_CODES;
    const key = JSON.stringify({
      code,
      holdingNotional,
      normalizedFee,
      candidates: SWITCH_STRATEGY_ETFS.map((item) => item.code),
      highCodes: normalizedHighCodes,
      timeframe
    });
    const existing = recommendationInFlight.current.get(key);
    if (existing) return existing;
    const request = generateSwitchRecommendation({
      holdingFundCode: code,
      holdingFundName: name,
      holdingQuantity: quantity,
      holdingNotional,
      feeConfig: normalizedFee,
      candidateCodes: SWITCH_STRATEGY_ETFS.map((item) => item.code),
      highCodes: normalizedHighCodes,
      backtestParams: timeframe ? { timeframe } : {}
    });
    recommendationInFlight.current.set(key, request);
    try {
      return await request;
    } finally {
      recommendationInFlight.current.delete(key);
    }
  };

  const applyRunResult = (result) => {
    const skippedRuleCount = rules.filter(
      (rule) => rule.enabled && rule.ruleType !== 'market_watch' && resolveRuleHoldingQuantity(rule, holdings) <= 0
    ).length;
    const summary = result?.summary
      ? { ...result.summary, skippedRuleCount: result.summary.skippedRuleCount ?? skippedRuleCount }
      : null;
    setLatestRun(summary);
    setSnapshot(result?.snapshot || null);
    const nextViews = (summary?.ruleResults || []).reduce((map, item) => {
      if (item?.runtimeView?.ruleId) map[item.runtimeView.ruleId] = item.runtimeView;
      return map;
    }, {});
    realtimeViewsRef.current = nextViews;
    setRuntimeViews(nextViews);
    setNextScheduledAt(summary?.nextScheduledAt || null);
    setScheduleStatus(summary?.scheduleStatus || 'unknown');
    setNotificationStatus(summary?.notificationStatus || 'unknown');
    return summary;
  };

  const executeSwitchRun = async ({ automatic = false } = {}) => {
    setRunning(true);
    setNotice(automatic ? '规则已保存，正在自动获取最新行情并完成首次分析…' : '');
    try {
      const result = await runSwitchOnce();
      const summary = applyRunResult(result);
      setNotice(
        automatic
          ? `规则已创建，首次分析完成：触发 ${summary?.triggeredSignalCount ?? summary?.triggered ?? 0} 条`
          : `运行完成：成功 ${summary?.successRuleCount ?? summary?.ruleCount ?? 0} 条，触发 ${summary?.triggeredSignalCount ?? summary?.triggered ?? 0} 条${summary?.skippedRuleCount ? `，跳过 ${summary.skippedRuleCount} 条` : ''}`
      );
      return result;
    } catch (error) {
      setNotice(automatic
        ? `规则已保存，但首次分析失败：${error?.message || '请稍后重试。'}`
        : error?.message || '运行失败，请稍后重试。');
      return null;
    } finally {
      setRunning(false);
    }
  };

  const generate = async (feeInput = fee) => {
    // 先切到第三步，确保远端请求期间用户能看到明确的加载状态。
    setStep('recommend');
    setRecommendation(null);
    setRecommendLoading(true);
    setNotice('');
    try {
      const payload = await requestRecommendation({
        code: selectedHolding.code,
        name: selectedHolding.name,
        quantity: selectedHolding.totalShares,
        holdingNotional: selectedHoldingNotional,
        feeConfig: feeInput,
        highCodes,
        timeframe: backtestTimeframe
      });
      setRecommendation(payload?.recommendation || null);
      setStep('recommend');
    } catch (error) {
      setNotice(error?.message || '推荐规则生成失败，请稍后重试。');
    } finally {
      setRecommendLoading(false);
    }
  };

  const useRecommendation = async () => {
    if (!recommendation) return;
    const nextRule = normalizeSwitchRuleModel({
      id: buildSwitchRuleId(),
      name: `${recommendation.holdingFundCode} 切换方案`,
      enabled: true,
      holdingFundCode: recommendation.holdingFundCode,
      holdingFundName: recommendation.holdingFundName,
      holdingQuantity: recommendation.holdingQuantity,
      holdingNotional: recommendation.holdingNotional,
      thresholdMode: 'backtest',
      thresholdValue: recommendation.thresholdValue,
      backtestRecommendedValue: recommendation.thresholdValue,
      recommendationStatus: 'valid',
      feeConfig: recommendation.feeConfig || fee,
      candidateFundCodes: recommendation.candidateFundCodes,
      highPremiumCodes: recommendation.highPremiumCodes || highCodes,
      premiumClassSource: recommendation.premiumClassSource || 'default',
      runtimeConfig: {
        recommendationId: recommendation.recommendationId,
        premiumClass: recommendation.premiumClass,
        highPremiumCodes: recommendation.highPremiumCodes || highCodes,
        premiumClassUpdatedAt: recommendation.classifiedAt,
        classificationSource: recommendation.classificationSource,
        classificationStatus: recommendation.classificationStatus,
        intraSellLowerPct: recommendation.intraSellLowerPct,
        intraBuyOtherPct: recommendation.intraBuyOtherPct,
        holdingSideAtRecommendation: recommendation.holdingSide,
        triggerOperatorAtRecommendation: recommendation.triggerOperator
      },
      lastResult: {
        status: recommendation.backtest?.status || 'pending',
        recommendationId: recommendation.recommendationId,
        backtest: recommendation.backtest,
        candidates: recommendation.candidatesResult
      }
    });
    const targetRuleId = reanalysisRuleId || nextRule.id;
    const nextRules = reanalysisRuleId
      ? rules.map((item) => (item.id === reanalysisRuleId ? { ...nextRule, id: reanalysisRuleId } : item))
      : [...rules, nextRule];
    try {
      const result = await saveSwitchConfigToWorker(
        normalizeSwitchConfigShape({ ...config, enabled: true, activeRuleId: targetRuleId, rules: nextRules })
      );
      setConfig(result.config);
      setSelectedRuleId(targetRuleId);
      setReanalysisRuleId('');
      setView('detail');
      setSnapshot(null);
      setRuntimeViews({});
      realtimeViewsRef.current = {};
      realtimeMarketMetaMapRef.current = {};
      setNotice('规则已保存，正在自动获取最新行情并完成首次分析…');
      await executeSwitchRun({ automatic: true });
    } catch (error) {
      setNotice(error?.message || '保存规则失败。');
    }
  };

  const startEdit = (rule) => {
    setSelectedRuleId(rule.id);
    setEditFee(normalizeFeeConfig(rule.feeConfig));
    setEditThresholdMode(rule.thresholdMode === 'fixed' ? 'fixed' : 'backtest');
    setEditThreshold(String(rule.thresholdValue ?? rule.backtestRecommendedValue ?? ''));
    setEditHighCodes([...(rule.highPremiumCodes || rule.runtimeConfig?.highPremiumCodes || DEFAULT_SWITCH_HIGH_CODES)]);
    setView('edit');
    setTab('plans');
  };
  const startReanalysis = (rule) => {
    setSelectedCode(rule.holdingFundCode || rule.benchmarkCodes?.[0] || '');
    setFee(normalizeFeeConfig(rule.feeConfig));
    setBacktestTimeframe('5m');
    setHighCodes([...(rule.highPremiumCodes || rule.runtimeConfig?.highPremiumCodes || DEFAULT_SWITCH_HIGH_CODES)]);
    setRecommendation(null);
    setReanalysisRuleId(rule.id);
    setStep('fee');
    setView('create');
    setTab('plans');
  };
  const startRebind = (rule) => {
    setSelectedCode('');
    setManualCode('');
    setFee(normalizeFeeConfig(rule.feeConfig));
    setBacktestTimeframe('5m');
    setHighCodes([...(rule.highPremiumCodes || rule.runtimeConfig?.highPremiumCodes || DEFAULT_SWITCH_HIGH_CODES)]);
    setRecommendation(null);
    setReanalysisRuleId(rule.id);
    setStep('holding');
    setView('create');
    setTab('plans');
  };
  const openRuleBacktest = async (rule) => {
    setRecommendation(null);
    setBacktestReturnView('edit');
    setView('backtest');
    setRecommendLoading(true);
    setNotice('');
    try {
      const payload = await requestRecommendation({
        code: rule.holdingFundCode,
        name: rule.holdingFundName,
        quantity: rule.holdingQuantity,
        holdingNotional: resolveRuleHoldingNotional(rule, holdings, snapshot),
        feeConfig: rule.feeConfig,
        highCodes: rule.highPremiumCodes || rule.runtimeConfig?.highPremiumCodes || DEFAULT_SWITCH_HIGH_CODES,
        timeframe: backtestTimeframe
      });
      setRecommendation(payload?.recommendation || null);
      setReanalysisRuleId(rule.id);
    } catch (error) {
      setNotice(error?.message || '回测请求失败，请稍后重试。');
    } finally {
      setRecommendLoading(false);
    }
  };

  const saveRule = async (rule, patch = {}) => {
    const nextRule = normalizeSwitchRuleModel({ ...rule, ...patch });
    const currentFee = normalizeFeeConfig(rule.feeConfig);
    const nextFee = normalizeFeeConfig(patch.feeConfig || currentFee);
    const feeChanged = JSON.stringify(currentFee) !== JSON.stringify(nextFee);
    const currentHighCodes = [...(rule.highPremiumCodes || rule.runtimeConfig?.highPremiumCodes || DEFAULT_SWITCH_HIGH_CODES)].sort();
    const nextHighCodes = [...(nextRule.highPremiumCodes || DEFAULT_SWITCH_HIGH_CODES)].sort();
    const highClassificationChanged = JSON.stringify(currentHighCodes) !== JSON.stringify(nextHighCodes);
    if (highClassificationChanged) {
      setSelectedCode(rule.holdingFundCode || rule.benchmarkCodes?.[0] || '');
      setFee(nextFee);
      setHighCodes(nextRule.highPremiumCodes || [...DEFAULT_SWITCH_HIGH_CODES]);
      setRecommendation(null);
      setReanalysisRuleId(rule.id);
      setStep('fee');
      setView('create');
      setTab('plans');
      setNotice('基金特征分类已变更，请重新生成推荐规则。');
      return false;
    }
    const mergedRule =
      feeChanged && (rule.backtestRecommendedValue !== null || rule.recommendationStatus === 'valid')
        ? normalizeSwitchRuleModel({
            ...nextRule,
            feeConfig: nextFee,
            thresholdMode: 'fixed',
            backtestRecommendedValue: null,
            recommendationStatus: 'fee_changed'
          })
        : nextRule;
    try {
      const result = await saveSwitchConfigToWorker(
        normalizeSwitchConfigShape({
          ...config,
          enabled: true,
          activeRuleId: mergedRule.id,
          rules: rules.map((item) => (item.id === mergedRule.id ? mergedRule : item))
        })
      );
      setConfig(result.config);
      setSnapshot(null);
      setRuntimeViews({});
      setNotice(feeChanged ? '费用已变更，推荐值需要重新生成。' : '规则已保存');
      return true;
    } catch (error) {
      setNotice(error?.message || '保存规则失败。');
      return false;
    }
  };

  const deleteRule = async (rule) => {
    const label = `${rule.holdingFundCode || ''} ${rule.holdingFundName || ''}`.trim();
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`确定删除“${label}”这条切换规则吗？\n\n删除后不会影响持仓和交易记录。`)
    )
      return;
    try {
      const result = await saveSwitchConfigToWorker(removeSwitchRule(config, rule.id));
      setConfig(result.config);
      setSnapshot(null);
      setRuntimeViews({});
      if (selectedRuleId === rule.id) {
        setSelectedRuleId('');
        setView('list');
      }
      setNotice('规则已删除');
    } catch (error) {
      setNotice(error?.message || '删除规则失败。');
    }
  };

  const runAll = async () => {
    if (!rules.length) {
      setNotice('请先添加规则');
      return;
    }
    const enabledCount = rules.filter(
      (rule) => rule.enabled && (rule.ruleType === 'market_watch' || resolveRuleHoldingQuantity(rule, holdings) > 0)
    ).length;
    const skippedCount = rules.filter(
      (rule) => rule.enabled && rule.ruleType !== 'market_watch' && resolveRuleHoldingQuantity(rule, holdings) <= 0
    ).length;
    if (!enabledCount) {
      setNotice(skippedCount ? '当前没有可运行的持仓方案，请先重新选择持仓。' : '请先启用至少一条规则');
      return;
    }
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `将获取最新行情，并对 ${enabledCount} 条启用中的规则执行一次分析。${skippedCount ? `\n跳过 ${skippedCount} 条无持仓方案。` : ''}\n\n可能生成新的切换信号\n不会自动交易`
      )
    )
      return;
    await executeSwitchRun();
  };

  const openRule = (rule) => {
    setSelectedRuleId(rule.id);
    setView('detail');
    setTab('plans');
  };

  const openRuleById = (ruleId) => {
    const rule = rules.find((item) => item.id === ruleId);
    if (rule) openRule(rule);
  };

  const createFromOpportunity = async (opportunity, feeConfig, options = {}) => {
    setCreatingOpportunityId(opportunity.id);
    setOpportunityError('');
    const submit = (target, extra = {}) => createSwitchRuleFromOpportunity({
      opportunityId: target.id,
      evaluatedAt: target.evaluatedAt,
      mode: opportunityResult?.mode || 'auto',
      holdings,
      feeConfig,
      ...extra
    });
    try {
      let result;
      try {
        result = await submit(opportunity, options);
      } catch (error) {
        const reason = error?.payload?.reason;
        const latest = error?.payload?.latestOpportunity;
        if (reason === 'candidate_missing') {
          if (!window.confirm(error.message)) return false;
          result = await submit(latest || opportunity, { ...options, allowCandidateUpdate: true, acceptLatest: true });
        } else if ((reason === 'opportunity_expired' || reason === 'opportunity_updated') && latest) {
          const changed = latest.targetFund?.code !== opportunity.targetFund?.code;
          const message = changed
            ? `机会数据已更新，当前更优目标为 ${latest.targetFund.code} ${latest.targetFund.name}。\n\n使用最新机会创建？`
            : '机会行情已更新，是否使用最新数据创建？';
          if (!window.confirm(message)) {
            await reloadOpportunities();
            return false;
          }
          result = await submit(latest, { ...options, acceptLatest: true });
        } else {
          throw error;
        }
      }
      if (result?.config) setConfig(normalizeSwitchConfigShape(result.config));
      if (result?.ruleId) setSelectedRuleId(result.ruleId);
      await reloadOpportunities({ force: true });
      if (result?.reason === 'existing_rule') {
        setNotice('该机会已由现有规则持续分析。');
        openRuleById(result.ruleId);
      } else {
        showActionToast('规则创建', 'success', { description: '已开始持续分析。' });
        setNotice(
          result?.reason === 'candidate_added'
            ? '已加入现有规则候选池。'
            : result?.reason === 'upgraded'
              ? '市场观察已升级为持仓切换提醒。'
              : '规则创建成功，已开始持续分析。'
        );
        try {
          const runResult = await runSwitchOnce();
          applyRunResult(runResult);
        } catch (runError) {
          setNotice(`规则已保存，首次分析暂未完成：${runError?.message || '请稍后重试。'}`);
        }
      }
      return true;
    } catch (error) {
      const message = error?.message || '创建规则失败。';
      setOpportunityError(message);
      showActionToast('规则创建', 'error', { description: message });
      return false;
    } finally {
      setCreatingOpportunityId('');
    }
  };

  const motionKey = `${tab}-${view}-${step}-${rules.length}`;

  if (loading)
    return (
      <div role="status" aria-label="页面加载中" className="mx-auto max-w-6xl space-y-4 px-4 pb-8 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-7 w-36 animate-pulse rounded-lg bg-slate-200" />
          <div className="mt-3 h-4 w-72 max-w-full animate-pulse rounded bg-slate-100" />
        </div>
        <div className="h-14 animate-pulse rounded-2xl bg-slate-100" />
        <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
        <span className="sr-only">正在加载切换方案</span>
      </div>
    );
  return (
    <SwitchPageMotion
      className="mx-auto max-w-[1500px] space-y-5 px-4 pb-8 sm:px-6 lg:px-8"
      motionKey={motionKey}
    >
      <div data-switch-motion-item>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">基金切换</h1>
        <p className="mt-1 text-sm text-slate-500">根据持仓、费用和历史数据，自动为您寻找更优切换机会并提醒。</p>
      </div>
      <div data-switch-motion-item className="flex items-center justify-between gap-3">
        <div className="inline-flex overflow-x-auto rounded-xl bg-slate-100 p-1">
          {TABS.map((item) => (
            <button
              type="button"
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => {
                setTab(item.id);
                setView(item.id === 'plans' ? 'list' : item.id);
              }}
              className={cx(
                'whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1',
                tab === item.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {view === 'list' && tab === 'plans' ? (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="hidden text-right text-xs sm:block">
              <div className="text-slate-500">上次运行：{formatRunTime(latestRun?.finishedAt || latestRun?.startedAt)}</div>
              <div className={cx('mt-1 font-semibold', latestRun?.status === 'failed' ? 'text-rose-600' : 'text-emerald-600')}>
                ● {latestRun?.status === 'failed' ? '失败' : latestRun?.status === 'partial' ? '部分成功' : latestRun ? '成功' : '等待首次运行'}
              </div>
            </div>
            <SwitchButton onClick={runAll} disabled={running} className="min-h-11 whitespace-nowrap px-4">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? '正在运行…' : latestRun?.status === 'failed' ? '重新运行' : '手动跑一次'}
            </SwitchButton>
          </div>
        ) : null}
      </div>
      {notice ? (
        <div data-switch-motion-item className="flex items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 shadow-sm">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {tab === 'records' ? (
        <SwitchPanel data-switch-motion-item>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">切换记录</h2>
              <p className="mt-1 text-sm text-slate-500">查看最近一次正式运行结果。</p>
            </div>
            <SwitchButton variant="secondary" onClick={reload}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </SwitchButton>
          </div>
          {latestRun ? (
            <div className="mt-5 rounded-xl bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-900">运行完成</span>
                <span className="text-xs text-slate-500">
                  {formatRunTime(latestRun.finishedAt || latestRun.startedAt)}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
                <div>
                  <div className="text-xs text-slate-500">分析规则</div>
                  <div className="mt-1 text-xl font-bold">
                    {latestRun.ruleCount || latestRun.ruleResults?.length || 0} 条
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">触发</div>
                  <div className="mt-1 text-xl font-bold">{latestRun.triggered || 0} 条</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">推送</div>
                  <div className="mt-1 text-xl font-bold">{latestRun.pushed || 0} 条</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">候选基金</div>
                  <div className="mt-1 text-xl font-bold">{latestRun.candidateCount || 0} 只</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">跳过</div>
                  <div className="mt-1 text-xl font-bold">{latestRun.skippedRuleCount || 0} 条</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">
              还没有运行记录。
            </div>
          )}
        </SwitchPanel>
      ) : null}
      {tab === 'opportunities' ? (
        <SwitchOpportunityPanel
          result={opportunityResult}
          loading={opportunityLoading}
          error={opportunityError}
          creatingId={creatingOpportunityId}
          initialFee={recentFeeConfig}
          onReload={reloadOpportunities}
          onCreate={createFromOpportunity}
          onOpenRule={openRuleById}
        />
      ) : null}
      {tab === 'plans' && view === 'list' ? (
        <>
          <div data-switch-motion-item>
            {realtimeAt ? (
              <div className="mb-3 flex items-center justify-end gap-2 text-xs text-emerald-600">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                溢价数据实时更新
              </div>
            ) : null}
            <StrategyRunStatus
              latestRun={latestRun}
              running={running}
              nextScheduledAt={nextScheduledAt}
              scheduleStatus={scheduleStatus}
              notificationStatus={notificationStatus}
              onOpenNotificationSettings={() => navigateWorkspace('notify')}
            />
          </div>
          {rules.length ? (
            <div className="space-y-4">
              {rules.map((rule) => (
                <div key={rule.id} data-switch-motion-item>
                  <SwitchStrategyCard
                    rule={rule}
                    snapshot={snapshot}
                    runtimeView={runtimeViews[rule.id]}
                    holdingNotional={resolveRuleHoldingNotional(rule, holdings, snapshot)}
                    holdingQuantity={resolveRuleHoldingQuantity(rule, holdings)}
                    expanded={expandedRuleId === rule.id}
                    onOpen={() => openRule(rule)}
                    onToggleExpand={() => setExpandedRuleId((current) => (current === rule.id ? '' : rule.id))}
                    onTest={() => setQuickRule(rule)}
                    onEdit={() => (rule.ruleType === 'market_watch' || resolveRuleHoldingQuantity(rule, holdings) > 0 ? startEdit(rule) : startRebind(rule))}
                    onToggle={() => saveRule(rule, { enabled: !rule.enabled })}
                    onDelete={() => deleteRule(rule)}
                  />
                </div>
              ))}
              <div data-switch-motion-item>
                <AddPlanEntry
                  onCreate={startCreate}
                  allHoldingsCovered={holdings.length > 0 && holdings.every((holding) => rules.some((rule) => rule.holdingFundCode === holding.code))}
                />
              </div>
            </div>
          ) : (
            <div data-switch-motion-item>
              <EmptyState onCreate={startCreate} onRun={runAll} running={running} />
            </div>
          )}
        </>
      ) : null}
      {view === 'create' && tab === 'plans' ? (
        step === 'holding' ? (
          <HoldingPicker
            holdings={holdings}
            rules={rules}
            replacingRuleId={reanalysisRuleId}
            selectedCode={selectedCode}
            setSelectedCode={setSelectedCode}
            manualCode={manualCode}
            setManualCode={setManualCode}
            onBack={() => setView('list')}
            onNext={() => setStep('fee')}
          />
        ) : step === 'fee' ? (
          <FeeForm
            fee={fee}
            setFee={setFee}
            holdingNotional={selectedHoldingNotional}
            backtestTimeframe={backtestTimeframe}
            setBacktestTimeframe={setBacktestTimeframe}
            onBack={() => setStep('holding')}
            onNext={(value) => {
              setFee(value);
              generate(value);
            }}
          />
        ) : recommendLoading ? (
          <RecommendationLoading />
        ) : recommendation ? (
          <RecommendationView
            recommendation={recommendation}
            fee={fee}
            holdingNotional={selectedHoldingNotional}
            backtestTimeframe={backtestTimeframe}
            setBacktestTimeframe={setBacktestTimeframe}
            onBack={() => setStep('fee')}
            onUse={useRecommendation}
            onBacktest={() => {
              setBacktestReturnView('create');
              setView('backtest');
            }}
            onRerun={() => generate(fee)}
          />
        ) : null
      ) : null}
      {view === 'backtest' ? (
        recommendation ? (
          <BacktestView
            recommendation={recommendation}
            onBack={() => setView(backtestReturnView)}
            onUse={useRecommendation}
          />
        ) : (
          <SwitchPanel data-switch-motion-item className="p-8 text-center text-sm text-slate-500">正在准备回测…</SwitchPanel>
        )
      ) : null}
      {view === 'edit' && selectedRule ? (
        <StrategyEditor
          rule={selectedRule}
          fee={editFee}
          setFee={setEditFee}
          thresholdMode={editThresholdMode}
          setThresholdMode={setEditThresholdMode}
          threshold={editThreshold}
          setThreshold={setEditThreshold}
          holdingNotional={resolveRuleHoldingNotional(selectedRule, holdings, snapshot)}
          highCodes={editHighCodes}
          setHighCodes={setEditHighCodes}
          onBack={() => setView('detail')}
          onBacktest={() => openRuleBacktest(selectedRule)}
          onSave={async (patch) => {
            if (await saveRule(selectedRule, patch)) setView('detail');
          }}
        />
      ) : null}
      {view === 'detail' && selectedRule ? (
        <SwitchRuleDetailView
          rule={selectedRule}
          snapshot={snapshot}
          runtimeView={runtimeViews[selectedRule.id]}
          holdingNotional={resolveRuleHoldingNotional(selectedRule, holdings, snapshot)}
          holdingQuantity={resolveRuleHoldingQuantity(selectedRule, holdings)}
          onBack={() => setView('list')}
          onTest={() => setQuickRule(selectedRule)}
          onEdit={() => (selectedRule.ruleType === 'market_watch' || resolveRuleHoldingQuantity(selectedRule, holdings) > 0 ? startEdit(selectedRule) : startRebind(selectedRule))}
          onToggle={() => saveRule(selectedRule, { enabled: !selectedRule.enabled })}
          onDelete={() => deleteRule(selectedRule)}
          onReanalyse={() => startReanalysis(selectedRule)}
          running={running}
        />
      ) : null}
      {quickRule ? <StrategyTestModal rule={quickRule} onClose={() => setQuickRule(null)} /> : null}
    </SwitchPageMotion>
  );
}
