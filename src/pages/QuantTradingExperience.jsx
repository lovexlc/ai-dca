import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  History,
  Play,
  RefreshCw,
  Settings2,
  WalletCards
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
  buildSampleBacktestRows,
  buildSimulatedOrderPlan,
  computeAccountSummary,
  executeSimulatedSwitch,
  normalizeQuantState,
  readQuantProjectState,
  resetQuantProjectState,
  runPremiumSpreadBacktest,
  saveQuantProjectState
} from '../app/quantTrading.js';
import { trackFeatureEvent } from '../app/analytics.js';
import { showToast } from '../app/toast.js';
import {
  Card,
  Field,
  NumberInput,
  TextInput,
  cx,
  primaryButtonClass,
  secondaryButtonClass,
  subtleButtonClass
} from '../components/experience-ui.jsx';

const MODULE_TABS = [
  { key: 'account', label: '模拟账户', Icon: WalletCards },
  { key: 'strategy', label: '策略', Icon: Bot },
  { key: 'trade', label: '交易', Icon: ArrowRightLeft },
  { key: 'backtest', label: '复盘', Icon: History }
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
          <span className="text-xs font-semibold text-slate-400">买卖盘为模拟输入</span>
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

function TradePanel({ state, plan, onExecute }) {
  return (
    <div className="space-y-4">
      <TradePlanCard plan={plan} onExecute={onExecute} />
      <OrdersPanel orders={state.orders} />
    </div>
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

export function QuantTradingExperience({ embedded = false } = {}) {
  const [activeModule, setActiveModule] = useState('account');
  const [state, setState] = useState(() => readQuantProjectState());
  const normalized = useMemo(() => normalizeQuantState(state), [state]);
  const summary = useMemo(() => computeAccountSummary(normalized), [normalized]);
  const plan = useMemo(() => buildSimulatedOrderPlan(normalized), [normalized]);
  const signal = plan.signal;

  useEffect(() => {
    saveQuantProjectState(normalized);
  }, [normalized]);

  useEffect(() => {
    trackFeatureEvent('quant_trading', 'view_open', { activeModule: 'account' });
  }, []);

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
    const result = executeSimulatedSwitch(normalized);
    if (!result.fills.length) {
      showToast({
        title: '没有执行撮合',
        description: result.plan.rejectReason || '当前信号未达到触发条件。',
        tone: 'amber'
      });
      trackFeatureEvent('quant_trading', 'simulate_trade_skip', { source, reason: result.plan.rejectReason });
      return;
    }
    setState(result.state);
    setActiveModule('trade');
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
  }, [normalized]);

  function resetState() {
    const next = resetQuantProjectState();
    setState(next);
    showToast({ title: '已恢复样例模拟盘', tone: 'slate' });
  }

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
            量化模拟
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">纳指 ETF 溢价差模拟盘</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">覆盖模拟账户、策略、交易和复盘，行情输入可后续替换为实时接口。</p>
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

      <ModuleTabs
        activeTab={activeModule}
        onSelect={(next) => {
          setActiveModule(next);
          trackFeatureEvent('quant_trading', 'module_select', { module: next });
        }}
      />

      {activeModule === 'account' ? (
        <AccountPanel
          state={normalized}
          summary={summary}
          onPatchAccount={patchAccount}
          onPatchPosition={patchPosition}
          onReset={resetState}
        />
      ) : activeModule === 'strategy' ? (
        <StrategyPanel
          state={normalized}
          signal={signal}
          onPatchStrategy={patchStrategy}
          onPatchQuote={patchQuote}
        />
      ) : activeModule === 'trade' ? (
        <TradePanel state={normalized} plan={plan} onExecute={() => executeTrade('trade_panel')} />
      ) : (
        <BacktestPanel state={normalized} summary={summary} />
      )}
    </div>
  );
}
