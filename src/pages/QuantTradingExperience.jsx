import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bot, CheckCircle2, Clock3, Database, ListChecks, Minus, Play, Plus, RefreshCw, RotateCcw, ShieldCheck, SlidersHorizontal, Trash2, WalletCards } from 'lucide-react';
import { Card, cx, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';
import { showToast } from '../app/toast.js';
import {
  adjustQuantPremiumCashInWorker,
  deleteQuantPremiumStrategyInWorker,
  loadQuantPremiumBacktestLatestFromWorker,
  loadQuantPremiumConfigFromWorker,
  loadQuantPremiumPaperStateFromWorker,
  loadQuantPremiumSnapshotFromWorker,
  loadQuantPremiumStrategiesFromWorker,
  loadQuantPremiumStrategySnapshotFromWorker,
  normalizeQuantPremiumConfigShape,
  parseQuantPremiumCodes,
  quantPremiumCodesToText,
  resetQuantPremiumPaperStateInWorker,
  runQuantPremiumOnce,
  saveQuantPremiumConfigToWorker,
  saveQuantPremiumStrategyToWorker
} from '../app/quantPremiumSync.js';

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `¥${num.toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatNumber(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '--';
  return num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function formatDateTime(value = '') {
  const text = String(value || '').trim();
  if (!text) return '--';
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(parsed));
  } catch {
    return text;
  }
}

function StatusPill({ children, tone = 'slate' }) {
  const toneClass = tone === 'emerald'
    ? 'bg-emerald-50 text-emerald-700'
    : tone === 'amber'
      ? 'bg-amber-50 text-amber-700'
      : tone === 'indigo'
        ? 'bg-indigo-50 text-indigo-700'
        : tone === 'rose'
          ? 'bg-rose-50 text-rose-700'
          : 'bg-slate-100 text-slate-600';
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold', toneClass)}>{children}</span>;
}

function Metric({ label, value, note, Icon }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-bold text-slate-400">{label}</div>
        {Icon ? <Icon className="h-4 w-4 text-slate-400" /> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500">{note}</div>
    </div>
  );
}

function EmptyRow({ colSpan, children }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-slate-400">{children}</td>
    </tr>
  );
}

function FormLabel({ label, children }) {
  return (
    <label className="space-y-2">
      <span className="block text-xs font-bold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const inputClass = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';
const textAreaClass = 'min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

function normalizePositionList(paperState) {
  return Object.values(paperState?.positions || {})
    .filter((item) => item && item.code)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

function normalizeOrderList(paperState) {
  return Array.isArray(paperState?.orders) ? paperState.orders.slice(0, 12) : [];
}

function normalizeCashEvents(paperState) {
  return Array.isArray(paperState?.cashEvents) ? paperState.cashEvents.slice(0, 10) : [];
}

function normalizeSignalList(snapshot) {
  const triggers = Array.isArray(snapshot?.triggers) ? snapshot.triggers : [];
  const signals = Array.isArray(snapshot?.signals) ? snapshot.signals : [];
  return (triggers.length ? triggers : signals).slice(0, 6);
}

const QUANT_VIEW_KEYS = new Set(['strategy', 'funds', 'fills']);

function normalizeQuantViewKey(value = '') {
  const key = String(value || '').trim();
  return QUANT_VIEW_KEYS.has(key) ? key : 'strategy';
}

export function QuantTradingExperience({ embedded = false, activeModule = 'strategy', hideModuleTabs = false, onModuleChange } = {}) {
  const [strategies, setStrategies] = useState([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState('');
  const [paperState, setPaperState] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [config, setConfig] = useState(() => normalizeQuantPremiumConfigShape());
  const [backtest, setBacktest] = useState(null);
  const [summary, setSummary] = useState(null);
  const [activeTab, setActiveTab] = useState(() => normalizeQuantViewKey(activeModule));
  const [highText, setHighText] = useState('');
  const [lowText, setLowText] = useState('');
  const [cashAmount, setCashAmount] = useState('10000');
  const [cashNote, setCashNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [adjustingCash, setAdjustingCash] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');

  const applyConfig = useCallback((nextConfig) => {
    const normalized = normalizeQuantPremiumConfigShape(nextConfig);
    setConfig(normalized);
    setHighText(quantPremiumCodesToText(normalized.highCodes));
    setLowText(quantPremiumCodesToText(normalized.lowCodes));
  }, []);

  const refresh = useCallback(async ({ silent = false, strategyId = '' } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    const strategiesResult = await loadQuantPremiumStrategiesFromWorker()
      .catch(async () => [await loadQuantPremiumConfigFromWorker()]);
    const nextStrategies = Array.isArray(strategiesResult) && strategiesResult.length
      ? strategiesResult
      : [normalizeQuantPremiumConfigShape()];
    const pickedId = strategyId || selectedStrategyId || nextStrategies[0]?.id || 'default';
    const picked = nextStrategies.find((item) => item.id === pickedId) || nextStrategies[0];
    let effectiveConfig = picked;
    setStrategies(nextStrategies);
    setSelectedStrategyId(picked.id);
    applyConfig(effectiveConfig);

    const [paperResult, snapshotResult, backtestResult] = await Promise.allSettled([
      loadQuantPremiumPaperStateFromWorker(picked.id),
      loadQuantPremiumStrategySnapshotFromWorker(picked.id).catch(() => loadQuantPremiumSnapshotFromWorker()),
      loadQuantPremiumBacktestLatestFromWorker(picked.id)
    ]);
    if (paperResult.status === 'fulfilled') {
      setPaperState(paperResult.value);
    }
    if (snapshotResult.status === 'fulfilled') {
      setSnapshot(snapshotResult.value?.snapshot || null);
    }
    if (backtestResult.status === 'fulfilled') {
      const latestBacktest = backtestResult.value || {};
      setBacktest(latestBacktest.result || null);
      if (latestBacktest.gate) {
        effectiveConfig = normalizeQuantPremiumConfigShape({
          ...effectiveConfig,
          backtestGate: latestBacktest.gate
        });
        setStrategies((current) => current.map((item) => item.id === effectiveConfig.id
          ? normalizeQuantPremiumConfigShape({ ...item, backtestGate: latestBacktest.gate })
          : item));
      }
    }
    applyConfig(effectiveConfig);

    const failures = [paperResult, snapshotResult, backtestResult].filter((item) => item.status === 'rejected');
    if (failures.length === 3) {
      setError(failures[0].reason instanceof Error ? failures[0].reason.message : 'Worker 状态暂不可用');
    } else if (failures.length) {
      setError('部分 Worker 状态暂不可用');
    }
    if (!silent) setLoading(false);
  }, [applyConfig, selectedStrategyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setActiveTab(normalizeQuantViewKey(activeModule));
  }, [activeModule]);

  async function handleSaveConfig() {
    const nextConfig = normalizeQuantPremiumConfigShape({
      ...config,
      highCodes: parseQuantPremiumCodes(highText),
      lowCodes: parseQuantPremiumCodes(lowText)
    });
    if (!nextConfig.highCodes.length || !nextConfig.lowCodes.length) {
      setError('H 和 L 至少各设置一只 ETF。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await saveQuantPremiumStrategyToWorker(nextConfig);
      setStrategies(result.strategies);
      setSelectedStrategyId(result.strategy.id);
      applyConfig(result.strategy);
      showToast({ title: '量化策略已保存', tone: 'emerald' });
    } catch (saveError) {
      try {
        const stored = await saveQuantPremiumConfigToWorker(nextConfig);
        applyConfig(stored);
        showToast({ title: '量化策略已保存', tone: 'emerald' });
      } catch {
      setError(saveError instanceof Error ? saveError.message : '保存失败');
      showToast({ title: '保存失败', description: saveError instanceof Error ? saveError.message : '', tone: 'amber' });
      }
    } finally {
      setSaving(false);
    }
  }

  const handleRunOnce = useCallback(async () => {
    setRunning(true);
    setError('');
    try {
      const result = await runQuantPremiumOnce(config.id);
      setSummary(result?.summary || null);
      await refresh({ silent: true });
      showToast({ title: '量化 Worker 已完成一轮评估', tone: 'emerald' });
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : '手动运行失败');
      showToast({ title: '手动运行失败', description: runError instanceof Error ? runError.message : '', tone: 'amber' });
    } finally {
      setRunning(false);
    }
  }, [config.id, refresh]);

  useEffect(() => {
    function handleRunEvent() {
      handleRunOnce();
    }
    window.addEventListener('quant:run-once', handleRunEvent);
    return () => window.removeEventListener('quant:run-once', handleRunEvent);
  }, [handleRunOnce]);

  async function handleCashAdjust(direction) {
    const amount = Math.abs(Number(cashAmount) || 0);
    if (!(amount > 0)) {
      setError('请输入有效金额。');
      return;
    }
    setAdjustingCash(true);
    setError('');
    try {
      const result = await adjustQuantPremiumCashInWorker(direction === 'out' ? -amount : amount, cashNote, config.id);
      setPaperState(result.state);
      setCashNote('');
      showToast({ title: direction === 'out' ? '模拟现金已减少' : '模拟现金已增加', tone: 'emerald' });
    } catch (cashError) {
      setError(cashError instanceof Error ? cashError.message : '资金调整失败');
      showToast({ title: '资金调整失败', description: cashError instanceof Error ? cashError.message : '', tone: 'amber' });
    } finally {
      setAdjustingCash(false);
    }
  }

  async function handleResetPaper() {
    setResetting(true);
    setError('');
    try {
      const next = await resetQuantPremiumPaperStateInWorker(null, config.id);
      setPaperState(next);
      setSummary(null);
      showToast({ title: '模拟盘已重置', tone: 'emerald' });
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : '重置失败');
      showToast({ title: '重置失败', description: resetError instanceof Error ? resetError.message : '', tone: 'amber' });
    } finally {
      setResetting(false);
    }
  }

  async function handleCreateStrategy() {
    setSaving(true);
    setError('');
    try {
      const draft = normalizeQuantPremiumConfigShape({
        ...config,
        id: `strategy-${Date.now().toString(36)}`,
        name: `溢价差策略 ${strategies.length + 1}`,
        enabled: false,
        liveSignalEnabled: false,
        backtestGate: { status: 'none' }
      });
      const result = await saveQuantPremiumStrategyToWorker(draft);
      setStrategies(result.strategies);
      setSelectedStrategyId(result.strategy.id);
      applyConfig(result.strategy);
      setSnapshot(null);
      setPaperState(null);
      setBacktest(null);
      showToast({ title: '新策略已创建', tone: 'emerald' });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建策略失败');
      showToast({ title: '创建策略失败', description: createError instanceof Error ? createError.message : '', tone: 'amber' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteStrategy() {
    if (strategies.length <= 1 || config.id === 'default') return;
    setSaving(true);
    setError('');
    try {
      const nextStrategies = await deleteQuantPremiumStrategyInWorker(config.id);
      setStrategies(nextStrategies);
      const next = nextStrategies[0] || normalizeQuantPremiumConfigShape();
      setSelectedStrategyId(next.id);
      applyConfig(next);
      await refresh({ silent: true, strategyId: next.id });
      showToast({ title: '策略已删除', tone: 'emerald' });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除策略失败');
      showToast({ title: '删除策略失败', description: deleteError instanceof Error ? deleteError.message : '', tone: 'amber' });
    } finally {
      setSaving(false);
    }
  }

  async function handleSelectStrategy(strategyId) {
    const next = strategies.find((item) => item.id === strategyId);
    if (next) {
      setSelectedStrategyId(next.id);
      applyConfig(next);
    }
    await refresh({ silent: true, strategyId });
  }

  const positions = useMemo(() => normalizePositionList(paperState), [paperState]);
  const orders = useMemo(() => normalizeOrderList(paperState), [paperState]);
  const cashEvents = useMemo(() => normalizeCashEvents(paperState), [paperState]);
  const signals = useMemo(() => normalizeSignalList(snapshot), [snapshot]);
  const positionCount = positions.filter((item) => Number(item.shares) > 0).length;
  const backtestGate = config.backtestGate || {};
  const visibleBacktestStatus = backtest?.status || backtestGate.status;
  const backtestPassed = visibleBacktestStatus === 'passed';
  const backtestApproved = backtestPassed && Boolean(backtestGate.approvedAt) && config.liveSignalEnabled;
  const metrics = [
    { label: 'Worker 频率', value: '1 分钟', note: '交易时段 cron', Icon: Clock3 },
    { label: '策略数量', value: formatNumber(strategies.length || 1), note: config.enabled ? '当前策略已启用' : '当前策略未启用', Icon: Bot },
    { label: '模拟现金', value: formatMoney(paperState?.cash), note: `${positionCount} 个模拟持仓`, Icon: WalletCards },
    { label: '实盘信号', value: backtestApproved ? '已确认' : '未确认', note: backtestPassed ? '回测有效，需人工确认' : '需先完成有效回测', Icon: Activity }
  ];
  const tabs = [
    { key: 'strategy', label: '策略', Icon: SlidersHorizontal },
    { key: 'funds', label: '资金', Icon: WalletCards },
    { key: 'fills', label: '成交', Icon: ListChecks }
  ];

  function handleTabChange(key) {
    const nextTab = normalizeQuantViewKey(key);
    setActiveTab(nextTab);
    if (typeof onModuleChange === 'function') {
      onModuleChange(nextTab);
    }
  }

  const strategyPicker = strategies.length > 1 ? (
    <select
      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      value={selectedStrategyId || config.id}
      onChange={(event) => handleSelectStrategy(event.target.value)}
    >
      {strategies.map((item) => (
        <option key={item.id} value={item.id}>{item.name || item.id}</option>
      ))}
    </select>
  ) : null;
  const showSharedChrome = !hideModuleTabs;

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      {showSharedChrome ? <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
            <Bot className="h-3.5 w-3.5" />
            量化研究
          </div>
          <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">Worker 溢价差模拟盘</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            量化 H/L 配置独立于持仓交易，模拟资金和成交也使用单独账户。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButtonClass} onClick={handleRunOnce} disabled={running}>
            <Play className="h-4 w-4" />
            {running ? '运行中' : '手动跑一轮'}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={() => refresh()} disabled={loading || running}>
            <RefreshCw className={cx('h-4 w-4', loading ? 'animate-spin' : '')} />
            刷新
          </button>
        </div>
      </div> : null}

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div>
      ) : null}

      {showSharedChrome ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((item) => <Metric key={item.label} {...item} />)}
      </div> : null}

      {showSharedChrome ? <div className="flex gap-2 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => handleTabChange(key)}
            className={cx(
              'inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors',
              activeTab === key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div> : null}

      {activeTab === 'strategy' ? (
        <>
        <Card className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-bold text-slate-400">STRATEGIES</div>
              <h2 className="mt-1 text-lg font-bold text-slate-900">策略配置</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondaryButtonClass} onClick={handleCreateStrategy} disabled={saving}>
                <Plus className="h-4 w-4" />
                新增策略
              </button>
              <button type="button" className={subtleButtonClass} onClick={handleDeleteStrategy} disabled={saving || strategies.length <= 1 || config.id === 'default'}>
                <Trash2 className="h-4 w-4" />
                删除策略
              </button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {(strategies.length ? strategies : [config]).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectStrategy(item.id)}
                className={cx(
                  'min-w-[180px] rounded-xl border px-3 py-2 text-left transition-colors',
                  item.id === selectedStrategyId ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                <div className="truncate text-sm font-bold">{item.name || item.id}</div>
                <div className="mt-1 text-xs">{item.enabled ? '已启用' : '未启用'} · {item.liveSignalEnabled ? '实盘信号已确认' : '未确认实盘'}</div>
              </button>
            ))}
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <Card className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-bold text-slate-400">QUANT H/L</div>
                <h2 className="mt-1 text-lg font-bold text-slate-900">量化策略配置</h2>
              </div>
              <StatusPill tone={config.enabled ? 'emerald' : 'slate'}>{config.enabled ? '已启用' : '未启用'}</StatusPill>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <FormLabel label="策略名称">
                <input className={inputClass} value={config.name} onChange={(event) => setConfig((current) => ({ ...current, name: event.target.value }))} />
              </FormLabel>
              <FormLabel label="卖出侧">
                <select className={inputClass} value={config.activeSide} onChange={(event) => setConfig((current) => ({ ...current, activeSide: event.target.value }))}>
                  <option value="all">H 和 L 都可作为卖出侧</option>
                  <option value="H">只从 H 换到 L</option>
                  <option value="L">只从 L 换到 H</option>
                </select>
              </FormLabel>
              <FormLabel label="H 高溢价 ETF">
                <textarea className={textAreaClass} value={highText} onChange={(event) => setHighText(event.target.value)} />
              </FormLabel>
              <FormLabel label="L 低溢价 ETF">
                <textarea className={textAreaClass} value={lowText} onChange={(event) => setLowText(event.target.value)} />
              </FormLabel>
              <FormLabel label="规则 A 阈值">
                <input className={inputClass} type="number" step="0.1" value={config.intraSellLowerPct} onChange={(event) => setConfig((current) => ({ ...current, intraSellLowerPct: event.target.value }))} />
              </FormLabel>
              <FormLabel label="规则 B 阈值">
                <input className={inputClass} type="number" step="0.1" value={config.intraBuyOtherPct} onChange={(event) => setConfig((current) => ({ ...current, intraBuyOtherPct: event.target.value }))} />
              </FormLabel>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={config.enabled} onChange={(event) => setConfig((current) => ({ ...current, enabled: event.target.checked }))} />
                启用量化 Worker
              </label>
              <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={config.notifyEnabled} onChange={(event) => setConfig((current) => ({ ...current, notifyEnabled: event.target.checked }))} />
                实盘信号通知
              </label>
              <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={config.paperEnabled} onChange={(event) => setConfig((current) => ({ ...current, paperEnabled: event.target.checked }))} />
                模拟盘撮合
              </label>
              <button type="button" className={primaryButtonClass} onClick={handleSaveConfig} disabled={saving}>
                <CheckCircle2 className="h-4 w-4" />
                {saving ? '保存中' : '保存策略'}
              </button>
            </div>
          </Card>

          <Card className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-bold text-slate-400">WORKER SNAPSHOT</div>
                <h2 className="mt-1 text-lg font-bold text-slate-900">当前信号</h2>
              </div>
              <StatusPill tone={snapshot?.ready ? 'emerald' : 'slate'}>
                <Database className="h-3.5 w-3.5" />
                {snapshot?.computedAt ? formatDateTime(snapshot.computedAt) : '未计算'}
              </StatusPill>
            </div>
            <div className="space-y-2">
              {signals.length ? signals.map((signal, index) => (
                <div key={`${signal.pairKey || signal.from || index}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-slate-900">{signal.fromCode || signal.from} → {signal.toCode || signal.to}</div>
                    <StatusPill tone={signal.rule === 'B' ? 'indigo' : 'slate'}>{signal.rule || signal.kind || '信号'}</StatusPill>
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    {signal.description || `gap ${Number((signal.gapPct ?? signal.diffPct) || 0).toFixed(2)}% / 阈值 ${Number(signal.threshold || 0).toFixed(2)}%`}
                  </div>
                </div>
              )) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                  当前没有触发信号
                </div>
              )}
            </div>
          </Card>
        </div>
        </>
      ) : null}

      {activeTab === 'funds' ? (
        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="space-y-4 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-slate-400">CASH</div>
                <h2 className="mt-1 text-lg font-bold text-slate-900">资金</h2>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {strategyPicker}
                <StatusPill tone="emerald">{formatMoney(paperState?.cash)}</StatusPill>
              </div>
            </div>
            <FormLabel label="调整金额">
              <input className={inputClass} type="number" min="0" step="100" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} />
            </FormLabel>
            <FormLabel label="备注">
              <input className={inputClass} value={cashNote} onChange={(event) => setCashNote(event.target.value)} />
            </FormLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className={secondaryButtonClass} onClick={() => handleCashAdjust('in')} disabled={adjustingCash}>
                <Plus className="h-4 w-4" />
                增加现金
              </button>
              <button type="button" className={subtleButtonClass} onClick={() => handleCashAdjust('out')} disabled={adjustingCash}>
                <Minus className="h-4 w-4" />
                减少现金
              </button>
            </div>
            <button type="button" className={subtleButtonClass} onClick={handleResetPaper} disabled={resetting || running}>
              <RotateCcw className="h-4 w-4" />
              重置模拟盘
            </button>
          </Card>

          <Card className="space-y-4 p-5 sm:p-6">
            <div>
              <div className="text-xs font-bold text-slate-400">CASH LOG</div>
              <h2 className="mt-1 text-lg font-bold text-slate-900">资金流水</h2>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 text-xs font-bold text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left">时间</th>
                    <th className="px-4 py-3 text-left">类型</th>
                    <th className="px-4 py-3 text-right">金额</th>
                    <th className="px-4 py-3 text-right">余额</th>
                    <th className="px-4 py-3 text-left">备注</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cashEvents.length ? cashEvents.map((event) => (
                    <tr key={event.id}>
                      <td className="px-4 py-3 text-slate-500">{formatDateTime(event.ts)}</td>
                      <td className={cx('px-4 py-3 font-semibold', event.type === 'withdraw' ? 'text-rose-600' : 'text-emerald-600')}>{event.type === 'withdraw' ? '减少' : '增加'}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatMoney(event.amount)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatMoney(event.cashAfter)}</td>
                      <td className="px-4 py-3 text-slate-500">{event.note || '--'}</td>
                    </tr>
                  )) : <EmptyRow colSpan={5}>暂无资金流水</EmptyRow>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {activeTab === 'fills' ? (
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-bold text-slate-400">PAPER ACCOUNT</div>
                <h2 className="mt-1 text-lg font-bold text-slate-900">模拟持仓</h2>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {strategyPicker}
                <StatusPill tone={paperState?.enabled === false ? 'amber' : 'emerald'}>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {paperState?.enabled === false ? '已停用' : '模拟模式'}
                </StatusPill>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 text-xs font-bold text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left">代码</th>
                    <th className="px-4 py-3 text-left">名称</th>
                    <th className="px-4 py-3 text-right">份额</th>
                    <th className="px-4 py-3 text-right">成本</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {positions.length ? positions.map((row) => (
                    <tr key={row.code}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{row.code}</td>
                      <td className="px-4 py-3 text-slate-600">{row.name || row.code}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.shares, 0)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatPrice(row.costPrice)}</td>
                    </tr>
                  )) : <EmptyRow colSpan={4}>暂无模拟持仓</EmptyRow>}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-bold text-slate-400">FILLS</div>
                <h2 className="mt-1 text-lg font-bold text-slate-900">最近模拟成交</h2>
              </div>
              <StatusPill>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {paperState?.lastStatus || 'idle'}
              </StatusPill>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 text-xs font-bold text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left">时间</th>
                    <th className="px-4 py-3 text-left">方向</th>
                    <th className="px-4 py-3 text-left">代码</th>
                    <th className="px-4 py-3 text-right">价格</th>
                    <th className="px-4 py-3 text-right">数量</th>
                    <th className="px-4 py-3 text-right">金额</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.length ? orders.map((order) => (
                    <tr key={order.id}>
                      <td className="px-4 py-3 text-slate-500">{formatDateTime(order.ts)}</td>
                      <td className={cx('px-4 py-3 font-semibold', order.side === 'SELL' ? 'text-rose-600' : 'text-emerald-600')}>{order.side}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{order.code}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatPrice(order.price)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatNumber(order.quantity, 0)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatMoney(order.amount)}</td>
                    </tr>
                  )) : <EmptyRow colSpan={6}>暂无模拟成交</EmptyRow>}
                </tbody>
              </table>
            </div>
            {summary ? (
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs font-bold text-slate-400">触发</div>
                  <div className="mt-1 font-semibold text-slate-900">{formatNumber(summary.triggered || 0)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs font-bold text-slate-400">模拟执行</div>
                  <div className="mt-1 font-semibold text-slate-900">{formatNumber(summary.paperExecuted || 0)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs font-bold text-slate-400">模拟订单</div>
                  <div className="mt-1 font-semibold text-slate-900">{formatNumber(summary.paperOrders || 0)}</div>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
