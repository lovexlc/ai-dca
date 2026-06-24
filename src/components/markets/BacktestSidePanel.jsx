import { useEffect, useState } from 'react';
import { X, Play, BarChart3, TrendingUp, Trophy, Activity, Save } from 'lucide-react';
import { cx, primaryButtonClass, secondaryButtonClass, inputClass } from '../experience-ui.jsx';
import { TagInput } from '../TagInput.jsx';

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

function toDecimalText(value, fallback) {
  if (value === '' || value === null || value === undefined) return String(fallback);
  return String(value);
}

function parseDecimalOr(value, fallback) {
  if (value === '' || value === '-' || value === '.') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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

function SectionLabel({ children }) {
  return (
    <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2 text-[11px] font-bold tracking-[0.16em] text-slate-400">
      <span className="h-3.5 w-[3px] rounded-full bg-[#4F46E5]" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

function DecimalInput({ id, label, suffix, hint, value, onChange, onCommit }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-500">{label}</label>
      <div className="mt-2 flex items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (next === '' || next === '-' || /^-?\d*\.?\d*$/.test(next)) {
              onChange(next);
            }
          }}
          onBlur={(event) => onCommit?.(event.target.value)}
          className={cx(inputClass, 'h-11 w-24 text-center font-semibold tabular-nums')}
        />
        {suffix ? <span className="text-sm text-slate-500">{suffix}</span> : null}
      </div>
      {hint ? <p className="mt-1.5 text-xs leading-5 text-slate-400">{hint}</p> : null}
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

  // 策略配置状态
  const [strategyName, setStrategyName] = useState('');
  const [highCodes, setHighCodes] = useState([symbol]);
  const [lowCodes, setLowCodes] = useState([]);
  const [intraSellLowerPct, setIntraSellLowerPct] = useState('1');
  const [intraBuyOtherPct, setIntraBuyOtherPct] = useState('3');
  const [initialCash, setInitialCash] = useState('10000');
  const [investMode, setInvestMode] = useState('dca'); // 'dca' 或 'lump-sum'
  const [investAmount, setInvestAmount] = useState('1000');

  useEffect(() => {
    if (open) {
      setResult(null);
      setStrategyName(`${symbol} 策略`);
      setHighCodes([symbol]);
      setLowCodes([]);
    }
  }, [open, symbol]);

  // 阻止滚动
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  async function handleRun() {
    if (!candles || candles.length < 10) {
      alert('数据不足，至少需要 10 个数据点');
      return;
    }

    setRunning(true);
    setResult(null);

    try {
      const cash = parseDecimalOr(initialCash, 10000);
      let currentCash = cash;
      let shares = 0;
      const trades = [];
      const equityCurve = []; // 记录权益曲线用于计算回撤

      if (investMode === 'lump-sum') {
        // 一次性投入：区间开始时全部买入
        const firstPrice = candles[0].close;
        if (firstPrice > 0) {
          const buyShares = cash / firstPrice;
          shares = buyShares;
          currentCash = 0;

          trades.push({
            date: candles[0].time,
            type: 'buy',
            price: firstPrice,
            shares: buyShares,
            amount: cash
          });
        }
      } else {
        // 定投模式：每隔一定周期买入
        const invest = parseDecimalOr(investAmount, 1000);
        const interval = Math.max(1, Math.floor(candles.length / 10));

        for (let i = 0; i < candles.length; i += interval) {
          const candle = candles[i];
          const price = candle.close;

          if (currentCash >= invest && price > 0) {
            const buyShares = invest / price;
            shares += buyShares;
            currentCash -= invest;

            trades.push({
              date: candle.time,
              type: 'buy',
              price,
              shares: buyShares,
              amount: invest
            });
          }
        }
      }

      // 计算权益曲线和最终收益
      const lastPrice = candles[candles.length - 1].close;
      let maxValue = cash;
      let maxDrawdown = 0;

      if (investMode === 'lump-sum') {
        // 一次性投入：持仓从开始就是固定的
        for (let i = 0; i < candles.length; i++) {
          const currentPrice = candles[i].close;
          const currentValue = shares * currentPrice;
          equityCurve.push(currentValue);

          maxValue = Math.max(maxValue, currentValue);
          if (maxValue > 0) {
            const drawdown = ((currentValue - maxValue) / maxValue) * 100;
            maxDrawdown = Math.min(maxDrawdown, drawdown);
          }
        }
      } else {
        // 定投模式：逐步累积持仓
        const interval = Math.max(1, Math.floor(candles.length / 10));
        let accumulatedShares = 0;
        let accumulatedCash = cash;
        let tradeIndex = 0;

        for (let i = 0; i < candles.length; i++) {
          const currentPrice = candles[i].close;

          // 更新持仓
          if (tradeIndex < trades.length && i >= interval * tradeIndex) {
            accumulatedShares += trades[tradeIndex].shares;
            accumulatedCash -= trades[tradeIndex].amount;
            tradeIndex++;
          }

          const currentValue = accumulatedCash + accumulatedShares * currentPrice;
          equityCurve.push(currentValue);

          // 计算回撤
          maxValue = Math.max(maxValue, currentValue);
          if (maxValue > 0) {
            const drawdown = ((currentValue - maxValue) / maxValue) * 100;
            maxDrawdown = Math.min(maxDrawdown, drawdown);
          }
        }
      }

      const finalValue = currentCash + shares * lastPrice;
      const totalReturn = finalValue - cash;
      const totalReturnPct = (totalReturn / cash) * 100;

      // 计算胜率
      const profitTrades = trades.filter(t => lastPrice > t.price).length;
      const winRate = trades.length > 0 ? (profitTrades / trades.length) * 100 : 0;

      setResult({
        summary: {
          totalReturnPct,
          winRatePct: winRate,
          maxDrawdownPct: maxDrawdown,
          tradeCount: trades.length,
          finalValue,
          initialCash: cash
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
    <>
      {/* 背景遮罩 */}
      <button
        type="button"
        aria-label="关闭回测侧边栏"
        className="fixed inset-0 z-[999] cursor-default bg-slate-950/35 backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* 侧边栏 */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="策略回测"
        className="fixed right-0 top-0 z-[1000] flex h-[100vh] w-[min(520px,100vw)] flex-col bg-[#F0F2F8] shadow-2xl animate-in fade-in slide-in-from-right-7 duration-200"
      >
        {/* Header */}
        <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-5">
          <div>
            <div className="text-sm font-bold text-slate-900">策略回测</div>
            <p className="text-xs text-slate-500">
              {symbol} · {chartRange} · {candles.length} 个数据点
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="space-y-6">
            {/* 基本信息 */}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <SectionLabel>基础信息</SectionLabel>
              <div>
                <label htmlFor="strategy-name" className="block text-xs font-semibold text-slate-500">策略名称</label>
                <input
                  id="strategy-name"
                  className={cx(inputClass, 'mt-2')}
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                  placeholder="输入策略名称"
                />
              </div>
            </div>

            {/* ETF 资产池 */}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <SectionLabel>ETF 资产池</SectionLabel>
              <div className="space-y-4">
                <TagInput
                  label="H 高溢价 ETF（卖出方）"
                  placeholder="输入代码如 159513"
                  tags={highCodes}
                  onChange={setHighCodes}
                />
                <TagInput
                  label="L 低溢价 ETF（买入方）"
                  placeholder="输入代码如 513100"
                  tags={lowCodes}
                  onChange={setLowCodes}
                />
              </div>
            </div>

            {/* 触发规则 */}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <SectionLabel>触发规则</SectionLabel>
              <div className="grid gap-4 sm:grid-cols-2">
                <DecimalInput
                  id="sell-lower"
                  label="卖 L 买 H 阈值"
                  suffix="%"
                  hint="溢价差缩小到此阈值触发"
                  value={intraSellLowerPct}
                  onChange={setIntraSellLowerPct}
                  onCommit={(v) => setIntraSellLowerPct(String(parseDecimalOr(v, 1)))}
                />
                <DecimalInput
                  id="buy-other"
                  label="卖 H 买 L 阈值"
                  suffix="%"
                  hint="溢价差扩大到此阈值触发"
                  value={intraBuyOtherPct}
                  onChange={setIntraBuyOtherPct}
                  onCommit={(v) => setIntraBuyOtherPct(String(parseDecimalOr(v, 3)))}
                />
              </div>
            </div>

            {/* 回测参数 */}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <SectionLabel>回测参数</SectionLabel>
              <div className="space-y-4">
                <div>
                  <label htmlFor="invest-mode" className="block text-xs font-semibold text-slate-500">投入方式</label>
                  <select
                    id="invest-mode"
                    className={cx(inputClass, 'mt-2')}
                    value={investMode}
                    onChange={(e) => setInvestMode(e.target.value)}
                  >
                    <option value="dca">定投模式（分批买入）</option>
                    <option value="lump-sum">一次性投入（区间开始全部买入）</option>
                  </select>
                </div>
                <DecimalInput
                  id="initial-cash"
                  label="初始资金"
                  suffix="¥"
                  hint={investMode === 'dca' ? '分 10 次定投买入' : '一次性全部买入'}
                  value={initialCash}
                  onChange={setInitialCash}
                  onCommit={(v) => setInitialCash(String(parseDecimalOr(v, 10000)))}
                />
                {investMode === 'dca' && (
                  <DecimalInput
                    id="invest-amount"
                    label="每次定投"
                    suffix="¥"
                    hint="每次定投的金额"
                    value={investAmount}
                    onChange={setInvestAmount}
                    onCommit={(v) => setInvestAmount(String(parseDecimalOr(v, 1000)))}
                  />
                )}
              </div>
            </div>

            {/* 回测结果 */}
            {!result ? (
              <div className="flex flex-col items-center gap-4 rounded-xl bg-white p-8 text-center shadow-sm">
                <BarChart3 className="h-16 w-16 text-slate-300" />
                <div>
                  <h3 className="text-base font-bold text-slate-700">准备开始回测</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    配置策略参数后点击"开始回测"
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
              <div className="space-y-4">
                {/* 核心指标 */}
                <div className="grid grid-cols-2 gap-3">
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
      </aside>
    </>
  );
}

export default BacktestSidePanel;
