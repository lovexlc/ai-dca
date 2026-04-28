import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownUp, Info, RefreshCw, Repeat } from 'lucide-react';
import { Card, Pill, SectionHeading, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';
import { readLedgerState } from '../app/holdingsLedger.js';
import { aggregateByCode } from '../app/holdingsLedgerCore.js';
import {
  findLatestNasdaqPrice,
  loadLatestNasdaqPrices,
  loadNasdaqDailySeries,
  loadNasdaqMinuteSnapshot
} from '../app/nasdaqPrices.js';

// 场内 / 场外纳指 100 切换套利策略实时建议器。
//
// 真实溢价数据来源（每个交易日 15:30 由 GitHub Action 拉取后入库）：
// - data/nas-daq100/daily-sina.json + intraday-1m.json：NDX 美元日 K + 分钟线
// - data/<code>/daily-sina.json：各场内 ETF 日 K
//
// 真实溢价计算（无 IOPV 时的近似锚定法）：
// 1) 取最近 N 个共同交易日的 ETF_close / NDX_close，求中位数 r0；
// 2) 实时溢价 % = (ETF当前价 / NDX当前价) / r0 - 1。
// 假设：长期溢价均值≈0（中位数法稳健于均值），ETF 与 NDX 单位规模与汇率因子被 r0 吸收。
//
// 持仓的 latestNav：A 股开盘时由 notify worker 实时推送 push2 行情；收盘后回落到 daily-sina 最后一根收盘价。
//
// 持久化：
// - aiDcaSwitchStrategyPrefs：基准 ETF、候选基金、阈值、手动溢价覆盖。
// - aiDcaSwitchStrategyLedger：套利轮次人工日志。

const BENCHMARK_INDEX_CODE = 'nas-daq100';
const PREMIUM_LOOKBACK_DAYS = 30;
const SWITCH_PREFS_KEY = 'aiDcaSwitchStrategyPrefs';
const SWITCH_LEDGER_KEY = 'aiDcaSwitchStrategyLedger';

const DEFAULT_PREFS = {
  benchmarkCode: '513100',
  enabledCodes: [],
  arbTargetPct: 2,
  intraSellLowerPct: 1,
  intraBuyOtherPct: 3,
  otcPremiumThresholdPct: 8,
  otcMinIntraPremiumLow: 1,
  otcMinIntraPremiumHigh: 2,
  manualBenchmarkPremiumPct: '',
  manualMinIntraPremiumPct: ''
};

function readPrefs() {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage?.getItem(SWITCH_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      enabledCodes: Array.isArray(parsed?.enabledCodes) ? parsed.enabledCodes : []
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(prefs) {
  if (typeof window === 'undefined') return;
  try { window.localStorage?.setItem(SWITCH_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function readSwitchLedger() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage?.getItem(SWITCH_LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeSwitchLedger(rows) {
  if (typeof window === 'undefined') return;
  try { window.localStorage?.setItem(SWITCH_LEDGER_KEY, JSON.stringify(rows)); } catch {}
}

function formatPercent(value, digits = 2, withSign = false) {
  if (!Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  const fixed = v.toFixed(digits);
  if (withSign && v > 0) return `+${fixed}%`;
  return `${fixed}%`;
}

function formatPrice(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return '—';
  return v.toFixed(4);
}

function formatDate(value) {
  return value ? String(value) : '—';
}

function nowIso() {
  return new Date().toISOString();
}

function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 用最近 lookback 个共同交易日的 ETF/NDX 收盘价比例中位数作为锚定比 r0。
function computeAnchorRatio(etfBars = [], ndxByDate, lookbackDays = PREMIUM_LOOKBACK_DAYS) {
  if (!Array.isArray(etfBars) || !etfBars.length || !ndxByDate || ndxByDate.size === 0) return null;
  const ratios = [];
  for (let i = etfBars.length - 1; i >= 0 && ratios.length < lookbackDays; i -= 1) {
    const bar = etfBars[i];
    const date = bar?.date;
    const etfClose = Number(bar?.close);
    if (!date || !Number.isFinite(etfClose) || etfClose <= 0) continue;
    const ndxClose = ndxByDate.get(date);
    if (Number.isFinite(ndxClose) && ndxClose > 0) {
      ratios.push(etfClose / ndxClose);
    }
  }
  return median(ratios);
}

function lastBarClose(bars) {
  if (!Array.isArray(bars)) return null;
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const v = Number(bars[i]?.close);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

function lastBarDate(bars) {
  if (!Array.isArray(bars)) return '';
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const d = bars[i]?.date || bars[i]?.datetime;
    if (d) return String(d);
  }
  return '';
}

export function SwitchStrategyExperience({ links, inPagesDir = false, embedded = false } = {}) {
  const [prefs, setPrefs] = useState(readPrefs);
  const [switchLedger, setSwitchLedger] = useState(readSwitchLedger);
  const [aggregates, setAggregates] = useState([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const [marketState, setMarketState] = useState({
    loading: true,
    error: '',
    ndxPrice: null,
    ndxAt: '',
    ratioByCode: {},
    generatedAt: ''
  });

  useEffect(() => { writePrefs(prefs); }, [prefs]);
  useEffect(() => { writeSwitchLedger(switchLedger); }, [switchLedger]);

  // 持仓 ledger
  useEffect(() => {
    try {
      const state = readLedgerState();
      const aggs = aggregateByCode(state.transactions || [], state.snapshotsByCode || {});
      setAggregates(Array.isArray(aggs) ? aggs : []);
    } catch {
      setAggregates([]);
    }
  }, [refreshTick]);

  const exchangeFunds = useMemo(
    () => aggregates.filter((a) => a.kind === 'exchange' && a.hasPosition),
    [aggregates]
  );
  const otcFunds = useMemo(
    () => aggregates.filter((a) => (a.kind === 'qdii' || a.kind === 'otc') && a.hasPosition),
    [aggregates]
  );

  // 默认勾选所有持仓场内 ETF
  useEffect(() => {
    if (!exchangeFunds.length) return;
    setPrefs((prev) => {
      if (Array.isArray(prev.enabledCodes) && prev.enabledCodes.length > 0) return prev;
      return { ...prev, enabledCodes: exchangeFunds.map((f) => f.code) };
    });
  }, [exchangeFunds.length]);

  // 加载真实溢价基础数据：NDX 当前价 + NDX 日 K + 各候选 ETF 日 K
  const loadMarket = useCallback(async () => {
    setMarketState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const codes = exchangeFunds.map((f) => f.code);
      if (!codes.length) {
        setMarketState({
          loading: false,
          error: '',
          ndxPrice: null,
          ndxAt: '',
          ratioByCode: {},
          generatedAt: nowIso()
        });
        return;
      }

      // 先拿 manifest 与 NDX 日 K + 分钟线
      const [manifest, ndxDailyPayload, ndxMinutePayload] = await Promise.all([
        loadLatestNasdaqPrices({ inPagesDir }).catch(() => []),
        loadNasdaqDailySeries(BENCHMARK_INDEX_CODE, { inPagesDir }).catch(() => null),
        loadNasdaqMinuteSnapshot(`data/${BENCHMARK_INDEX_CODE}/intraday-1m.json`, { inPagesDir }).catch(() => null)
      ]);

      const benchmarkEntry = findLatestNasdaqPrice(manifest, BENCHMARK_INDEX_CODE);
      const ndxBars = Array.isArray(ndxDailyPayload?.bars) ? ndxDailyPayload.bars : [];
      const ndxMinuteBars = Array.isArray(ndxMinutePayload?.bars) ? ndxMinutePayload.bars : [];

      // 当前价优先级：分钟线最后一根 → manifest current_price → 日 K 最后一根
      const ndxFromMinute = lastBarClose(ndxMinuteBars);
      const ndxFromManifest = Number(benchmarkEntry?.current_price);
      const ndxFromDaily = lastBarClose(ndxBars);
      const ndxPrice = Number.isFinite(ndxFromMinute) && ndxFromMinute > 0
        ? ndxFromMinute
        : (Number.isFinite(ndxFromManifest) && ndxFromManifest > 0
            ? ndxFromManifest
            : (Number.isFinite(ndxFromDaily) && ndxFromDaily > 0 ? ndxFromDaily : null));

      const ndxAt = lastBarDate(ndxMinuteBars) || benchmarkEntry?.datetime || lastBarDate(ndxBars) || '';

      if (!ndxPrice) {
        throw new Error('未拿到 NASDAQ 100 当前价（data/nas-daq100/...）');
      }

      const ndxByDate = new Map();
      ndxBars.forEach((bar) => {
        const close = Number(bar?.close);
        if (bar?.date && Number.isFinite(close) && close > 0) {
          ndxByDate.set(bar.date, close);
        }
      });

      // 各候选 ETF 的日 K
      const dailyResults = await Promise.all(
        codes.map((code) =>
          loadNasdaqDailySeries(code, { inPagesDir })
            .then((payload) => ({ code, bars: Array.isArray(payload?.bars) ? payload.bars : [] }))
            .catch(() => ({ code, bars: [] }))
        )
      );

      const ratioByCode = {};
      dailyResults.forEach(({ code, bars }) => {
        const r0 = computeAnchorRatio(bars, ndxByDate, PREMIUM_LOOKBACK_DAYS);
        if (Number.isFinite(r0) && r0 > 0) {
          ratioByCode[code] = r0;
        }
      });

      setMarketState({
        loading: false,
        error: '',
        ndxPrice,
        ndxAt,
        ratioByCode,
        generatedAt: nowIso()
      });
    } catch (error) {
      setMarketState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : '真实溢价数据加载失败'
      }));
    }
  }, [exchangeFunds, inPagesDir]);

  useEffect(() => { loadMarket(); }, [loadMarket, refreshTick]);

  // 把真实溢价合并到 fund 上
  const fundsWithPremium = useMemo(() => {
    const ndxPrice = Number(marketState.ndxPrice);
    return exchangeFunds.map((fund) => {
      const r0 = Number(marketState.ratioByCode?.[fund.code]);
      const px = Number(fund.latestNav);
      let premiumPct = null;
      if (Number.isFinite(ndxPrice) && ndxPrice > 0 && Number.isFinite(r0) && r0 > 0 && Number.isFinite(px) && px > 0) {
        premiumPct = ((px / ndxPrice) / r0 - 1) * 100;
      }
      return {
        ...fund,
        anchorRatio: Number.isFinite(r0) && r0 > 0 ? r0 : null,
        premiumPct
      };
    });
  }, [exchangeFunds, marketState.ndxPrice, marketState.ratioByCode]);

  const enabledFunds = useMemo(() => {
    const set = new Set(prefs.enabledCodes || []);
    return fundsWithPremium.filter((f) => set.has(f.code));
  }, [fundsWithPremium, prefs.enabledCodes]);

  const benchmark = useMemo(
    () => fundsWithPremium.find((f) => f.code === prefs.benchmarkCode)
      || enabledFunds[0]
      || fundsWithPremium[0]
      || null,
    [fundsWithPremium, enabledFunds, prefs.benchmarkCode]
  );

  function toggleEnabled(code) {
    setPrefs((prev) => {
      const set = new Set(prev.enabledCodes || []);
      if (set.has(code)) set.delete(code); else set.add(code);
      return { ...prev, enabledCodes: Array.from(set) };
    });
  }
  function setBenchmarkCode(code) {
    setPrefs((prev) => ({ ...prev, benchmarkCode: code }));
  }
  function setPrefValue(key, value) {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }

  // 场内信号：用真实溢价差判定
  const intraSignals = useMemo(() => {
    if (!benchmark || !Number.isFinite(benchmark.premiumPct)) return [];
    const sellLower = Number(prefs.intraSellLowerPct || 0);
    const buyOther = Number(prefs.intraBuyOtherPct || 0);
    return enabledFunds
      .filter((f) => f.code !== benchmark.code && Number.isFinite(f.premiumPct))
      .map((f) => {
        // diff = 基准溢价 - 候选溢价；为正说明基准更贵
        const diff = benchmark.premiumPct - f.premiumPct;
        return {
          code: f.code,
          name: f.name || f.code,
          latestNav: f.latestNav,
          latestNavDate: f.latestNavDate,
          premiumPct: f.premiumPct,
          diffVsBench: diff,
          // 规则 A：基准价 − 持有价 ≤ X% → 卖持有买基准（基准便宜了）
          sellHoldBuyBench: diff <= sellLower,
          // 规则 B：基准（持有） − 另一只 ≥ Y% → 卖基准买另一只（基准更贵）
          sellBenchBuyOther: diff >= buyOther
        };
      })
      .sort((a, b) => a.diffVsBench - b.diffVsBench);
  }, [enabledFunds, benchmark, prefs.intraSellLowerPct, prefs.intraBuyOtherPct]);

  // 自动取场外信号所需的两个数；允许手动覆盖
  const otcAutoBenchPrem = Number.isFinite(benchmark?.premiumPct) ? benchmark.premiumPct : null;
  const otcAutoMinIntraPrem = useMemo(() => {
    const list = enabledFunds
      .filter((f) => Number.isFinite(f.premiumPct))
      .map((f) => f.premiumPct);
    if (!list.length) return null;
    return Math.min.apply(null, list);
  }, [enabledFunds]);

  const otcSignal = useMemo(() => {
    const manualBench = prefs.manualBenchmarkPremiumPct === '' ? null : Number(prefs.manualBenchmarkPremiumPct);
    const manualMin = prefs.manualMinIntraPremiumPct === '' ? null : Number(prefs.manualMinIntraPremiumPct);

    const benchPrem = Number.isFinite(manualBench) ? manualBench : otcAutoBenchPrem;
    const minIntraPrem = Number.isFinite(manualMin) ? manualMin : otcAutoMinIntraPrem;
    const benchSource = Number.isFinite(manualBench) ? '手动' : '自动';
    const intraSource = Number.isFinite(manualMin) ? '手动' : '自动';

    if (!Number.isFinite(benchPrem) || !Number.isFinite(minIntraPrem)) {
      return {
        ready: false,
        message: marketState.loading
          ? '正在加载真实溢价数据…'
          : (marketState.error || '真实溢价数据未就绪。可在下方手动输入两个值。')
      };
    }

    const benchHigh = benchPrem > Number(prefs.otcPremiumThresholdPct || 0);
    const intraLowSoft = minIntraPrem < Number(prefs.otcMinIntraPremiumHigh || 0);
    const intraLowHard = minIntraPrem < Number(prefs.otcMinIntraPremiumLow || 0);
    const triggered = benchHigh && (intraLowSoft || intraLowHard);

    let level = '未触发';
    if (triggered && intraLowHard) level = '强信号';
    else if (triggered) level = '弱信号';

    return {
      ready: true,
      benchPrem,
      minIntraPrem,
      benchSource,
      intraSource,
      benchHigh,
      intraLowSoft,
      intraLowHard,
      triggered,
      level
    };
  }, [
    prefs.manualBenchmarkPremiumPct,
    prefs.manualMinIntraPremiumPct,
    prefs.otcPremiumThresholdPct,
    prefs.otcMinIntraPremiumLow,
    prefs.otcMinIntraPremiumHigh,
    otcAutoBenchPrem,
    otcAutoMinIntraPrem,
    marketState.loading,
    marketState.error
  ]);

  // 套利轮次记录
  function appendCycle() {
    const row = {
      id: `cycle-${Date.now()}`,
      createdAt: nowIso(),
      benchmarkCode: prefs.benchmarkCode,
      counterpartCode: '',
      enterPrice: '',
      exitPrice: '',
      shares: '',
      pnl: '',
      note: ''
    };
    setSwitchLedger((prev) => [row, ...prev]);
  }
  function patchCycle(id, key, value) {
    setSwitchLedger((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  }
  function removeCycle(id) {
    setSwitchLedger((prev) => prev.filter((row) => row.id !== id));
  }

  const benchmarkSummary = useMemo(() => {
    if (!exchangeFunds.length) {
      return '当前持仓中没有场内 ETF，先在持仓页录入交易再回来配置切换策略。';
    }
    if (!benchmark) return '请先选择一只基准 ETF。';
    const premLabel = Number.isFinite(benchmark.premiumPct)
      ? `溢价 ${formatPercent(benchmark.premiumPct, 2, true)}`
      : '溢价 —';
    return `基准：${benchmark.code} · ${benchmark.name || ''} · 最新 ${formatPrice(benchmark.latestNav)} (${formatDate(benchmark.latestNavDate)}) · ${premLabel}`;
  }, [exchangeFunds.length, benchmark]);

  const ndxLabel = Number.isFinite(marketState.ndxPrice)
    ? `NDX ${marketState.ndxPrice.toFixed(2)} ${marketState.ndxAt ? `(${marketState.ndxAt})` : ''}`
    : (marketState.loading ? '加载中…' : (marketState.error || '未就绪'));

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeading
          eyebrow="切换策略"
          title="场内 / 场外纳指 100 切换套利"
          description="用 GitHub Action 每日 15:30 拉取的 NDX 美元价 + 各场内 ETF 日 K，按近 30 个交易日的 ETF/NDX 中位比例做锚定，估算每只 ETF 的真实溢价；命中阈值即给出切换建议。"
        />
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <Info className="h-4 w-4 text-slate-400" />
            <span>{benchmarkSummary}</span>
            <span className="hidden md:inline text-slate-300">·</span>
            <span className="text-slate-500">{ndxLabel}</span>
            <button
              type="button"
              className={cx(secondaryButtonClass, 'ml-auto h-9 px-3 text-xs')}
              onClick={() => setRefreshTick((n) => n + 1)}
            >
              <RefreshCw className="h-4 w-4" />
              重新读取数据
            </button>
          </div>
          {marketState.error ? (
            <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>真实溢价数据加载失败：{marketState.error}。可继续在下方手动输入溢价值。</span>
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">基准 ETF</div>
              <select
                className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 focus:border-indigo-300 focus:outline-none"
                value={prefs.benchmarkCode}
                onChange={(e) => setBenchmarkCode(e.target.value)}
              >
                {exchangeFunds.length === 0 ? (
                  <option value="">（持仓暂无场内 ETF）</option>
                ) : null}
                {exchangeFunds.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.code} · {f.name || ''}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">默认 513100；下拉切换为其他你持有的场内 ETF。建议选规模大、流动性强的那只作为基准。</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">套利目标</div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  step="0.5"
                  className="w-24 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 focus:border-indigo-300 focus:outline-none"
                  value={prefs.arbTargetPct}
                  onChange={(e) => setPrefValue('arbTargetPct', e.target.value)}
                />
                <span className="text-sm text-slate-600">% / 周期</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">用作评估单笔切换是否值得的参考，触发判定本身不直接使用该值。</p>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">候选基金（场内）</div>
                <div className="mt-1 text-sm text-slate-600">从持仓 exchange ETF 中勾选要参与切换比对的基金。</div>
              </div>
              <div className="text-xs text-slate-500">已选 {prefs.enabledCodes.length} / 持仓 {exchangeFunds.length}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {exchangeFunds.length === 0 ? (
                <div className="text-sm text-slate-500">持仓中暂无场内 ETF。</div>
              ) : null}
              {fundsWithPremium.map((f) => {
                const checked = (prefs.enabledCodes || []).includes(f.code);
                return (
                  <button
                    key={f.code}
                    type="button"
                    onClick={() => toggleEnabled(f.code)}
                    className={cx(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                      checked
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                    )}
                  >
                    <span>{f.code}</span>
                    <span className="text-slate-400">·</span>
                    <span className="max-w-[120px] truncate text-slate-600">{f.name || ''}</span>
                    {Number.isFinite(f.premiumPct) ? (
                      <span className={cx(
                        'ml-1 tabular-nums',
                        f.premiumPct >= 0 ? 'text-rose-500' : 'text-emerald-500'
                      )}>{formatPercent(f.premiumPct, 2, true)}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="场内切换信号"
          title="基准 ETF 与候选 ETF 真实溢价差"
          description="溢价 = (ETF当前价 / NDX当前价) / 近 30 日 ETF/NDX 中位比例 − 1。差值 = 基准溢价 − 候选溢价；正值意味着基准更贵。"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">规则 A</div>
            <div className="mt-1 text-slate-700">
              基准溢价 − 持有溢价 ≤
              <input
                type="number"
                step="0.5"
                value={prefs.intraSellLowerPct}
                onChange={(e) => setPrefValue('intraSellLowerPct', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />
              %  →  卖出持有，买入基准（基准相对便宜了）
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">规则 B</div>
            <div className="mt-1 text-slate-700">
              基准溢价 − 另一只溢价 ≥
              <input
                type="number"
                step="0.5"
                value={prefs.intraBuyOtherPct}
                onChange={(e) => setPrefValue('intraBuyOtherPct', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />
              %  →  卖出基准，买入另一只（基准更贵了）
            </div>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">候选</th>
                <th className="px-3 py-2 text-right font-semibold">单价</th>
                <th className="px-3 py-2 text-right font-semibold">真实溢价</th>
                <th className="px-3 py-2 text-right font-semibold">基准 − 候选</th>
                <th className="px-3 py-2 text-left font-semibold">建议</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {!benchmark ? (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-sm text-slate-500">先选定一只基准 ETF。</td></tr>
              ) : null}
              {benchmark && intraSignals.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-sm text-slate-500">候选池中除了基准没有其他场内 ETF（或溢价数据未就绪）。</td></tr>
              ) : null}
              {intraSignals.map((row) => {
                let tone = 'slate';
                let suggestion = '观望';
                if (row.sellBenchBuyOther) { tone = 'emerald'; suggestion = `卖基准 → 买 ${row.code}`; }
                else if (row.sellHoldBuyBench) { tone = 'indigo'; suggestion = `卖 ${row.code} → 买基准`; }
                return (
                  <tr key={row.code}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-700">{row.code}</div>
                      <div className="text-xs text-slate-400">{row.name}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatPrice(row.latestNav)}</td>
                    <td className={cx(
                      'px-3 py-2 text-right tabular-nums',
                      row.premiumPct >= 0 ? 'text-rose-600' : 'text-emerald-600'
                    )}>{formatPercent(row.premiumPct, 2, true)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatPercent(row.diffVsBench, 2, true)}</td>
                    <td className="px-3 py-2"><Pill tone={tone}>{suggestion}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span>
            数据每个交易日 15:30 由 GitHub Action（fetch-nasdaq-minute.yml）刷新；A 股开盘期间 ETF 当前价由 notify worker 实时推送。锚定法不需要 IOPV，但假设长期溢价均值≈0；若 ETF 与 NDX 跟踪误差较大（含汇率），建议把窗口延长。
          </span>
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="场外切换信号"
          title="基准 ETF 溢价 vs 场内最低溢价"
          description="判定何时把场内基准 ETF 换成场外 QDII 联接基金（或反向）。两个数默认从上方真实溢价自动取，可手动覆盖。"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">基准 ETF 当前溢价 %</div>
              <div className="text-xs text-slate-500">
                自动 {Number.isFinite(otcAutoBenchPrem) ? formatPercent(otcAutoBenchPrem, 2, true) : '—'}
              </div>
            </div>
            <input
              type="number"
              step="0.1"
              placeholder="留空使用自动值"
              value={prefs.manualBenchmarkPremiumPct}
              onChange={(e) => setPrefValue('manualBenchmarkPremiumPct', e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold focus:border-indigo-300 focus:outline-none"
            />
            <div className="mt-1 text-xs text-slate-500">
              触发阈值：&gt;
              <input
                type="number"
                step="0.5"
                value={prefs.otcPremiumThresholdPct}
                onChange={(e) => setPrefValue('otcPremiumThresholdPct', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />%
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">场内最低溢价 %</div>
              <div className="text-xs text-slate-500">
                自动 {Number.isFinite(otcAutoMinIntraPrem) ? formatPercent(otcAutoMinIntraPrem, 2, true) : '—'}
              </div>
            </div>
            <input
              type="number"
              step="0.1"
              placeholder="留空使用自动值"
              value={prefs.manualMinIntraPremiumPct}
              onChange={(e) => setPrefValue('manualMinIntraPremiumPct', e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold focus:border-indigo-300 focus:outline-none"
            />
            <div className="mt-1 text-xs text-slate-500">
              触发阈值：&lt;
              <input
                type="number"
                step="0.5"
                value={prefs.otcMinIntraPremiumLow}
                onChange={(e) => setPrefValue('otcMinIntraPremiumLow', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />%（强）/ &lt;
              <input
                type="number"
                step="0.5"
                value={prefs.otcMinIntraPremiumHigh}
                onChange={(e) => setPrefValue('otcMinIntraPremiumHigh', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />%（弱）
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          {otcSignal.ready ? (
            <div className="space-y-2 text-sm text-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={otcSignal.triggered ? (otcSignal.intraLowHard ? 'emerald' : 'amber') : 'slate'}>
                  {otcSignal.level}
                </Pill>
                <span>
                  基准溢价 {formatPercent(otcSignal.benchPrem, 2, true)}
                  <span className="ml-1 text-xs text-slate-400">({otcSignal.benchSource})</span>
                  <span className="mx-1 text-slate-400">·</span>
                  场内最低溢价 {formatPercent(otcSignal.minIntraPrem, 2, true)}
                  <span className="ml-1 text-xs text-slate-400">({otcSignal.intraSource})</span>
                </span>
              </div>
              {otcSignal.triggered ? (
                <div className="text-slate-700">
                  建议：卖出场内基准 ETF（{prefs.benchmarkCode}）→ 申购场外 QDII 联接基金，等溢价回归再赎回换回场内。
                </div>
              ) : (
                <div className="text-slate-500">
                  未触发。等到「基准溢价 &gt; {prefs.otcPremiumThresholdPct}% 且 场内最低溢价 &lt; {prefs.otcMinIntraPremiumHigh}%」再考虑切换。
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Info className="h-4 w-4 text-slate-400" />
              {otcSignal.message}
            </div>
          )}
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">持仓中的场外 / QDII 基金</div>
          {otcFunds.length === 0 ? (
            <div className="mt-2 text-sm text-slate-500">持仓中暂无场外或 QDII 基金。</div>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {otcFunds.map((f) => (
                <li key={f.code} className="flex flex-wrap items-center gap-2">
                  <Pill tone={f.kind === 'qdii' ? 'purple' : 'indigo'}>{f.kind === 'qdii' ? 'QDII' : '场外'}</Pill>
                  <span className="font-semibold text-slate-700">{f.code}</span>
                  <span className="text-slate-500">{f.name || ''}</span>
                  <span className="ml-auto tabular-nums text-slate-400">最新 {formatPrice(f.latestNav)} · {formatDate(f.latestNavDate)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 text-xs text-slate-500">这些基金可作为「场外切换」时的申购目标。建议优先选择费率低、跟踪误差小的联接基金。</div>
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="套利轮次记录"
          title="切换周期人工日志"
          description={`记录每一次切换的开仓 / 平仓价、份额与盈亏，用于回看是否达到目标 ${prefs.arbTargetPct}% / 周期。`}
        />
        <div className="mt-4 flex items-center justify-end">
          <button
            type="button"
            onClick={appendCycle}
            className={cx(primaryButtonClass, 'h-9 px-3 text-xs')}
          >
            <ArrowDownUp className="h-4 w-4" />
            新增一笔切换
          </button>
        </div>
        {switchLedger.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            还没有套利记录。每完成一轮切换就回来登一笔，便于回看节奏。
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">基准 / 对手</th>
                  <th className="px-3 py-2 text-right font-semibold">开仓价</th>
                  <th className="px-3 py-2 text-right font-semibold">平仓价</th>
                  <th className="px-3 py-2 text-right font-semibold">份额</th>
                  <th className="px-3 py-2 text-right font-semibold">盈亏 %</th>
                  <th className="px-3 py-2 text-left font-semibold">备注</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {switchLedger.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2">
                      <input
                        value={row.benchmarkCode}
                        onChange={(e) => patchCycle(row.id, 'benchmarkCode', e.target.value)}
                        className="w-20 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs focus:border-indigo-300 focus:outline-none"
                      />
                      <span className="mx-1 text-slate-400">→</span>
                      <input
                        value={row.counterpartCode}
                        onChange={(e) => patchCycle(row.id, 'counterpartCode', e.target.value)}
                        className="w-20 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs focus:border-indigo-300 focus:outline-none"
                        placeholder="对手代码"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="0.001"
                        value={row.enterPrice}
                        onChange={(e) => patchCycle(row.id, 'enterPrice', e.target.value)}
                        className="w-24 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-right text-xs tabular-nums focus:border-indigo-300 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="0.001"
                        value={row.exitPrice}
                        onChange={(e) => patchCycle(row.id, 'exitPrice', e.target.value)}
                        className="w-24 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-right text-xs tabular-nums focus:border-indigo-300 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="1"
                        value={row.shares}
                        onChange={(e) => patchCycle(row.id, 'shares', e.target.value)}
                        className="w-24 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-right text-xs tabular-nums focus:border-indigo-300 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {(() => {
                        const a = Number(row.enterPrice);
                        const b = Number(row.exitPrice);
                        if (!(a > 0) || !(b > 0)) return <span className="text-slate-400">—</span>;
                        const pct = ((b - a) / a) * 100;
                        return <span className={pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{formatPercent(pct, 2, true)}</span>;
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={row.note}
                        onChange={(e) => patchCycle(row.id, 'note', e.target.value)}
                        className="w-full min-w-[8rem] rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs focus:border-indigo-300 focus:outline-none"
                        placeholder="备注"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeCycle(row.id)}
                        className="text-xs font-semibold text-slate-400 hover:text-rose-500"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default SwitchStrategyExperience;
