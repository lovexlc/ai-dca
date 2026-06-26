import { useEffect, useState } from 'react';
import { X, Play, BarChart3, TrendingUp, Trophy, Activity, RefreshCw, Settings2 } from 'lucide-react';
import { cx, primaryButtonClass, secondaryButtonClass, inputClass } from '../experience-ui.jsx';
import { TagInput } from '../TagInput.jsx';
import { EquityChart, KlineChart, PremiumChart } from '../BacktestCharts.jsx';
import { InteractiveChartContainer } from '../InteractiveChartContainer.jsx';
import { createTradeSimulator, runBacktest } from '../../app/backtest/index.js';
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

function formatCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `¥${num.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num >= 10 ? num.toFixed(2) : num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function formatTradeDate(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(5, 10);
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '--';
  const date = new Date(num < 10000000000 ? num * 1000 : num);
  if (Number.isNaN(date.getTime())) return '--';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

const BACKTEST_RANGE_OPTIONS = Object.freeze([
  { key: '3mo', label: '3 个月', days: 92 },
  { key: '6mo', label: '6 个月', days: 183 },
  { key: '1y', label: '1 年', days: 365 },
  { key: '2y', label: '2 年', days: 365 * 2 },
  { key: 'custom', label: '自定义', days: null },
]);

const OPTIMIZE_SELL_LOWER_GRID = Object.freeze([0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.5, 2]);
const OPTIMIZE_BUY_OTHER_GRID = Object.freeze([1, 1.5, 2, 2.5, 3, 3.5, 4, 5]);
const BACKTEST_CHART_VIEWS = Object.freeze([
  { id: 'equity', label: '权益曲线' },
  { id: 'kline', label: 'K线+信号' },
  { id: 'premium', label: '溢价差' }
]);
const BACKTEST_TRADING_COSTS = Object.freeze({
  feeRate: 0.00005,
  minFee: 0,
  tickSize: 0.005,
  slippageTicks: 1,
  lotSize: 100,
  useQuotedPrices: false
});

function todayShanghaiIso() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  } catch (_error) {
    return new Date().toISOString().slice(0, 10);
  }
}

function shiftIsoDate(isoDate, deltaDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return '';
  const [year, month, day] = isoDate.split('-').map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(deltaDays || 0));
  return date.toISOString().slice(0, 10);
}

function deriveBacktestDateRange(rangeKey, customRange = {}) {
  const selected = BACKTEST_RANGE_OPTIONS.find((item) => item.key === rangeKey) || BACKTEST_RANGE_OPTIONS[2];
  if (selected.key === 'custom') {
    const startDate = String(customRange.startDate || '').slice(0, 10);
    const endDate = String(customRange.endDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && startDate <= endDate) {
      return { startDate, endDate };
    }
    const fallbackEndDate = todayShanghaiIso();
    return { startDate: shiftIsoDate(fallbackEndDate, -365), endDate: fallbackEndDate };
  }
  const endDate = todayShanghaiIso();
  return { startDate: shiftIsoDate(endDate, -selected.days), endDate };
}

function normalizeCandlesForHold(raw = []) {
  return (Array.isArray(raw) ? raw : [])
    .map((item) => {
      const close = Number(item?.c ?? item?.close ?? item?.price);
      const t = Number(item?.t ?? item?.timestamp ?? 0);
      const rawDate = String(item?.date || item?.day || '').slice(0, 10);
      return {
        ...item,
        c: close,
        close,
        t: Number.isFinite(t) && t > 0 ? t : (rawDate ? Math.floor(Date.parse(`${rawDate}T15:00:00+08:00`) / 1000) : 0),
      };
    })
    .filter((item) => Number.isFinite(item.c) && item.c > 0)
    .sort((a, b) => Number(a.t) - Number(b.t));
}

function makeRotationResult(result) {
  if (!result?.ok || result.status !== 'passed') return null;
  return {
    finalValue: result.summary.finalEquity,
    totalReturnPct: result.summary.totalReturnPct,
    maxDrawdownPct: result.summary.maxDrawdownPct,
    tradeCount: result.summary.tradeCount,
    rotationCount: result.summary.switchCount || 0,
    trades: result.trades,
    equityCurve: result.rows.map((row) => row.equity),
    rows: result.rows,
    signals: result.signals,
    chart: result.chart,
    summary: result.summary,
    thresholds: {
      sellLowerThreshold: result.strategy?.intraSellLowerPct,
      buyOtherThreshold: result.strategy?.intraBuyOtherPct,
    },
    initialSide: '',
    autoClassified: result.autoClassified || false,
    effectiveHighCodes: result.effectiveHighCodes || [],
    effectiveLowCodes: result.effectiveLowCodes || [],
    avgPremiumByCode: result.avgPremiumByCode || null
  };
}

function buildTradeExamples(trades = [], signals = [], limit = 4) {
  const signalByTs = new Map(
    (Array.isArray(signals) ? signals : [])
      .map((signal) => [Number(signal.ts), signal])
      .filter(([ts]) => Number.isFinite(ts))
  );
  const groups = new Map();
  for (const trade of Array.isArray(trades) ? trades : []) {
    const ts = Number(trade?.ts ?? trade?.date);
    if (!Number.isFinite(ts)) continue;
    const list = groups.get(ts) || [];
    list.push(trade);
    groups.set(ts, list);
  }
  return Array.from(groups.entries())
    .sort(([leftTs], [rightTs]) => leftTs - rightTs)
    .map(([ts, list]) => {
      const sell = list.find((trade) => trade?.type === 'sell');
      const buy = list.find((trade) => trade?.type === 'buy');
      if (!sell || !buy) return null;
      const signal = signalByTs.get(ts) || {};
      return { ts, sell, buy, signal };
    })
    .filter(Boolean)
    .slice(0, limit);
}

function pickBetterBacktest(currentBest, candidate) {
  if (!candidate) return currentBest;
  if (!currentBest) return candidate;
  const candidateReturn = Number(candidate.totalReturnPct);
  const bestReturn = Number(currentBest.totalReturnPct);
  if (candidateReturn > bestReturn) return candidate;
  if (candidateReturn < bestReturn) return currentBest;
  const candidateDrawdown = Math.abs(Number(candidate.maxDrawdownPct));
  const bestDrawdown = Math.abs(Number(currentBest.maxDrawdownPct));
  return candidateDrawdown < bestDrawdown ? candidate : currentBest;
}

function optimizePremiumSpread({ baseStrategy, backtestOptions }) {
  let best = null;
  const attempts = [];
  for (const initialSide of ['L', 'H']) {
    for (const sellLowerThreshold of OPTIMIZE_SELL_LOWER_GRID) {
      for (const buyOtherThreshold of OPTIMIZE_BUY_OTHER_GRID) {
        if (buyOtherThreshold < sellLowerThreshold) continue;
        const strategy = {
          ...baseStrategy,
          initialSide,
          intraSellLowerPct: sellLowerThreshold,
          intraBuyOtherPct: buyOtherThreshold,
        };
        const result = runBacktest(strategy, backtestOptions);
        const rotation = makeRotationResult(result);
        if (rotation) {
          rotation.thresholds = { sellLowerThreshold, buyOtherThreshold };
          rotation.initialSide = initialSide;
          attempts.push(rotation);
          best = pickBetterBacktest(best, rotation);
        }
      }
    }
  }
  return { best, attempts };
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
  const { code, initialCash, mode, investAmount, tradingCosts = BACKTEST_TRADING_COSTS } = config;
  const trades = [];
  const equityCurve = [];
  const simulator = createTradeSimulator({
    initialCash,
    ...tradingCosts
  });

  function currentPrices(candle) {
    return { [code]: candle.c };
  }

  if (mode === 'lump-sum') {
    const firstTrade = simulator.executeBuy(code, candles[0], simulator.cash);
    if (firstTrade) trades.push({ ...firstTrade, date: candles[0].t });

    for (const candle of candles) {
      equityCurve.push(simulator.calcEquity(currentPrices(candle)));
    }
  } else {
    const interval = Math.max(1, Math.floor(candles.length / 10));

    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      if (i % interval === 0 && simulator.cash >= investAmount && candle.c > 0) {
        const buyTrade = simulator.executeBuy(code, candle, investAmount);
        if (buyTrade) {
          trades.push({ ...buyTrade, date: candle.t });
        }
      }
      equityCurve.push(simulator.calcEquity(currentPrices(candle)));
    }
  }

  const lastPrice = candles[candles.length - 1].c;
  const finalValue = simulator.calcEquity({ [code]: lastPrice });
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
    code,
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
  switchPrefs = null,
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
  const [backtestRange, setBacktestRange] = useState('1y');
  const [customStartDate, setCustomStartDate] = useState(() => shiftIsoDate(todayShanghaiIso(), -365));
  const [customEndDate, setCustomEndDate] = useState(() => todayShanghaiIso());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [chartView, setChartView] = useState('equity');

  useEffect(() => {
    if (open) {
      console.log('[BacktestSidePanel] useEffect triggered on open:', { symbol, switchPrefs });
      const nextDefaults = deriveDefaultBacktestCodes(symbol, { switchPrefs });
      console.log('[BacktestSidePanel] nextDefaults:', nextDefaults);
      setResult(null);
      setChartView('equity');
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
    console.log('[BacktestSidePanel] current state:', { highCodes, lowCodes, backtestRange, customStartDate, customEndDate });

    setRunning(true);
    setResult(null);

    try {
      const cash = parseDecimalOr(initialCash, 10000);
      const invest = parseDecimalOr(investAmount, 1000);
      const dateRange = deriveBacktestDateRange(backtestRange, { startDate: customStartDate, endDate: customEndDate });

      console.log('[Backtest] 开始回测', {
        highCodes,
        lowCodes,
        dateRange,
        initialCash: cash,
        optimize: true
      });

      let rotationResult = null;
      let holdResult = null;
      let holdResults = [];

      // 如果配置了H/L档，使用统一回测引擎
      if (highCodes.length > 0 && lowCodes.length > 0) {
        console.log('[Backtest] 进入H/L档回测分支');
        console.log('[Backtest] 获取历史数据和NAV...');
        const allCodes = [...highCodes, ...lowCodes];
        console.log('[Backtest] allCodes:', allCodes);

        const { historyByCode, navHistoryByCode } = await fetchBacktestData(allCodes, {
          highCodes,
          lowCodes,
          ...dateRange,
          forceRefresh: true
        });
        console.log('[Backtest] fetchBacktestData 返回:', {
          historyByCodeKeys: Object.keys(historyByCode),
          navHistoryByCodeKeys: Object.keys(navHistoryByCode),
          historyLengths: Object.fromEntries(Object.entries(historyByCode).map(([k, v]) => [k, v?.length])),
          navLengths: Object.fromEntries(Object.entries(navHistoryByCode).map(([k, v]) => [k, v?.length]))
        });

        console.log('[Backtest] 运行溢价差轮动策略（使用NAV计算真实溢价率）...');

        const baseStrategy = {
          type: 'premium-spread',
          highCodes: [highCodes[0]],
          lowCodes: [lowCodes[0]],
          activeSide: 'all'
        };
        console.log('[Backtest] strategy config:', baseStrategy);

        const backtestOptions = {
          timeframe: '1d',
          historyByCode,
          navHistoryByCode,
          initialEquity: cash,
          ...BACKTEST_TRADING_COSTS,
          silent: true
        };
        console.log('[Backtest] backtestOptions:', { ...backtestOptions, historyByCode: 'omitted', navHistoryByCode: 'omitted' });

        const optimized = optimizePremiumSpread({ baseStrategy, backtestOptions });
        rotationResult = optimized.best;
        console.log('[Backtest] 阈值自动寻优结果:', {
          attempts: optimized.attempts.length,
          best: rotationResult ? {
            totalReturnPct: rotationResult.totalReturnPct,
            maxDrawdownPct: rotationResult.maxDrawdownPct,
            rotationCount: rotationResult.rotationCount,
            initialSide: rotationResult.initialSide,
            thresholds: rotationResult.thresholds
          } : null
        });

        if (rotationResult) {
          setIntraSellLowerPct(toDecimalText(rotationResult.thresholds.sellLowerThreshold, 1));
          setIntraBuyOtherPct(toDecimalText(rotationResult.thresholds.buyOtherThreshold, 3));
        } else {
          console.warn('[Backtest] 所有阈值组合均未通过质量检查');
        }

        holdResults = [highCodes[0], lowCodes[0]]
          .filter(Boolean)
          .map((holdCode) => {
            const holdCandles = normalizeCandlesForHold(historyByCode?.[holdCode] || []);
            if (!holdCandles || holdCandles.length < 10) {
              console.log('[Backtest] 持有对比数据不足:', { holdCode, length: holdCandles?.length });
              return null;
            }
            console.log('[Backtest] 运行持有策略...', { holdCode, holdCandles: holdCandles.length });
            return runHoldBacktest(holdCandles, {
              code: holdCode,
              initialCash: cash,
              mode: investMode,
              investAmount: invest,
              tradingCosts: BACKTEST_TRADING_COSTS
            });
          })
          .filter(Boolean);

        if (!holdResults.length) {
          alert('数据不足，至少需要 10 个数据点');
          return;
        }
        holdResult = holdResults.find((item) => item.code === symbol) || holdResults[0] || null;
        console.log('[Backtest] 持有策略结果:', holdResults.map((item) => ({
          code: item.code,
          totalReturnPct: item.totalReturnPct,
          maxDrawdownPct: item.maxDrawdownPct,
          tradeCount: item.tradeCount,
          finalValue: item.finalValue
        })));
      } else {
        console.log('[Backtest] 跳过H/L档回测（highCodes或lowCodes为空）');
      }

      setResult({
        rotation: rotationResult,
        hold: holdResult,
        holds: holdResults,
        config: {
          highCodes,
          lowCodes,
          sellLowerThreshold: rotationResult?.thresholds?.sellLowerThreshold ?? parseDecimalOr(intraSellLowerPct, 1),
          buyOtherThreshold: rotationResult?.thresholds?.buyOtherThreshold ?? parseDecimalOr(intraBuyOtherPct, 3),
          initialCash: cash,
          dateRange
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
  const holds = Array.isArray(result?.holds) ? result.holds : (hold ? [hold] : []);
  const effectiveHighCodes = rotation?.effectiveHighCodes?.length ? rotation.effectiveHighCodes : highCodes;
  const effectiveLowCodes = rotation?.effectiveLowCodes?.length ? rotation.effectiveLowCodes : lowCodes;
  const bestHold = holds.reduce((best, item) => {
    if (!item) return best;
    if (!best) return item;
    return Number(item.totalReturnPct) > Number(best.totalReturnPct) ? item : best;
  }, null);
  const tradeExamples = rotation ? buildTradeExamples(rotation.trades, rotation.signals, 4) : [];
  const selectedRangeLabel = BACKTEST_RANGE_OPTIONS.find((item) => item.key === backtestRange)?.label || '1 年';

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
              {symbol} · {selectedRangeLabel} · 自动寻优
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

            {/* 时间区间 */}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <SectionLabel>回测区间</SectionLabel>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {BACKTEST_RANGE_OPTIONS.map((option) => {
                    const selected = backtestRange === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setBacktestRange(option.key)}
                        className={cx(
                          'h-10 rounded-xl border px-3 text-sm font-semibold transition',
                          selected
                            ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {backtestRange === 'custom' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-semibold text-slate-500">
                      开始日期
                      <input
                        type="date"
                        className={cx(inputClass, 'mt-2')}
                        value={customStartDate}
                        max={customEndDate || undefined}
                        onChange={(event) => setCustomStartDate(event.target.value)}
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-500">
                      结束日期
                      <input
                        type="date"
                        className={cx(inputClass, 'mt-2')}
                        value={customEndDate}
                        min={customStartDate || undefined}
                        onChange={(event) => setCustomEndDate(event.target.value)}
                      />
                    </label>
                  </div>
                )}
                <p className="text-xs leading-5 text-slate-400">
                  回测会按这里选择的日期独立拉取 H/L 与持有对比数据，不再依赖基金详情页当前 K 线。
                </p>
              </div>
            </div>

            {/* 高级选项 */}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <button
                type="button"
                onClick={() => setAdvancedOpen((value) => !value)}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Settings2 className="h-4 w-4 text-indigo-500" />
                  高级选项
                </span>
                <span className="text-xs font-semibold text-slate-400">
                  {advancedOpen ? '收起' : '展开'}
                </span>
              </button>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                默认自动识别 H/L 并遍历阈值组合，普通回测无需手动填写。
              </p>
              {advancedOpen && (
                <div className="mt-4 space-y-5">
                  <div className="space-y-4">
                    <TagInput
                      label="H 高溢价 ETF（卖出方）"
                      placeholder="输入代码如 513100"
                      tags={highCodes}
                      onChange={setHighCodes}
                    />
                    <TagInput
                      label="L 低溢价 ETF（买入方）"
                      placeholder="输入代码如 159501"
                      tags={lowCodes}
                      onChange={setLowCodes}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DecimalInput
                      id="sell-lower"
                      label="当前卖 L 买 H 阈值"
                      suffix="%"
                      hint="持 L 时溢价差回落到该值以下切回 H"
                      value={intraSellLowerPct}
                      onChange={setIntraSellLowerPct}
                      onCommit={(v) => setIntraSellLowerPct(String(parseDecimalOr(v, 1)))}
                    />
                    <DecimalInput
                      id="buy-other"
                      label="当前卖 H 买 L 阈值"
                      suffix="%"
                      hint="持 H 时溢价差超过该值切到便宜的 L"
                      value={intraBuyOtherPct}
                      onChange={setIntraBuyOtherPct}
                      onCommit={(v) => setIntraBuyOtherPct(String(parseDecimalOr(v, 3)))}
                    />
                  </div>
                </div>
              )}
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
                    选择回测区间后点击「开始回测」，系统会自动寻找最优溢价差阈值。
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
                        初始 {rotation.initialSide || 'L'} · {rotation.rotationCount} 次轮动
                        {rotation.autoClassified ? ' · 已自动校正 H/L' : ''}
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
                      <div className="mb-2 flex justify-between">
                        <span className="text-slate-500">最优阈值</span>
                        <span className="font-semibold tabular-nums text-slate-900">
                          L→H {formatNumber(rotation.thresholds?.sellLowerThreshold)}% / H→L {formatNumber(rotation.thresholds?.buyOtherThreshold)}%
                        </span>
                      </div>
                      <div className="mb-2 flex justify-between">
                        <span className="text-slate-500">初始持仓</span>
                        <span className="font-semibold tabular-nums text-slate-900">
                          {rotation.initialSide === 'H' ? effectiveHighCodes[0] : effectiveLowCodes[0]}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">最终市值</span>
                        <span className="font-semibold tabular-nums text-slate-900">
                          ¥{rotation.finalValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {rotation && (
                  <InteractiveChartContainer
                    views={BACKTEST_CHART_VIEWS}
                    activeView={chartView}
                    onViewChange={setChartView}
                    className="shadow-sm"
                  >
                    {chartView === 'equity' && <EquityChart data={rotation.rows || []} />}
                    {chartView === 'kline' && (
                      <KlineChart
                        candles={rotation.chart?.candles || []}
                        signals={rotation.signals || []}
                      />
                    )}
                    {chartView === 'premium' && <PremiumChart data={rotation.rows || []} signals={rotation.signals || []} trades={rotation.trades || []} />}
                  </InteractiveChartContainer>
                )}

                {/* 持有策略对比 */}
                {holds.length > 0 && (
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-sm font-bold text-slate-900">
                      持有策略对比
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {investMode === 'dca' ? '定投' : '一次性'} · 同手续费/滑点/整手
                      </span>
                    </h3>
                    <div className="grid gap-3">
                      {holds.map((item) => (
                        <div key={item.code} className="rounded-lg bg-slate-50 p-3">
                          <div className="mb-2 flex items-center justify-between text-sm">
                            <span className="font-semibold text-slate-900">持有 {item.code}</span>
                            <span className={cx('font-bold tabular-nums',
                              item.totalReturnPct > 0 ? 'text-emerald-600' : item.totalReturnPct < 0 ? 'text-rose-600' : 'text-slate-600'
                            )}>
                              {formatPercent(item.totalReturnPct)}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                            <span>最大回撤 {formatPercent(item.maxDrawdownPct)}</span>
                            <span className="text-right">最终 ¥{item.finalValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 策略对比 */}
                {rotation && bestHold && (
                  <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-4">
                    <h3 className="mb-3 text-sm font-bold text-indigo-900">策略对比</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-indigo-700">相对最佳持有差异</span>
                        <span className={cx('font-bold tabular-nums',
                          rotation.totalReturnPct > bestHold.totalReturnPct ? 'text-emerald-600' : 'text-rose-600'
                        )}>
                          {formatPercent(rotation.totalReturnPct - bestHold.totalReturnPct)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-indigo-700">轮动策略 vs 持有 {bestHold.code}</span>
                        <span className="font-semibold text-indigo-900">
                          {rotation.totalReturnPct > bestHold.totalReturnPct ? '轮动胜出' : '持有胜出'}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 rounded-xl bg-white/70 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-indigo-900">真实买卖点示例</span>
                        <span className="text-[11px] text-indigo-500">来自本次回测成交记录</span>
                      </div>
                      {tradeExamples.length ? (
                        <div className="space-y-2">
                          {tradeExamples.map(({ ts, sell, buy, signal }, index) => {
                            const rule = signal.rule || (sell.code === effectiveHighCodes[0] ? 'B' : 'A');
                            const gap = Number(signal.gapPct);
                            return (
                              <div key={`${ts}-${sell.code}-${buy.code}-${index}`} className="rounded-lg border border-indigo-100 bg-white px-3 py-2 text-xs">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-bold text-indigo-900">
                                    {formatTradeDate(signal.datetime || signal.date || ts)} · 规则 {rule}
                                  </span>
                                  <span className="font-semibold tabular-nums text-indigo-700">
                                    H−L {Number.isFinite(gap) ? formatPercent(gap) : '--'}
                                  </span>
                                </div>
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-slate-700">
                                  <span className="rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-600">
                                    卖 {sell.code} @ {formatPrice(sell.price)}
                                  </span>
                                  <span className="text-slate-400">→</span>
                                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-600">
                                    买 {buy.code} @ {formatPrice(buy.price)}
                                  </span>
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500">
                                  卖出 {formatCurrency(sell.netProceeds ?? sell.amount)}，买入 {formatCurrency(buy.totalCost ?? buy.amount)}
                                  {Number.isFinite(Number(sell.profit)) ? `，本轮卖出盈亏 ${formatCurrency(sell.profit)}` : ''}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs leading-5 text-indigo-700">
                          本次最优组合没有形成完整卖出→买入轮动，图表仍展示权益和溢价差轨迹。
                        </p>
                      )}
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
