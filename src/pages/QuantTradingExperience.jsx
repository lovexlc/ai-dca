import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bot, CheckCircle2, Clock3, Database, Play, RefreshCw, RotateCcw, ShieldCheck, WalletCards } from 'lucide-react';
import { Card, cx, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';
import { showToast } from '../app/toast.js';
import {
  loadSwitchPaperStateFromWorker,
  loadSwitchSnapshotFromWorker,
  resetSwitchPaperStateInWorker,
  runSwitchOnce
} from '../app/switchStrategySync.js';

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

function normalizePositionList(paperState) {
  return Object.values(paperState?.positions || {})
    .filter((item) => item && item.code)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

function normalizeOrderList(paperState) {
  return Array.isArray(paperState?.orders) ? paperState.orders.slice(0, 8) : [];
}

function normalizeSignalList(snapshot) {
  const triggers = Array.isArray(snapshot?.triggers) ? snapshot.triggers : [];
  const signals = Array.isArray(snapshot?.signals) ? snapshot.signals : [];
  return (triggers.length ? triggers : signals).slice(0, 6);
}

export function QuantTradingExperience({ embedded = false } = {}) {
  const [paperState, setPaperState] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [config, setConfig] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    const [paperResult, snapshotResult] = await Promise.allSettled([
      loadSwitchPaperStateFromWorker(),
      loadSwitchSnapshotFromWorker()
    ]);

    if (paperResult.status === 'fulfilled') {
      setPaperState(paperResult.value);
    }
    if (snapshotResult.status === 'fulfilled') {
      setSnapshot(snapshotResult.value?.snapshot || null);
      setConfig(snapshotResult.value?.config || null);
    }

    const failures = [paperResult, snapshotResult].filter((item) => item.status === 'rejected');
    if (failures.length === 2) {
      setError(failures[0].reason instanceof Error ? failures[0].reason.message : 'Worker 状态暂不可用');
    } else if (failures.length) {
      setError('部分 Worker 状态暂不可用');
    }
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleRunOnce() {
    setRunning(true);
    setError('');
    try {
      const result = await runSwitchOnce();
      setSummary(result?.summary || null);
      await refresh({ silent: true });
      showToast({ title: 'Worker 已完成一轮评估', tone: 'emerald' });
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : '手动运行失败');
      showToast({ title: '手动运行失败', description: runError instanceof Error ? runError.message : '', tone: 'amber' });
    } finally {
      setRunning(false);
    }
  }

  async function handleResetPaper() {
    setResetting(true);
    setError('');
    try {
      const next = await resetSwitchPaperStateInWorker();
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

  const positions = useMemo(() => normalizePositionList(paperState), [paperState]);
  const orders = useMemo(() => normalizeOrderList(paperState), [paperState]);
  const signals = useMemo(() => normalizeSignalList(snapshot), [snapshot]);
  const activeRules = Array.isArray(config?.rules)
    ? config.rules.filter((rule) => rule?.enabled).length
    : 0;
  const positionCount = positions.filter((item) => Number(item.shares) > 0).length;

  const metrics = [
    { label: 'Worker 频率', value: '1 分钟', note: '交易时段 cron', Icon: Clock3 },
    { label: '策略状态', value: config?.enabled ? '已启用' : '未启用', note: `${activeRules} 条启用规则`, Icon: Bot },
    { label: '模拟现金', value: formatMoney(paperState?.cash), note: `${positionCount} 个持仓`, Icon: WalletCards },
    { label: '今日成交', value: formatNumber(paperState?.executionsToday || 0), note: `上限 ${formatNumber(paperState?.maxExecutionsPerDay || 0)} 次`, Icon: Activity }
  ];

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
            <Bot className="h-3.5 w-3.5" />
            量化研究
          </div>
          <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">Worker 溢价差模拟盘</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            分钟级通知 Worker 读取 ETF 盘口与净值，触发 H/L 溢价差信号后写入模拟盘 SELL/BUY 成交。
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
          <button type="button" className={subtleButtonClass} onClick={handleResetPaper} disabled={resetting || running}>
            <RotateCcw className="h-4 w-4" />
            重置模拟盘
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((item) => <Metric key={item.label} {...item} />)}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-bold text-slate-400">PAPER ACCOUNT</div>
              <h2 className="mt-1 text-lg font-bold text-slate-900">模拟持仓</h2>
            </div>
            <StatusPill tone={paperState?.enabled === false ? 'amber' : 'emerald'}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {paperState?.enabled === false ? '已停用' : '模拟模式'}
            </StatusPill>
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
          <div className="grid gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs font-bold text-slate-400">触发</div>
              <div className="mt-1 font-semibold text-slate-900">{formatNumber(summary.triggered || 0)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs font-bold text-slate-400">通知</div>
              <div className="mt-1 font-semibold text-slate-900">{formatNumber(summary.pushed || 0)}</div>
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
  );
}
