import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
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
import { formatSwitchPercent, SwitchButton, SwitchPanel } from '../../components/fund-switch/ui.jsx';

const TABS = [
  { id: 'opportunities', label: '推荐机会' },
  { id: 'plans', label: '我的方案' },
  { id: 'records', label: '切换记录' }
];

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
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
        <Sparkles className="h-7 w-7" />
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
    <SwitchPanel>
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

function FeeForm({ fee, setFee, onBack, onNext }) {
  const validation = validateFeeConfig(fee);
  const update = (field, value) => setFee((current) => ({ ...current, [field]: value }));
  const fields = [
    ['sellCommissionRate', '卖出手续费', '%'],
    ['buyCommissionRate', '买入手续费', '%'],
    ['minimumCommission', '最低佣金', '元'],
    ['otherFee', '其他费用', '元']
  ];
  return (
    <SwitchPanel>
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
            fee.mode === 'estimated_total' ? fee.estimatedTotalFee : estimateSwitchCost(fee, 10000)
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

function RecommendationView({ recommendation, fee, onBack, onUse, onBacktest }) {
  const backtest = recommendation?.backtest || {};
  const optimized = backtest.selectionStatus === 'optimized';
  return (
    <SwitchPanel>
      <StepIndicator step="recommend" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">已生成推荐规则</h2>
          <p className="mt-1 text-sm text-slate-500">系统已完成候选匹配、费用计算和历史分析。</p>
        </div>
        <Sparkles className="h-6 w-6 text-amber-500" />
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
              fee.mode === 'estimated_total' ? fee.estimatedTotalFee : estimateSwitchCost(fee, 10000)
            )}{' '}
            元
          </div>
        </div>
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
                  : 'bg-slate-100 text-slate-600'
            )}
          >
            {backtest.status !== 'passed' ? '数据不足' : optimized ? '自动推荐' : '参考值'}
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
        {backtest.selectionReason && !optimized ? (
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
  return (
    <SwitchPanel>
      <div className="flex items-center gap-3">
        <SwitchButton variant="quiet" className="px-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </SwitchButton>
        <div>
          <h2 className="text-xl font-bold text-slate-900">历史回测</h2>
          <p className="mt-1 text-sm text-slate-500">回测区间、手续费和候选基金范围由系统自动完成。</p>
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
        <table className="w-full min-w-[540px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs text-slate-400">
            <tr>
              <th className="px-3 py-3">提醒值</th>
              <th className="px-3 py-3">触发次数</th>
              <th className="px-3 py-3">胜率</th>
              <th className="px-3 py-3">年化提升</th>
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
                    <span className="ml-1 text-xs text-emerald-700">推荐</span>
                  ) : null}
                </td>
                <td className="px-3 py-3">{item.triggerCount} 次</td>
                <td className="px-3 py-3">{formatSwitchPercent(item.winRatePct, 1)}</td>
                <td className="px-3 py-3">{formatSwitchPercent(item.annualizedReturnPct, 1)}</td>
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
  const [latestRun, setLatestRun] = useState(null);
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('list');
  const [step, setStep] = useState('holding');
  const [selectedCode, setSelectedCode] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [fee, setFee] = useState(() => ({ ...DEFAULT_SWITCH_FEE_CONFIG }));
  const [recommendation, setRecommendation] = useState(null);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const [reanalysisRuleId, setReanalysisRuleId] = useState('');
  const [editFee, setEditFee] = useState(() => ({ ...DEFAULT_SWITCH_FEE_CONFIG }));
  const [editThresholdMode, setEditThresholdMode] = useState('backtest');
  const [editThreshold, setEditThreshold] = useState('');
  const [quickRule, setQuickRule] = useState(null);
  const [expandedRuleId, setExpandedRuleId] = useState('');
  const [running, setRunning] = useState(false);
  const [backtestReturnView, setBacktestReturnView] = useState('create');
  const recommendationInFlight = useRef(new Map());

  const rules = Array.isArray(config?.rules) ? config.rules : [];
  const selectedHolding = useMemo(
    () => holdings.find((item) => item.code === selectedCode) || { code: selectedCode, name: '' },
    [holdings, selectedCode]
  );
  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId) || rules[0] || null,
    [rules, selectedRuleId]
  );

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
      setLatestRun(run?.run || null);
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
    setRecommendation(null);
    setReanalysisRuleId('');
    setStep('holding');
    setView('create');
    setTab('plans');
    setNotice('');
  };

  const requestRecommendation = async ({ code, name = '', quantity, feeConfig }) => {
    const normalizedFee = normalizeFeeConfig(feeConfig);
    const key = JSON.stringify({
      code,
      normalizedFee,
      candidates: SWITCH_STRATEGY_ETFS.map((item) => item.code)
    });
    const existing = recommendationInFlight.current.get(key);
    if (existing) return existing;
    const request = generateSwitchRecommendation({
      holdingFundCode: code,
      holdingFundName: name,
      holdingQuantity: quantity,
      feeConfig: normalizedFee,
      candidateCodes: SWITCH_STRATEGY_ETFS.map((item) => item.code)
    });
    recommendationInFlight.current.set(key, request);
    try {
      return await request;
    } finally {
      recommendationInFlight.current.delete(key);
    }
  };

  const generate = async (feeInput = fee) => {
    setRecommendLoading(true);
    setNotice('');
    try {
      const payload = await requestRecommendation({
        code: selectedHolding.code,
        name: selectedHolding.name,
        quantity: selectedHolding.totalShares,
        feeConfig: feeInput
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
      thresholdMode: 'backtest',
      thresholdValue: recommendation.thresholdValue,
      backtestRecommendedValue: recommendation.thresholdValue,
      recommendationStatus: 'valid',
      feeConfig: recommendation.feeConfig || fee,
      candidateFundCodes: recommendation.candidateFundCodes,
      runtimeConfig: {
        recommendationId: recommendation.recommendationId,
        premiumClass: recommendation.premiumClass,
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
      setNotice('已采用回测推荐值');
    } catch (error) {
      setNotice(error?.message || '保存规则失败。');
    }
  };

  const startEdit = (rule) => {
    setSelectedRuleId(rule.id);
    setEditFee(normalizeFeeConfig(rule.feeConfig));
    setEditThresholdMode(rule.thresholdMode === 'fixed' ? 'fixed' : 'backtest');
    setEditThreshold(String(rule.thresholdValue ?? rule.backtestRecommendedValue ?? ''));
    setView('edit');
    setTab('plans');
  };
  const startReanalysis = (rule) => {
    setSelectedCode(rule.holdingFundCode || rule.benchmarkCodes?.[0] || '');
    setFee(normalizeFeeConfig(rule.feeConfig));
    setRecommendation(null);
    setReanalysisRuleId(rule.id);
    setStep('fee');
    setView('create');
    setTab('plans');
  };
  const openRuleBacktest = async (rule) => {
    setRecommendLoading(true);
    setNotice('');
    try {
      const payload = await requestRecommendation({
        code: rule.holdingFundCode,
        name: rule.holdingFundName,
        quantity: rule.holdingQuantity,
        feeConfig: rule.feeConfig
      });
      setRecommendation(payload?.recommendation || null);
      setReanalysisRuleId(rule.id);
      setBacktestReturnView('edit');
      setView('backtest');
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
    setRunning(true);
    setNotice('');
    try {
      const result = await runSwitchOnce();
      setLatestRun(result?.summary || null);
      setSnapshot(result?.snapshot || null);
      setNotice(
        `运行完成：成功 ${result?.summary?.ruleCount || 0} 条，触发 ${result?.summary?.triggered || 0} 条`
      );
    } catch (error) {
      setNotice(error?.message || '运行失败，请稍后重试。');
    } finally {
      setRunning(false);
    }
  };

  const openRule = (rule) => {
    setSelectedRuleId(rule.id);
    setView('detail');
    setTab('plans');
  };
  if (loading)
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载切换方案…
      </div>
    );
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 pb-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">基金切换</h1>
          <p className="mt-1 text-sm text-slate-500">根据持仓、费用和历史数据管理切换提醒。</p>
        </div>
        {view === 'list' && tab === 'plans' ? (
          <SwitchButton onClick={startCreate}>
            <Plus className="h-4 w-4" />
            添加规则
          </SwitchButton>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex overflow-x-auto rounded-xl bg-slate-100 p-1">
          {TABS.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => {
                setTab(item.id);
                setView(item.id === 'plans' ? 'list' : item.id);
              }}
              className={cx(
                'whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold',
                tab === item.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === 'plans' && view === 'list' ? (
          <SwitchButton variant="secondary" onClick={runAll} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}手动跑一次
          </SwitchButton>
        ) : null}
      </div>
      {notice ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {tab === 'records' ? (
        <SwitchPanel>
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
        <SwitchPanel>
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
          <StrategyRunStatus latestRun={latestRun} running={running} onRun={runAll} onRetry={runAll} />
          {rules.length ? (
            <div className="space-y-4">
              {rules.map((rule, index) => (
                <SwitchStrategyCard
                  key={rule.id}
                  rule={rule}
                  snapshot={snapshot}
                  expanded={expandedRuleId ? expandedRuleId === rule.id : index === 0}
                  onOpen={() => openRule(rule)}
                  onToggleExpand={() => setExpandedRuleId((current) => (current === rule.id ? '' : rule.id))}
                  onTest={() => setQuickRule(rule)}
                  onEdit={() => startEdit(rule)}
                  onToggle={() => saveRule(rule, { enabled: !rule.enabled })}
                  onDelete={() => deleteRule(rule)}
                />
              ))}
            </div>
          ) : (
            <EmptyState onCreate={startCreate} onRun={runAll} running={running} />
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
            onBack={() => setStep('holding')}
            onNext={(value) => {
              setFee(value);
              generate(value);
            }}
          />
        ) : recommendLoading ? (
          <SwitchPanel className="flex min-h-[360px] flex-col items-center justify-center text-center">
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
          <SwitchPanel className="p-8 text-center text-sm text-slate-500">正在准备回测…</SwitchPanel>
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
          onBack={() => setView('list')}
          onTest={() => setQuickRule(selectedRule)}
          onEdit={() => startEdit(selectedRule)}
          onToggle={() => saveRule(selectedRule, { enabled: !selectedRule.enabled })}
          onDelete={() => deleteRule(selectedRule)}
          onReanalyse={() => startReanalysis(selectedRule)}
        />
      ) : null}
      {quickRule ? <StrategyTestModal rule={quickRule} onClose={() => setQuickRule(null)} /> : null}
    </div>
  );
}
