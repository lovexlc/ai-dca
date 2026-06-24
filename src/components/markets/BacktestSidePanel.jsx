import { useEffect, useState } from 'react';
import { X, Play, TrendingUp, Trophy, Activity, BarChart3 } from 'lucide-react';
import { cx, primaryButtonClass, secondaryButtonClass } from '../experience-ui.jsx';

function formatPercent(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(digits)}%`;
}

function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toFixed(digits);
}

function MetricCard({ icon: Icon, label, value, tone = 'neutral' }) {
  const toneColors = {
    positive: 'text-emerald-600',
    negative: 'text-rose-600',
    neutral: 'text-slate-600'
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <div className={cx('mt-2 text-xl font-bold tabular-nums', toneColors[tone])}>
        {value}
      </div>
    </div>
  );
}

export function BacktestSidePanel({
  open = false,
  onClose,
  symbol,
  candles = [],
  chartRange = '1d',
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [strategy, setStrategy] = useState('dca'); // 默认定投策略

  useEffect(() => {
    if (open) {
      setResult(null); // 打开时重置结果
    }
  }, [open, symbol]);

  async function handleRun() {
    if (!candles || candles.length < 10) {
      alert('数据不足，至少需要 10 个数据点');
      return;
    }

    setRunning(true);
    setResult(null);

    try {
      // 简化的回测逻辑：模拟定投策略
      const initialCash = 10000;
      let cash = initialCash;
      let shares = 0;
      const investAmount = 1000; // 每次定投金额
      const trades = [];

      // 每隔一定周期买入
      const interval = Math.max(1, Math.floor(candles.length / 10));

      for (let i = 0; i < candles.length; i += interval) {
        const candle = candles[i];
        const price = candle.close;

        if (cash >= investAmount) {
          const buyShares = investAmount / price;
          shares += buyShares;
          cash -= investAmount;

          trades.push({
            date: candle.time,
            type: 'buy',
            price,
            shares: buyShares,
            amount: investAmount
          });
        }
      }

      // 计算最终收益
      const lastPrice = candles[candles.length - 1].close;
      const finalValue = cash + shares * lastPrice;
      const totalReturn = finalValue - initialCash;
      const totalReturnPct = (totalReturn / initialCash) * 100;

      // 计算胜率
      const profitTrades = trades.filter(t => lastPrice > t.price).length;
      const winRate = trades.length > 0 ? (profitTrades / trades.length) * 100 : 0;

      // 计算最大回撤（简化）
      let maxValue = initialCash;
      let maxDrawdown = 0;

      for (let i = 0; i < candles.length; i++) {
        const currentPrice = candles[i].close;
        const currentValue = cash + shares * currentPrice;
        maxValue = Math.max(maxValue, currentValue);
        const drawdown = ((currentValue - maxValue) / maxValue) * 100;
        maxDrawdown = Math.min(maxDrawdown, drawdown);
      }

      setResult({
        summary: {
          totalReturnPct,
          winRatePct: winRate,
          maxDrawdownPct: maxDrawdown,
          tradeCount: trades.length,
          finalValue,
          initialCash
        },
        trades
      });
    } catch (error) {
      alert(error.message || '回测失败');
    } finally {
      setRunning(false);
    }
  }

  if (!open) return null;

  const summary = result?.summary || {};
  const totalReturnPct = summary.totalReturnPct || 0;
  const winRatePct = summary.winRatePct || 0;
  const maxDrawdownPct = summary.maxDrawdownPct || 0;
  const tradeCount = summary.tradeCount || 0;

  const returnTone = totalReturnPct > 0 ? 'positive' : totalReturnPct < 0 ? 'negative' : 'neutral';
  const winRateTone = winRatePct >= 60 ? 'positive' : winRatePct >= 50 ? 'neutral' : 'negative';
  const drawdownTone = Math.abs(maxDrawdownPct) <= 5 ? 'positive' : Math.abs(maxDrawdownPct) <= 10 ? 'neutral' : 'negative';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 sm:p-0">
      <div className="relative flex h-full max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl sm:h-auto sm:max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">策略回测</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {symbol} · {chartRange} 周期 · {candles.length} 个数据点
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!result ? (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <BarChart3 className="h-16 w-16 text-slate-300" />
              <div>
                <h3 className="text-base font-bold text-slate-700">准备开始回测</h3>
                <p className="mt-2 text-sm text-slate-500">
                  将使用当前图表的价格数据进行定投策略回测
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  初始资金：¥10,000 · 每次定投：¥1,000
                </p>
              </div>
              <button
                type="button"
                onClick={handleRun}
                disabled={running || candles.length < 10}
                className={cx(primaryButtonClass, 'mt-4')}
              >
                {running ? (
                  <>
                    <Play className="h-4 w-4 animate-pulse" />
                    <span>回测中...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    <span>开始回测</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* 核心指标 */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard
                  icon={TrendingUp}
                  label="总收益率"
                  value={formatPercent(totalReturnPct)}
                  tone={returnTone}
                />
                <MetricCard
                  icon={Trophy}
                  label="胜率"
                  value={formatPercent(winRatePct, 0)}
                  tone={winRateTone}
                />
                <MetricCard
                  icon={Activity}
                  label="最大回撤"
                  value={formatPercent(maxDrawdownPct)}
                  tone={drawdownTone}
                />
                <MetricCard
                  icon={BarChart3}
                  label="交易次数"
                  value={`${tradeCount} 笔`}
                  tone="neutral"
                />
              </div>

              {/* 详细信息 */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="text-sm font-semibold text-slate-700">回测详情</h4>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">初始资金</span>
                    <span className="font-medium tabular-nums text-slate-900">
                      ¥{summary.initialCash?.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">最终市值</span>
                    <span className="font-medium tabular-nums text-slate-900">
                      ¥{summary.finalValue?.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">净收益</span>
                    <span className={cx('font-bold tabular-nums', returnTone === 'positive' ? 'text-emerald-600' : returnTone === 'negative' ? 'text-rose-600' : 'text-slate-900')}>
                      {totalReturnPct > 0 ? '+' : ''}¥{(summary.finalValue - summary.initialCash).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={running}
                  className={cx(secondaryButtonClass, 'flex-1')}
                >
                  <Play className="h-4 w-4" />
                  <span>重新回测</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className={cx(primaryButtonClass, 'flex-1')}
                >
                  完成
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default BacktestSidePanel;
