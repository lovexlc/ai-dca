import { useMemo, useState } from 'react';
import { Activity, ArrowRightLeft, ListChecks, Minus, Play, Plus, RefreshCw, RotateCcw, ShieldCheck, Wallet } from 'lucide-react';
import { Card, cx, primaryButtonClass, secondaryButtonClass, subtleButtonClass, inputClass } from '../experience-ui.jsx';
import { RealTimeSignalCard } from '../RealTimeSignalCard.jsx';
import { showToast } from '../../app/toast.js';

const SUB_TABS = [
  { id: 'signal', label: '信号', icon: Activity },
  { id: 'positions', label: '持仓', icon: ShieldCheck },
  { id: 'cash', label: '现金', icon: Wallet },
  { id: 'fills', label: '成交', icon: ArrowRightLeft }
];

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

function normalizeLiveSignal(snapshot) {
  if (!snapshot) return null;
  const source = snapshot.signal
    || (Array.isArray(snapshot.signals) ? snapshot.signals[0] : null)
    || (Array.isArray(snapshot.triggers) ? snapshot.triggers[0] : null);
  if (!source || typeof source !== 'object') return null;
  const gapValue = Number(source.gapPct ?? source.gapPercent);
  return {
    rule: source.rule || source.ruleName || source.ruleId || '',
    fromCode: source.fromCode || source.from || source.from_code || '',
    toCode: source.toCode || source.to || source.to_code || '',
    gapPct: Number.isFinite(gapValue) ? gapValue.toFixed(2) : '',
    threshold: source.threshold ?? source.triggerPct ?? '',
    triggered: source.triggered !== undefined ? Boolean(source.triggered) : true,
    timestamp: source.timestamp || source.ts || source.date || snapshot.generatedAt || snapshot.computedAt || ''
  };
}

function normalizePositions(paperState) {
  return Object.values(paperState?.positions || {})
    .filter((item) => item && item.code)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

function normalizeOrders(paperState) {
  return Array.isArray(paperState?.orders) ? paperState.orders.slice(0, 24) : [];
}

function normalizeCashEvents(paperState) {
  return Array.isArray(paperState?.cashEvents) ? paperState.cashEvents.slice(0, 20) : [];
}

function SignalSubPanel({ snapshot }) {
  const signals = useMemo(() => {
    if (!snapshot) return [];
    const triggers = Array.isArray(snapshot.triggers) ? snapshot.triggers : [];
    const signalList = Array.isArray(snapshot.signals) ? snapshot.signals : [];
    return (triggers.length ? triggers : signalList).slice(0, 12);
  }, [snapshot]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">信号列表</h3>
        <span className="text-xs text-slate-500">{signals.length} 条</span>
      </div>
      {signals.length === 0 ? (
        <div className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">暂无触发信号</div>
      ) : (
        <ul className="space-y-2">
          {signals.map((signal, index) => (
            <li key={`${signal.pairKey || signal.from || index}-${index}`} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-slate-900">
                  {signal.fromCode || signal.from} → {signal.toCode || signal.to}
                </div>
                <span className={cx(
                  'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold',
                  signal.rule === 'B' ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'
                )}>
                  规则 {signal.rule || signal.kind || '?'}
                </span>
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {signal.description || `gap ${Number((signal.gapPct ?? signal.diffPct) || 0).toFixed(2)}% / 阈值 ${Number(signal.threshold || 0).toFixed(2)}%`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PositionsSubPanel({ paperState }) {
  const positions = useMemo(() => normalizePositions(paperState), [paperState]);
  const positionCount = positions.filter((item) => Number(item.shares) > 0).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900">模拟持仓</h3>
          <p className="text-xs text-slate-500">{positionCount} 个标的</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          现金 {formatMoney(paperState?.cash)}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left">代码</th>
              <th className="px-4 py-3 text-left">名称</th>
              <th className="px-4 py-3 text-right">份额</th>
              <th className="px-4 py-3 text-right">成本价</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {positions.length ? positions.map((row) => (
              <tr key={row.code}>
                <td className="px-4 py-3 font-semibold text-slate-900">{row.code}</td>
                <td className="px-4 py-3 text-slate-600">{row.name || row.code}</td>
                <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.shares)}</td>
                <td className="px-4 py-3 text-right text-slate-700">{formatPrice(row.costPrice)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">暂无模拟持仓</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CashSubPanel({ paperState, adjusting, resetting, onAdjust, onReset }) {
  const [amount, setAmount] = useState('10000');
  const [note, setNote] = useState('');
  const cashEvents = useMemo(() => normalizeCashEvents(paperState), [paperState]);

  async function commit(direction) {
    const numeric = Math.abs(Number(amount) || 0);
    if (!(numeric > 0)) {
      showToast({ title: '请输入有效金额', tone: 'amber' });
      return;
    }
    try {
      await onAdjust?.(direction === 'out' ? -numeric : numeric, note);
      setNote('');
    } catch {
      // toast handled upstream
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">资金管理</h3>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            {formatMoney(paperState?.cash)}
          </span>
        </div>
        <div>
          <label htmlFor="quant-live-cash-amount" className="block text-xs font-semibold text-slate-500">调整金额</label>
          <input
            id="quant-live-cash-amount"
            type="number"
            min="0"
            step="100"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={cx(inputClass, 'mt-2')}
          />
        </div>
        <div>
          <label htmlFor="quant-live-cash-note" className="block text-xs font-semibold text-slate-500">备注</label>
          <input
            id="quant-live-cash-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="可选"
            className={cx(inputClass, 'mt-2')}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className={secondaryButtonClass} onClick={() => commit('in')} disabled={adjusting}>
            <Plus className="h-4 w-4" />
            增加现金
          </button>
          <button type="button" className={subtleButtonClass} onClick={() => commit('out')} disabled={adjusting}>
            <Minus className="h-4 w-4" />
            减少现金
          </button>
        </div>
        <button type="button" className={cx(subtleButtonClass, 'w-full text-rose-600 hover:bg-rose-50')} onClick={onReset} disabled={resetting}>
          <RotateCcw className="h-4 w-4" />
          重置模拟盘
        </button>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-900">资金流水</h3>
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
                  <td className={cx('px-4 py-3 font-semibold', event.type === 'withdraw' ? 'text-rose-600' : 'text-emerald-600')}>
                    {event.type === 'withdraw' ? '减少' : '增加'}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatMoney(event.amount)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatMoney(event.cashAfter)}</td>
                  <td className="px-4 py-3 text-slate-500">{event.note || '--'}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">暂无资金流水</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FillsSubPanel({ paperState, summary }) {
  const orders = useMemo(() => normalizeOrders(paperState), [paperState]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">模拟成交</h3>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
          状态 {paperState?.lastStatus || 'idle'}
        </span>
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
                <td className="px-4 py-3 text-right text-slate-700">{formatNumber(order.quantity)}</td>
                <td className="px-4 py-3 text-right text-slate-700">{formatMoney(order.amount)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">暂无模拟成交</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {summary ? (
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-xs font-bold text-slate-400">触发</div>
            <div className="mt-1 font-semibold text-slate-900">{formatNumber(summary.triggered)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-xs font-bold text-slate-400">模拟执行</div>
            <div className="mt-1 font-semibold text-slate-900">{formatNumber(summary.paperExecuted)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-xs font-bold text-slate-400">模拟订单</div>
            <div className="mt-1 font-semibold text-slate-900">{formatNumber(summary.paperOrders)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RiskDecisionPanel({ riskDecision }) {
  const reasons = Array.isArray(riskDecision?.reasons) ? riskDecision.reasons : [];
  const allowed = riskDecision?.allowed === true;
  return (
    <div className={cx(
      'rounded-xl border px-4 py-3 text-sm',
      allowed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'
    )}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-bold">{allowed ? '后端风控允许实盘信号' : '后端风控暂未放行'}</div>
        <div className="text-xs font-semibold opacity-80">级别 {riskDecision?.level || (allowed ? 'ok' : 'warn')}</div>
      </div>
      {reasons.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {reasons.map((reason) => (
            <span key={reason} className="rounded-full bg-white/70 px-2 py-1 text-xs font-semibold">{reason}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AuditTrailPanel({ events = [] }) {
  const list = Array.isArray(events) ? events.slice(0, 4) : [];
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">最近审计</h3>
        <span className="text-xs text-slate-500">{list.length} 条</span>
      </div>
      {list.length ? (
        <div className="mt-3 grid gap-2">
          {list.map((event) => (
            <div key={event.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <div className="min-w-0">
                <div className="font-bold text-slate-700">{event.summary || event.type}</div>
                <div className="mt-0.5 truncate text-slate-500">{event.type}</div>
              </div>
              <div className="shrink-0 text-slate-400">{formatDateTime(event.createdAt)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">暂无审计事件</div>
      )}
    </div>
  );
}

export function LivePanel({
  strategy,
  snapshot,
  paperState,
  riskDecision,
  auditEvents,
  summary,
  refreshing = false,
  running = false,
  saving = false,
  onRefresh,
  onRunOnce,
  onAdjustCash,
  onResetPaper
}) {
  const [subTab, setSubTab] = useState('signal');
  const liveSignal = useMemo(() => normalizeLiveSignal(snapshot), [snapshot]);

  if (!strategy) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <ListChecks className="h-12 w-12 text-slate-300" />
        <div>
          <p className="text-base font-bold text-slate-700">没有可监控的策略</p>
          <p className="mt-1 text-sm text-slate-500">先在「策略」页创建一个</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-6 p-5 sm:p-6">
      {/* 顶部信号区 */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">LIVE</div>
            <h2 className="mt-1 truncate text-lg font-bold text-slate-900">{strategy?.name || strategy?.id || '未选择策略'}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {snapshot?.computedAt ? `最新计算：${formatDateTime(snapshot.computedAt)}` : '尚未计算'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={subtleButtonClass} onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className={cx('h-4 w-4', refreshing ? 'animate-spin' : '')} />
              刷新
            </button>
            <button type="button" className={primaryButtonClass} onClick={() => onRunOnce?.()} disabled={running}>
              <Play className="h-4 w-4" />
              {running ? '运行中…' : '跑一轮'}
            </button>
          </div>
        </div>
        {liveSignal ? (
          <RealTimeSignalCard signal={liveSignal} />
        ) : (
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            当前没有触发信号
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <RiskDecisionPanel riskDecision={riskDecision} />
        <AuditTrailPanel events={auditEvents} />
      </div>

      {/* 子标签栏 */}
      <div className="border-t border-slate-100 pt-6">
        <div className="overflow-x-auto border-b border-slate-200" role="tablist" aria-label="实盘子页签">
          <div className="flex min-w-max items-center gap-0">
            {SUB_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = subTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubTab(tab.id)}
                  role="tab"
                  aria-selected={isActive}
                  className={cx(
                    'inline-flex min-h-12 shrink-0 items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-semibold transition-all duration-200',
                    isActive
                      ? 'border-indigo-500 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div>
        {subTab === 'signal' ? <SignalSubPanel snapshot={snapshot} /> : null}
        {subTab === 'positions' ? <PositionsSubPanel paperState={paperState} /> : null}
        {subTab === 'cash' ? (
          <CashSubPanel
            paperState={paperState}
            adjusting={saving}
            resetting={saving}
            onAdjust={onAdjustCash}
            onReset={onResetPaper}
          />
        ) : null}
        {subTab === 'fills' ? <FillsSubPanel paperState={paperState} summary={summary} /> : null}
      </div>
    </Card>
  );
}
