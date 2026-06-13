import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Bell,
  Bot,
  CandlestickChart,
  CheckCircle2,
  Database,
  FileText,
  Gauge,
  LineChart,
  Play,
  Radio,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart as ReLineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  applyMarketQuotesToQuantState,
  buildSampleBacktestRows,
  buildSimulatedOrderPlan,
  computeAccountSummary,
  executeSimulatedSwitch,
  evaluateRealtimeAutoExecution,
  markRealtimeStatus,
  normalizeQuantState,
  premiumPct,
  readQuantProjectState,
  recordRealtimeExecution,
  resetQuantProjectState,
  runPremiumSpreadBacktest,
  saveQuantProjectState
} from '../app/quantTrading.js';
import { trackFeatureEvent } from '../app/analytics.js';
import { fetchQuotes } from '../app/marketsApi.js';
import { isInTradingSession } from '../app/tradingSession.js';
import { showToast } from '../app/toast.js';
import {
  Card,
  Field,
  NumberInput,
  SelectField,
  TextInput,
  cx,
  primaryButtonClass,
  secondaryButtonClass,
  subtleButtonClass
} from '../components/experience-ui.jsx';

const MODULE_TABS = [
  { key: 'dashboard', label: '综合仪表盘', Icon: Gauge },
  { key: 'marketData', label: '行情与数据', Icon: CandlestickChart },
  { key: 'research', label: '策略研究', Icon: Bot },
  { key: 'trading', label: '交易执行', Icon: ArrowRightLeft },
  { key: 'risk', label: '风控监控', Icon: ShieldCheck },
  { key: 'performance', label: '账户绩效', Icon: LineChart },
  { key: 'settings', label: '系统设置', Icon: Settings2 }
];

const CURRENCY_FORMAT = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const NUMBER_FORMAT = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2
});

function formatCurrency(value) {
  return CURRENCY_FORMAT.format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function formatPrice(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(3) : '-';
}

function formatPct(value, digits = 2) {
  const num = Number(value);
  return `${Number.isFinite(num) ? num.toFixed(digits) : '0.00'}%`;
}

function formatDateTime(value = '') {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return value;
  }
}

function toInputNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function SignalBadge({ signal }) {
  const active = signal.action === 'switch';
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold',
        active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
      )}
    >
      {active ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {active ? '可模拟切换' : '继续观察'}
    </span>
  );
}

function ModuleTabs({ activeTab, onSelect }) {
  return (
    <div className="overflow-x-auto">
      <div className="inline-flex min-w-full items-center gap-1 rounded-2xl bg-slate-100 p-1 sm:min-w-0">
        {MODULE_TABS.map(({ key, label, Icon }) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              className={cx(
                'inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-colors',
                active ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-800'
              )}
              aria-pressed={active}
              onClick={() => onSelect(key)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, note, tone = 'slate' }) {
  const toneClass = tone === 'emerald'
    ? 'text-emerald-600'
    : tone === 'red'
      ? 'text-red-500'
      : tone === 'indigo'
        ? 'text-indigo-600'
        : 'text-slate-900';
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold text-slate-400">{label}</div>
      <div className={cx('mt-2 truncate text-2xl font-semibold tabular-nums', toneClass)}>{value}</div>
      {note ? <div className="mt-1 truncate text-xs text-slate-500">{note}</div> : null}
    </div>
  );
}

function EmptyRows({ children }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

function ToggleField({ label, description, checked, onChange }) {
  return (
    <label className="flex min-h-[76px] cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-indigo-200 hover:bg-indigo-50/40">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-900">{label}</span>
        {description ? <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span> : null}
      </span>
    </label>
  );
}

function StatusPill({ children, tone = 'slate', Icon }) {
  const toneClass = tone === 'emerald'
    ? 'bg-emerald-50 text-emerald-700'
    : tone === 'red'
      ? 'bg-red-50 text-red-600'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-700'
        : tone === 'indigo'
          ? 'bg-indigo-50 text-indigo-700'
          : 'bg-slate-100 text-slate-600';
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold', toneClass)}>
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {children}
    </span>
  );
}

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        {eyebrow ? <div className="text-xs font-bold text-slate-400">{eyebrow}</div> : null}
        <h2 className="mt-1 text-lg font-bold text-slate-900">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

function ProgressBar({ value, tone = 'indigo' }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const toneClass = tone === 'emerald' ? 'bg-emerald-500' : tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div className={cx('h-full rounded-full', toneClass)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function InfoRow({ label, value, note, tone = 'slate' }) {
  const valueClass = tone === 'emerald' ? 'text-emerald-600' : tone === 'red' ? 'text-red-500' : 'text-slate-900';
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-slate-700">{label}</div>
        {note ? <div className="mt-0.5 truncate text-xs text-slate-400">{note}</div> : null}
      </div>
      <div className={cx('shrink-0 text-right text-sm font-bold tabular-nums', valueClass)}>{value}</div>
    </div>
  );
}

function deriveQuoteRows(state) {
  const symbols = Array.from(new Set([state.strategy.sellSymbol, state.strategy.buySymbol].filter(Boolean)));
  return symbols.map((symbol, index) => {
    const quote = state.quotes[symbol] || { symbol, name: symbol };
    const price = quote.price > 0 ? quote.price : quote.bid > 0 ? quote.bid : quote.ask;
    const premium = premiumPct(price, quote.iopv);
    return {
      ...quote,
      symbol,
      leg: index === 0 ? '卖出腿' : '买入腿',
      price,
      premium
    };
  });
}

function buildMarketOverviewRows(signal) {
  return [
    { name: '沪深300', price: '3,912.42', change: 0.42, volume: '2,184 亿' },
    { name: '中证500', price: '5,842.19', change: -0.18, volume: '1,376 亿' },
    { name: '纳指100', price: '19,746.80', change: signal.netSpreadPct > 0 ? 0.36 : -0.12, volume: 'ETF 联动' }
  ];
}

function buildAlertRows({ state, summary, signal, plan, isTradingSessionNow }) {
  const positionRatio = summary.equity > 0 ? (summary.marketValue / summary.equity) * 100 : 0;
  const alerts = [];
  if (signal.action === 'switch') {
    alerts.push({ level: '交易信号', tone: 'emerald', message: `净差价 ${formatPct(signal.netSpreadPct)} 达到触发线`, action: '待确认撮合' });
  }
  if (!plan.canTrade) {
    alerts.push({ level: '策略限制', tone: 'amber', message: plan.rejectReason || signal.reason, action: '继续观察' });
  }
  if (positionRatio > 80) {
    alerts.push({ level: '仓位风险', tone: 'amber', message: `总仓位 ${formatPct(positionRatio)}`, action: '检查持仓' });
  }
  if (state.realtime.enabled && state.realtime.onlyTradingSession && !isTradingSessionNow) {
    alerts.push({ level: '运行状态', tone: 'slate', message: '雪球轮询等待 A 股交易时段', action: '等待开盘' });
  }
  if (state.realtime.lastError) {
    alerts.push({ level: '行情异常', tone: 'red', message: state.realtime.lastError, action: '刷新行情' });
  }
  return alerts.length ? alerts : [{ level: '系统', tone: 'emerald', message: '当前无待处理风险报警', action: '正常' }];
}

function RealtimePanel({ state, busy, isTradingSessionNow, onPatchRealtime, onRefresh }) {
  const realtime = state.realtime;
  const enabled = realtime.enabled;
  const autoExecute = realtime.autoExecute;
  const sessionTone = isTradingSessionNow ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600';
  const statusText = busy
    ? '刷新中'
    : enabled
      ? isTradingSessionNow || !realtime.onlyTradingSession
        ? '监听中'
        : '等待开盘'
      : '手动模式';

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
            <Radio className="h-3.5 w-3.5" />
            雪球实时执行
          </div>
          <h2 className="mt-3 text-lg font-bold text-slate-900">盘中自动刷新盘口并执行模拟撮合</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">实时行情来自 markets worker 的雪球 quote + pankou。自动撮合只写入模拟账户，不会向券商下真实订单。</p>
        </div>
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => onRefresh('manual')}>
          <RefreshCw className={cx('h-4 w-4', busy && 'animate-spin')} />
          刷新雪球行情
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <ToggleField
          label="盘中自动刷新"
          description="开启后按设定间隔轮询雪球实时盘口。"
          checked={enabled}
          onChange={(checked) => onPatchRealtime('enabled', checked)}
        />
        <ToggleField
          label="达到条件自动撮合"
          description="净差价超过触发线时自动执行模拟切换。"
          checked={autoExecute}
          onChange={(checked) => onPatchRealtime('autoExecute', checked)}
        />
        <ToggleField
          label="仅 A 股交易时段"
          description="默认只在 09:30-11:30、13:00-15:00 运行。"
          checked={realtime.onlyTradingSession}
          onChange={(checked) => onPatchRealtime('onlyTradingSession', checked)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="刷新间隔" rightLabel="秒">
          <NumberInput value={realtime.refreshIntervalSec} min="5" max="60" step="1" onChange={(event) => onPatchRealtime('refreshIntervalSec', toInputNumber(event.target.value))} />
        </Field>
        <Field label="日内最多自动执行">
          <NumberInput value={realtime.maxExecutionsPerDay} min="1" max="20" step="1" onChange={(event) => onPatchRealtime('maxExecutionsPerDay', toInputNumber(event.target.value))} />
        </Field>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs font-bold text-slate-400">当前状态</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={cx('inline-flex rounded-full px-2.5 py-1 text-xs font-bold', sessionTone)}>{isTradingSessionNow ? '盘中' : '非盘中'}</span>
            <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">{statusText}</span>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs font-bold text-slate-400">今日自动执行</div>
          <div className="mt-2 text-lg font-semibold tabular-nums text-slate-900">{realtime.executionsToday}/{realtime.maxExecutionsPerDay}</div>
        </div>
      </div>

      <div className="grid gap-3 text-xs text-slate-500 lg:grid-cols-3">
        <div className="truncate rounded-xl bg-slate-50 px-3 py-2">刷新：{formatDateTime(realtime.lastRefreshAt)}</div>
        <div className="truncate rounded-xl bg-slate-50 px-3 py-2">行情：{formatDateTime(realtime.lastQuoteAt)}</div>
        <div className={cx('truncate rounded-xl px-3 py-2', realtime.lastError ? 'bg-red-50 text-red-600' : 'bg-slate-50')}>{realtime.lastError || `状态：${realtime.lastStatus || 'idle'}`}</div>
      </div>
    </Card>
  );
}

function DashboardPanel({ state, summary, signal, plan, isTradingSessionNow, backtestResult, onExecute }) {
  const marketRows = buildMarketOverviewRows(signal);
  const alerts = buildAlertRows({ state, summary, signal, plan, isTradingSessionNow });
  const recentOrders = state.orders.slice(0, 10);
  const strategyHealthTone = state.realtime.lastError ? 'red' : state.realtime.enabled ? 'emerald' : 'slate';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="总资产" value={formatCurrency(summary.equity)} note={`可用 ${formatCurrency(summary.cash)}`} />
        <Metric label="当日盈亏" value={formatCurrency(summary.pnl)} note={formatPct(summary.cost > 0 ? (summary.pnl / summary.cost) * 100 : 0)} tone={summary.pnl >= 0 ? 'emerald' : 'red'} />
        <Metric label="累计收益率" value={formatPct(backtestResult.summary.totalReturnPct)} note="样例回测" tone="emerald" />
        <Metric label="持仓总市值" value={formatCurrency(summary.marketValue)} note={`${summary.positionCount} 个持仓`} />
        <Metric label="最大回撤" value={formatPct(backtestResult.summary.maxDrawdownPct)} note={`夏普 ${formatNumber(1.26)}`} tone={backtestResult.summary.maxDrawdownPct < 0 ? 'red' : 'slate'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card className="space-y-4 p-5 sm:p-6">
          <SectionHeader
            eyebrow="DASHBOARD"
            title="策略运行状态"
            description="集中查看模拟策略、实时行情、交易信号和近期绩效。"
            action={<button type="button" className={primaryButtonClass} disabled={!plan.canTrade} onClick={onExecute}><Play className="h-4 w-4" />执行模拟撮合</button>}
          />
          <div className="grid gap-3 lg:grid-cols-3">
            <InfoRow label={state.strategy.name} value={signal.action === 'switch' ? '可执行' : '观察'} note={signal.reason} tone={signal.action === 'switch' ? 'emerald' : 'slate'} />
            <InfoRow label="雪球实时行情" value={state.realtime.enabled ? '运行中' : '未开启'} note={state.realtime.lastStatus || 'idle'} tone={strategyHealthTone} />
            <InfoRow label="今日自动执行" value={`${state.realtime.executionsToday}/${state.realtime.maxExecutionsPerDay}`} note={formatDateTime(state.realtime.lastExecutionAt)} />
          </div>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ReLineChart data={backtestResult.rows} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(value) => String(value).slice(5)} />
                <YAxis width={74} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(value) => NUMBER_FORMAT.format(value)} />
                <Tooltip formatter={(value) => [formatCurrency(value), '策略权益']} labelFormatter={(label) => `日期 ${label}`} />
                <Line type="monotone" dataKey="equity" stroke="#2563eb" strokeWidth={2.5} dot={false} />
              </ReLineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="space-y-4 p-5 sm:p-6">
          <SectionHeader eyebrow="ALERTS" title="核心预警" />
          <div className="space-y-2">
            {alerts.map((alert, index) => (
              <div key={`${alert.level}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <StatusPill tone={alert.tone}>{alert.level}</StatusPill>
                  <span className="text-xs font-bold text-slate-400">{alert.action}</span>
                </div>
                <div className="mt-2 text-sm font-semibold leading-5 text-slate-800">{alert.message}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="text-sm font-bold text-slate-900">市场概览</h3>
            <StatusPill tone={isTradingSessionNow ? 'emerald' : 'slate'}>{isTradingSessionNow ? '盘中' : '非盘中'}</StatusPill>
          </div>
          <div className="divide-y divide-slate-100">
            {marketRows.map((row) => (
              <div key={row.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3 text-sm">
                <div className="font-semibold text-slate-900">{row.name}</div>
                <div className="text-right tabular-nums text-slate-600">{row.price}</div>
                <div className={cx('text-right font-bold tabular-nums', row.change >= 0 ? 'text-emerald-600' : 'text-red-500')}>{formatPct(row.change)}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="text-sm font-bold text-slate-900">近期交易记录</h3>
            <span className="text-xs font-semibold text-slate-400">最近 10 笔</span>
          </div>
          {recentOrders.length ? (
            <div className="divide-y divide-slate-100">
              {recentOrders.map((order) => (
                <div key={order.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-3 text-sm">
                  <StatusPill tone={order.side === 'BUY' ? 'emerald' : 'red'}>{order.side === 'BUY' ? '买入' : '卖出'}</StatusPill>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900">{order.symbol} {order.name}</div>
                    <div className="truncate text-xs text-slate-400">{formatDateTime(order.ts)}</div>
                  </div>
                  <div className="text-right font-semibold tabular-nums text-slate-900">{formatCurrency(order.amount)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-5"><EmptyRows>暂无成交记录</EmptyRows></div>
          )}
        </Card>
      </div>
    </div>
  );
}

function MarketDataPanel({ state, signal, busy, isTradingSessionNow, onPatchQuote, onPatchRealtime, onRefresh }) {
  const quoteRows = deriveQuoteRows(state);
  const dataCards = [
    { title: '历史行情数据', note: '支持分钟、日线样例序列', value: '180 天' },
    { title: '基本面数据', note: 'ETF 名称、净值、IOPV 字段', value: '已映射' },
    { title: '特色数据', note: '溢价率、净差价、盘口深度', value: formatPct(signal.netSpreadPct) },
    { title: '舆情/事件数据', note: '预留公告、新闻、龙虎榜入口', value: '待接入' }
  ];

  return (
    <div className="space-y-4">
      <RealtimePanel
        state={state}
        busy={busy}
        isTradingSessionNow={isTradingSessionNow}
        onPatchRealtime={onPatchRealtime}
        onRefresh={onRefresh}
      />

      <Card className="p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">全市场标的行情</h3>
            <div className="mt-1 text-xs text-slate-400">自选标的盘口、IOPV 和溢价率</div>
          </div>
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => onRefresh('manual')}>
            <RefreshCw className={cx('h-4 w-4', busy && 'animate-spin')} />
            刷新行情
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left">分组</th>
                <th className="px-4 py-3 text-left">标的</th>
                <th className="px-4 py-3 text-right">最新价</th>
                <th className="px-4 py-3 text-right">买一</th>
                <th className="px-4 py-3 text-right">买一量</th>
                <th className="px-4 py-3 text-right">卖一</th>
                <th className="px-4 py-3 text-right">卖一量</th>
                <th className="px-4 py-3 text-right">IOPV</th>
                <th className="px-4 py-3 text-right">溢价率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quoteRows.map((quote) => (
                <tr key={quote.symbol} className="bg-white">
                  <td className="px-4 py-3"><StatusPill tone={quote.leg === '卖出腿' ? 'red' : 'emerald'}>{quote.leg}</StatusPill></td>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {quote.symbol}
                    <div className="text-xs font-medium text-slate-400">{quote.name}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatPrice(quote.price)}</td>
                  {['bid', 'bidSize', 'ask', 'askSize', 'iopv'].map((field) => (
                    <td key={field} className="px-4 py-3 text-right">
                      <input
                        className="h-9 w-24 rounded-xl border border-slate-200 px-2 text-right text-sm tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        type="number"
                        min="0"
                        step={field.endsWith('Size') ? '100' : '0.001'}
                        value={quote[field] || 0}
                        onChange={(event) => onPatchQuote(quote.symbol, field, toInputNumber(event.target.value))}
                      />
                    </td>
                  ))}
                  <td className={cx('px-4 py-3 text-right font-semibold tabular-nums', quote.premium >= 0 ? 'text-emerald-600' : 'text-red-500')}>{formatPct(quote.premium)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {dataCards.map((item) => (
          <Card key={item.title} className="p-4">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
              <Database className="h-4 w-4" />
              {item.title}
            </div>
            <div className="mt-3 text-xl font-semibold text-slate-900">{item.value}</div>
            <div className="mt-1 text-sm leading-5 text-slate-500">{item.note}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ResearchBacktestPanel({ state, summary, signal, onPatchStrategy, onPatchQuote }) {
  const [editorMode, setEditorMode] = useState('code');
  const templateRows = [
    { name: '纳指 ETF 溢价差', type: '套利', status: '当前模板' },
    { name: '双均线趋势', type: '趋势', status: '模板' },
    { name: '网格交易', type: '震荡', status: '模板' }
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-5 p-5 sm:p-6">
        <SectionHeader
          eyebrow="RESEARCH"
          title="策略开发工具"
          description="支持代码模式、可视化规则和模板复用；当前策略为纳指 ETF 溢价差切换。"
          action={
            <div className="inline-flex rounded-2xl bg-slate-100 p-1">
              {[
                { key: 'code', label: '代码模式', Icon: FileText },
                { key: 'visual', label: '可视化模式', Icon: SlidersHorizontal }
              ].map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={cx('inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-bold', editorMode === key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500')}
                  onClick={() => setEditorMode(key)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          }
        />
        <div className="grid gap-3 lg:grid-cols-[1fr_0.85fr]">
          <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-sm text-slate-100">
            <div className="flex items-center justify-between text-xs font-bold text-slate-400">
              <span>{editorMode === 'code' ? 'Python 策略编辑器' : '可视化规则预览'}</span>
              <StatusPill tone={signal.action === 'switch' ? 'emerald' : 'slate'}>{signal.action === 'switch' ? '触发' : '观察'}</StatusPill>
            </div>
            <pre className="mt-4 overflow-x-auto whitespace-pre-wrap font-mono leading-6">{editorMode === 'code'
              ? `def handle_bar(context, data):\n    sell = quote("${state.strategy.sellSymbol}")\n    buy = quote("${state.strategy.buySymbol}")\n    spread = premium(sell.bid, sell.iopv) - premium(buy.ask, buy.iopv)\n    if spread >= ${state.strategy.triggerSpreadPct}:\n        switch_etf("${state.strategy.sellSymbol}", "${state.strategy.buySymbol}")`
              : `条件：卖出腿溢价率 - 买入腿溢价率 >= ${formatPct(state.strategy.triggerSpreadPct)}\n标的池：${state.strategy.sellSymbol} / ${state.strategy.buySymbol}\n执行：按买一/卖一、滑点、份额和现金约束生成模拟成交`}
            </pre>
          </div>
          <div className="space-y-2">
            {templateRows.map((template) => (
              <div key={template.name} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <div className="text-sm font-bold text-slate-900">{template.name}</div>
                  <div className="mt-1 text-xs text-slate-400">{template.type}</div>
                </div>
                <StatusPill tone={template.status === '当前模板' ? 'indigo' : 'slate'}>{template.status}</StatusPill>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <StrategyPanel
        state={state}
        signal={signal}
        onPatchStrategy={onPatchStrategy}
        onPatchQuote={onPatchQuote}
      />

      <BacktestPanel state={state} summary={summary} />
    </div>
  );
}

function TradingExecutionPanel({ state, summary, plan, onExecute }) {
  return (
    <div className="space-y-4">
      <Card className="space-y-5 p-5 sm:p-6">
        <SectionHeader
          eyebrow="TRADING"
          title="策略部署"
          description="回测通过后可部署到模拟盘；实盘券商接口保持隔离，当前不会发送真实订单。"
        />
        <div className="grid gap-3 lg:grid-cols-4">
          <InfoRow label="运行环境" value="模拟盘" note="独立模拟账户" tone="emerald" />
          <InfoRow label="运行周期" value={state.realtime.enabled ? `${state.realtime.refreshIntervalSec}s` : '手动'} note="分钟级轮询" />
          <InfoRow label="交易时段" value={state.realtime.onlyTradingSession ? 'A 股时段' : '全天'} note="可在设置中调整" />
          <InfoRow label="券商接口" value="未绑定" note="PTrade / QMT 预留" />
        </div>
      </Card>
      <TradePlanCard plan={plan} onExecute={onExecute} />
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h3 className="text-sm font-bold text-slate-900">持仓管理</h3>
            <span className="text-xs font-semibold text-slate-400">{summary.positionCount} 个持仓</span>
          </div>
          <div className="divide-y divide-slate-100">
            {summary.positions.map((position) => {
              const weight = summary.equity > 0 ? (position.marketValue / summary.equity) * 100 : 0;
              return (
                <div key={position.symbol} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="font-semibold text-slate-900">{position.symbol} {position.name}</div>
                    <div className="font-bold tabular-nums text-slate-900">{formatCurrency(position.marketValue)}</div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>{formatNumber(position.shares, 0)} 份</span>
                    <span>{formatPct(weight)}</span>
                  </div>
                  <div className="mt-2"><ProgressBar value={weight} tone={weight > 60 ? 'amber' : 'indigo'} /></div>
                </div>
              );
            })}
          </div>
        </Card>
        <OrdersPanel orders={state.orders} />
      </div>
    </div>
  );
}

function RiskMonitoringPanel({ state, summary, signal, plan, backtestResult, isTradingSessionNow, onPatchStrategy, onPatchRealtime }) {
  const positionRatio = summary.equity > 0 ? (summary.marketValue / summary.equity) * 100 : 0;
  const maxPositionRatio = summary.equity > 0
    ? Math.max(0, ...summary.positions.map((position) => (position.marketValue / summary.equity) * 100))
    : 0;
  const alerts = buildAlertRows({ state, summary, signal, plan, isTradingSessionNow });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="总仓位" value={formatPct(positionRatio)} note="持仓市值 / 总资产" tone={positionRatio > 80 ? 'red' : 'slate'} />
        <Metric label="单标的最大仓位" value={formatPct(maxPositionRatio)} note="事前风控" tone={maxPositionRatio > 65 ? 'amber' : 'slate'} />
        <Metric label="浮亏比例" value={formatPct(summary.cost > 0 ? Math.min(0, summary.pnl / summary.cost) * 100 : 0)} note={formatCurrency(summary.pnl)} tone={summary.pnl < 0 ? 'red' : 'emerald'} />
        <Metric label="回测最大回撤" value={formatPct(backtestResult.summary.maxDrawdownPct)} note="样例序列" tone={backtestResult.summary.maxDrawdownPct < -5 ? 'red' : 'slate'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="space-y-4 p-5 sm:p-6">
          <SectionHeader eyebrow="MONITOR" title="实时监控看板" description="跟踪策略运行、账户风险和行情异常状态。" />
          <div className="space-y-3">
            <InfoRow label="策略运行" value={state.realtime.enabled ? '运行中' : '停止'} note={state.realtime.lastStatus || 'idle'} tone={state.realtime.lastError ? 'red' : state.realtime.enabled ? 'emerald' : 'slate'} />
            <InfoRow label="交易信号" value={signal.action === 'switch' ? '触发' : '未触发'} note={signal.reason} tone={signal.action === 'switch' ? 'emerald' : 'slate'} />
            <InfoRow label="行情异动" value={formatPct(signal.netSpreadPct)} note="净差价监控" tone={signal.netSpreadPct >= signal.triggerSpreadPct ? 'emerald' : 'slate'} />
          </div>
        </Card>

        <Card className="space-y-4 p-5 sm:p-6">
          <SectionHeader eyebrow="RULES" title="风控规则配置" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="单次最大交易金额">
              <NumberInput value={state.strategy.maxOrderCash} min="0" step="1000" onChange={(event) => onPatchStrategy('maxOrderCash', toInputNumber(event.target.value))} />
            </Field>
            <Field label="日内最多自动执行">
              <NumberInput value={state.realtime.maxExecutionsPerDay} min="1" max="20" step="1" onChange={(event) => onPatchRealtime('maxExecutionsPerDay', toInputNumber(event.target.value))} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ToggleField
              label="触发后仅模拟成交"
              description="保持实盘券商隔离，不发送真实订单。"
              checked
              onChange={() => {}}
            />
            <ToggleField
              label="仅 A 股交易时段执行"
              description="非交易时段只刷新状态，不自动撮合。"
              checked={state.realtime.onlyTradingSession}
              onChange={(checked) => onPatchRealtime('onlyTradingSession', checked)}
            />
          </div>
        </Card>
      </div>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-bold text-slate-900">报警与通知</h3>
          <StatusPill tone="indigo" Icon={Bell}>站内信</StatusPill>
        </div>
        <div className="divide-y divide-slate-100">
          {alerts.map((alert, index) => (
            <div key={`${alert.level}-${index}`} className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-[auto_1fr_auto] sm:items-center">
              <StatusPill tone={alert.tone}>{alert.level}</StatusPill>
              <div className="font-semibold text-slate-800">{alert.message}</div>
              <div className="text-xs font-bold text-slate-400">{alert.action}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AccountPerformancePanel({ state, summary, backtestResult, onPatchAccount, onPatchPosition, onReset }) {
  const totalFee = state.orders.reduce((sum, order) => sum + (Number(order.fee) || 0), 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="账户总资产" value={formatCurrency(summary.equity)} note="现金 + 持仓市值" />
        <Metric label="可用资金" value={formatCurrency(summary.cash)} note="模拟账户" />
        <Metric label="累计手续费" value={formatCurrency(totalFee)} note={`${state.orders.length} 笔成交`} />
        <Metric label="胜率" value={formatPct(backtestResult.summary.winRatePct, 0)} note={`交易 ${backtestResult.summary.trades} 次`} />
      </div>

      <Card className="space-y-4 p-5 sm:p-6">
        <SectionHeader eyebrow="PERFORMANCE" title="账户与绩效分析" description="资产走势、收益拆解和风险指标基于当前模拟账户与样例回测序列。" />
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ReLineChart data={backtestResult.rows} margin={{ left: 0, right: 10, top: 12, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(value) => String(value).slice(5)} />
              <YAxis width={72} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(value) => NUMBER_FORMAT.format(value)} />
              <Tooltip formatter={(value) => [formatCurrency(value), '账户权益']} labelFormatter={(label) => `日期 ${label}`} />
              <Line type="monotone" dataKey="equity" stroke="#0f172a" strokeWidth={2.5} dot={false} />
            </ReLineChart>
          </ResponsiveContainer>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <InfoRow label="策略收益" value={formatCurrency(backtestResult.summary.totalProfit)} note="溢价差捕获" tone="emerald" />
          <InfoRow label="平均净差价" value={formatPct(backtestResult.summary.avgNetSpreadPct)} note="交易样本" />
          <InfoRow label="风险价值" value={formatCurrency(Math.abs(summary.pnl) * 0.35)} note="简化 VaR 估算" tone={summary.pnl < 0 ? 'red' : 'slate'} />
        </div>
      </Card>

      <AccountPanel
        state={state}
        summary={summary}
        onPatchAccount={onPatchAccount}
        onPatchPosition={onPatchPosition}
        onReset={onReset}
      />
    </div>
  );
}

function SystemSettingsPanel({ state, onPatchRealtime }) {
  return (
    <div className="space-y-4">
      <Card className="space-y-5 p-5 sm:p-6">
        <SectionHeader eyebrow="SETTINGS" title="个人中心" description="管理员可见的量化系统配置入口。" />
        <div className="grid gap-3 lg:grid-cols-3">
          <InfoRow label="账户权限" value="管理员" note="量化菜单仅管理员可见" tone="emerald" />
          <InfoRow label="资金密码" value="未配置" note="实盘接入前设置" />
          <InfoRow label="API 密钥" value="未绑定" note="券商接口预留" />
        </div>
      </Card>

      <Card className="space-y-5 p-5 sm:p-6">
        <SectionHeader eyebrow="DATA SOURCE" title="系统配置" description="行情源、券商接口和运行参数集中配置。" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="行情数据源">
            <SelectField value="xueqiu" onChange={() => {}} options={[{ label: '雪球 quote + pankou', value: 'xueqiu' }]} />
          </Field>
          <Field label="券商接口">
            <SelectField value="paper" onChange={() => {}} options={[{ label: '模拟盘', value: 'paper' }, { label: 'PTrade 待绑定', value: 'ptrade' }, { label: 'QMT 待绑定', value: 'qmt' }]} />
          </Field>
          <Field label="刷新间隔" rightLabel="秒">
            <NumberInput value={state.realtime.refreshIntervalSec} min="5" max="60" step="1" onChange={(event) => onPatchRealtime('refreshIntervalSec', toInputNumber(event.target.value))} />
          </Field>
          <Field label="页面主题">
            <SelectField value="light" onChange={() => {}} options={[{ label: '浅色', value: 'light' }, { label: '深色预留', value: 'dark' }]} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ToggleField
            label="盘中自动刷新"
            description="按刷新间隔轮询雪球行情。"
            checked={state.realtime.enabled}
            onChange={(checked) => onPatchRealtime('enabled', checked)}
          />
          <ToggleField
            label="达到条件自动撮合"
            description="只写入模拟账户成交。"
            checked={state.realtime.autoExecute}
            onChange={(checked) => onPatchRealtime('autoExecute', checked)}
          />
          <ToggleField
            label="仅交易时段运行"
            description="按 A 股开收盘时段控制。"
            checked={state.realtime.onlyTradingSession}
            onChange={(checked) => onPatchRealtime('onlyTradingSession', checked)}
          />
        </div>
      </Card>
    </div>
  );
}

function AccountPanel({ state, summary, onPatchAccount, onPatchPosition, onReset }) {
  return (
    <div className="space-y-4">
      <Card className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">模拟账户</h2>
            <div className="mt-1 text-sm text-slate-500">现金、费率、滑点和持仓用于交易撮合。</div>
          </div>
          <button type="button" className={subtleButtonClass} onClick={onReset}>
            <RefreshCw className="h-4 w-4" />
            恢复样例
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="可用现金">
            <NumberInput value={state.account.cash} min="0" step="1000" onChange={(event) => onPatchAccount('cash', toInputNumber(event.target.value))} />
          </Field>
          <Field label="佣金率" rightLabel="%">
            <NumberInput value={state.account.feeRate} min="0" step="0.001" onChange={(event) => onPatchAccount('feeRate', toInputNumber(event.target.value))} />
          </Field>
          <Field label="最低佣金">
            <NumberInput value={state.account.minFee} min="0" step="0.1" onChange={(event) => onPatchAccount('minFee', toInputNumber(event.target.value))} />
          </Field>
          <Field label="最小跳动">
            <NumberInput value={state.account.tickSize} min="0.0001" step="0.001" onChange={(event) => onPatchAccount('tickSize', toInputNumber(event.target.value))} />
          </Field>
          <Field label="滑点档位">
            <NumberInput value={state.account.slippageTicks} min="0" step="1" onChange={(event) => onPatchAccount('slippageTicks', toInputNumber(event.target.value))} />
          </Field>
        </div>
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-bold text-slate-900">持仓</h3>
          <span className="text-xs font-semibold text-slate-400">{summary.positionCount} 个有效持仓</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left">代码</th>
                <th className="px-4 py-3 text-left">名称</th>
                <th className="px-4 py-3 text-right">份额</th>
                <th className="px-4 py-3 text-right">成本价</th>
                <th className="px-4 py-3 text-right">最新价</th>
                <th className="px-4 py-3 text-right">市值</th>
                <th className="px-4 py-3 text-right">盈亏</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.positions.map((position) => (
                <tr key={position.symbol} className="bg-white">
                  <td className="px-4 py-3 font-semibold text-slate-900">{position.symbol}</td>
                  <td className="px-4 py-3 text-slate-600">{position.name}</td>
                  <td className="px-4 py-3 text-right">
                    <input
                      className="h-9 w-28 rounded-xl border border-slate-200 px-2 text-right text-sm tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      type="number"
                      min="0"
                      step="100"
                      value={position.shares}
                      onChange={(event) => onPatchPosition(position.symbol, 'shares', toInputNumber(event.target.value))}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      className="h-9 w-24 rounded-xl border border-slate-200 px-2 text-right text-sm tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      type="number"
                      min="0"
                      step="0.001"
                      value={position.costPrice}
                      onChange={(event) => onPatchPosition(position.symbol, 'costPrice', toInputNumber(event.target.value))}
                    />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatPrice(position.lastPrice)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-900">{formatCurrency(position.marketValue)}</td>
                  <td className={cx('px-4 py-3 text-right tabular-nums font-semibold', position.pnl >= 0 ? 'text-emerald-600' : 'text-red-500')}>
                    {formatCurrency(position.pnl)}
                    <div className="text-xs font-medium">{formatPct(position.pnlPct)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StrategyPanel({ state, signal, onPatchStrategy, onPatchQuote }) {
  const symbols = [state.strategy.sellSymbol, state.strategy.buySymbol];
  return (
    <div className="space-y-4">
      <Card className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">策略</h2>
            <div className="mt-1 text-sm text-slate-500">默认模板为同类纳指 ETF 的溢价差切换。</div>
          </div>
          <SignalBadge signal={signal} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="策略名称">
            <TextInput value={state.strategy.name} onChange={(event) => onPatchStrategy('name', event.target.value)} />
          </Field>
          <Field label="卖出代码">
            <TextInput value={state.strategy.sellSymbol} onChange={(event) => onPatchStrategy('sellSymbol', event.target.value)} />
          </Field>
          <Field label="买入代码">
            <TextInput value={state.strategy.buySymbol} onChange={(event) => onPatchStrategy('buySymbol', event.target.value)} />
          </Field>
          <Field label="最大单次金额">
            <NumberInput value={state.strategy.maxOrderCash} min="0" step="1000" onChange={(event) => onPatchStrategy('maxOrderCash', toInputNumber(event.target.value))} />
          </Field>
          <Field label="触发差价" rightLabel="%">
            <NumberInput value={state.strategy.triggerSpreadPct} min="0" step="0.01" onChange={(event) => onPatchStrategy('triggerSpreadPct', toInputNumber(event.target.value))} />
          </Field>
          <Field label="观察线" rightLabel="%">
            <NumberInput value={state.strategy.closeSpreadPct} min="0" step="0.01" onChange={(event) => onPatchStrategy('closeSpreadPct', toInputNumber(event.target.value))} />
          </Field>
          <Field label="费用缓冲" rightLabel="%">
            <NumberInput value={state.strategy.feeBufferPct} min="0" step="0.01" onChange={(event) => onPatchStrategy('feeBufferPct', toInputNumber(event.target.value))} />
          </Field>
          <Field label="交易单位">
            <NumberInput value={state.strategy.lotSize} min="1" step="100" onChange={(event) => onPatchStrategy('lotSize', toInputNumber(event.target.value))} />
          </Field>
          <Field label="最小订单金额">
            <NumberInput value={state.strategy.minOrderCash} min="0" step="100" onChange={(event) => onPatchStrategy('minOrderCash', toInputNumber(event.target.value))} />
          </Field>
          <Field label="复盘冷却天数">
            <NumberInput value={state.strategy.cooldownDays} min="0" step="1" onChange={(event) => onPatchStrategy('cooldownDays', toInputNumber(event.target.value))} />
          </Field>
        </div>
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-bold text-slate-900">盘口与 IOPV</h3>
          <span className="text-xs font-semibold text-slate-400">可手动输入，也可由雪球实时刷新覆盖</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left">腿</th>
                <th className="px-4 py-3 text-left">名称</th>
                <th className="px-4 py-3 text-right">买一</th>
                <th className="px-4 py-3 text-right">买一量</th>
                <th className="px-4 py-3 text-right">卖一</th>
                <th className="px-4 py-3 text-right">卖一量</th>
                <th className="px-4 py-3 text-right">IOPV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {symbols.map((symbol, index) => {
                const quote = state.quotes[symbol] || { symbol, name: symbol };
                return (
                  <tr key={`${symbol}-${index}`} className="bg-white">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {index === 0 ? '卖出' : '买入'}
                      <div className="text-xs font-medium text-slate-400">{symbol}</div>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        className="h-9 w-36 rounded-xl border border-slate-200 px-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        value={quote.name || ''}
                        onChange={(event) => onPatchQuote(symbol, 'name', event.target.value)}
                      />
                    </td>
                    {['bid', 'bidSize', 'ask', 'askSize', 'iopv'].map((field) => (
                      <td key={field} className="px-4 py-3 text-right">
                        <input
                          className="h-9 w-24 rounded-xl border border-slate-200 px-2 text-right text-sm tabular-nums outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                          type="number"
                          min="0"
                          step={field.endsWith('Size') ? '100' : '0.001'}
                          value={quote[field] || 0}
                          onChange={(event) => onPatchQuote(symbol, field, toInputNumber(event.target.value))}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function TradePlanCard({ plan, onExecute }) {
  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">交易</h2>
          <div className="mt-1 text-sm text-slate-500">{plan.signal.reason}</div>
        </div>
        <SignalBadge signal={plan.signal} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-bold text-slate-400">卖出腿</div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="font-semibold text-slate-900">{plan.sell.symbol}</span>
            <span className="tabular-nums text-slate-600">{formatPrice(plan.sell.price)}</span>
          </div>
          <div className="mt-2 text-sm text-slate-500">{formatNumber(plan.sell.quantity, 0)} 份 · {formatCurrency(plan.sell.amount)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-bold text-slate-400">买入腿</div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="font-semibold text-slate-900">{plan.buy.symbol}</span>
            <span className="tabular-nums text-slate-600">{formatPrice(plan.buy.price)}</span>
          </div>
          <div className="mt-2 text-sm text-slate-500">{formatNumber(plan.buy.quantity, 0)} 份 · {formatCurrency(plan.buy.amount)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-bold text-slate-400">预估捕获</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-emerald-600">{formatCurrency(plan.estimatedCapture)}</div>
          <div className="mt-2 text-sm text-slate-500">费用 {formatCurrency(plan.totalFee)}</div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-500">{plan.canTrade ? '撮合将按滑点后的买一 / 卖一价格成交。' : plan.rejectReason}</div>
        <button type="button" className={primaryButtonClass} disabled={!plan.canTrade} onClick={onExecute}>
          <Play className="h-4 w-4" />
          执行模拟撮合
        </button>
      </div>
    </Card>
  );
}

function OrdersPanel({ orders }) {
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h3 className="text-sm font-bold text-slate-900">成交记录</h3>
        <span className="text-xs font-semibold text-slate-400">最近 {orders.length} 笔</span>
      </div>
      {orders.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left">时间</th>
                <th className="px-4 py-3 text-left">方向</th>
                <th className="px-4 py-3 text-left">标的</th>
                <th className="px-4 py-3 text-right">价格</th>
                <th className="px-4 py-3 text-right">数量</th>
                <th className="px-4 py-3 text-right">金额</th>
                <th className="px-4 py-3 text-right">费用</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((order) => (
                <tr key={order.id} className="bg-white">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">{formatDateTime(order.ts)}</td>
                  <td className={cx('px-4 py-3 font-bold', order.side === 'BUY' ? 'text-emerald-600' : 'text-red-500')}>{order.side === 'BUY' ? '买入' : '卖出'}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {order.symbol}
                    <div className="text-xs font-medium text-slate-400">{order.name}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatPrice(order.price)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(order.quantity, 0)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatCurrency(order.amount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatCurrency(order.fee)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-5">
          <EmptyRows>暂无成交记录</EmptyRows>
        </div>
      )}
    </Card>
  );
}

function BacktestPanel({ state, summary }) {
  const [days, setDays] = useState(45);
  const rows = useMemo(() => buildSampleBacktestRows(days), [days]);
  const result = useMemo(() => runPremiumSpreadBacktest({
    rows,
    triggerSpreadPct: state.strategy.triggerSpreadPct,
    feeBufferPct: state.strategy.feeBufferPct,
    orderCash: state.strategy.maxOrderCash,
    initialEquity: Math.max(summary.equity, 1),
    cooldownDays: state.strategy.cooldownDays
  }), [rows, state.strategy.triggerSpreadPct, state.strategy.feeBufferPct, state.strategy.maxOrderCash, state.strategy.cooldownDays, summary.equity]);

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">复盘</h2>
            <div className="mt-1 text-sm text-slate-500">用同一套阈值在样例溢价差序列上回测。</div>
          </div>
          <Field label="样本天数" className="w-full sm:w-36">
            <NumberInput value={days} min="8" max="180" step="1" onChange={(event) => setDays(toInputNumber(event.target.value))} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="交易次数" value={`${result.summary.trades} 次`} />
          <Metric label="累计捕获" value={formatCurrency(result.summary.totalProfit)} tone="emerald" />
          <Metric label="收益率" value={formatPct(result.summary.totalReturnPct)} tone="emerald" />
          <Metric label="胜率" value={formatPct(result.summary.winRatePct, 0)} />
          <Metric label="最大回撤" value={formatPct(result.summary.maxDrawdownPct)} tone={result.summary.maxDrawdownPct < 0 ? 'red' : 'slate'} />
        </div>

        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ReLineChart data={result.rows} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(value) => String(value).slice(5)} />
              <YAxis yAxisId="equity" width={72} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(value) => NUMBER_FORMAT.format(value)} />
              <YAxis yAxisId="spread" orientation="right" width={48} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(value) => `${value}%`} />
              <Tooltip
                formatter={(value, name) => {
                  if (name === 'equity') return [formatCurrency(value), '权益'];
                  if (name === 'netSpreadPct') return [formatPct(value), '净差价'];
                  return [value, name];
                }}
                labelFormatter={(label) => `日期 ${label}`}
              />
              <ReferenceLine yAxisId="spread" y={state.strategy.triggerSpreadPct} stroke="#f59e0b" strokeDasharray="4 4" />
              <Line yAxisId="equity" type="monotone" dataKey="equity" stroke="#0f172a" strokeWidth={2} dot={false} />
              <Line yAxisId="spread" type="monotone" dataKey="netSpreadPct" stroke="#2563eb" strokeWidth={2} dot={false} />
            </ReLineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-sm font-bold text-slate-900">复盘交易</h3>
          <span className="text-xs font-semibold text-slate-400">按冷却期过滤</span>
        </div>
        {result.trades.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">日期</th>
                  <th className="px-4 py-3 text-right">原始差价</th>
                  <th className="px-4 py-3 text-right">净差价</th>
                  <th className="px-4 py-3 text-right">交易金额</th>
                  <th className="px-4 py-3 text-right">捕获收益</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.trades.slice().reverse().map((trade) => (
                  <tr key={trade.date} className="bg-white">
                    <td className="px-4 py-3 font-semibold text-slate-900">{trade.date}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatPct(trade.rawSpreadPct)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{formatPct(trade.netSpreadPct)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(trade.orderCash)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-600">{formatCurrency(trade.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyRows>当前阈值下没有触发交易</EmptyRows>
          </div>
        )}
      </Card>
    </div>
  );
}

export function QuantTradingExperience({ embedded = false, activeModule: controlledModule = '', hideModuleTabs = false, onModuleChange } = {}) {
  const isControlledModule = Boolean(controlledModule);
  const [internalActiveModule, setInternalActiveModule] = useState(controlledModule || 'dashboard');
  const [state, setState] = useState(() => readQuantProjectState());
  const [realtimeBusy, setRealtimeBusy] = useState(false);
  const [isTradingSessionNow, setIsTradingSessionNow] = useState(() => isInTradingSession(new Date()));
  const normalized = useMemo(() => normalizeQuantState(state), [state]);
  const stateRef = useRef(normalized);
  const realtimeBusyRef = useRef(false);
  const summary = useMemo(() => computeAccountSummary(normalized), [normalized]);
  const plan = useMemo(() => buildSimulatedOrderPlan(normalized), [normalized]);
  const signal = plan.signal;
  const dashboardBacktestRows = useMemo(() => buildSampleBacktestRows(60), []);
  const dashboardBacktestResult = useMemo(() => runPremiumSpreadBacktest({
    rows: dashboardBacktestRows,
    triggerSpreadPct: normalized.strategy.triggerSpreadPct,
    feeBufferPct: normalized.strategy.feeBufferPct,
    orderCash: normalized.strategy.maxOrderCash,
    initialEquity: Math.max(summary.equity, 1),
    cooldownDays: normalized.strategy.cooldownDays
  }), [dashboardBacktestRows, normalized.strategy.triggerSpreadPct, normalized.strategy.feeBufferPct, normalized.strategy.maxOrderCash, normalized.strategy.cooldownDays, summary.equity]);
  const realtimeEnabled = normalized.realtime.enabled;
  const realtimeRefreshIntervalSec = normalized.realtime.refreshIntervalSec;
  const realtimeAutoExecute = normalized.realtime.autoExecute;
  const realtimeOnlyTradingSession = normalized.realtime.onlyTradingSession;
  const activeModule = controlledModule || internalActiveModule;

  const selectModule = useCallback((nextModule) => {
    const normalizedModule = MODULE_TABS.some((tab) => tab.key === nextModule) ? nextModule : 'dashboard';
    if (isControlledModule) {
      onModuleChange?.(normalizedModule);
    } else {
      setInternalActiveModule(normalizedModule);
    }
    trackFeatureEvent('quant_trading', 'module_select', { module: normalizedModule });
  }, [isControlledModule, onModuleChange]);

  useEffect(() => {
    if (controlledModule && MODULE_TABS.some((tab) => tab.key === controlledModule)) {
      setInternalActiveModule(controlledModule);
    }
  }, [controlledModule]);

  useEffect(() => {
    stateRef.current = normalized;
  }, [normalized]);

  useEffect(() => {
    saveQuantProjectState(normalized);
  }, [normalized]);

  useEffect(() => {
    trackFeatureEvent('quant_trading', 'view_open', { activeModule });
  }, [activeModule]);

  function patchState(updater) {
    setState((current) => normalizeQuantState(updater(normalizeQuantState(current))));
  }

  function patchAccount(key, value) {
    patchState((current) => ({
      ...current,
      account: {
        ...current.account,
        [key]: value
      }
    }));
  }

  function patchStrategy(key, value) {
    patchState((current) => ({
      ...current,
      strategy: {
        ...current.strategy,
        [key]: value
      }
    }));
  }

  function patchQuote(symbol, key, value) {
    patchState((current) => ({
      ...current,
      quotes: {
        ...current.quotes,
        [symbol]: {
          ...(current.quotes[symbol] || { symbol }),
          symbol,
          [key]: value
        }
      }
    }));
  }

  function patchRealtime(key, value) {
    patchState((current) => ({
      ...current,
      realtime: {
        ...current.realtime,
        [key]: value
      }
    }));
  }

  function patchPosition(symbol, key, value) {
    patchState((current) => ({
      ...current,
      account: {
        ...current.account,
        positions: {
          ...current.account.positions,
          [symbol]: {
            ...(current.account.positions[symbol] || { symbol, name: current.quotes[symbol]?.name || symbol }),
            [key]: value
          }
        }
      }
    }));
  }

  const executeTrade = useCallback((source = 'button') => {
    const nowIso = new Date().toISOString();
    const result = executeSimulatedSwitch(stateRef.current, nowIso);
    if (!result.fills.length) {
      showToast({
        title: '没有执行撮合',
        description: result.plan.rejectReason || '当前信号未达到触发条件。',
        tone: 'amber'
      });
      trackFeatureEvent('quant_trading', 'simulate_trade_skip', { source, reason: result.plan.rejectReason });
      return;
    }
    const nextState = recordRealtimeExecution(result.state, nowIso);
    stateRef.current = nextState;
    setState(nextState);
    selectModule('trading');
    showToast({
      title: '模拟撮合完成',
      description: `成交 ${result.fills.length} 笔，费用 ${formatCurrency(result.plan.totalFee)}。`,
      tone: 'emerald'
    });
    trackFeatureEvent('quant_trading', 'simulate_trade_success', {
      source,
      fillCount: result.fills.length,
      netSpreadPct: result.plan.signal.netSpreadPct
    });
  }, [selectModule]);

  const refreshRealtimeQuotes = useCallback(async (source = 'manual') => {
    if (realtimeBusyRef.current) return;
    const startedAt = new Date();
    const current = stateRef.current;
    const realtime = current.realtime;
    const tradingSession = isInTradingSession(startedAt);
    setIsTradingSessionNow(tradingSession);

    if (source === 'auto' && realtime.onlyTradingSession && !tradingSession) {
      const nextState = markRealtimeStatus(current, {
        lastStatus: 'waiting_session',
        lastRefreshAt: startedAt.toISOString(),
        lastError: ''
      });
      stateRef.current = nextState;
      setState(nextState);
      return;
    }

    realtimeBusyRef.current = true;
    setRealtimeBusy(true);
    try {
      const symbols = [current.strategy.sellSymbol, current.strategy.buySymbol].filter(Boolean);
      const payload = await fetchQuotes(symbols);
      const merged = applyMarketQuotesToQuantState(stateRef.current, payload?.quotes || {}, {
        refreshedAt: new Date().toISOString()
      });
      let nextState = merged.state;
      let autoExecuted = false;
      let decision = null;

      if (source === 'auto' && nextState.realtime.autoExecute) {
        decision = evaluateRealtimeAutoExecution(nextState, {
          now: new Date(),
          isTradingSession: tradingSession
        });
        if (decision.ok) {
          const autoResult = executeSimulatedSwitch(nextState, new Date().toISOString());
          if (autoResult.fills.length) {
            nextState = recordRealtimeExecution(autoResult.state, new Date().toISOString());
            autoExecuted = true;
          }
        } else {
          nextState = markRealtimeStatus(nextState, {
            lastStatus: 'watching',
            lastError: decision.reason || ''
          });
        }
      }

      stateRef.current = nextState;
      setState(nextState);
      if (source !== 'auto' || autoExecuted) {
        showToast({
          title: autoExecuted ? '实时策略已自动撮合' : '雪球行情已刷新',
          description: autoExecuted
            ? `净差价 ${formatPct(decision?.plan?.signal?.netSpreadPct || 0)}，已写入模拟成交。`
            : `更新 ${merged.updatedSymbols.length} 个标的盘口。`,
          tone: autoExecuted ? 'emerald' : 'indigo'
        });
      }
      trackFeatureEvent('quant_trading', autoExecuted ? 'realtime_auto_execute' : 'realtime_refresh', {
        source,
        updatedCount: merged.updatedSymbols.length,
        errorCount: merged.errors.length,
        tradingSession,
        autoExecuted
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '雪球行情刷新失败');
      const nextState = markRealtimeStatus(stateRef.current, {
        lastStatus: 'error',
        lastRefreshAt: new Date().toISOString(),
        lastError: message
      });
      stateRef.current = nextState;
      setState(nextState);
      if (source !== 'auto') {
        showToast({ title: '雪球行情刷新失败', description: message, tone: 'red' });
      }
      trackFeatureEvent('quant_trading', 'realtime_refresh_error', { source, message: message.slice(0, 160) });
    } finally {
      realtimeBusyRef.current = false;
      setRealtimeBusy(false);
    }
  }, []);

  function resetState() {
    const next = resetQuantProjectState();
    stateRef.current = next;
    setState(next);
    showToast({ title: '已恢复样例模拟盘', tone: 'slate' });
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIsTradingSessionNow(isInTradingSession(new Date()));
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!realtimeEnabled) return undefined;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) refreshRealtimeQuotes('auto');
    };
    tick();
    const timer = window.setInterval(tick, Math.max(5, realtimeRefreshIntervalSec) * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [realtimeEnabled, realtimeRefreshIntervalSec, realtimeAutoExecute, realtimeOnlyTradingSession, refreshRealtimeQuotes]);

  useEffect(() => {
    function onMobileExecute() {
      executeTrade('mobile_quick_action');
    }
    window.addEventListener('quant:execute-simulated-trade', onMobileExecute);
    return () => window.removeEventListener('quant:execute-simulated-trade', onMobileExecute);
  }, [executeTrade]);

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
            <Settings2 className="h-3.5 w-3.5" />
            量化研究
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">纳指 ETF 量化研究系统</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">覆盖综合仪表盘、行情数据、策略研究、交易执行、风控监控、账户绩效和系统设置；不包含选股与因子研究模块。</p>
        </div>
        <button type="button" className={secondaryButtonClass} onClick={() => executeTrade('header')}>
          <Play className="h-4 w-4" />
          模拟撮合
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="账户权益" value={formatCurrency(summary.equity)} note={`现金 ${formatCurrency(summary.cash)}`} />
        <Metric label="持仓市值" value={formatCurrency(summary.marketValue)} note={`${summary.positionCount} 个持仓`} />
        <Metric label="净差价" value={formatPct(signal.netSpreadPct)} note={`触发 ${formatPct(signal.triggerSpreadPct)}`} tone={signal.action === 'switch' ? 'emerald' : 'slate'} />
        <Metric label="交易信号" value={signal.action === 'switch' ? '切换' : '观察'} note={signal.reason} tone={signal.action === 'switch' ? 'emerald' : 'slate'} />
      </div>

      {hideModuleTabs ? null : (
        <ModuleTabs
          activeTab={activeModule}
          onSelect={selectModule}
        />
      )}

      {activeModule === 'dashboard' ? (
        <DashboardPanel
          state={normalized}
          summary={summary}
          signal={signal}
          plan={plan}
          isTradingSessionNow={isTradingSessionNow}
          backtestResult={dashboardBacktestResult}
          onExecute={() => executeTrade('dashboard')}
        />
      ) : activeModule === 'marketData' ? (
        <MarketDataPanel
          state={normalized}
          signal={signal}
          busy={realtimeBusy}
          isTradingSessionNow={isTradingSessionNow}
          onPatchQuote={patchQuote}
          onPatchRealtime={patchRealtime}
          onRefresh={refreshRealtimeQuotes}
        />
      ) : activeModule === 'research' ? (
        <ResearchBacktestPanel
          state={normalized}
          summary={summary}
          signal={signal}
          onPatchStrategy={patchStrategy}
          onPatchQuote={patchQuote}
        />
      ) : activeModule === 'trading' ? (
        <TradingExecutionPanel state={normalized} summary={summary} plan={plan} onExecute={() => executeTrade('trade_panel')} />
      ) : activeModule === 'risk' ? (
        <RiskMonitoringPanel
          state={normalized}
          summary={summary}
          signal={signal}
          plan={plan}
          backtestResult={dashboardBacktestResult}
          isTradingSessionNow={isTradingSessionNow}
          onPatchStrategy={patchStrategy}
          onPatchRealtime={patchRealtime}
        />
      ) : activeModule === 'performance' ? (
        <AccountPerformancePanel
          state={normalized}
          summary={summary}
          onPatchAccount={patchAccount}
          onPatchPosition={patchPosition}
          onReset={resetState}
          backtestResult={dashboardBacktestResult}
        />
      ) : (
        <SystemSettingsPanel state={normalized} onPatchRealtime={patchRealtime} />
      )}
    </div>
  );
}
