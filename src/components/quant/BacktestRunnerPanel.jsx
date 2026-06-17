import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, BarChart3, Play, RefreshCw, ShieldCheck, TrendingUp, Trophy, Zap } from 'lucide-react';
import { Card, cx, primaryButtonClass, secondaryButtonClass, subtleButtonClass, inputClass } from '../experience-ui.jsx';
import { MetricCard } from '../MetricCard.jsx';
import { InteractiveChartContainer } from '../InteractiveChartContainer.jsx';
import { EquityChart, KlineChart, PremiumChart } from '../BacktestCharts.jsx';
import { TradeHistoryCard } from '../TradeHistoryCard.jsx';
import { formatTradeDateTime } from '../../app/tradeDisplay.js';
import { saveQuantPremiumStrategyToWorker, normalizeQuantPremiumConfigShape } from '../../app/quantPremiumSync.js';
import { showToast } from '../../app/toast.js';

const BACKTEST_TIMEFRAME_OPTIONS = [
  { value: '5m', label: '5m 默认（约 3-4 周）' },
  { value: '1m', label: '1m（约 3-4 个交易日）' },
  { value: '15m', label: '15m（约 2-3 个月）' },
  { value: '30m', label: '30m' },
  { value: '60m', label: '60m' },
  { value: '1d', label: '1d（日线长期）' }
];

const CHART_VIEWS = [
  { id: 'equity', label: '权益曲线' },
  { id: 'kline', label: 'K线+信号' },
  { id: 'premium', label: '溢价差' }
];

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `¥${num.toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatPercent(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '--';
  return num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function resolveTradeSettlementValue(trade = {}) {
  if (trade.type === 'buy') return trade.totalCost ?? trade.amount;
  return trade.netProceeds ?? trade.amount;
}

function readFeeRate(value, fallback) {
  if (value === '' || value === '.') return fallback;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function FeeInput({ id, label, value, onChange, onCommit }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-500">{label}</label>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-sm text-slate-500">万分之</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (next === '' || /^\d*\.?\d*$/.test(next)) onChange(next);
          }}
          onBlur={(event) => onCommit?.(event.target.value)}
          className={cx(inputClass, 'h-11 w-24 text-center font-semibold tabular-nums')}
        />
      </div>
    </div>
  );
}

export function BacktestRunnerPanel({
  strategies = [],
  selectedStrategy,
  backtest,
  backtesting = false,
  saving = false,
  onSelectStrategy,
  onRunBacktest,
  onUpdateStrategy,
  onGoLive,
  onGoStrategy
}) {
  const [timeframe, setTimeframe] = useState('5m');
  const [buyFee, setBuyFee] = useState('1');
  const [sellFee, setSellFee] = useState('1');
  const [chartView, setChartView] = useState('equity');

  useEffect(() => {
    if (backtest?.timeframe) setTimeframe(backtest.timeframe);
  }, [backtest?.timeframe, selectedStrategy?.id]);

  const summary = backtest?.summary || {};
  const totalReturnPct = summary.totalReturnPct || 0;
  const winRatePct = summary.winRatePct || 0;
  const sharpeRatio = summary.sharpeRatio || 0;
  const maxDrawdownPct = summary.maxDrawdownPct || 0;

  const returnTone = totalReturnPct > 0 ? 'positive' : totalReturnPct < 0 ? 'negative' : 'neutral';
  const winRateTone = winRatePct >= 60 ? 'positive' : winRatePct >= 50 ? 'neutral' : 'negative';
  const sharpeTone = sharpeRatio >= 1.5 ? 'positive' : sharpeRatio >= 1 ? 'neutral' : 'negative';
  const drawdownTone = Math.abs(maxDrawdownPct) <= 5 ? 'positive' : Math.abs(maxDrawdownPct) <= 10 ? 'neutral' : 'negative';

  const gateStatus = backtest?.status || selectedStrategy?.backtestGate?.status || '';
  const backtestPassed = gateStatus === 'passed';
  const backtestApproved = backtestPassed
    && Boolean(selectedStrategy?.backtestGate?.approvedAt)
    && Boolean(selectedStrategy?.liveSignalEnabled);
  const missingKlineCodes = useMemo(() => {
    const list = backtest?.quality?.missingKlineCodes;
    return Array.isArray(list) ? list : [];
  }, [backtest]);
  const backtestRange = summary.from || summary.to ? `${summary.from || '--'} 至 ${summary.to || '--'}` : '--';

  async function handleRun() {
    if (!selectedStrategy) return;
    const feeRate = (readFeeRate(buyFee, 1) + readFeeRate(sellFee, 1)) / 2 / 10000;
    await onRunBacktest?.(selectedStrategy, {
      timeframe,
      useV2: true,
      feeRate
    });
  }

  async function handleLiveSignalToggle(enabled) {
    if (!selectedStrategy) return;
    const target = selectedStrategy;
    const targetGate = target.backtestGate || {};
    const effectiveGate = targetGate?.status === 'passed' || backtest?.status !== 'passed'
      ? targetGate
      : {
        ...(targetGate || {}),
        status: 'passed',
        latestRunId: backtest?.runId || targetGate?.latestRunId || '',
        summary: backtest?.summary || targetGate?.summary || null,
        updatedAt: backtest?.finishedAt || ''
      };
    try {
      const result = await saveQuantPremiumStrategyToWorker({
        ...target,
        backtestGate: effectiveGate,
        liveSignalEnabled: enabled,
        approveLiveSignal: enabled
      });
      const saved = normalizeQuantPremiumConfigShape(result.strategy);
      onUpdateStrategy?.(saved, result.strategies);
      showToast({ title: enabled ? '实盘信号已确认' : '实盘信号已关闭', tone: 'emerald' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '实盘信号更新失败';
      showToast({ title: '更新失败', description: message, tone: 'rose' });
    }
  }

  if (!selectedStrategy) {
    return (
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <BarChart3 className="h-12 w-12 text-slate-300" />
        <div>
          <p className="text-base font-bold text-slate-700">没有可回测的策略</p>
          <p className="mt-1 text-sm text-slate-500">先去创建一个策略</p>
        </div>
        <button type="button" className={primaryButtonClass} onClick={onGoStrategy}>
          前往策略页
          <ArrowRight className="h-4 w-4" />
        </button>
      </Card>
    );
  }

  return (
    <Card className="space-y-6 p-5 sm:p-6">
      {/* 顶部选择器 + 配置 */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">BACKTEST</div>
            <h2 className="mt-1 text-lg font-bold text-slate-900">{selectedStrategy.name || selectedStrategy.id}</h2>
            <p className="mt-1 text-xs text-slate-500">V2 引擎 · 历史 K 线回放 · 通过后可用于实盘信号</p>
          </div>
          <select
            value={selectedStrategy.id}
            onChange={(event) => onSelectStrategy?.(event.target.value)}
            className={cx(inputClass, 'h-10 max-w-[200px] font-semibold')}
          >
            {strategies.map((item) => (
              <option key={item.id} value={item.id}>{item.name || item.id}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <label htmlFor="quant-backtest-tf" className="block text-xs font-semibold text-slate-500">K 线粒度</label>
            <select
              id="quant-backtest-tf"
              className={cx(inputClass, 'mt-2')}
              value={timeframe}
              onChange={(event) => setTimeframe(event.target.value)}
            >
              {BACKTEST_TIMEFRAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <FeeInput
            id="quant-backtest-buy-fee"
            label="买入手续费"
            value={buyFee}
            onChange={setBuyFee}
            onCommit={(next) => setBuyFee(String(readFeeRate(next, 1)))}
          />
          <FeeInput
            id="quant-backtest-sell-fee"
            label="卖出手续费"
            value={sellFee}
            onChange={setSellFee}
            onCommit={(next) => setSellFee(String(readFeeRate(next, 1)))}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            onClick={handleRun}
            disabled={backtesting}
          >
            {backtesting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {backtesting ? '回测中…' : '运行回测'}
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={cx(secondaryButtonClass, 'disabled:opacity-50')}
              onClick={() => handleLiveSignalToggle(true)}
              disabled={saving || !backtestPassed || backtestApproved}
            >
              <ShieldCheck className="h-4 w-4" />
              {backtestApproved ? '实盘信号已确认' : '确认用于实盘信号'}
            </button>
            <button
              type="button"
              className={subtleButtonClass}
              onClick={() => handleLiveSignalToggle(false)}
              disabled={saving || !selectedStrategy.liveSignalEnabled}
            >
              关闭实盘信号
            </button>
          </div>
        </div>
      </div>

      {backtest ? (
        <>
          {/* 指标行 */}
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-6 sm:gap-4 lg:grid-cols-4">
            <MetricCard
              label="累计收益"
              value={formatPercent(totalReturnPct, 2)}
              subtitle={formatMoney(summary.totalProfit || 0)}
              tone={returnTone}
              Icon={TrendingUp}
            />
            <MetricCard
              label="盈利轮动"
              value={formatPercent(winRatePct, 0)}
              subtitle={`${summary.trades || 0} 次轮动`}
              tone={winRateTone}
              Icon={Trophy}
            />
            <MetricCard
              label="夏普比率"
              value={formatNumber(sharpeRatio, 2)}
              subtitle="风险调整后收益"
              tone={sharpeTone}
              Icon={Zap}
            />
            <MetricCard
              label="最大回撤"
              value={formatPercent(maxDrawdownPct, 2)}
              subtitle="历史最大损失"
              tone={drawdownTone}
              Icon={Activity}
            />
          </div>

          {/* 回测元信息 */}
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <div className="text-xs font-bold text-slate-400">回测区间</div>
              <div className="mt-1 font-semibold text-slate-900">{backtestRange}</div>
            </div>
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <div className="text-xs font-bold text-slate-400">数据覆盖</div>
              <div className="mt-1 font-semibold text-slate-900">{formatPercent(summary.dataCoveragePct, 1)}</div>
            </div>
          </div>
          {missingKlineCodes.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-700">
              缺失 K 线代码：{missingKlineCodes.join('、')}。可换更高粒度重试，或先从策略中移除缺数据标的。
            </div>
          ) : null}

          {/* 图表区 */}
          <div className="border-t border-slate-100 pt-6">
            <InteractiveChartContainer
              views={CHART_VIEWS}
              activeView={chartView}
              onViewChange={setChartView}
            >
              {chartView === 'equity' && <EquityChart data={backtest.rows || []} />}
              {chartView === 'kline' && (
                <KlineChart
                  candles={backtest.chart?.candles || []}
                  signals={backtest.signals || []}
                />
              )}
              {chartView === 'premium' && <PremiumChart data={backtest.rows || []} />}
            </InteractiveChartContainer>
          </div>

          {/* 交易明细 */}
          {backtest.trades?.length ? (
            <div className="space-y-3 border-t border-slate-100 pt-6">
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">TRADES</div>
              <div className="block divide-y divide-slate-100 sm:hidden">
                {backtest.trades.map((trade, idx) => (
                  <div key={idx} className="py-3">
                    <TradeHistoryCard trade={trade} />
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto rounded-xl border border-slate-200 sm:block">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs font-bold text-slate-700">
                    <tr>
                      <th className="px-4 py-3 text-left">时间</th>
                      <th className="px-4 py-3 text-left">方向</th>
                      <th className="px-4 py-3 text-left">代码</th>
                      <th className="px-4 py-3 text-right">股数</th>
                      <th className="px-4 py-3 text-right">价格</th>
                      <th className="px-4 py-3 text-right">金额</th>
                      <th className="px-4 py-3 text-right">手续费</th>
                      <th className="px-4 py-3 text-right">结算</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {backtest.trades.map((trade, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-900">{formatTradeDateTime(trade)}</td>
                        <td className="px-4 py-3">
                          <span className={cx(
                            'inline-flex rounded-full px-2 py-1 text-xs font-bold',
                            trade.type === 'buy' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                          )}>
                            {trade.type === 'buy' ? '买入' : '卖出'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{trade.code}</td>
                        <td className="px-4 py-3 text-right text-slate-900">{formatNumber(trade.shares, 0)}</td>
                        <td className="px-4 py-3 text-right text-slate-900">{formatPrice(trade.price)}</td>
                        <td className="px-4 py-3 text-right text-slate-900">{formatMoney(trade.amount)}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{formatMoney(trade.fee)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatMoney(resolveTradeSettlementValue(trade))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* 底部 CTA */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6">
            <div>
              <div className="text-sm font-bold text-slate-900">投入实盘</div>
              <div className="mt-1 text-xs text-slate-500">回测通过后，去实盘页查看信号、持仓和成交。</div>
            </div>
            <button type="button" className={primaryButtonClass} onClick={onGoLive}>
              进入实盘
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 border-t border-slate-100 py-10 text-center text-slate-400">
          <BarChart3 className="h-12 w-12" />
          <p className="text-base font-semibold text-slate-600">暂无回测结果</p>
          <p className="text-sm">选择粒度后点「运行回测」</p>
        </div>
      )}
    </Card>
  );
}
