import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, FlaskConical,
  Loader2, PauseCircle, Play, Plus, RefreshCw, RotateCcw, Settings2,
  SlidersHorizontal, Sparkles, TrendingUp, WalletCards, X
} from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { readLedgerState } from '../../app/holdingsLedger.js';
import { aggregateByCode } from '../../app/holdingsLedgerCore.js';
import {
  buildDefaultSwitchConfig,
  buildSwitchRuleId,
  generateSwitchRecommendation,
  loadLatestSwitchRun,
  loadSwitchConfigFromWorker,
  loadSwitchSnapshotFromWorker,
  normalizeSwitchConfigShape,
  readSwitchConfigCache,
  runSwitchOnce,
  runSwitchQuickTest,
  saveSwitchConfigToWorker
} from '../../app/switchStrategySync.js';
import {
  DEFAULT_SWITCH_FEE_CONFIG,
  estimateSwitchCost,
  getSwitchConditionText,
  getSwitchStatusText,
  normalizeFeeConfig,
  normalizeSwitchRuleModel,
  validateFeeConfig
} from '../../app/switchRuleModel.js';
import { SWITCH_STRATEGY_ETFS } from '../../app/nasdaqCatalog.js';

const TABS = [
  { id: 'opportunities', label: '推荐机会' },
  { id: 'plans', label: '我的方案' },
  { id: 'records', label: '切换记录' }
];

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
}

function formatPercent(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits)}%` : '—';
}

function Button({ children, className = '', variant = 'primary', ...props }) {
  const variants = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800',
    secondary: 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
    quiet: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
    danger: 'border border-rose-200 bg-white text-rose-600 hover:bg-rose-50'
  };
  return <button type="button" className={cx('inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50', variants[variant], className)} {...props}>{children}</button>;
}

function Panel({ children, className = '' }) {
  return <section className={cx('rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5', className)}>{children}</section>;
}

function Stat({ label, value, hint = '', tone = 'slate' }) {
  const color = tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900';
  return <div className="min-w-0"><div className="text-xs text-slate-500">{label}</div><div className={cx('mt-1 text-xl font-bold tracking-tight', color)}>{value}</div>{hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}</div>;
}

function StepIndicator({ step }) {
  return <div className="mb-5 flex items-center gap-2 text-xs font-semibold text-slate-400">
    {[['holding', '选择持仓'], ['fee', '切换费用'], ['recommend', '生成推荐']].map(([id, label], index) => (
      <div key={id} className="flex items-center gap-2">
        <span className={cx('flex h-7 w-7 items-center justify-center rounded-full', step === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500')}>{index + 1}</span>
        <span className={cx(step === id ? 'text-slate-800' : '')}>{label}</span>
        {index < 2 ? <ArrowRight className="h-3.5 w-3.5 text-slate-300" /> : null}
      </div>
    ))}
  </div>;
}

function ruleSnapshotFor(snapshot, ruleId) {
  if (!snapshot) return null;
  const nested = Array.isArray(snapshot.rules) ? snapshot.rules.find((item) => item.ruleId === ruleId)?.snapshot : null;
  return nested || snapshot;
}

function maxAdvantageFor(snapshot) {
  const values = (snapshot?.byBenchmark || []).flatMap((item) => item?.candidates || [])
    .map((item) => Number(item?.advantagePct ?? item?.gapPct ?? item?.spreadVsBenchmarkPct));
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

function EmptyState({ onCreate, onRun, running = false }) {
  return <Panel className="flex min-h-[360px] flex-col items-center justify-center text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700"><Sparkles className="h-7 w-7" /></div>
    <h2 className="mt-5 text-xl font-bold text-slate-900">还没有切换规则</h2>
    <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">选择一只当前持仓，系统会自动寻找同类基金，并根据手续费和历史数据生成提醒条件。</p>
    <div className="mt-6 flex flex-wrap justify-center gap-3">
      <Button onClick={onCreate}><Plus className="h-4 w-4" />添加第一条规则</Button>
      <Button variant="secondary" onClick={onRun} disabled={running}><Play className="h-4 w-4" />手动跑一次</Button>
    </div>
  </Panel>;
}

function FeeForm({ fee, setFee, onBack, onNext }) {
  const validation = validateFeeConfig(fee);
  const update = (field, value) => setFee((current) => ({ ...current, [field]: value }));
  return <Panel>
    <StepIndicator step="fee" />
    <h2 className="text-xl font-bold text-slate-900">切换费用</h2>
    <p className="mt-1 text-sm text-slate-500">手续费会纳入推荐提醒值和历史回测。</p>
    <div className="mt-5 inline-flex rounded-xl bg-slate-100 p-1 text-sm">
      {[['detailed', '按明细计算'], ['estimated_total', '直接填写预计总费用']].map(([mode, label]) => <button type="button" key={mode} onClick={() => update('mode', mode)} className={cx('rounded-lg px-3 py-2 font-semibold', fee.mode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>{label}</button>)}
    </div>
    {fee.mode === 'detailed' ? <div className="mt-5 grid gap-4 sm:grid-cols-2">
      {[
        ['sellCommissionRate', '卖出手续费', '%'],
        ['buyCommissionRate', '买入手续费', '%'],
        ['minimumCommission', '最低佣金', '元'],
        ['otherFee', '其他费用', '元']
      ].map(([field, label, suffix]) => <label key={field} className="text-sm font-semibold text-slate-700">{label}<div className="relative mt-1.5"><input inputMode="decimal" value={fee[field] ?? ''} onChange={(event) => update(field, event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 pr-12 text-sm outline-none focus:border-slate-500" /><span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-400">{suffix}</span></div>{validation.errors[field] ? <span className="mt-1 block text-xs font-normal text-rose-600">{validation.errors[field]}</span> : null}</label>)}
    </div> : <label className="mt-5 block max-w-sm text-sm font-semibold text-slate-700">预计单次切换总费用<div className="relative mt-1.5"><input inputMode="decimal" value={fee.estimatedTotalFee ?? ''} onChange={(event) => update('estimatedTotalFee', event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 pr-12 text-sm outline-none focus:border-slate-500" /><span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-400">元</span></div>{validation.errors.estimatedTotalFee ? <span className="mt-1 block text-xs font-normal text-rose-600">{validation.errors.estimatedTotalFee}</span> : null}</label>}
    <div className="mt-5 rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-500">预计单次切换成本</div><div className="mt-1 text-2xl font-bold text-slate-900">约 {formatNumber(fee.mode === 'estimated_total' ? fee.estimatedTotalFee : estimateSwitchCost(fee, 10000))} 元</div><div className="mt-1 text-xs text-slate-400">实际金额会根据切换金额和券商规则变化。</div></div>
    <div className="mt-6 flex justify-between gap-3"><Button variant="secondary" onClick={onBack}><ArrowLeft className="h-4 w-4" />上一步</Button><Button onClick={() => onNext(validation.value)} disabled={!validation.valid}>生成推荐规则<ArrowRight className="h-4 w-4" /></Button></div>
  </Panel>;
}

function RuleEditor({ rule, fee, setFee, thresholdMode, setThresholdMode, threshold, setThreshold, onBack, onSave }) {
  const validation = validateFeeConfig(fee);
  return <Panel><div className="flex items-center gap-3"><Button variant="quiet" className="px-2" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button><div><h2 className="text-xl font-bold text-slate-900">编辑规则</h2><p className="mt-1 text-sm text-slate-500">保留当前持仓和候选基金，只调整提醒条件与费用。</p></div></div><div className="mt-6"><div className="text-sm font-semibold text-slate-700">提醒值</div><div className="mt-2 flex gap-2"><button type="button" onClick={() => setThresholdMode('backtest')} className={cx('rounded-xl border px-4 py-2.5 text-sm font-semibold', thresholdMode === 'backtest' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600')}>推荐值</button><button type="button" onClick={() => setThresholdMode('fixed')} className={cx('rounded-xl border px-4 py-2.5 text-sm font-semibold', thresholdMode === 'fixed' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600')}>自定义</button></div>{thresholdMode === 'fixed' ? <><div className="mt-3 flex max-w-xs items-center gap-2"><input inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" /><span className="text-sm text-slate-500">% 时提醒</span></div><p className="mt-2 text-xs leading-5 text-slate-400">数值越小，提醒越频繁；数值越大，机会要求越严格。</p></> : <p className="mt-3 text-sm text-slate-500">当前使用回测推荐值 {formatPercent(rule.backtestRecommendedValue || rule.thresholdValue)}。</p>}</div><div className="mt-6 border-t border-slate-100 pt-5"><div className="text-sm font-semibold text-slate-700">切换费用</div><div className="mt-3 grid gap-3 sm:grid-cols-2">{[['sellCommissionRate', '卖出手续费', '%'], ['buyCommissionRate', '买入手续费', '%'], ['minimumCommission', '最低佣金', '元'], ['otherFee', '其他费用', '元']].map(([field, label, suffix]) => <label key={field} className="text-sm text-slate-600">{label}<div className="relative mt-1"><input inputMode="decimal" value={fee[field] ?? ''} onChange={(event) => setFee((current) => ({ ...current, [field]: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 pr-10 text-sm" /><span className="pointer-events-none absolute right-3 top-2.5 text-xs text-slate-400">{suffix}</span></div></label>)}</div></div><div className="mt-6 flex justify-end gap-2"><Button variant="secondary" onClick={onBack}>取消</Button><Button onClick={() => onSave({ thresholdMode, thresholdValue: thresholdMode === 'fixed' ? Number(threshold) : Number(rule.backtestRecommendedValue || rule.thresholdValue), feeConfig: validation.value })} disabled={!validation.valid || (thresholdMode === 'fixed' && (!Number.isFinite(Number(threshold)) || Number(threshold) < 0))}>保存规则</Button></div></Panel>;
}

function HoldingPicker({ holdings, rules, selectedCode, setSelectedCode, manualCode, setManualCode, onBack, onNext }) {
  const existing = new Set((rules || []).map((rule) => rule.holdingFundCode || rule.benchmarkCodes?.[0]));
  return <Panel>
    <StepIndicator step="holding" />
    <h2 className="text-xl font-bold text-slate-900">选择当前持仓</h2>
    <p className="mt-1 text-sm text-slate-500">选择一只需要持续分析切换机会的基金。</p>
    <div className="mt-5 space-y-2">
      {holdings.map((holding) => {
        const code = holding.code;
        const disabled = existing.has(code);
        return <button type="button" key={code} disabled={disabled} onClick={() => setSelectedCode(code)} className={cx('flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors', selectedCode === code ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300', disabled && 'cursor-not-allowed opacity-50')}>
          <span><span className="block font-semibold text-slate-900">{code} {holding.name || ''}</span><span className="mt-1 block text-xs text-slate-500">持有 {Number(holding.totalShares || holding.movingTotalShares || 0).toLocaleString('zh-CN')} 份</span></span>
          {disabled ? <span className="text-xs font-semibold text-slate-400">已有规则</span> : selectedCode === code ? <Check className="h-5 w-5 text-slate-900" /> : null}
        </button>;
      })}
      {!holdings.length ? <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">暂时没有可用持仓，可以手动添加基金。</div> : null}
    </div>
    <div className="mt-5 border-t border-slate-100 pt-4"><div className="text-sm font-semibold text-slate-700">手动添加基金</div><div className="mt-2 flex gap-2"><input value={manualCode} onChange={(event) => setManualCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="输入 6 位基金代码" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-500" /><Button variant="secondary" onClick={() => setSelectedCode(manualCode)} disabled={!/^\d{6}$/.test(manualCode)}>使用</Button></div></div>
    <div className="mt-6 flex justify-between gap-3"><Button variant="secondary" onClick={onBack}><X className="h-4 w-4" />取消</Button><Button onClick={onNext} disabled={!/^\d{6}$/.test(selectedCode)}>下一步<ArrowRight className="h-4 w-4" /></Button></div>
  </Panel>;
}

function RecommendationView({ recommendation, fee, onBack, onUse, onBacktest }) {
  const backtest = recommendation?.backtest || {};
  return <Panel>
    <StepIndicator step="recommend" />
    <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">已生成推荐规则</h2><p className="mt-1 text-sm text-slate-500">系统已完成候选匹配、费用计算和历史分析。</p></div><Sparkles className="h-6 w-6 text-amber-500" /></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-500">当前持仓</div><div className="mt-2 font-bold text-slate-900">{recommendation?.holdingFundCode} {recommendation?.holdingFundName}</div></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-500">推荐提醒条件</div><div className="mt-2 text-sm font-bold leading-6 text-slate-900">{recommendation?.holdingSide === 'low' ? `当切回候选基金的价差收窄到 ${formatNumber(recommendation?.thresholdValue)}% 以内时提醒` : `当当前持仓比同类基金贵 ${formatNumber(recommendation?.thresholdValue)}% 时提醒`}</div></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-500">预计单次切换成本</div><div className="mt-2 font-bold text-slate-900">约 {formatNumber(fee.mode === 'estimated_total' ? fee.estimatedTotalFee : estimateSwitchCost(fee, 10000))} 元</div></div></div>
    <div className="mt-5 rounded-xl border border-slate-100 p-4"><div className="flex items-center justify-between"><h3 className="font-bold text-slate-900">历史回测</h3><span className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', backtest.status === 'passed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{backtest.status === 'passed' ? '数据可用' : '数据不足'}</span></div><div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4"><Stat label="触发" value={`${backtest.triggerCount ?? 0} 次`} /><Stat label="胜率" value={formatPercent(backtest.winRatePct, 1)} tone="emerald" /><Stat label="年化提升" value={formatPercent(backtest.annualizedReturnPct, 1)} tone="emerald" /><Stat label="最大回撤" value={formatPercent(backtest.maxDrawdownPct, 2)} /></div></div>
    {recommendation?.historyIssues?.length ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">部分历史数据暂不可用，推荐值会在数据补齐后重新分析。</div> : null}
    <div className="mt-6 flex flex-wrap justify-between gap-3"><Button variant="secondary" onClick={onBack}><ArrowLeft className="h-4 w-4" />上一步</Button><div className="flex gap-2"><Button variant="secondary" onClick={onBacktest}><TrendingUp className="h-4 w-4" />查看回测结果</Button><Button onClick={onUse}>使用推荐规则<Check className="h-4 w-4" /></Button></div></div>
  </Panel>;
}

function BacktestView({ recommendation, onBack, onUse }) {
  const comparison = recommendation?.backtest?.comparison || [];
  return <Panel><div className="flex items-center gap-3"><Button variant="quiet" className="px-2" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button><div><h2 className="text-xl font-bold text-slate-900">历史回测</h2><p className="mt-1 text-sm text-slate-500">回测区间、手续费和候选基金范围由系统自动完成。</p></div></div><div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4"><Stat label="推荐提醒值" value={formatPercent(recommendation?.backtest?.recommendedValue)} /><Stat label="触发次数" value={`${recommendation?.backtest?.triggerCount || 0} 次`} /><Stat label="胜率" value={formatPercent(recommendation?.backtest?.winRatePct, 1)} tone="emerald" /><Stat label="年化提升" value={formatPercent(recommendation?.backtest?.annualizedReturnPct, 1)} tone="emerald" /></div><div className="mt-6 overflow-x-auto"><table className="w-full min-w-[540px] text-left text-sm"><thead className="border-b border-slate-100 text-xs text-slate-400"><tr><th className="px-3 py-3">提醒值</th><th className="px-3 py-3">触发次数</th><th className="px-3 py-3">胜率</th><th className="px-3 py-3">年化提升</th></tr></thead><tbody>{comparison.map((item) => <tr key={item.threshold} className={cx('border-b border-slate-50', item.threshold === recommendation?.backtest?.recommendedValue && 'bg-emerald-50/60')}><td className="px-3 py-3 font-semibold">{formatPercent(item.threshold)} {item.threshold === recommendation?.backtest?.recommendedValue ? <span className="ml-1 text-xs text-emerald-700">推荐</span> : null}</td><td className="px-3 py-3">{item.triggerCount} 次</td><td className="px-3 py-3">{formatPercent(item.winRatePct, 1)}</td><td className="px-3 py-3">{formatPercent(item.annualizedReturnPct, 1)}</td></tr>)}</tbody></table></div><div className="mt-6 flex justify-between gap-3"><Button variant="secondary" onClick={onBack}>返回上一步</Button><Button onClick={onUse}>使用推荐值 {formatPercent(recommendation?.backtest?.recommendedValue)}</Button></div></Panel>;
}

function QuickTestModal({ rule, onClose }) {
  const [state, setState] = useState({ status: 'idle', payload: null, error: '' });
  const start = async () => {
    setState({ status: 'running', payload: null, error: '' });
    try { setState({ status: 'success', payload: await runSwitchQuickTest(rule.id) }); } catch (error) { setState({ status: 'failed', payload: null, error: error?.message || '快速测试失败' }); }
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 p-3 sm:items-center"><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold text-slate-900">快速测试</h2><p className="mt-1 text-sm text-slate-500">将立即请求远端服务器，获取最新行情并运行这条规则。</p></div><button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-500">不会发送正式提醒<br />不会修改持仓<br />不会产生交易</div>{state.status === 'idle' ? <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>取消</Button><Button onClick={start}><FlaskConical className="h-4 w-4" />开始测试</Button></div> : state.status === 'running' ? <div className="mt-6 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />正在获取最新行情并运行规则</div> : <div className="mt-5"><div className={cx('rounded-xl p-4 text-sm', state.status === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}><div className="font-bold">{state.status === 'success' ? '测试成功' : '测试未通过'}</div>{state.status === 'success' ? <div className="mt-2 space-y-1 text-xs"><div>远端服务器连接正常</div><div>最新行情获取成功</div><div>规则计算正常</div><div>通知通道正常</div><div className="pt-2 font-semibold">当前结果：{state.payload?.result?.status === 'triggered' ? '已达到提醒条件' : '尚未触发'}</div></div> : <div className="mt-2 text-xs">错误原因：{state.error}</div>}</div><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={start}><RotateCcw className="h-4 w-4" />重新测试</Button><Button onClick={onClose}>完成</Button></div></div>}</div></div>;
}

function RuleCard({ rule, snapshot, onOpen, onTest, onEdit, onToggle }) {
  const model = normalizeSwitchRuleModel(rule);
  const currentSnapshot = ruleSnapshotFor(snapshot, model.id);
  const advantage = maxAdvantageFor(currentSnapshot);
  return <Panel className="cursor-pointer transition-shadow hover:shadow-md" onClick={onOpen}><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-bold text-slate-900">{model.holdingFundCode} {model.holdingFundName}</h3><span className={cx('rounded-full px-2 py-1 text-xs font-semibold', model.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{model.enabled ? '已启用' : '已停用'}</span></div><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><div className="text-xs text-slate-400">监控目标</div><div className="mt-1 font-semibold text-slate-700">寻找更便宜的同类基金</div></div><div><div className="text-xs text-slate-400">提醒条件</div><div className="mt-1 font-semibold text-slate-700">{getSwitchConditionText(model)}</div></div></div></div><ChevronDown className="h-5 w-5 text-slate-300" /></div><div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4"><Stat label="当前最大切换优势" value={formatPercent(advantage)} /><Stat label="当前状态" value={getSwitchStatusText('', { maxAdvantage: advantage })} /></div><div className="mt-4 flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}><Button variant="secondary" className="px-3 py-2 text-xs" onClick={onTest}><FlaskConical className="h-3.5 w-3.5" />快速测试</Button><Button variant="quiet" className="px-3 py-2 text-xs" onClick={onEdit}><Settings2 className="h-3.5 w-3.5" />编辑</Button><Button variant="quiet" className="px-3 py-2 text-xs" onClick={onToggle}>{model.enabled ? <PauseCircle className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{model.enabled ? '停用' : '启用'}</Button></div></Panel>;
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
  const [running, setRunning] = useState(false);

  const rules = Array.isArray(config?.rules) ? config.rules : [];
  const selectedHolding = useMemo(() => holdings.find((item) => item.code === selectedCode) || { code: selectedCode, name: '' }, [holdings, selectedCode]);
  const selectedRule = useMemo(() => rules.find((rule) => rule.id === selectedRuleId) || rules[0] || null, [rules, selectedRuleId]);

  const reload = async () => {
    const ledger = readLedgerState();
    const aggregate = aggregateByCode(ledger.transactions || [], ledger.snapshotsByCode || {}).filter((item) => item.totalShares > 0 || item.pendingBuyAmount > 0).map((item) => ({ ...item, totalShares: item.totalShares || item.movingTotalShares || 0 }));
    setHoldings(aggregate);
    try {
      const [remoteConfig, remoteSnapshot, run] = await Promise.all([loadSwitchConfigFromWorker(), loadSwitchSnapshotFromWorker(), loadLatestSwitchRun()]);
      setConfig(remoteConfig); setSnapshot(remoteSnapshot?.snapshot || null); setLatestRun(run?.run || null);
    } catch (error) {
      setNotice(error?.message || '暂时无法连接远端服务，已显示本机缓存。');
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); }, []);

  const startCreate = () => {
    const existing = new Set(rules.map((rule) => rule.holdingFundCode || rule.benchmarkCodes?.[0]));
    setSelectedCode(holdings.find((item) => !existing.has(item.code))?.code || '');
    setManualCode(''); setFee({ ...DEFAULT_SWITCH_FEE_CONFIG }); setRecommendation(null); setStep('holding'); setView('create'); setTab('plans'); setNotice('');
  };

  const generate = async (feeInput = fee) => {
    setRecommendLoading(true); setNotice('');
    try {
      const payload = await generateSwitchRecommendation({ holdingFundCode: selectedHolding.code, holdingFundName: selectedHolding.name, holdingQuantity: selectedHolding.totalShares, feeConfig: normalizeFeeConfig(feeInput), candidateCodes: SWITCH_STRATEGY_ETFS.map((item) => item.code) });
      setRecommendation(payload?.recommendation || null); setStep('recommend');
    } catch (error) { setNotice(error?.message || '推荐规则生成失败，请稍后重试。'); } finally { setRecommendLoading(false); }
  };

  const useRecommendation = async () => {
    if (!recommendation) return;
    const nextRule = normalizeSwitchRuleModel({
      id: buildSwitchRuleId(), name: `${recommendation.holdingFundCode} 切换方案`, enabled: true,
      holdingFundCode: recommendation.holdingFundCode, holdingFundName: recommendation.holdingFundName, holdingQuantity: recommendation.holdingQuantity,
      thresholdMode: 'backtest', thresholdValue: recommendation.thresholdValue, backtestRecommendedValue: recommendation.thresholdValue,
      feeConfig: recommendation.feeConfig || fee, candidateFundCodes: recommendation.candidateFundCodes,
      runtimeConfig: { recommendationId: recommendation.recommendationId, premiumClass: recommendation.premiumClass, premiumClassUpdatedAt: recommendation.classifiedAt, classificationSource: recommendation.classificationSource, classificationStatus: recommendation.classificationStatus, intraSellLowerPct: recommendation.intraSellLowerPct, intraBuyOtherPct: recommendation.intraBuyOtherPct, holdingSideAtRecommendation: recommendation.holdingSide, triggerOperatorAtRecommendation: recommendation.triggerOperator },
      lastResult: { status: recommendation.backtest?.status || 'pending', recommendationId: recommendation.recommendationId, backtest: recommendation.backtest, candidates: recommendation.candidatesResult }
    });
    const targetRuleId = reanalysisRuleId || nextRule.id;
    const nextRules = reanalysisRuleId ? rules.map((item) => item.id === reanalysisRuleId ? { ...nextRule, id: reanalysisRuleId } : item) : [...rules, nextRule];
    const next = normalizeSwitchConfigShape({ ...config, enabled: true, activeRuleId: targetRuleId, rules: nextRules });
    try { const result = await saveSwitchConfigToWorker(next); setConfig(result.config); setSelectedRuleId(targetRuleId); setReanalysisRuleId(''); setView('detail'); setSnapshot(null); setNotice('已采用回测推荐值'); } catch (error) { setNotice(error?.message || '保存规则失败。'); }
  };

  const startEdit = (rule) => {
    setSelectedRuleId(rule.id); setEditFee(normalizeFeeConfig(rule.feeConfig)); setEditThresholdMode(rule.thresholdMode === 'fixed' ? 'fixed' : 'backtest'); setEditThreshold(String(rule.thresholdValue ?? rule.backtestRecommendedValue ?? '')); setView('edit'); setTab('plans');
  };

  const startReanalysis = (rule) => {
    setSelectedCode(rule.holdingFundCode || rule.benchmarkCodes?.[0] || ''); setFee(normalizeFeeConfig(rule.feeConfig)); setRecommendation(null); setReanalysisRuleId(rule.id); setStep('fee'); setView('create'); setTab('plans');
  };

  const saveRule = async (rule, patch = {}) => {
    const nextRule = normalizeSwitchRuleModel({ ...rule, ...patch });
    const next = normalizeSwitchConfigShape({ ...config, enabled: true, activeRuleId: nextRule.id, rules: rules.map((item) => item.id === nextRule.id ? nextRule : item) });
    try { const result = await saveSwitchConfigToWorker(next); setConfig(result.config); setNotice('规则已保存'); } catch (error) { setNotice(error?.message || '保存规则失败。'); }
  };

  const runAll = async () => {
    if (!rules.length) { setNotice('请先添加规则'); return; }
    if (typeof window !== 'undefined' && !window.confirm(`将获取最新行情，并对 ${rules.filter((rule) => rule.enabled).length} 条启用中的规则执行一次分析。\n\n可能生成新的切换信号\n不会自动交易`)) return;
    setRunning(true); setNotice('');
    try { const result = await runSwitchOnce(); setLatestRun(result?.summary || null); setSnapshot(result?.snapshot || null); setNotice(`运行完成：成功 ${result?.summary?.ruleCount || 0} 条，触发 ${result?.summary?.triggered || 0} 条`); } catch (error) { setNotice(error?.message || '运行失败，请稍后重试。'); } finally { setRunning(false); }
  };

  const openRule = (rule) => { setSelectedRuleId(rule.id); setView('detail'); setTab('plans'); };
  const activeSnapshot = selectedRule ? ruleSnapshotFor(snapshot, selectedRule.id) : null;
  const candidates = activeSnapshot?.byBenchmark?.find((item) => item.benchmarkCode === selectedRule?.holdingFundCode)?.candidates || [];

  if (loading) return <div className="flex min-h-[360px] items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载切换方案…</div>;

  return <div className="mx-auto max-w-5xl space-y-4 px-4 pb-8 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold tracking-tight text-slate-900">基金切换</h1><p className="mt-1 text-sm text-slate-500">根据持仓、费用和历史数据管理切换提醒。</p></div>{view === 'list' && tab === 'plans' ? <Button onClick={startCreate}><Plus className="h-4 w-4" />添加规则</Button> : null}</div>
    <div className="flex items-center justify-between gap-3"><div className="inline-flex rounded-xl bg-slate-100 p-1">{TABS.map((item) => <button type="button" key={item.id} onClick={() => { setTab(item.id); setView(item.id === 'plans' ? 'list' : item.id); }} className={cx('rounded-lg px-4 py-2 text-sm font-semibold', tab === item.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>{item.label}</button>)}</div>{tab === 'plans' && view === 'list' ? <Button variant="secondary" onClick={runAll} disabled={running}>{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}手动跑一次</Button> : null}</div>
    {notice ? <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white"><span>{notice}</span><button type="button" onClick={() => setNotice('')}><X className="h-4 w-4" /></button></div> : null}
    {tab === 'records' ? <Panel><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold text-slate-900">切换记录</h2><p className="mt-1 text-sm text-slate-500">查看最近一次正式运行结果。</p></div><Button variant="secondary" onClick={reload}><RefreshCw className="h-4 w-4" />刷新</Button></div>{latestRun ? <div className="mt-5 rounded-xl bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold text-slate-900">运行完成</span><span className="text-xs text-slate-500">{latestRun.finishedAt || latestRun.startedAt || '—'}</span></div><div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4"><Stat label="分析规则" value={`${latestRun.ruleCount || latestRun.ruleResults?.length || 0} 条`} /><Stat label="触发" value={`${latestRun.triggered || 0} 条`} tone="emerald" /><Stat label="推送" value={`${latestRun.pushed || 0} 条`} /><Stat label="候选基金" value={`${latestRun.candidateCount || 0} 只`} /></div></div> : <div className="mt-6 rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">还没有运行记录。</div>}</Panel> : null}
    {tab === 'opportunities' ? <Panel><div className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-emerald-600" /><h2 className="text-lg font-bold text-slate-900">推荐机会</h2></div>{rules.length ? <div className="mt-5 space-y-3">{rules.filter((rule) => rule.enabled).map((rule) => <button type="button" key={rule.id} onClick={() => openRule(rule)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-4 text-left hover:border-slate-400"><span><span className="block font-bold text-slate-900">{rule.holdingFundCode} {rule.holdingFundName}</span><span className="mt-1 block text-sm text-slate-500">{getSwitchConditionText(rule)}</span></span><ArrowRight className="h-5 w-5 text-slate-300" /></button>)}</div> : <div className="mt-6 rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">添加规则后，这里会展示当前切换优势。</div>}</Panel> : null}
    {tab === 'plans' && view === 'list' ? rules.length ? <div className="space-y-4">{rules.map((rule) => <RuleCard key={rule.id} rule={rule} snapshot={snapshot} onOpen={() => openRule(rule)} onTest={() => setQuickRule(rule)} onEdit={() => openRule(rule)} onToggle={() => saveRule(rule, { enabled: !rule.enabled })} />)}</div> : <EmptyState onCreate={startCreate} onRun={runAll} running={running} /> : null}
    {view === 'create' && tab === 'plans' ? step === 'holding' ? <HoldingPicker holdings={holdings} rules={rules} selectedCode={selectedCode} setSelectedCode={setSelectedCode} manualCode={manualCode} setManualCode={setManualCode} onBack={() => setView('list')} onNext={() => setStep('fee')} /> : step === 'fee' ? <FeeForm fee={fee} setFee={setFee} onBack={() => setStep('holding')} onNext={(value) => { setFee(value); generate(value); }} /> : recommendLoading ? <Panel className="flex min-h-[360px] flex-col items-center justify-center text-center"><Loader2 className="h-8 w-8 animate-spin text-slate-700" /><h2 className="mt-4 text-lg font-bold text-slate-900">正在生成推荐规则</h2><p className="mt-2 text-sm leading-6 text-slate-500">正在匹配同类基金<br />正在计算切换费用<br />正在分析历史溢价差<br />正在寻找更合适的提醒条件</p></Panel> : recommendation ? <RecommendationView recommendation={recommendation} fee={fee} onBack={() => setStep('fee')} onUse={useRecommendation} onBacktest={() => { setView('backtest'); }} /> : null : null}
    {view === 'backtest' ? <BacktestView recommendation={recommendation} onBack={() => { setView('create'); setStep('recommend'); }} onUse={useRecommendation} /> : null}
    {view === 'edit' && selectedRule ? <RuleEditor rule={selectedRule} fee={editFee} setFee={setEditFee} thresholdMode={editThresholdMode} setThresholdMode={setEditThresholdMode} threshold={editThreshold} setThreshold={setEditThreshold} onBack={() => setView('detail')} onSave={(patch) => { saveRule(selectedRule, patch); setView('detail'); }} /> : null}
    {view === 'detail' && selectedRule ? <Panel><div className="flex flex-wrap items-start justify-between gap-3"><div><button type="button" onClick={() => setView('list')} className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="h-3.5 w-3.5" />我的方案</button><h2 className="text-xl font-bold text-slate-900">{selectedRule.holdingFundCode} {selectedRule.holdingFundName}</h2><p className="mt-1 text-sm text-slate-500">当前持仓 {Number(selectedRule.holdingQuantity || 0).toLocaleString('zh-CN')} 份</p></div><span className={cx('rounded-full px-3 py-1.5 text-xs font-semibold', selectedRule.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{selectedRule.enabled ? '已启用' : '已停用'}</span></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-900 p-4 text-white"><div className="text-xs text-slate-300">当前最大切换优势</div><div className="mt-2 text-2xl font-bold">{formatPercent(maxAdvantageFor(activeSnapshot))}</div></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-500">推荐提醒值</div><div className="mt-2 text-2xl font-bold text-slate-900">{formatPercent(selectedRule.thresholdValue)}</div></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-500">当前状态</div><div className="mt-2 text-lg font-bold text-slate-900">{getSwitchStatusText('', { maxAdvantage: maxAdvantageFor(activeSnapshot) })}</div></div></div><div className="mt-6"><h3 className="font-bold text-slate-900">候选基金</h3>{candidates.length ? <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100">{candidates.slice().sort((a, b) => Number(b.advantagePct ?? b.gapPct ?? 0) - Number(a.advantagePct ?? a.gapPct ?? 0)).map((candidate) => <div key={candidate.code} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="font-semibold text-slate-700">{candidate.code} {candidate.name}</span><span className="text-right"><span className="block font-bold text-slate-900">{formatPercent(candidate.advantagePct ?? candidate.gapPct ?? candidate.spreadVsBenchmarkPct)}</span><span className="text-xs text-slate-400">{Number(candidate.advantagePct ?? candidate.gapPct ?? 0) >= Number(selectedRule.thresholdValue) ? '达到提醒条件' : '未达到'}</span></span></div>)}</div> : <div className="mt-3 rounded-xl bg-slate-50 p-5 text-sm text-slate-500">运行一次后显示候选基金和当前切换优势。</div>}</div><div className="mt-6 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><div><span className="text-xs text-slate-400">提醒方式</span><div className="mt-1 font-semibold text-slate-700">{selectedRule.thresholdMode === 'fixed' ? '自定义' : '推荐值'}</div></div><div><span className="text-xs text-slate-400">提醒条件</span><div className="mt-1 font-semibold text-slate-700">{getSwitchConditionText(selectedRule)}</div></div><div><span className="text-xs text-slate-400">切换费用</span><div className="mt-1 font-semibold text-slate-700">约 {formatNumber(estimateSwitchCost(selectedRule.feeConfig, 10000))} 元</div></div><div><span className="text-xs text-slate-400">数据比较</span><div className="mt-1 font-semibold text-slate-700">实时行情</div></div></div><div className="mt-6 flex flex-wrap gap-2"><Button onClick={() => setQuickRule(selectedRule)}><FlaskConical className="h-4 w-4" />快速测试</Button><Button variant="secondary" onClick={() => startEdit(selectedRule)}><Settings2 className="h-4 w-4" />编辑规则</Button><Button variant="danger" onClick={() => saveRule(selectedRule, { enabled: !selectedRule.enabled })}>{selectedRule.enabled ? '停用规则' : '启用规则'}</Button>{['pending_classification', 'classification_expired'].includes(selectedRule.runtimeConfig?.classificationStatus) ? <Button variant="secondary" onClick={() => startReanalysis(selectedRule)}><RefreshCw className="h-4 w-4" />重新分析候选基金</Button> : null}</div></Panel> : null}
    {quickRule ? <QuickTestModal rule={quickRule} onClose={() => setQuickRule(null)} /> : null}
  </div>;
}
