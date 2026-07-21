import { useEffect, useMemo, useRef, useState } from 'react';
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
  generateSwitchRecommendation,
  loadLatestSwitchRun,
  loadSwitchConfigFromWorker,
  loadSwitchSnapshotFromWorker,
  normalizeSwitchConfigShape,
  readSwitchConfigCache,
  removeSwitchRule,
  runSwitchOnce,
  saveSwitchConfigToWorker
} from '../../app/switchStrategySync.js';
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
import { navigateWorkspace } from '../notify/workspaceNavigation.js';

const TABS = [
  { id: 'opportunities', label: '推荐机会' },
  { id: 'plans', label: '我的方案' },
  { id: 'records', label: '切换记录' }
];

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
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

function StepIndicator({ step }) {
  return (
    <div className="mb-5 flex items-center gap-2 text-xs font-semibold text-slate-400">
      {[
        ['holding', '选择持仓'],
        ['fee', '切换费用'],
        ['recommend', '生成推荐']
      ].map(([id, label], index) => (
        <div key={id} className="flex items-center gap-2">
          <span
            className={cx(
              'flex h-7 w-7 items-center justify-center rounded-full',
              step === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
            )}
          >
            {index + 1}
          </span>
          <span className={step === id ? 'text-slate-800' : ''}>{label}</span>
          {index < 2 ? <ArrowRight className="h-3.5 w-3.5 text-slate-300" /> : null}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate, onRun, running }) {
  return (
    <SwitchPanel className="flex min-h-[360px] flex-col items-center justify-center text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
        <ArrowLeftRight className="h-7 w-7" />
      </div>
      <h2 className="mt-5 text-xl font-bold text-slate-900">还没有切换方案</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
        选择一只当前持仓，系统会自动寻找同类基金，并根据手续费和历史数据生成提醒条件。
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <SwitchButton onClick={onCreate}>
          <Plus className="h-4 w-4" />
          添加新的切换方案
        </SwitchButton>
        <SwitchButton variant="secondary" onClick={onRun} disabled={running}>
          <Play className="h-4 w-4" />
          手动跑一次
        </SwitchButton>
      </div>
    </SwitchPanel>
  );
}

function AddPlanEntry({ onCreate }) {
  return (
    <button
      type="button"
      onClick={onCreate}
      className="flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-5 py-5 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50/40"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-2xl font-light text-indigo-600">+</span>
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
  selectedCode,
  setSelectedCode,
  manualCode,
  setManualCode,
  onBack,
  onNext
}) {
  const existing = new Set(rules.map((rule) => rule.holdingFundCode || rule.benchmarkCodes?.[0]));
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
            onChange={(event) => setManualCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="输入 6 位基金代码"
            className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
          />
          <SwitchButton
            variant="secondary"
            onClick={() => setSelectedCode(manualCode)}
            disabled={!/^\d{6}$/.test(manualCode)}
          >
            使用
          </SwitchButton>
        </div>
      </div>
      <div className="mt-6 flex justify-between gap-3">
        <SwitchButton variant="secondary" onClick={onBack}>
          取消
        </SwitchButton>
        <SwitchButton onClick={onNext} disabled={!/^\d{6}$/.test(selectedCode)}>
          下一步
          <ArrowRight className="h-4 w-4" />
        </SwitchButton>
      </div>
    </SwitchPanel>
  );
}

function FeeForm({ fee, setFee, holdingNotional = 0, onBack, onNext }) {
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

function RecommendationView({ recommendation, fee, holdingNotional = 0, onBack, onUse, onBacktest }) {
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
              : `当当前持仓比同类基金贵 ${formatNumber(recommendation?.thresholdValue)}% 时提醒`}
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
      <div className="mt-6 flex flex-wrap justify-between gap-3">
        <SwitchButton variant="secondary" onClick={onBack}>
          上一步
        </SwitchButton>
        <div className="flex flex-wrap gap-2">
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
  const [backtestReturnView, setBacktestReturnView] = useState('create');
  const recommendationInFlight = useRef(new Map());
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
    const aggregate = aggregateByCode(ledger.transactions || [], ledger.snapshotsByCode || {})
      .filter((item) => item.totalShares > 0 || item.pendingBuyAmount > 0)
      .map((item) => ({ ...item, totalShares: item.totalShares || item.movingTotalShares || 0 }));
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
    highCodes: selectedHighCodes
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
      highCodes: normalizedHighCodes
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
      highCodes: normalizedHighCodes
    });
    recommendationInFlight.current.set(key, request);
    try {
      return await request;
    } finally {
      recommendationInFlight.current.delete(key);
    }
  };

  const applyRunResult = (result) => {
    setLatestRun(result?.summary || null);
    setSnapshot(result?.snapshot || null);
    const nextViews = (result?.summary?.ruleResults || []).reduce((map, item) => {
      if (item?.runtimeView?.ruleId) map[item.runtimeView.ruleId] = item.runtimeView;
      return map;
    }, {});
    realtimeViewsRef.current = nextViews;
    setRuntimeViews(nextViews);
    setNextScheduledAt(result?.summary?.nextScheduledAt || null);
    setScheduleStatus(result?.summary?.scheduleStatus || 'unknown');
    setNotificationStatus(result?.summary?.notificationStatus || 'unknown');
    return result?.summary || null;
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
          : `运行完成：成功 ${summary?.successRuleCount ?? summary?.ruleCount ?? 0} 条，触发 ${summary?.triggeredSignalCount ?? summary?.triggered ?? 0} 条`
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
        highCodes
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
    setHighCodes([...(rule.highPremiumCodes || rule.runtimeConfig?.highPremiumCodes || DEFAULT_SWITCH_HIGH_CODES)]);
    setRecommendation(null);
    setReanalysisRuleId(rule.id);
    setStep('fee');
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
        highCodes: rule.highPremiumCodes || rule.runtimeConfig?.highPremiumCodes || DEFAULT_SWITCH_HIGH_CODES
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
      setNotice('H 组已变更，请重新生成推荐规则。');
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
    const enabledCount = rules.filter((rule) => rule.enabled).length;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `将获取最新行情，并对 ${enabledCount} 条启用中的规则执行一次分析。\n\n可能生成新的切换信号\n不会自动交易`
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
      className="mx-auto max-w-6xl space-y-4 px-4 pb-8 sm:px-6"
      motionKey={motionKey}
    >
      <div data-switch-motion-item className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm shadow-slate-900/15">
            <ArrowLeftRight className="h-5 w-5" />
          </div>
          <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">基金切换</h1>
          <p className="mt-1 text-sm text-slate-500">根据持仓、费用和历史数据，自动为您寻找更优切换机会并提醒。</p>
          </div>
        </div>
        {view === 'list' && tab === 'plans' && latestRun ? (
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-right text-xs text-slate-500 shadow-sm">
            <div>上次运行：{latestRun.finishedAt || latestRun.startedAt || '—'}</div>
            <div className={cx('mt-1 font-semibold', latestRun.status === 'failed' ? 'text-rose-600' : 'text-emerald-600')}>
              ● {latestRun.status === 'failed' ? '失败' : latestRun.status === 'partial' ? '部分成功' : '成功'}
            </div>
          </div>
        ) : null}
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
      </div>
      {notice ? (
        <div data-switch-motion-item className="flex items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-sm">
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
                  {latestRun.finishedAt || latestRun.startedAt || '—'}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
        <SwitchPanel data-switch-motion-item>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-600" />
            <h2 className="text-lg font-bold text-slate-900">推荐机会</h2>
          </div>
          {rules.length ? (
            <div className="mt-5 space-y-3">
              {rules
                .filter((rule) => rule.enabled)
                .map((rule) => (
                  <button
                    type="button"
                    key={rule.id}
                    onClick={() => openRule(rule)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-4 text-left hover:border-slate-400"
                  >
                    <span>
                      <span className="block font-bold text-slate-900">
                        {rule.holdingFundCode} {rule.holdingFundName}
                      </span>
                      <span className="mt-1 block text-sm text-slate-500">
                        {getSwitchConditionText(rule)}
                      </span>
                    </span>
                    <ArrowRight className="h-5 w-5 text-slate-300" />
                  </button>
                ))}
            </div>
          ) : (
            <div className="mt-6 rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">
              添加规则后，这里会展示当前切换优势。
            </div>
          )}
        </SwitchPanel>
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
              onRun={runAll}
              onRetry={runAll}
              onOpenNotificationSettings={() => navigateWorkspace('notify')}
            />
          </div>
          {rules.length ? (
            <div className="space-y-4">
              {rules.map((rule, index) => (
                <div key={rule.id} data-switch-motion-item>
                  <SwitchStrategyCard
                    rule={rule}
                    snapshot={snapshot}
                    runtimeView={runtimeViews[rule.id]}
                    holdingNotional={resolveRuleHoldingNotional(rule, holdings, snapshot)}
                    expanded={expandedRuleId ? expandedRuleId === rule.id : index === 0}
                    onOpen={() => openRule(rule)}
                    onToggleExpand={() => setExpandedRuleId((current) => (current === rule.id ? '' : rule.id))}
                    onTest={() => setQuickRule(rule)}
                    onEdit={() => startEdit(rule)}
                    onToggle={() => saveRule(rule, { enabled: !rule.enabled })}
                    onDelete={() => deleteRule(rule)}
                  />
                </div>
              ))}
              <div data-switch-motion-item>
                <AddPlanEntry onCreate={startCreate} />
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
            onBack={() => setStep('holding')}
            onNext={(value) => {
              setFee(value);
              generate(value);
            }}
          />
        ) : recommendLoading ? (
          <SwitchPanel data-switch-motion-item className="flex min-h-[360px] flex-col items-center justify-center text-center">
            <Loader2 className="h-8 w-8 animate-spin text-slate-700" />
            <h2 className="mt-4 text-lg font-bold text-slate-900">正在生成推荐规则</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              正在匹配同类基金
              <br />
              正在计算切换费用
              <br />
              正在分析历史溢价差
              <br />
              正在寻找更合适的提醒条件
            </p>
          </SwitchPanel>
        ) : recommendation ? (
          <RecommendationView
            recommendation={recommendation}
            fee={fee}
            holdingNotional={selectedHoldingNotional}
            onBack={() => setStep('fee')}
            onUse={useRecommendation}
            onBacktest={() => {
              setBacktestReturnView('create');
              setView('backtest');
            }}
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
          onBack={() => setView('list')}
          onTest={() => setQuickRule(selectedRule)}
          onEdit={() => startEdit(selectedRule)}
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
