import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Calculator, Play, Send } from 'lucide-react';
import {
  DCA_FREQUENCIES,
  DCA_TIMEFRAMES,
  buildDcaChartData,
  calculateDcaBacktest,
  loadBacktestCandles
} from '../app/dcaCalculator.js';
import { formatCurrency } from '../app/accumulation.js';
import { EXTRA_SYMBOL_GROUPS } from '../app/extraSymbols.js';
import {
  Card,
  Field,
  NumberInput,
  Pill,
  SectionHeading,
  SelectField,
  StatCard,
  TextInput,
  cx,
  primaryButtonClass
} from '../components/experience-ui.jsx';

// PR 2.5：DCA 回测计算器。
// 动能：选标的 + 时间范围 + 频率 + 金额 → 拉取历史 K 线 + 纯函数回测 + 列表 + 走势图。
// PR 2.5b：「应用此策略」 点后写 sessionStorage `aiDcaCalcApply` Ⓝ 跳 #dca，DcaExperience 读取预填表单。

const DEFAULT_SYMBOL = 'QQQ';

const CHART_MARGIN = Object.freeze({ top: 8, right: 16, bottom: 8, left: 0 });
const CHART_TICK = Object.freeze({ fontSize: 11, fill: '#94a3b8' });
const CHART_TOOLTIP_STYLE = Object.freeze({ borderRadius: 12, fontSize: 12, border: '1px solid #e2e8f0' });
const CHART_LEGEND_STYLE = Object.freeze({ fontSize: 12 });
const CALC_APPLY_KEY = 'aiDcaCalcApply';

export function DcaCalculatorExperience({ embedded = false }) {
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [timeframe, setTimeframe] = useState('1mo');
  const [frequency, setFrequency] = useState('weekly');
  const [amount, setAmount] = useState(100);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const freqMeta = DCA_FREQUENCIES.find((f) => f.value === frequency) || DCA_FREQUENCIES[0];
  const tfMeta = DCA_TIMEFRAMES.find((t) => t.value === timeframe) || DCA_TIMEFRAMES[2];

  const chartData = useMemo(() => {
    if (!result?.ok) return [];
    return buildDcaChartData(result.rows, result.candles);
  }, [result]);

  async function handleRun() {
    if (loading) return;
    const trimmed = String(symbol || '').trim().toUpperCase();
    if (!trimmed) {
      setError('请输入标的代码');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const rawCandles = await loadBacktestCandles(trimmed, timeframe);
      if (!rawCandles.length) {
        setError('未拉到 K 线数据，可能是代码输错或后端暂不支持。');
        return;
      }
      const backtest = calculateDcaBacktest({
        rawCandles,
        amount: Number(amount) || 0,
        frequencyDays: freqMeta.days
      });
      if (!backtest.ok) {
        setError(backtest.reason === 'invalid_input' ? '请检查金额与频率' : '回测计算失败');
        return;
      }
      setResult(backtest);
    } catch (err) {
      setError(err instanceof Error ? err.message : '拉取数据失败');
    } finally {
      setLoading(false);
    }
  }

  const summary = result?.summary;
  const isProfit = summary && summary.profit >= 0;

  function handleApplyStrategy() {
    if (!summary) return;
    try {
      window.sessionStorage.setItem(CALC_APPLY_KEY, JSON.stringify({
        symbol: String(symbol || '').trim().toUpperCase(),
        frequency,
        amount: Number(amount) || 0,
        avgCost: summary.avgCost,
        appliedAt: new Date().toISOString()
      }));
    } catch (_e) { /* ignore quota */ }
    window.location.hash = '#dca';
  }

  return (
    <div className={cx('space-y-6', embedded ? '' : 'mx-auto max-w-6xl px-6 pt-8')}>
      <Card className="min-w-0">
        <SectionHeading
          eyebrow="输入"
          title="DCA 回测计算器"
          description="选一个标的 + 频率 + 单期金额，查看历史上如果内控这么定投会发生什么。"
        />

        <div className="mt-5 space-y-4">
          <Field label="标的代码" helper="点击 chip 快选，或手动输入。">
            <div className="mb-2 space-y-2">
              {EXTRA_SYMBOL_GROUPS.map((group) => (
                <div key={group.key} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">{group.label}</span>
                  {group.symbols.map((s) => (
                    <button
                      key={s.code}
                      type="button"
                      onClick={() => setSymbol(s.code)}
                      className={cx(
                        'rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                        symbol === s.code
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:text-indigo-600'
                      )}
                      title={s.name}
                    >
                      {s.code}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <TextInput value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="QQQ / VOO / AAPL / NVDA …" />
          </Field>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="时间范围">
              <SelectField
                options={DCA_TIMEFRAMES.map((t) => ({ label: t.label, value: t.value }))}
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
              />
            </Field>
            <Field label="频率">
              <SelectField
                options={DCA_FREQUENCIES.map((f) => ({ label: f.label, value: f.value }))}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              />
            </Field>
            <Field label="单期金额 (USD)">
              <NumberInput
                step="10"
                min="1"
                value={amount}
                onChange={(e) => setAmount(Math.max(Number(e.target.value) || 0, 0))}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={cx(primaryButtonClass, 'inline-flex items-center gap-1.5')}
              onClick={handleRun}
              disabled={loading}
            >
              <Play className="h-4 w-4" />
              {loading ? '拉取中…' : '运行回测'}
            </button>
            <span className="text-xs text-slate-500">
              {tfMeta.label} · {freqMeta.label} · 单期 {formatCurrency(amount, '$ ')}
            </span>
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <div>{error}</div>
            </div>
          ) : null}
        </div>
      </Card>

      {summary ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              accent="indigo"
              eyebrow="投入总额"
              value={formatCurrency(summary.totalInvested, '$ ')}
              note={`共 ${summary.periods} 期`}
            />
            <StatCard
              accent={isProfit ? 'emerald' : 'rose'}
              eyebrow="总资产"
              value={formatCurrency(summary.finalValue, '$ ')}
              note={`现价 ${formatCurrency(summary.lastClose, '$ ')}、股数 ${summary.totalShares}`}
            />
            <StatCard
              accent={isProfit ? 'emerald' : 'rose'}
              eyebrow="总到手"
              value={`${summary.profit >= 0 ? '+' : '−'}${formatCurrency(Math.abs(summary.profit), '$ ')}`}
              note={`总回报率 ${summary.returnPct >= 0 ? '+' : ''}${summary.returnPct}%`}
            />
            <StatCard
              eyebrow="年化"
              value={`${summary.annualizedPct >= 0 ? '+' : ''}${summary.annualizedPct}%`}
              note={`均价 ${formatCurrency(summary.avgCost, '$ ')}、${summary.spanDays} 天跨度`}
            />
          </div>

          <Card className="min-w-0">
            <SectionHeading
              eyebrow="走势"
              title={`${symbol.toUpperCase()} · ${summary.startDate} → ${summary.endDate}`}
              action={(
                <div className="flex items-center gap-2">
                  <Pill tone={isProfit ? 'emerald' : 'rose'}>{isProfit ? '赢利' : '亏损'}</Pill>
                  <button
                    type="button"
                    onClick={handleApplyStrategy}
                    className={cx(primaryButtonClass, 'inline-flex items-center gap-1.5')}
                    title="点击以此回测参数在 「定投」 页预填一份新定投计划"
                  >
                    <Send className="h-4 w-4" />
                    应用此策略
                  </button>
                </div>
              )}
            />
            <div className="mt-4 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={CHART_MARGIN}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={CHART_TICK} minTickGap={30} />
                  <YAxis yAxisId="left" tick={CHART_TICK} domain={['auto', 'auto']} />
                  <YAxis yAxisId="right" orientation="right" tick={CHART_TICK} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(value, name) => [typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : value, name]}
                  />
                  <Legend wrapperStyle={CHART_LEGEND_STYLE} />
                  <Line yAxisId="left" type="monotone" dataKey="marketValue" name="市值" stroke="#6366f1" strokeWidth={2} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey="invested" name="累计投入" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="price" name={`${symbol.toUpperCase()} 价格`} stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="min-w-0">
            <SectionHeading
              eyebrow="明细"
              title="逐期购入记录"
              description={`只展示前 20 / 后 5 期。总共 ${summary.periods} 期。`}
            />
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">日期</th>
                    <th className="px-3 py-2 text-right">价格</th>
                    <th className="px-3 py-2 text-right">购股数</th>
                    <th className="px-3 py-2 text-right">累计投入</th>
                    <th className="px-3 py-2 text-right">累计股数</th>
                    <th className="px-3 py-2 text-right">均价</th>
                    <th className="px-3 py-2 text-right">当期市值</th>
                  </tr>
                </thead>
                <tbody>
                  {[...result.rows.slice(0, 20), ...(result.rows.length > 25 ? result.rows.slice(-5) : [])].map((r) => (
                    <tr key={r.index} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 text-slate-500">{r.index}</td>
                      <td className="px-3 py-1.5">{r.date}</td>
                      <td className="px-3 py-1.5 text-right">{formatCurrency(r.price, '$ ')}</td>
                      <td className="px-3 py-1.5 text-right">{r.shares}</td>
                      <td className="px-3 py-1.5 text-right">{formatCurrency(r.invested, '$ ')}</td>
                      <td className="px-3 py-1.5 text-right">{r.sharesAccum}</td>
                      <td className="px-3 py-1.5 text-right">{formatCurrency(r.avgCost, '$ ')}</td>
                      <td className="px-3 py-1.5 text-right">{formatCurrency(r.marketValue, '$ ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <Card className="min-w-0">
          <div className="flex flex-col items-center gap-2 py-10 text-center text-slate-500">
            <Calculator className="h-8 w-8 text-slate-400" />
            <div className="text-sm">运行回测后会在这里看到走势图和明细。</div>
            <div className="text-xs text-slate-400">提示：1d / 1w / 1mo 分别对应 1 个月、 1 年、 5 年的 Yahoo 数据。</div>
          </div>
        </Card>
      )}
    </div>
  );
}
