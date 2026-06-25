import { useEffect, useState } from 'react';
import { X, Play, BarChart3, TrendingUp, Trophy, Activity, RefreshCw } from 'lucide-react';
import { cx, primaryButtonClass, secondaryButtonClass, inputClass } from '../experience-ui.jsx';
import { TagInput } from '../TagInput.jsx';
import { runBacktest } from '../../app/backtest/index.js';
import { fetchBacktestData } from '../../app/backtestDataFetcher.js';
import { deriveDefaultBacktestCodes } from './backtestSidePanelState.js';

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

// 计算溢价率（简化版：使用价格比）
function calculatePremium(highPrice, lowPrice) {
  if (!lowPrice || lowPrice <= 0) return 0;
  return ((highPrice - lowPrice) / lowPrice) * 100;
}

// 溢价差轮动策略回测
function runRotationBacktest(highCandles, lowCandles, config) {
  const { initialCash, sellLowerThreshold, buyOtherThreshold } = config;

  let cash = initialCash;
  let position = 'cash'; // 'cash', 'high', 'low'
  let shares = 0;
  const trades = [];
  const equityCurve = [];

  const minLength = Math.min(highCandles.length, lowCandles.length);

  console.log('[Backtest] 轮动策略开始', {
    minLength,
    sellLowerThreshold,
    buyOtherThreshold,
    firstHighPrice: highCandles[0]?.c,
    firstLowPrice: lowCandles[0]?.c,
    firstPremium: calculatePremium(highCandles[0]?.c, lowCandles[0]?.c)
  });

  for (let i = 0; i < minLength; i++) {
    const highPrice = highCandles[i].c;
    const lowPrice = lowCandles[i].c;
    const premium = calculatePremium(highPrice, lowPrice);

    let currentValue = cash;
    if (position === 'high') currentValue = shares * highPrice;
    if (position === 'low') currentValue = shares * lowPrice;

    // 交易逻辑
    if (position === 'cash') {
      // 初始买入低溢价（L档）
      // 修改逻辑：只要有L档价格就买入，不再判断溢价差阈值
      if (lowPrice > 0) {
        console.log('[Backtest] 初始买入 L', { i, lowPrice, premium });
        shares = cash / lowPrice;
        cash = 0;
        position = 'low';
        trades.push({
          date: lowCandles[i].t,
          type: 'buy',
          code: 'L',
          price: lowPrice,
          shares,
          amount: shares * lowPrice,
          premium
        });
      }
    } else if (position === 'low') {
      // 持有L，溢价差缩小 -> 卖L买H
      if (premium <= sellLowerThreshold && highPrice > 0) {
        console.log('[Backtest] 卖L买H', { i, premium, sellLowerThreshold, lowPrice, highPrice });
        const sellAmount = shares * lowPrice;
        trades.push({
          date: lowCandles[i].t,
          type: 'sell',
          code: 'L',
          price: lowPrice,
          shares,
          amount: sellAmount,
          premium
        });

        cash = sellAmount;
        shares = cash / highPrice;
        cash = 0;
        position = 'high';

        trades.push({
          date: highCandles[i].t,
          type: 'buy',
          code: 'H',
          price: highPrice,
          shares,
          amount: shares * highPrice,
          premium
        });
      }
    } else if (position === 'high') {
      // 持有H，溢价差扩大 -> 卖H买L
      if (premium >= buyOtherThreshold && lowPrice > 0) {
        console.log('[Backtest] 卖H买L', { i, premium, buyOtherThreshold, highPrice, lowPrice });
        const sellAmount = shares * highPrice;
        trades.push({
          date: highCandles[i].t,
          type: 'sell',
          code: 'H',
          price: highPrice,
          shares,
          amount: sellAmount,
          premium
        });

        cash = sellAmount;
        shares = cash / lowPrice;
        cash = 0;
        position = 'low';

        trades.push({
          date: lowCandles[i].t,
          type: 'buy',
          code: 'L',
          price: lowPrice,
          shares,
          amount: shares * lowPrice,
          premium
        });
      }
    }

    equityCurve.push(currentValue);
  }

  // 计算最终市值
  const lastHighPrice = highCandles[minLength - 1].c;
  const lastLowPrice = lowCandles[minLength - 1].c;
  let finalValue = cash;
  if (position === 'high') finalValue = shares * lastHighPrice;
  if (position === 'low') finalValue = shares * lastLowPrice;

  // 计算指标
  const totalReturn = finalValue - initialCash;
  const totalReturnPct = (totalReturn / initialCash) * 100;

  let maxValue = initialCash;
  let maxDrawdown = 0;
  for (const value of equityCurve) {
    maxValue = Math.max(maxValue, value);
    if (maxValue > 0) {
      const drawdown = ((value - maxValue) / maxValue) * 100;
      maxDrawdown = Math.min(maxDrawdown, drawdown);
    }
  }

  const rotationCount = trades.filter(t => t.type === 'sell').length;

  return {
    finalValue,
    totalReturnPct,
    maxDrawdownPct: maxDrawdown,
    tradeCount: trades.length,
    rotationCount,
    trades,
    equityCurve
  };
}

// 持有策略回测（对比基准）
function runHoldBacktest(candles, config) {
  const { initialCash, mode, investAmount } = config;

  let cash = initialCash;
  let shares = 0;
  const trades = [];
  const equityCurve = [];

  if (mode === 'lump-sum') {
    // 一次性投入
    const firstPrice = candles[0].c;
    if (firstPrice > 0) {
      shares = cash / firstPrice;
      cash = 0;
      trades.push({
        date: candles[0].t,
        type: 'buy',
        price: firstPrice,
        shares,
        amount: shares * firstPrice
      });
    }

    for (const candle of candles) {
      equityCurve.push(shares * candle.c);
    }
  } else {
    // 定投模式
    const interval = Math.max(1, Math.floor(candles.length / 10));
    let accShares = 0;
    let accCash = initialCash;
    let remainingBudget = initialCash;
    let tradeIndex = 0;

    for (let i = 0; i < candles.length; i += interval) {
      const price = candles[i].c;
      if (remainingBudget >= investAmount && price > 0) {
        const buyShares = investAmount / price;
        shares += buyShares;
        remainingBudget -= investAmount;
        trades.push({
          date: candles[i].t,
          type: 'buy',
          price,
          shares: buyShares,
          amount: investAmount
        });
      }
    }

    for (let i = 0; i < candles.length; i++) {
      if (tradeIndex < trades.length && i >= interval * tradeIndex) {
        accShares += trades[tradeIndex].shares;
        accCash -= trades[tradeIndex].amount;
        tradeIndex++;
      }
      equityCurve.push(accCash + accShares * candles[i].c);
    }

    cash = accCash;
  }

  const lastPrice = candles[candles.length - 1].c;
  const finalValue = cash + shares * lastPrice;
  const totalReturn = finalValue - initialCash;
  const totalReturnPct = (totalReturn / initialCash) * 100;

  let maxValue = initialCash;
  let maxDrawdown = 0;
  for (const value of equityCurve) {
    maxValue = Math.max(maxValue, value);
    if (maxValue > 0) {
      const drawdown = ((value - maxValue) / maxValue) * 100;
      maxDrawdown = Math.min(maxDrawdown, drawdown);
    }
  }

  return {
    finalValue,
    totalReturnPct,
    maxDrawdownPct: maxDrawdown,
    tradeCount: trades.length,
    trades,
    equityCurve
  };
}

export function BacktestSidePanel({
  open = false,
  onClose,
  symbol,
  candles = [],
  switchPrefs = null,
  chartRange = '1d',
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  // 策略配置状态
  const [strategyName, setStrategyName] = useState('');
  const defaultCodes = deriveDefaultBacktestCodes(symbol, { switchPrefs });
  const [highCodes, setHighCodes] = useState(defaultCodes.highCodes);
  const [lowCodes, setLowCodes] = useState(defaultCodes.lowCodes);
  const [intraSellLowerPct, setIntraSellLowerPct] = useState('1');
  const [intraBuyOtherPct, setIntraBuyOtherPct] = useState('3');
  const [initialCash, setInitialCash] = useState('10000');
  const [investMode, setInvestMode] = useState('dca');
  const [investAmount, setInvestAmount] = useState('1000');

  useEffect(() => {
    if (open) {
      console.log('[BacktestSidePanel] useEffect triggered on open:', { symbol, switchPrefs });
      const nextDefaults = deriveDefaultBacktestCodes(symbol, { switchPrefs });
      console.log('[BacktestSidePanel] nextDefaults:', nextDefaults);
      setResult(null);
      setStrategyName(`${symbol} 策略`);
      setHighCodes(nextDefaults.highCodes);
      setLowCodes(nextDefaults.lowCodes);
      console.log('[BacktestSidePanel] state updated with highCodes:', nextDefaults.highCodes, 'lowCodes:', nextDefaults.lowCodes);
    }
  }, [open, symbol, switchPrefs]);

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
    console.log('[BacktestSidePanel] handleRun called');
    console.log('[BacktestSidePanel] current state:', { highCodes, lowCodes, candles: candles?.length });

    if (!candles || candles.length < 10) {
      console.log('[BacktestSidePanel] insufficient candles:', candles?.length);
      alert('数据不足，至少需要 10 个数据点');
      return;
    }

    setRunning(true);
    setResult(null);

    try {
      const cash = parseDecimalOr(initialCash, 10000);
      const sellLowerThreshold = parseDecimalOr(intraSellLowerPct, 1);
      const buyOtherThreshold = parseDecimalOr(intraBuyOtherPct, 3);
      const invest = parseDecimalOr(investAmount, 1000);

      console.log('[Backtest] 开始回测', {
        highCodes,
        lowCodes,
        sellLowerThreshold,
        buyOtherThreshold,
        initialCash: cash
      });

      let rotationResult = null;
      let holdResult = null;

      // 如果配置了H/L档，使用统一回测引擎
      if (highCodes.length > 0 && lowCodes.length > 0) {
        console.log('[Backtest] 进入H/L档回测分支');
        console.log('[Backtest] 获取历史数据和NAV...');
        const allCodes = [...highCodes, ...lowCodes];
        console.log('[Backtest] allCodes:', allCodes);

        // 使用统一的数据获取函数
        const { historyByCode, navHistoryByCode } = await fetchBacktestData(allCodes, { highCodes, lowCodes });
        console.log('[Backtest] fetchBacktestData 返回:', {
          historyByCodeKeys: Object.keys(historyByCode),
          navHistoryByCodeKeys: Object.keys(navHistoryByCode),
          historyLengths: Object.fromEntries(Object.entries(historyByCode).map(([k, v]) => [k, v?.length])),
          navLengths: Object.fromEntries(Object.entries(navHistoryByCode).map(([k, v]) => [k, v?.length]))
        });

        console.log('[Backtest] 运行溢价差轮动策略（使用NAV计算真实溢价率）...');

        // 构建策略配置
        const strategy = {
          type: 'premium-spread',
          highCodes: [highCodes[0]],
          lowCodes: [lowCodes[0]],
          intraSellLowerPct: sellLowerThreshold,
          intraBuyOtherPct: buyOtherThreshold,
          activeSide: 'all'
        };
        console.log('[Backtest] strategy config:', strategy);

        const backtestOptions = {
          timeframe: chartRange === '1y' ? '1d' : chartRange === '1m' ? '1d' : '5m',
          historyByCode,
          navHistoryByCode,
          initialEquity: cash,
          feeRate: 0.00005,
          minFee: 0,
          tickSize: 0.001,
          slippageTicks: 1,
          lotSize: 100
        };
        console.log('[Backtest] backtestOptions:', { ...backtestOptions, historyByCode: 'omitted', navHistoryByCode: 'omitted' });

        const result = runBacktest(strategy, backtestOptions);
        console.log('[Backtest] runBacktest 返回:', result);

        if (result.ok && result.status === 'passed') {
          rotationResult = {
            finalValue: result.summary.finalEquity,
            totalReturnPct: result.summary.totalReturnPct,
            maxDrawdownPct: result.summary.maxDrawdownPct,
            tradeCount: result.summary.tradeCount,
            rotationCount: result.summary.switchCount || 0,
            trades: result.trades,
            equityCurve: result.rows.map(r => r.equity)
          };
          console.log('[Backtest] 轮动策略结果:', rotationResult);
        } else {
          console.warn('[Backtest] 回测未通过质量检查:', result.quality);
        }
      } else {
        console.log('[Backtest] 跳过H/L档回测（highCodes或lowCodes为空）');
      }

      // 运行持有策略（对比基准）- 保持原逻辑
      console.log('[Backtest] 运行持有策略...');
      holdResult = runHoldBacktest(candles, {
        initialCash: cash,
        mode: investMode,
        investAmount: invest
      });
      console.log('[Backtest] 持有策略结果:', holdResult);

      setResult({
        rotation: rotationResult,
        hold: holdResult,
        config: {
          highCodes,
          lowCodes,
          sellLowerThreshold,
          buyOtherThreshold,
          initialCash: cash
        }
      });
    } catch (error) {
      console.error('[Backtest] 回测失败:', error);
      alert(error.message || '回测失败');
    } finally {
      setRunning(false);
    }
  }

  if (!open) return null;

  const rotation = result?.rotation;
  const hold = result?.hold;

  return (
    <>
      <button
        type="button"
        aria-label="关闭回测侧边栏"
        className="fixed inset-0 z-[999] cursor-default bg-slate-950/35 backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="策略回测"
        className="fixed right-0 top-0 z-[1000] flex h-[100vh] w-[min(560px,100vw)] flex-col bg-[#F0F2F8] shadow-2xl animate-in fade-in slide-in-from-right-7 duration-200"
      >
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

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-5">
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
                  <label htmlFor="invest-mode" className="block text-xs font-semibold text-slate-500">持有对比模式</label>
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
                  hint="轮动策略和持有对比使用相同初始资金"
                  value={initialCash}
                  onChange={setInitialCash}
                  onCommit={(v) => setInitialCash(String(parseDecimalOr(v, 10000)))}
                />
                {investMode === 'dca' && (
                  <DecimalInput
                    id="invest-amount"
                    label="每次定投"
                    suffix="¥"
                    hint="定投模式下每次买入金额"
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
                    配置 H/L 档和触发规则后点击「开始回测」
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={running}
                  className={cx(primaryButtonClass, 'mt-4')}
                >
                  {running ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
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
                {/* 溢价差轮动策略结果 */}
                {rotation && (
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-sm font-bold text-slate-900">
                      溢价差轮动策略
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {rotation.rotationCount} 次轮动
                      </span>
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <MetricCard
                        icon={TrendingUp}
                        label="总收益率"
                        value={formatPercent(rotation.totalReturnPct)}
                        tone={rotation.totalReturnPct > 0 ? 'positive' : rotation.totalReturnPct < 0 ? 'negative' : 'neutral'}
                      />
                      <MetricCard
                        icon={Activity}
                        label="最大回撤"
                        value={formatPercent(rotation.maxDrawdownPct)}
                        tone={Math.abs(rotation.maxDrawdownPct) <= 5 ? 'positive' : Math.abs(rotation.maxDrawdownPct) <= 10 ? 'neutral' : 'negative'}
                      />
                    </div>
                    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">最终市值</span>
                        <span className="font-semibold tabular-nums text-slate-900">
                          ¥{rotation.finalValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 持有策略对比 */}
                {hold && (
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-sm font-bold text-slate-900">
                      持有策略对比
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {investMode === 'dca' ? '定投' : '一次性'} · {symbol}
                      </span>
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <MetricCard
                        icon={TrendingUp}
                        label="总收益率"
                        value={formatPercent(hold.totalReturnPct)}
                        tone={hold.totalReturnPct > 0 ? 'positive' : hold.totalReturnPct < 0 ? 'negative' : 'neutral'}
                      />
                      <MetricCard
                        icon={Activity}
                        label="最大回撤"
                        value={formatPercent(hold.maxDrawdownPct)}
                        tone={Math.abs(hold.maxDrawdownPct) <= 5 ? 'positive' : Math.abs(hold.maxDrawdownPct) <= 10 ? 'neutral' : 'negative'}
                      />
                    </div>
                    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">最终市值</span>
                        <span className="font-semibold tabular-nums text-slate-900">
                          ¥{hold.finalValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 策略对比 */}
                {rotation && hold && (
                  <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-4">
                    <h3 className="mb-3 text-sm font-bold text-indigo-900">策略对比</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-indigo-700">收益率差异</span>
                        <span className={cx('font-bold tabular-nums',
                          rotation.totalReturnPct > hold.totalReturnPct ? 'text-emerald-600' : 'text-rose-600'
                        )}>
                          {formatPercent(rotation.totalReturnPct - hold.totalReturnPct)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-indigo-700">轮动策略 vs 持有</span>
                        <span className="font-semibold text-indigo-900">
                          {rotation.totalReturnPct > hold.totalReturnPct ? '轮动胜出' : '持有胜出'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

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
