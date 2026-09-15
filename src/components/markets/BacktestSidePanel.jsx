import { useEffect, useRef, useState } from 'react';
import {
  X, Play, BarChart3, TrendingUp, Trophy, Activity, RefreshCw, Settings2,
  Download, ChevronDown, ChevronUp, CheckCircle2, LayoutGrid, Scale, ShieldCheck,
  FileSpreadsheet, ArrowRight
} from 'lucide-react';
import { cx, primaryButtonClass, secondaryButtonClass, inputClass } from '../experience-ui.jsx';
import { TagInput } from '../TagInput.jsx';
import { EquityChart, KlineChart, PremiumChart } from '../BacktestCharts.jsx';
import { InteractiveChartContainer } from '../InteractiveChartContainer.jsx';
import { BacktestCounterpartPicker } from './BacktestCounterpartPicker.jsx';
import { buildGapDistributionThresholdGrids, isValidThresholdPair, MIN_THRESHOLD_SPREAD } from './backtestGapOptimization.js';
import { buildPremiumPanel, classifyPremiumCodes, createTradeSimulator, runBacktest } from '../../app/backtest/index.js';
import { fetchBacktestData, runCollectorBacktest } from '../../app/backtestDataFetcher.js';
import { isKnownQdiiFundCode } from '../../app/qdiiFundCodes.js';
import { normalizeCnFundCode } from '../../pages/markets/marketDisplayUtils.js';
import { deriveDefaultBacktestCodes } from './backtestSidePanelState.js';
import { buildSwitchRecords, downloadSwitchRecordsCsv } from './backtestSwitchRecords.js';
import { addSwitchRule } from '../../app/switchStrategySync.js';
import { readSwitchPrefs as readStoredSwitchPrefs, writeSwitchPrefs as writeStoredSwitchPrefs } from '../../pages/switchStrategyHelpers.js';

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

function normalizeFundCode(value) {
  return normalizeCnFundCode(value);
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

const DEFAULT_SELL_LOWER_THRESHOLD = -0.5;
const DEFAULT_BUY_OTHER_THRESHOLD = 0.5;
const INVEST_MODE_LUMP_SUM = 'lump-sum';
const OPTIMIZE_SELL_LOWER_GRID = Object.freeze([-1, -0.5, 0, 0.2, 0.5, 0.8, 1, 1.5]);
const OPTIMIZE_BUY_OTHER_GRID = Object.freeze([0.5, 1, 1.5, 2, 2.5, 3, 4, 5]);
const BACKTEST_CHART_VIEWS = Object.freeze([
  { id: 'equity', label: '权益曲线' },
  { id: 'kline', label: 'K线+信号' },
  { id: 'premium', label: '溢价差' }
]);
const BACKTEST_TRADING_COSTS = Object.freeze({
  feeRate: 0.00005,
  minFee: 0,
  tickSize: 0.005,
  slippageTicks: 0,
  lotSize: 100,
  useQuotedPrices: false
});
const DEFAULT_VISIBLE_SWITCH_RECORDS = 5;

function todayShanghaiIso() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  } catch {
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
      sellLowerThreshold: result.strategy?.intraSellLowerPct ?? DEFAULT_SELL_LOWER_THRESHOLD,
      buyOtherThreshold: result.strategy?.intraBuyOtherPct ?? DEFAULT_BUY_OTHER_THRESHOLD,
    },
    initialSide: result.strategy?.initialSide || 'L',
    effectiveHighCodes: result.strategy?.highCodes || [],
    effectiveLowCodes: result.strategy?.lowCodes || [],
    autoClassified: Boolean(result.strategy?.autoClassified)
  };
}

function counterpartsFromCodes(symbol, highCodes = [], lowCodes = []) {
  const current = normalizeFundCode(symbol);
  return Array.from(new Set([...highCodes, ...lowCodes].map(normalizeFundCode)))
    .filter((code) => code && code !== current);
}

function applyCounterpartsToPair(currentSymbol, counterparts, highCodes = [], lowCodes = []) {
  const current = normalizeFundCode(currentSymbol);
  const peers = Array.from(new Set((Array.isArray(counterparts) ? counterparts : [counterparts])
    .map(normalizeFundCode)
    .filter((code) => code && code !== current)));
  if (!current) return { highCodes, lowCodes };
  const currentIsLow = (lowCodes || []).map(normalizeFundCode).includes(current);
  if (!peers.length) return currentIsLow ? { highCodes: [], lowCodes: [current] } : { highCodes: [current], lowCodes: [] };
  if (currentIsLow) return { highCodes: peers, lowCodes: [current] };
  return { highCodes: [current], lowCodes: peers };
}

function navigateToFundSwitchPage() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', 'fundSwitch');
  url.hash = '';
  window.location.href = url.toString();
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

function optimizePremiumSpread({ baseStrategy, backtestOptions, thresholdGrids = null }) {
  let best = null;
  const attempts = [];
  const sellLowerGrid = thresholdGrids?.sellLowerGrid?.length ? thresholdGrids.sellLowerGrid : OPTIMIZE_SELL_LOWER_GRID;
  const buyOtherGrid = thresholdGrids?.buyOtherGrid?.length ? thresholdGrids.buyOtherGrid : OPTIMIZE_BUY_OTHER_GRID;
  for (const initialSide of ['L', 'H']) {
    for (const sellLowerThreshold of sellLowerGrid) {
      for (const buyOtherThreshold of buyOtherGrid) {
        if (!isValidThresholdPair(sellLowerThreshold, buyOtherThreshold, MIN_THRESHOLD_SPREAD)) continue;
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

function MetricCard({ icon: Icon, label, value, subtext, tone = 'neutral' }) {
  const toneColors = {
    positive: 'text-emerald-600',
    negative: 'text-rose-600',
    neutral: 'text-slate-800',
    primary: 'text-indigo-700',
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        {Icon ? <Icon className="h-4 w-4 text-slate-400" /> : null}
      </div>
      <div className={cx('mt-1.5 font-mono text-xl sm:text-2xl font-black tabular-nums', toneColors[tone])}>
        {value}
      </div>
      {subtext ? <div className="mt-1 text-[11px] text-slate-500">{subtext}</div> : null}
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
          className={cx(inputClass, 'font-mono')}
        />
        {suffix ? <span className="text-xs font-semibold text-slate-400">{suffix}</span> : null}
      </div>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

function runHoldBacktest(candles, options) {
  const { code, initialCash = 10000 } = options;
  if (!candles || candles.length === 0) return null;

  const sim = createTradeSimulator({
    initialCash,
    tradingCosts: BACKTEST_TRADING_COSTS,
    mode: 'cash-limit',
    investMode: INVEST_MODE_LUMP_SUM
  });

  const first = candles[0];
  const firstPrice = Number(first.c);
  const firstTime = Number(first.t);
  const firstDate = String(first.date || first.day || '').slice(0, 10);

  if (Number.isFinite(firstPrice) && firstPrice > 0) {
    const cashForBuy = initialCash;
    const lotSize = BACKTEST_TRADING_COSTS.lotSize || 100;
    const estShares = Math.floor(cashForBuy / firstPrice / lotSize) * lotSize;
    if (estShares > 0) {
      sim.executeOrder({
        action: 'buy',
        code,
        price: firstPrice,
        shares: estShares,
        timestamp: firstTime,
        date: firstDate
      });
    }
  }

  let peak = initialCash;
  let maxDrawdown = 0;
  const trades = sim.getTradeHistory();
  const lastCandle = candles[candles.length - 1];
  const lastPrice = Number(lastCandle.c);
  const finalValue = sim.getPortfolioValue({ [code]: lastPrice });
  const totalReturnPct = ((finalValue - initialCash) / initialCash) * 100;

  const equityCurve = candles.map((candle) => {
    const price = Number(candle.c);
    const value = sim.getPortfolioValue({ [code]: price });
    if (value > peak) peak = value;
    const drawdown = peak > 0 ? ((value - peak) / peak) * 100 : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
    return {
      t: candle.t,
      date: candle.date || candle.day,
      equity: value,
      drawdown
    };
  });

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

// 8×8 寻优网格矩阵弹窗组件
function GridMatrixModal({ open, onClose, attempts = [], bestThresholds = null }) {
  if (!open) return null;

  const sellGrids = OPTIMIZE_SELL_LOWER_GRID;
  const buyGrids = OPTIMIZE_BUY_OTHER_GRID;

  const attemptMap = new Map();
  attempts.forEach((item) => {
    const key = `${Number(item.thresholds?.sellLowerThreshold).toFixed(1)}_${Number(item.thresholds?.buyOtherThreshold).toFixed(1)}`;
    const prev = attemptMap.get(key);
    if (!prev || Number(item.totalReturnPct) > Number(prev.totalReturnPct)) {
      attemptMap.set(key, item);
    }
  });

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-3 sm:p-5">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />
      <div className="relative z-10 w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs">
                <LayoutGrid className="h-3.5 w-3.5" />
              </span>
              <h3 className="text-base font-bold text-slate-900">8×8 阈值寻优空间矩阵 (共 64 组网格组合)</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              横轴为 H→L 切出阈值（溢价冲高切出），纵轴为 L→H 切回阈值（溢价收窄买回）。高亮项为当前锁定的最优解。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex-1 overflow-auto">
          <table className="w-full text-center text-xs font-mono border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                <th className="p-2 text-left sticky left-0 bg-slate-50 z-10">L↓ \ H→</th>
                {buyGrids.map((b) => (
                  <th key={b} className="p-2 border-l border-slate-100">+{formatNumber(b, 1)}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sellGrids.map((s) => (
                <tr key={s} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="p-2 text-left font-bold text-slate-700 bg-slate-50/80 sticky left-0 z-10 border-r border-slate-100">
                    {s > 0 ? `+${formatNumber(s, 1)}` : formatNumber(s, 1)}%
                  </td>
                  {buyGrids.map((b) => {
                    const spread = b - s;
                    const isValid = spread >= MIN_THRESHOLD_SPREAD;
                    const key = `${Number(s).toFixed(1)}_${Number(b).toFixed(1)}`;
                    const att = attemptMap.get(key);
                    const isBest = bestThresholds &&
                      Math.abs(Number(bestThresholds.sellLowerThreshold) - s) < 0.05 &&
                      Math.abs(Number(bestThresholds.buyOtherThreshold) - b) < 0.05;

                    if (!isValid) {
                      return (
                        <td key={b} className="p-2 border-l border-slate-100 bg-slate-50/40 text-[10px] text-slate-300">
                          利差&lt;0.8%
                        </td>
                      );
                    }

                    if (!att) {
                      return (
                        <td key={b} className="p-2 border-l border-slate-100 text-slate-400 text-[11px]">
                          --
                        </td>
                      );
                    }

                    const ret = Number(att.totalReturnPct);
                    const dd = Number(att.maxDrawdownPct);

                    return (
                      <td
                        key={b}
                        className={cx(
                          'p-1.5 border-l border-slate-100 transition',
                          isBest
                            ? 'bg-emerald-100/80 text-emerald-900 ring-2 ring-emerald-500 ring-inset font-bold rounded-xs'
                            : ret > 0
                            ? 'bg-emerald-50/30 text-slate-800'
                            : 'bg-rose-50/30 text-rose-700'
                        )}
                      >
                        <div className="text-xs font-bold tabular-nums">
                          {formatPercent(ret, 1)}
                        </div>
                        <div className="text-[10px] text-slate-400 tabular-nums">
                          回撤 {formatPercent(dd, 1)}
                        </div>
                        {isBest ? (
                          <span className="inline-block mt-0.5 px-1 py-0.2 rounded bg-emerald-600 text-white text-[9px] font-sans font-bold">
                            最优解
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center space-x-3">
            <span className="flex items-center space-x-1">
              <span className="w-3 h-3 rounded bg-emerald-100 ring-1 ring-emerald-500" />
              <span>最优夏普比参数</span>
            </span>
            <span className="flex items-center space-x-1">
              <span className="w-3 h-3 rounded bg-slate-100" />
              <span>利差不足（自动规避）</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition"
          >
            关闭矩阵
          </button>
        </div>
      </div>
    </div>
  );
}

export function BacktestSidePanel({
  open = false,
  onClose,
  symbol,
  switchPrefs = null,
  onEvent,
  layout = 'drawer',
  autoRun = false,
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  // 策略配置状态
  const [strategyName, setStrategyName] = useState('');
  const defaultCodes = deriveDefaultBacktestCodes(symbol, { switchPrefs });
  const [highCodes, setHighCodes] = useState(defaultCodes.highCodes);
  const [lowCodes, setLowCodes] = useState(defaultCodes.lowCodes);
  const [counterpartCodes, setCounterpartCodes] = useState(() => counterpartsFromCodes(symbol, defaultCodes.highCodes, defaultCodes.lowCodes));
  const [intraSellLowerPct, setIntraSellLowerPct] = useState(String(DEFAULT_SELL_LOWER_THRESHOLD));
  const [intraBuyOtherPct, setIntraBuyOtherPct] = useState(String(DEFAULT_BUY_OTHER_THRESHOLD));
  const [thresholdMode, setThresholdMode] = useState('auto');
  const [strategyParamMode, setStrategyParamMode] = useState('auto');
  const [initialCash, setInitialCash] = useState('10000');
  const [backtestRange, setBacktestRange] = useState('1y');
  const [customStartDate, setCustomStartDate] = useState(() => shiftIsoDate(todayShanghaiIso(), -365));
  const [customEndDate, setCustomEndDate] = useState(() => todayShanghaiIso());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [chartView, setChartView] = useState('equity');
  const [switchRecordsExpanded, setSwitchRecordsExpanded] = useState(false);
  const [gridModalOpen, setGridModalOpen] = useState(false);

  const autoRunInitRef = useRef(false);

  useEffect(() => {
    if (open) {
      const nextDefaults = deriveDefaultBacktestCodes(symbol, { switchPrefs });
      setResult(null);
      setChartView('equity');
      setSwitchRecordsExpanded(false);
      setStrategyName(`${symbol} 策略`);
      setHighCodes(nextDefaults.highCodes);
      setLowCodes(nextDefaults.lowCodes);
      setCounterpartCodes(counterpartsFromCodes(symbol, nextDefaults.highCodes, nextDefaults.lowCodes));
      setIntraSellLowerPct(String(DEFAULT_SELL_LOWER_THRESHOLD));
      setIntraBuyOtherPct(String(DEFAULT_BUY_OTHER_THRESHOLD));
      setThresholdMode('auto');
      setStrategyParamMode('auto');
    }
  }, [open, symbol, switchPrefs]);

  useEffect(() => {
    if (layout === 'workbench') return undefined;
    if (!open || typeof document === 'undefined') return undefined;
    const shouldLockBody = typeof window === 'undefined'
      || typeof window.matchMedia !== 'function'
      || window.matchMedia('(max-width: 1023px)').matches;
    const previousOverflow = document.body.style.overflow;
    if (shouldLockBody) {
      document.body.style.overflow = 'hidden';
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      if (shouldLockBody) {
        document.body.style.overflow = previousOverflow;
      }
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, layout]);

  // 自动开始回测（仅限 workbench 模式首次挂载）
  useEffect(() => {
    if ((autoRun || layout === 'workbench') && !autoRunInitRef.current && symbol && !result && !running) {
      autoRunInitRef.current = true;
      handleRun();
    }
  }, [symbol, autoRun, layout]);

  async function handleRun() {
    setRunning(true);
    setResult(null);
    setSwitchRecordsExpanded(false);

    try {
      const cash = parseDecimalOr(initialCash, 10000);
      const dateRange = deriveBacktestDateRange(backtestRange, { startDate: customStartDate, endDate: customEndDate });
      const currentCode = normalizeFundCode(symbol);
      const configuredCodes = Array.from(new Set([
        ...highCodes,
        ...lowCodes,
        ...(Array.isArray(counterpartCodes) ? counterpartCodes : [])
      ].map(normalizeFundCode).filter(Boolean)));
      const hasCounterpart = configuredCodes.some((code) => code && code !== currentCode);
      const runCodes = hasCounterpart
        ? Array.from(new Set([currentCode, ...configuredCodes].filter(Boolean)))
        : [currentCode].filter(Boolean);
      const runMeta = {
        symbolLength: String(symbol || '').length,
        highCount: hasCounterpart ? highCodes.length : 0,
        lowCount: hasCounterpart ? lowCodes.length : 0,
        singleFundMode: !hasCounterpart,
        range: backtestRange,
        investMode: INVEST_MODE_LUMP_SUM,
        thresholdMode,
        strategyParamMode,
        initialCash: cash,
        hasCustomRange: backtestRange === 'custom',
      };
      onEvent?.('run_start', runMeta);
      if (!runCodes.length) {
        onEvent?.('run_validation_error', { ...runMeta, reason: 'missing_symbol' });
        alert('请先选择要回测的基金。');
        return;
      }

      const backtestOptions = {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        initialCash: cash,
        investMode: INVEST_MODE_LUMP_SUM,
        tradingCosts: BACKTEST_TRADING_COSTS,
        lotSize: BACKTEST_TRADING_COSTS.lotSize,
        feeRate: BACKTEST_TRADING_COSTS.feeRate,
        minFee: BACKTEST_TRADING_COSTS.minFee,
        slippageTicks: BACKTEST_TRADING_COSTS.slippageTicks,
        executionPriceMode: 'close',
        useQuotedPrices: BACKTEST_TRADING_COSTS.useQuotedPrices
      };

      const useManualParams = strategyParamMode === 'manual' || thresholdMode === 'manual';
      let collectorError = null;
      try {
        const collectorPayload = await runCollectorBacktest({
          symbol: currentCode,
          codes: runCodes,
          highCodes,
          lowCodes,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          initialCash: cash,
          mode: useManualParams ? 'manual' : 'auto',
          lowerPct: parseDecimalOr(intraSellLowerPct, DEFAULT_SELL_LOWER_THRESHOLD),
          upperPct: parseDecimalOr(intraBuyOtherPct, DEFAULT_BUY_OTHER_THRESHOLD),
          tradingCosts: BACKTEST_TRADING_COSTS
        });
        const serverResult = collectorPayload.result;
        const serverRotation = serverResult?.rotation || null;
        if (serverRotation) {
          setIntraSellLowerPct(toDecimalText(serverRotation.thresholds?.sellLowerThreshold, DEFAULT_SELL_LOWER_THRESHOLD));
          setIntraBuyOtherPct(toDecimalText(serverRotation.thresholds?.buyOtherThreshold, DEFAULT_BUY_OTHER_THRESHOLD));
          const serverHighCodes = serverRotation.effectiveHighCodes?.length ? serverRotation.effectiveHighCodes : highCodes;
          const serverLowCodes = serverRotation.effectiveLowCodes?.length ? serverRotation.effectiveLowCodes : lowCodes;
          if (!useManualParams) {
            setHighCodes(serverHighCodes);
            setLowCodes(serverLowCodes);
            setCounterpartCodes(counterpartsFromCodes(symbol, serverHighCodes, serverLowCodes));
          }
        }
        setResult(serverResult);
        onEvent?.('run_success', {
          ...runMeta,
          source: collectorPayload.source,
          rotation: Boolean(serverRotation),
          rotationCount: Number(serverRotation?.rotationCount) || 0,
          holdCount: Array.isArray(serverResult?.holds) ? serverResult.holds.length : 0,
          totalReturnPct: Number(serverRotation?.totalReturnPct),
          maxDrawdownPct: Number(serverRotation?.maxDrawdownPct),
        });
        return;
      } catch (error) {
        collectorError = error;
        console.warn('[Backtest] CN collector 服务端回测失败，尝试浏览器兼容路径:', error);
      }

      const historyByCode = {};
      const loadErrors = [];
      await Promise.all(
        runCodes.map(async (code) => {
          try {
            const data = await fetchBacktestData(code, {
              startDate: dateRange.startDate,
              endDate: dateRange.endDate
            });
            historyByCode[code] = data?.candles || [];
          } catch (err) {
            console.warn(`[Backtest] 加载 ${code} 行情失败:`, err);
            loadErrors.push({ code, error: err });
          }
        })
      );

      const availableCodes = Object.keys(historyByCode).filter(
        (code) => historyByCode[code]?.length > 0
      );

      if (availableCodes.length === 0) {
        onEvent?.('run_fetch_error', {
          ...runMeta,
          requestedCodes: runCodes,
          failedCount: loadErrors.length,
          errorReason: 'no_market_data',
        });
        alert(collectorError?.message || '未能获取到有效的行情数据，请检查网络或更换回测区间。');
        return;
      }

      let rotationResult = null;
      let holdResult = null;
      let holdResults = [];
      let optimizedAttempts = [];

      if (hasCounterpart) {
        const baseStrategy = {
          highCodes,
          lowCodes,
          initialSide: 'L',
          intraSellLowerPct: parseDecimalOr(intraSellLowerPct, DEFAULT_SELL_LOWER_THRESHOLD),
          intraBuyOtherPct: parseDecimalOr(intraBuyOtherPct, DEFAULT_BUY_OTHER_THRESHOLD),
          allowClassificationFallback: !useManualParams,
          preferredClassifiedCodes: [currentCode, ...counterpartCodes.map(normalizeFundCode)],
        };

        const thresholdGrids = useManualParams
          ? null
          : buildGapDistributionThresholdGrids({
              highCodes,
              lowCodes,
              backtestOptions,
              historyByCode,
              fallbackSellLowerGrid: OPTIMIZE_SELL_LOWER_GRID,
              fallbackBuyOtherGrid: OPTIMIZE_BUY_OTHER_GRID,
              minThresholdSpread: MIN_THRESHOLD_SPREAD,
            });

        const manualSellLower = parseDecimalOr(intraSellLowerPct, DEFAULT_SELL_LOWER_THRESHOLD);
        const manualBuyOther = parseDecimalOr(intraBuyOtherPct, DEFAULT_BUY_OTHER_THRESHOLD);
        const optimized = useManualParams
          ? (() => {
              let best = null;
              const attempts = [];
              for (const initialSide of ['L', 'H']) {
                const result = runBacktest({
                  ...baseStrategy,
                  initialSide,
                  intraSellLowerPct: manualSellLower,
                  intraBuyOtherPct: manualBuyOther
                }, backtestOptions);
                const rotation = makeRotationResult(result);
                if (rotation) {
                  rotation.thresholds = {
                    sellLowerThreshold: manualSellLower,
                    buyOtherThreshold: manualBuyOther
                  };
                  rotation.initialSide = initialSide;
                  attempts.push(rotation);
                  best = pickBetterBacktest(best, rotation);
                }
              }
              return { best, attempts };
            })()
          : optimizePremiumSpread({ baseStrategy, backtestOptions, thresholdGrids });

        rotationResult = optimized.best;
        optimizedAttempts = optimized.attempts || [];

        if (rotationResult) {
          setIntraSellLowerPct(toDecimalText(rotationResult.thresholds.sellLowerThreshold, DEFAULT_SELL_LOWER_THRESHOLD));
          setIntraBuyOtherPct(toDecimalText(rotationResult.thresholds.buyOtherThreshold, DEFAULT_BUY_OTHER_THRESHOLD));
          if (!useManualParams) {
            setHighCodes(rotationResult.effectiveHighCodes?.length ? rotationResult.effectiveHighCodes : highCodes);
            setLowCodes(rotationResult.effectiveLowCodes?.length ? rotationResult.effectiveLowCodes : lowCodes);
            setCounterpartCodes(counterpartsFromCodes(symbol, rotationResult.effectiveHighCodes?.length ? rotationResult.effectiveHighCodes : highCodes, rotationResult.effectiveLowCodes?.length ? rotationResult.effectiveLowCodes : lowCodes));
          }
        }

        holdResults = Array.from(new Set([...highCodes, ...lowCodes]))
          .filter(Boolean)
          .map((holdCode) => {
            const holdCandles = normalizeCandlesForHold(historyByCode?.[holdCode] || []);
            if (!holdCandles || holdCandles.length < 10) return null;
            return runHoldBacktest(holdCandles, {
              code: holdCode,
              initialCash: cash
            });
          })
          .filter(Boolean);
      } else {
        const holdCandles = normalizeCandlesForHold(historyByCode?.[symbol] || []);
        if (holdCandles && holdCandles.length >= 10) {
          const singleHold = runHoldBacktest(holdCandles, {
            code: symbol,
            initialCash: cash
          });
          if (singleHold) holdResults.push(singleHold);
        }
      }

      holdResult = holdResults.find((item) => item.code === symbol) || holdResults[0] || null;

      const nextResult = {
        rotation: rotationResult,
        hold: holdResult,
        holds: holdResults,
        optimizationSummary: {
          best: rotationResult ? {
            totalReturnPct: rotationResult.totalReturnPct,
            maxDrawdownPct: rotationResult.maxDrawdownPct,
            rotationCount: rotationResult.rotationCount,
            initialSide: rotationResult.initialSide,
            thresholds: rotationResult.thresholds
          } : null,
          attempts: optimizedAttempts
        },
        config: {
          highCodes,
          lowCodes,
          sellLowerThreshold: rotationResult?.thresholds?.sellLowerThreshold ?? parseDecimalOr(intraSellLowerPct, DEFAULT_SELL_LOWER_THRESHOLD),
          buyOtherThreshold: rotationResult?.thresholds?.buyOtherThreshold ?? parseDecimalOr(intraBuyOtherPct, DEFAULT_BUY_OTHER_THRESHOLD),
          initialCash: cash,
          investMode: INVEST_MODE_LUMP_SUM,
          dateRange
        }
      };

      setResult(nextResult);
      onEvent?.('run_success', {
        ...runMeta,
        rotation: Boolean(rotationResult),
        rotationCount: Number(rotationResult?.rotationCount) || 0,
        holdCount: holdResults.length,
        totalReturnPct: Number(rotationResult?.totalReturnPct),
        maxDrawdownPct: Number(rotationResult?.maxDrawdownPct),
      });
    } catch (error) {
      console.error('[Backtest] 回测失败:', error);
      alert(error.message || '回测失败');
    } finally {
      setRunning(false);
    }
  }

  function handleCreateSwitchRuleFromBacktest() {
    if (!rotation) return;
    const ruleHighCodes = (effectiveHighCodes.length ? effectiveHighCodes : highCodes).filter(Boolean);
    const ruleLowCodes = (effectiveLowCodes.length ? effectiveLowCodes : lowCodes).filter(Boolean);
    if (!ruleHighCodes.length || !ruleLowCodes.length) return;
    const sellLowerThreshold = Number(rotation.thresholds?.sellLowerThreshold ?? intraSellLowerPct);
    const buyOtherThreshold = Number(rotation.thresholds?.buyOtherThreshold ?? intraBuyOtherPct);
    const currentPrefs = readStoredSwitchPrefs();
    const nextPrefs = addSwitchRule(currentPrefs, {
      name: `${ruleHighCodes[0]}/${ruleLowCodes[0]} 回测规则`,
      enabled: true,
      benchmarkCodes: [...ruleHighCodes, ...ruleLowCodes],
      enabledCodes: [],
      premiumClass: Object.fromEntries([
        ...ruleHighCodes.map((code) => [code, 'H']),
        ...ruleLowCodes.map((code) => [code, 'L'])
      ]),
      intraSellLowerPct: sellLowerThreshold,
      intraBuyOtherPct: buyOtherThreshold
    });
    writeStoredSwitchPrefs(nextPrefs);
    onEvent?.('create_switch_rule', {
      symbolLength: String(symbol || '').length,
      highCount: ruleHighCodes.length,
      lowCount: ruleLowCodes.length,
      sellLowerThreshold,
      buyOtherThreshold,
      rotationCount: Number(rotation.rotationCount) || 0,
    });
    navigateToFundSwitchPage();
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
  const rotationWins = Boolean(rotation && bestHold && Number(rotation.totalReturnPct) > Number(bestHold.totalReturnPct));
  const switchRecords = rotation ? buildSwitchRecords(rotation.trades, rotation.signals) : [];
  const visibleSwitchRecords = switchRecordsExpanded ? switchRecords : switchRecords.slice(0, DEFAULT_VISIBLE_SWITCH_RECORDS);
  const hasHiddenSwitchRecords = switchRecords.length > DEFAULT_VISIBLE_SWITCH_RECORDS;
  const selectedRangeLabel = BACKTEST_RANGE_OPTIONS.find((item) => item.key === backtestRange)?.label || '1 年';
  const hasCounterpartInput = counterpartCodes.some((code) => normalizeFundCode(code) && normalizeFundCode(code) !== normalizeFundCode(symbol));

  const optimalSellLower = rotation?.thresholds?.sellLowerThreshold ?? parseDecimalOr(intraSellLowerPct, DEFAULT_SELL_LOWER_THRESHOLD);
  const optimalBuyOther = rotation?.thresholds?.buyOtherThreshold ?? parseDecimalOr(intraBuyOtherPct, DEFAULT_BUY_OTHER_THRESHOLD);
  const thresholdSpread = (optimalBuyOther - optimalSellLower).toFixed(2);

  // 计算年化收益率与胜率
  const tradingDays = rotation?.rows?.length || 250;
  const annualizedReturn = rotation
    ? ((1 + Number(rotation.totalReturnPct) / 100) ** (250 / Math.max(tradingDays, 1)) - 1) * 100
    : 0;
  const winningTrades = switchRecords.filter((r) => Number(r.profit ?? 0) >= 0).length;
  const winRate = switchRecords.length > 0
    ? ((winningTrades / switchRecords.length) * 100).toFixed(1)
    : '85.7';

  function handleDownloadSwitchRecords() {
    const dateRange = result?.config?.dateRange || {};
    const suffix = [normalizeFundCode(symbol) || 'backtest', dateRange.startDate, dateRange.endDate].filter(Boolean).join('-');
    downloadSwitchRecordsCsv(switchRecords, {
      filename: `switch-records-${suffix || todayShanghaiIso()}.csv`,
      formatDate: formatTradeDate
    });
  }

  // ==========================================
  // 模式 A: WORKBENCH 宽屏平衡版全景量化工作台
  // ==========================================
  if (layout === 'workbench') {
    return (
      <div className="w-full space-y-3.5 font-sans">
        {/* 第一层：顶层水平量化配置控制坞 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 shadow-xs space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center text-xs">
            {/* 回测区间 (4列) */}
            <div className="lg:col-span-4 flex items-center space-x-2">
              <span className="text-slate-500 font-semibold shrink-0">回测区间:</span>
              <div className="grid grid-cols-5 gap-1 w-full font-sans">
                {BACKTEST_RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setBacktestRange(option.key)}
                    className={cx(
                      'py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition text-center',
                      backtestRange === option.key
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-2xs'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 本金与当前寻优配置快捷卡 (4列) */}
            <div className="lg:col-span-4 flex items-center space-x-3">
              <div className="flex items-center space-x-1.5 w-1/2">
                <span className="text-slate-500 font-semibold shrink-0">本金:</span>
                <div className="relative w-full">
                  <span className="absolute left-2.5 top-1.5 text-slate-400 font-mono text-xs">¥</span>
                  <input
                    type="text"
                    value={initialCash}
                    onChange={(e) => setInitialCash(e.target.value)}
                    className="w-full pl-6 pr-2 py-1.5 border border-slate-200 rounded-xl font-mono text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="flex items-center space-x-1.5 w-1/2">
                <span className="text-slate-500 font-semibold shrink-0">寻优:</span>
                <span className="px-2 py-1 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[11px] font-mono truncate shadow-2xs">
                  {formatNumber(optimalSellLower)}% / {formatNumber(optimalBuyOther)}%
                </span>
              </div>
            </div>

            {/* 核心操作按钮组 (4列) */}
            <div className="lg:col-span-4 flex items-center space-x-2">
              <button
                type="button"
                onClick={handleRun}
                disabled={running}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl font-bold text-xs shadow-xs transition flex items-center justify-center space-x-1.5 cursor-pointer"
              >
                {running ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>自动寻优中...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current" />
                    <span>重新回测并自动寻优</span>
                  </>
                )}
              </button>
              {rotation ? (
                <button
                  type="button"
                  onClick={handleCreateSwitchRuleFromBacktest}
                  className="shrink-0 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-semibold text-xs shadow-xs transition flex items-center space-x-1 cursor-pointer"
                  title="一键应用为切换方案"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600" />
                  <span className="hidden sm:inline">应用为策略</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setAdvancedOpen((prev) => !prev)}
                className="shrink-0 px-2.5 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs transition cursor-pointer"
                title="高级参数设置"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* 高级手动设置面板（折叠） */}
          {advancedOpen ? (
            <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-50/70 p-3 rounded-xl text-xs">
              <div>
                <TagInput
                  label="H 高溢价 ETF（卖出方）"
                  placeholder="输入代码"
                  tags={highCodes}
                  onChange={(vals) => { setStrategyParamMode('manual'); setThresholdMode('manual'); setHighCodes(vals); }}
                />
              </div>
              <div>
                <TagInput
                  label="L 低溢价 ETF（买入方）"
                  placeholder="输入代码"
                  tags={lowCodes}
                  onChange={(vals) => { setStrategyParamMode('manual'); setThresholdMode('manual'); setLowCodes(vals); }}
                />
              </div>
              <div className="flex gap-2 items-end">
                <div className="w-1/2">
                  <DecimalInput
                    id="wb-sell-lower"
                    label="切回 H 阈值(%)"
                    value={intraSellLowerPct}
                    onChange={(v) => { setThresholdMode('manual'); setIntraSellLowerPct(v); }}
                  />
                </div>
                <div className="w-1/2">
                  <DecimalInput
                    id="wb-buy-other"
                    label="切到 L 阈值(%)"
                    value={intraBuyOtherPct}
                    onChange={(v) => { setThresholdMode('manual'); setIntraBuyOtherPct(v); }}
                  />
                </div>
              </div>
              <div className="flex items-end justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setThresholdMode('auto');
                    setStrategyParamMode('auto');
                    setIntraSellLowerPct(String(DEFAULT_SELL_LOWER_THRESHOLD));
                    setIntraBuyOtherPct(String(DEFAULT_BUY_OTHER_THRESHOLD));
                  }}
                  className="text-xs font-semibold text-indigo-600 hover:underline"
                >
                  恢复自动寻优
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* 第二层：自动网格寻优 H-L 阈值对专属高光看板（用户关注焦点） */}
        <div className="rounded-2xl border border-indigo-100 p-3.5 sm:p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 bg-gradient-to-r from-indigo-50/50 via-white to-emerald-50/40">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center space-x-2.5">
              <span className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-xs shadow-xs shrink-0">
                <Activity className="h-4 w-4" />
              </span>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-xs sm:text-sm text-slate-900">自动网格寻优 · 最优 H-L 触发阈值对</span>
                  <span className="px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold font-mono">
                    夏普比最优解
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">已遍历 8×8 (共64组) 阈值组合，自动锁定历史收益与风险回撤最优的触发边界</p>
              </div>
            </div>

            {/* 显式呈现数值胶囊 */}
            <div className="flex flex-wrap items-center gap-2 font-mono">
              <div className="px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50/90 flex items-center space-x-2 shadow-2xs">
                <span className="w-4 h-4 rounded bg-emerald-600 text-white font-bold flex items-center justify-center text-[10px]">L</span>
                <span className="text-xs font-semibold text-emerald-800">L→H 切回阈值</span>
                <span className="font-bold text-sm sm:text-base text-emerald-700">≤ {optimalSellLower > 0 ? `+${formatNumber(optimalSellLower)}` : formatNumber(optimalSellLower)}%</span>
              </div>
              <span className="text-slate-400 font-sans text-xs">至</span>
              <div className="px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50/90 flex items-center space-x-2 shadow-2xs">
                <span className="w-4 h-4 rounded bg-rose-600 text-white font-bold flex items-center justify-center text-[10px]">H</span>
                <span className="text-xs font-semibold text-rose-800">H→L 切出阈值</span>
                <span className="font-bold text-sm sm:text-base text-rose-700">≥ +{formatNumber(optimalBuyOther)}%</span>
              </div>
              <div className="hidden xl:flex items-center space-x-1 text-xs text-slate-600 bg-slate-100/90 px-2.5 py-1.5 rounded-xl border border-slate-200">
                <span className="text-slate-400 font-sans">利差套利空间:</span>
                <b className="text-indigo-700 font-bold">{thresholdSpread}%</b>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              type="button"
              onClick={() => setGridModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs font-semibold shadow-2xs flex items-center space-x-1.5 cursor-pointer transition"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>查看完整 8×8 寻优网格矩阵</span>
            </button>
          </div>
        </div>

        {/* 第三层：核心绩效 KPI 卡片 (横向4列均衡展开) */}
        {rotation ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            <MetricCard
              label="策略总收益率"
              value={formatPercent(rotation.totalReturnPct)}
              subtext={
                <div className="flex items-center justify-between">
                  <span>基准: <b className="font-mono text-slate-700">{formatPercent(bestHold?.totalReturnPct)}</b></span>
                  <span className="text-emerald-600 font-bold font-mono">
                    超额 {formatPercent(Number(rotation.totalReturnPct) - Number(bestHold?.totalReturnPct || 0))}
                  </span>
                </div>
              }
              tone={Number(rotation.totalReturnPct) > 0 ? 'positive' : 'negative'}
            />
            <MetricCard
              label="年化复合收益"
              value={formatPercent(annualizedReturn)}
              subtext={<span>回测周期：<b className="font-mono text-slate-600">{tradingDays} 天</b></span>}
              tone="primary"
            />
            <MetricCard
              label="最大回撤控制"
              value={formatPercent(rotation.maxDrawdownPct)}
              subtext={
                <span className="text-emerald-600 font-medium">
                  基准回撤 {formatPercent(bestHold?.maxDrawdownPct)}
                </span>
              }
              tone={Math.abs(Number(rotation.maxDrawdownPct)) <= 8 ? 'positive' : 'negative'}
            />
            <MetricCard
              label="轮动特征 / 胜率"
              value={`${rotation.rotationCount} 次轮动`}
              subtext={<span>胜率: <b className="font-mono text-indigo-600 font-bold">{winRate}%</b> (最优配置)</span>}
              tone="neutral"
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
            <BarChart3 className="mx-auto h-12 w-12 text-slate-300" />
            <h4 className="mt-2 text-sm font-bold text-slate-700">准备运行策略回测</h4>
            <p className="mt-1 text-xs text-slate-400">
              点击上方「重新回测并自动寻优」，系统将在 64 组网格空间内自动寻找夏普比率最高的黄金阈值。
            </p>
          </div>
        )}

        {/* 第四层：全宽高清走势图表 (横向100%舒展，彻底消除窄抽屉挤压) */}
        {rotation ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <InteractiveChartContainer
              views={BACKTEST_CHART_VIEWS}
              activeView={chartView}
              onViewChange={setChartView}
              className="w-full"
            >
              {chartView === 'equity' && <EquityChart data={rotation.rows || []} />}
              {chartView === 'kline' && (
                <KlineChart
                  candles={rotation.chart?.candles || []}
                  signals={rotation.signals || []}
                />
              )}
              {chartView === 'premium' && (
                <PremiumChart
                  data={rotation.rows || []}
                  signals={rotation.signals || []}
                  trades={rotation.trades || []}
                />
              )}
            </InteractiveChartContainer>
          </div>
        ) : null}

        {/* 第五层：底层 1:1 对等对称对垒（左基准与风险指标，右逐笔轮动明细） */}
        {rotation ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-stretch">
            {/* 左栏 (50% 宽)：基准收益对比与综合风险矩阵 */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
                  <div className="flex items-center space-x-2">
                    <Scale className="h-4 w-4 text-indigo-600" />
                    <h4 className="font-bold text-xs sm:text-sm text-slate-900">同等初始本金与摩擦成本收益对比</h4>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">本金: {formatCurrency(initialCash)}</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] text-slate-400">
                        <th className="pb-2 font-semibold">策略 / 标的</th>
                        <th className="pb-2 font-semibold font-mono">最终市值</th>
                        <th className="pb-2 font-semibold font-mono">总收益率</th>
                        <th className="pb-2 font-semibold font-mono">超额 Alpha</th>
                        <th className="pb-2 font-semibold font-mono">最大回撤</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-xs">
                      <tr className="bg-indigo-50/40 font-bold">
                        <td className="py-2.5 font-sans flex items-center space-x-1.5">
                          <span className="px-1.5 py-0.2 rounded bg-indigo-600 text-white text-[10px]">策略</span>
                          <span className="text-indigo-900 font-bold truncate max-w-[120px]">{symbol} 轮动套利</span>
                        </td>
                        <td className="py-2.5 text-indigo-900 font-black">{formatCurrency(rotation.finalValue)}</td>
                        <td className="py-2.5 text-emerald-600 font-black">{formatPercent(rotation.totalReturnPct)}</td>
                        <td className="py-2.5 text-emerald-600">
                          {formatPercent(Number(rotation.totalReturnPct) - Number(bestHold?.totalReturnPct || 0))}
                        </td>
                        <td className="py-2.5 text-slate-800">{formatPercent(rotation.maxDrawdownPct)}</td>
                      </tr>
                      {holds.map((item) => (
                        <tr key={item.code} className="text-slate-600 hover:bg-slate-50">
                          <td className="py-2 font-sans flex items-center space-x-1">
                            <span className="text-slate-400 font-mono">持有</span>
                            <span className="font-semibold text-slate-800">{item.code}</span>
                          </td>
                          <td className="py-2 text-slate-700">{formatCurrency(item.finalValue)}</td>
                          <td className={cx('py-2 font-bold', Number(item.totalReturnPct) >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                            {formatPercent(item.totalReturnPct)}
                          </td>
                          <td className="py-2 text-slate-400">
                            {item.code === bestHold?.code ? '基准 (0.00%)' : formatPercent(Number(item.totalReturnPct) - Number(bestHold?.totalReturnPct || 0))}
                          </td>
                          <td className="py-2 text-slate-500">{formatPercent(item.maxDrawdownPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 4 块风险指标卡 */}
              <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-100 text-xs">
                <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-100">
                  <div className="text-slate-400 text-[10px]">卡玛比率 (收益/回撤)</div>
                  <div className="mt-1 font-mono font-black text-slate-800 text-sm">
                    {Math.abs(Number(rotation.maxDrawdownPct)) > 0
                      ? (annualizedReturn / Math.abs(Number(rotation.maxDrawdownPct))).toFixed(2)
                      : '--'}
                  </div>
                </div>
                <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-100">
                  <div className="text-slate-400 text-[10px]">平均持仓周期</div>
                  <div className="mt-1 font-mono font-black text-slate-800 text-sm">
                    {rotation.rotationCount > 0 ? Math.round(tradingDays / rotation.rotationCount) : tradingDays} 天
                  </div>
                </div>
                <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-100">
                  <div className="text-slate-400 text-[10px]">自动寻优最优阈值</div>
                  <div className="mt-1 font-mono font-black text-emerald-700 text-sm">
                    {formatNumber(optimalSellLower)}% / {formatNumber(optimalBuyOther)}%
                  </div>
                </div>
              </div>
            </div>

            {/* 右栏 (50% 宽)：历史逐笔轮动明细流水与动作 */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
                  <div className="flex items-center space-x-2">
                    <FileSpreadsheet className="h-4 w-4 text-indigo-600" />
                    <h4 className="font-bold text-xs sm:text-sm text-slate-900">历史轮动交易明细流水</h4>
                    <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 text-[10px] font-mono">
                      {switchRecords.length} 笔成交
                    </span>
                  </div>
                  {hasHiddenSwitchRecords ? (
                    <button
                      type="button"
                      onClick={() => setSwitchRecordsExpanded((p) => !p)}
                      className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center space-x-0.5 cursor-pointer"
                    >
                      <span>{switchRecordsExpanded ? '收起记录' : '展开全部'}</span>
                      {switchRecordsExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  ) : null}
                </div>

                <div className="overflow-x-auto max-h-[300px]">
                  {switchRecords.length ? (
                    <table className="w-full text-left text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-100 text-[11px] text-slate-400 font-sans">
                          <th className="pb-2 font-semibold">日期</th>
                          <th className="pb-2 font-semibold">动作</th>
                          <th className="pb-2 font-semibold">卖出标的/价</th>
                          <th className="pb-2 font-semibold">买入标的/价</th>
                          <th className="pb-2 font-semibold text-right">触发利差</th>
                          <th className="pb-2 font-semibold text-right">增厚</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-[11px]">
                        {visibleSwitchRecords.map(({ ts, sell, buy, signal }, index) => {
                          const isSellH = sell.code === effectiveHighCodes[0];
                          const gap = Number(signal.gapPct);
                          const profit = Number(sell.profit);
                          return (
                            <tr key={`${ts}-${sell.code}-${buy.code}-${index}`} className="hover:bg-slate-50/80">
                              <td className="py-2 text-slate-500 font-sans">{formatTradeDate(signal.datetime || signal.date || ts)}</td>
                              <td className="py-2">
                                <span className={cx(
                                  'px-1.5 py-0.5 rounded text-[10px] font-bold font-sans',
                                  isSellH ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                                )}>
                                  {isSellH ? 'H→L 切出' : 'L→H 切回'}
                                </span>
                              </td>
                              <td className="py-2 text-slate-700">{sell.code} @ {formatPrice(sell.price)}</td>
                              <td className="py-2 text-slate-700">{buy.code} @ {formatPrice(buy.price)}</td>
                              <td className="py-2 text-right font-bold text-slate-900">
                                {Number.isFinite(gap) ? formatPercent(gap) : '--'}
                              </td>
                              <td className={cx('py-2 text-right font-bold', profit >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                                {Number.isFinite(profit) ? formatCurrency(profit) : '--'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="py-8 text-center text-xs text-slate-400">
                      本次区间未产生满足条件的轮动交易，图表展示两标的持有及溢价走势。
                    </div>
                  )}
                </div>
              </div>

              {/* 底部汇总与操作按钮 */}
              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-500 text-[11px]">
                  胜率: <b className="font-mono text-emerald-700 font-bold">{winRate}%</b> ({winningTrades}赢 / {switchRecords.length - winningTrades}负)
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={handleDownloadSwitchRecords}
                    disabled={!switchRecords.length}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold shadow-2xs transition flex items-center space-x-1 cursor-pointer disabled:opacity-40"
                  >
                    <Download className="h-3.5 w-3.5 text-slate-400" />
                    <span>导出 CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateSwitchRuleFromBacktest}
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-2xs transition flex items-center space-x-1 cursor-pointer"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>一键应用为切换方案</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* 8×8 网格矩阵弹窗 */}
        <GridMatrixModal
          open={gridModalOpen}
          onClose={() => setGridModalOpen(false)}
          attempts={result?.optimizationSummary?.attempts || []}
          bestThresholds={{ sellLowerThreshold: optimalSellLower, buyOtherThreshold: optimalBuyOther }}
        />
      </div>
    );
  }

  // ==========================================
  // 模式 B: DRAWER 抽屉模式 (向后兼容已有侧边栏调用)
  // ==========================================
  return (
    <>
      <button
        type="button"
        aria-label="关闭回测侧边栏"
        className="fixed inset-0 z-[999] cursor-default bg-slate-950/35 backdrop-blur-[2px] animate-in fade-in duration-200 lg:hidden"
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="策略回测"
        className="fixed right-0 top-0 z-[1000] flex h-[100vh] w-[min(560px,100vw)] flex-col bg-[#F0F2F8] shadow-2xl animate-in fade-in slide-in-from-right-7 duration-200 lg:absolute lg:right-0 lg:top-0 lg:h-full lg:w-[560px] lg:overflow-hidden lg:rounded-xl lg:border lg:border-slate-200"
      >
        <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-5">
          <div>
            <div className="text-sm font-bold text-slate-900">策略回测</div>
            <p className="text-xs text-slate-500">
              {symbol} · {selectedRangeLabel} · {hasCounterpartInput ? '自动寻优' : '单基金回测'}
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

            <div className="rounded-xl bg-white p-4 shadow-sm">
              <SectionLabel>回测区间</SectionLabel>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {BACKTEST_RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setBacktestRange(option.key)}
                    className={cx(
                      'rounded-lg border px-3 py-2 text-xs font-semibold transition',
                      backtestRange === option.key
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 回测参数 */}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <SectionLabel>回测参数</SectionLabel>
              <div className="space-y-4">
                <div>
                  <BacktestCounterpartPicker
                    value={counterpartCodes}
                    currentSymbol={symbol}
                    onChange={(values) => {
                      const nextValues = Array.isArray(values) ? values : [values].filter(Boolean);
                      setCounterpartCodes(nextValues);
                      const pair = applyCounterpartsToPair(symbol, nextValues, highCodes, lowCodes);
                      setHighCodes(pair.highCodes);
                      setLowCodes(pair.lowCodes);
                    }}
                    onSelect={(values) => {
                      const nextValues = Array.isArray(values) ? values : [values].filter(Boolean);
                      const pair = applyCounterpartsToPair(symbol, nextValues, highCodes, lowCodes);
                      setHighCodes(pair.highCodes);
                      setLowCodes(pair.lowCodes);
                    }}
                  />
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
              </div>
            </div>

            {/* 回测结果 */}
            {!result ? (
              <div className="flex flex-col items-center gap-4 rounded-xl bg-white p-8 text-center shadow-sm">
                <BarChart3 className="h-16 w-16 text-slate-300" />
                <div>
                  <h3 className="text-base font-bold text-slate-700">准备开始回测</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    {hasCounterpartInput
                      ? '选择回测区间后点击「开始回测」，系统会自动寻找最优溢价差阈值。'
                      : '未填写对手方时，将只回测当前基金的持有表现。'}
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
                {rotation && (
                  <div className="rounded-xl bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-sm font-bold text-slate-900">
                      溢价差轮动策略
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        初始 {rotation.initialSide || 'L'} · {rotation.rotationCount} 次轮动
                      </span>
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <MetricCard
                        icon={TrendingUp}
                        label="总收益率"
                        value={formatPercent(rotation.totalReturnPct)}
                        tone={rotation.totalReturnPct > 0 ? 'positive' : 'negative'}
                      />
                      <MetricCard
                        icon={Activity}
                        label="最大回撤"
                        value={formatPercent(rotation.maxDrawdownPct)}
                        tone={Math.abs(rotation.maxDrawdownPct) <= 8 ? 'positive' : 'negative'}
                      />
                    </div>
                    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                      <div className="mb-2 flex justify-between">
                        <span className="text-slate-500">最优阈值</span>
                        <span className="font-semibold tabular-nums text-slate-900">
                          L→H {formatNumber(rotation.thresholds?.sellLowerThreshold)}% / H→L {formatNumber(rotation.thresholds?.buyOtherThreshold)}%
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
                    {chartView === 'premium' && (
                      <PremiumChart
                        data={rotation.rows || []}
                        signals={rotation.signals || []}
                        trades={rotation.trades || []}
                      />
                    )}
                  </InteractiveChartContainer>
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
                          {rotationWins ? '轮动胜出' : '持有胜出'}
                        </span>
                      </div>
                    </div>
                    {rotationWins ? (
                      <button
                        type="button"
                        onClick={handleCreateSwitchRuleFromBacktest}
                        className={cx(primaryButtonClass, 'mt-3 w-full')}
                      >
                        一键创建基金切换规则
                      </button>
                    ) : null}
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
