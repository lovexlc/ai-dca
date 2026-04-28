import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownUp, Info, RefreshCw } from 'lucide-react';
import { Card, Pill, SectionHeading, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';
import { readLedgerState } from '../app/holdingsLedger.js';
import { aggregateByCode } from '../app/holdingsLedgerCore.js';

// 场内 / 场外纳指 100 切换套利策略实时建议器。
//
// 真实溢价计算：
//   溢价 % = (当前成交价 − 最新单位净值) / 最新单位净值
//
// 数据源（每个交易日 15:30 由 GitHub Action 拉取）：
// - data/<code>/latest-nav.json：场内 ETF 最新单位净值 (東财 f10/lsjz 的 DWJZ)
// - data/all_nasdq.json：候选基金 universe（纳指 100 场内 ETF 全集，与持仓解耦）
// - 当前价：持仓 ledger 中的 latestNav（A 股开盘期间由 notify worker push2 推送，收盘后是最后成交价）；
//   非持仓候选取 data/<code>/daily-sina.json 最后一根 K 线 close 作为代理。
//
// 触发底层仍然是“两只之间的溢价差”，但 UI 只告诉用户「哪两只之间出现机会」，
// 不在实时面板上展示具体数值，过价让用户去基金软件官方渠道查看。
//
// 持久化：
// - aiDcaSwitchStrategyPrefs：基准 ETF、候选基金、阈值
// - aiDcaSwitchStrategyLedger：套利轮次人工日志

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
  otcMinIntraPremiumHigh: 2
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

function navJsonPath(code, inPagesDir) {
  return inPagesDir ? `../data/${code}/latest-nav.json` : `./data/${code}/latest-nav.json`;
}

async function loadEtfLatestNav(code, { inPagesDir = false } = {}) {
  if (!/^\d{6}$/.test(String(code || '').trim())) return null;
  const response = await fetch(navJsonPath(code, inPagesDir), {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const latestNav = Number(payload?.latestNav);
  if (!Number.isFinite(latestNav) || latestNav <= 0) return null;
  return {
    code: payload?.code || code,
    name: payload?.name || '',
    latestNav,
    latestNavDate: payload?.latestNavDate || '',
    previousNav: Number(payload?.previousNav) || null,
    previousNavDate: payload?.previousNavDate || ''
  };
}

function nasdqListPath(inPagesDir) {
  return inPagesDir ? `../data/all_nasdq.json` : `./data/all_nasdq.json`;
}

async function loadNasdqList({ inPagesDir = false } = {}) {
  const response = await fetch(nasdqListPath(inPagesDir), {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.etfs) ? payload.etfs : [];
}

function dailySinaPath(code, inPagesDir) {
  return inPagesDir ? `../data/${code}/daily-sina.json` : `./data/${code}/daily-sina.json`;
}

async function loadEtfLatestPrice(code, { inPagesDir = false } = {}) {
  if (!/^\d{6}$/.test(String(code || '').trim())) return null;
  const response = await fetch(dailySinaPath(code, inPagesDir), {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const bars = Array.isArray(payload?.bars) ? payload.bars : [];
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  const close = Number(last?.close);
  if (!Number.isFinite(close) || close <= 0) return null;
  return {
    code: String(payload?.fund_code || code),
    name: payload?.fund_name || '',
    close,
    date: last?.date || ''
  };
}

export function SwitchStrategyExperience({ links, inPagesDir = false, embedded = false } = {}) {
  const [prefs, setPrefs] = useState(readPrefs);
  const [switchLedger, setSwitchLedger] = useState(readSwitchLedger);
  const [aggregates, setAggregates] = useState([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const [navState, setNavState] = useState({
    loading: true,
    error: '',
    navByCode: {},
    generatedAt: ''
  });

  // 候选基金 universe = data/all_nasdq.json 中的纳指 100 场内 ETF 全集，并非仅限于持仓。
  const [candidateUniverse, setCandidateUniverse] = useState([]);
  const [universeError, setUniverseError] = useState('');
  // 非持仓候选的现价：取 daily-sina.json 最后一根 K 线 close 作为当前价代理。
  const [priceState, setPriceState] = useState({ priceByCode: {} });

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

  // 候选基金 universe（来自 data/all_nasdq.json）
  useEffect(() => {
    let cancelled = false;
    loadNasdqList({ inPagesDir })
      .then((list) => {
        if (cancelled) return;
        setCandidateUniverse(Array.isArray(list) ? list : []);
        setUniverseError('');
      })
      .catch((error) => {
        if (cancelled) return;
        setCandidateUniverse([]);
        setUniverseError(error instanceof Error ? error.message : '候选基金列表加载失败');
      });
    return () => { cancelled = true; };
  }, [inPagesDir, refreshTick]);

  // 默认勾选「既在候选池又在持仓」的场内 ETF。候选池本身来自 all_nasdq.json，与持仓解耦。
  useEffect(() => {
    if (!candidateUniverse.length) return;
    setPrefs((prev) => {
      if (Array.isArray(prev.enabledCodes) && prev.enabledCodes.length > 0) return prev;
      const universeCodes = new Set(candidateUniverse.map((f) => f.code));
      const defaults = exchangeFunds.map((f) => f.code).filter((code) => universeCodes.has(code));
      if (!defaults.length) return prev;
      return { ...prev, enabledCodes: defaults };
    });
  }, [candidateUniverse, exchangeFunds]);

  // 拉取所有候选 ETF 的最新单位净值（候选池来自 data/all_nasdq.json，不仅限于持仓）。
  const loadNav = useCallback(async () => {
    setNavState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const codes = candidateUniverse.map((f) => f.code);
      if (!codes.length) {
        setNavState({ loading: false, error: '', navByCode: {}, generatedAt: nowIso() });
        return;
      }
      const results = await Promise.all(
        codes.map((code) => loadEtfLatestNav(code, { inPagesDir }).catch(() => null))
      );
      const navByCode = {};
      results.forEach((entry) => {
        if (entry && entry.code) navByCode[entry.code] = entry;
      });
      setNavState({
        loading: false,
        error: Object.keys(navByCode).length === 0 ? '未拿到 ETF 最新净值。请检查 GitHub Action 是否跑过并生成 data/<code>/latest-nav.json。' : '',
        navByCode,
        generatedAt: nowIso()
      });
    } catch (error) {
      setNavState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : '净值数据加载失败'
      }));
    }
  }, [candidateUniverse, inPagesDir]);

  useEffect(() => { loadNav(); }, [loadNav, refreshTick]);

  // 非持仓候选的现价：从 data/<code>/daily-sina.json 取最后一根 K 线 close。
  // 持仓的候选直接用 holdings ledger 中的 latestNav（已由 notify worker 实时推送），不在此处覆盖。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!candidateUniverse.length) {
        setPriceState({ priceByCode: {} });
        return;
      }
      const heldCodes = new Set(exchangeFunds.map((f) => f.code));
      const targets = candidateUniverse.filter((f) => !heldCodes.has(f.code));
      if (!targets.length) {
        setPriceState({ priceByCode: {} });
        return;
      }
      const results = await Promise.all(
        targets.map((f) => loadEtfLatestPrice(f.code, { inPagesDir }).catch(() => null))
      );
      if (cancelled) return;
      const priceByCode = {};
      results.forEach((entry) => {
        if (entry && entry.code) priceByCode[entry.code] = entry;
      });
      setPriceState({ priceByCode });
    })();
    return () => { cancelled = true; };
  }, [candidateUniverse, exchangeFunds, inPagesDir, refreshTick]);

  // 合并：(当前价 - 最新NAV) / 最新NAV。
  // 候选池来自 all_nasdq.json：持仓里的取 holdings ledger 的 latestNav，否则取 daily-sina 最后一根 close。
  const fundsWithPremium = useMemo(() => {
    const heldByCode = new Map(exchangeFunds.map((f) => [f.code, f]));
    return candidateUniverse.map((u) => {
      const held = heldByCode.get(u.code) || null;
      const navEntry = navState.navByCode?.[u.code] || null;
      const priceEntry = priceState.priceByCode?.[u.code] || null;
      const px = held ? Number(held.latestNav) : Number(priceEntry?.close);
      const nav = Number(navEntry?.latestNav);
      let premiumPct = null;
      if (Number.isFinite(px) && px > 0 && Number.isFinite(nav) && nav > 0) {
        premiumPct = ((px - nav) / nav) * 100;
      }
      return {
        code: u.code,
        name: held?.name || u.name || '',
        kind: held?.kind || 'exchange',
        hasPosition: Boolean(held),
        latestNav: Number.isFinite(px) && px > 0 ? px : null,
        latestPriceDate: held ? '' : (priceEntry?.date || ''),
        navLatest: nav > 0 ? nav : null,
        navLatestDate: navEntry?.latestNavDate || '',
        premiumPct
      };
    });
  }, [candidateUniverse, exchangeFunds, navState.navByCode, priceState.priceByCode]);

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

  // 场内信号：只输出「哪两只满足条件」，不输出具体溢价。
  const intraSignals = useMemo(() => {
    if (!benchmark || !Number.isFinite(benchmark.premiumPct)) return [];
    const sellLower = Number(prefs.intraSellLowerPct || 0);
    const buyOther = Number(prefs.intraBuyOtherPct || 0);
    const list = [];
    enabledFunds
      .filter((f) => f.code !== benchmark.code && Number.isFinite(f.premiumPct))
      .forEach((f) => {
        const diff = benchmark.premiumPct - f.premiumPct;
        // 规则 A：基准溢价 − 持有溢价 ≤ X% → 卖持有买基准
        if (diff <= sellLower) {
          list.push({
            kind: 'A',
            from: f.code,
            fromName: f.name || f.code,
            to: benchmark.code,
            toName: benchmark.name || benchmark.code,
            description: `${f.code} 与 ${benchmark.code} 的溢价差 ≤ ${sellLower}%：可考虑卖 ${f.code} 买 ${benchmark.code}`
          });
        }
        // 规则 B：基准溢价 − 另一只 ≥ Y% → 卖基准买另一只
        if (diff >= buyOther) {
          list.push({
            kind: 'B',
            from: benchmark.code,
            fromName: benchmark.name || benchmark.code,
            to: f.code,
            toName: f.name || f.code,
            description: `${benchmark.code} 与 ${f.code} 的溢价差 ≥ ${buyOther}%：可考虑卖 ${benchmark.code} 买 ${f.code}`
          });
        }
      });
    return list;
  }, [enabledFunds, benchmark, prefs.intraSellLowerPct, prefs.intraBuyOtherPct]);

  // 场外信号：同样只输出代码对，不显示溢价数。
  const otcSignal = useMemo(() => {
    const benchPrem = Number.isFinite(benchmark?.premiumPct) ? benchmark.premiumPct : null;
    let minFund = null;
    enabledFunds.forEach((f) => {
      if (Number.isFinite(f.premiumPct)) {
        if (!minFund || f.premiumPct < minFund.premiumPct) minFund = f;
      }
    });
    if (!Number.isFinite(benchPrem) || !minFund) {
      return {
        ready: false,
        message: navState.loading ? '正在加载 ETF 净值…' : (navState.error || 'ETF 净值数据未就绪。')
      };
    }
    const benchHigh = benchPrem > Number(prefs.otcPremiumThresholdPct || 0);
    const intraLowSoft = minFund.premiumPct < Number(prefs.otcMinIntraPremiumHigh || 0);
    const intraLowHard = minFund.premiumPct < Number(prefs.otcMinIntraPremiumLow || 0);
    const triggered = benchHigh && (intraLowSoft || intraLowHard);

    let level = '未触发';
    if (triggered && intraLowHard) level = '强信号';
    else if (triggered) level = '弱信号';

    return {
      ready: true,
      benchCode: benchmark.code,
      benchName: benchmark.name || benchmark.code,
      lowestCode: minFund.code,
      lowestName: minFund.name || minFund.code,
      benchHigh,
      intraLowSoft,
      intraLowHard,
      triggered,
      level
    };
  }, [
    enabledFunds,
    benchmark,
    prefs.otcPremiumThresholdPct,
    prefs.otcMinIntraPremiumLow,
    prefs.otcMinIntraPremiumHigh,
    navState.loading,
    navState.error
  ]);

  // 套利轮次
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

  const navUpdatedHint = useMemo(() => {
    const dates = Object.values(navState.navByCode || {})
      .map((entry) => entry?.latestNavDate)
      .filter(Boolean)
      .sort();
    if (!dates.length) return '';
    return `NAV 最新日期 ${dates[dates.length - 1]}`;
  }, [navState.navByCode]);

  const benchmarkSummary = useMemo(() => {
    if (!exchangeFunds.length) {
      return '当前持仓中没有场内 ETF，先在持仓页录入交易再回来配置切换策略。';
    }
    if (!benchmark) return '请先选择一只基准 ETF。';
    return `基准：${benchmark.code} · ${benchmark.name || ''}`;
  }, [exchangeFunds.length, benchmark]);

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeading
          eyebrow="切换策略"
          title="场内 / 场外纳指 100 切换套利"
          description="溢价 % = (当前成交价 − 最新单位净值) / 最新单位净值。净值数据每个交易日 15:30 由 GitHub Action 从东财 lsjz 接口拉取。当前价 A 股开盘期间由 worker push2 实时推送，收盘后为最后成交价。"
        />
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <Info className="h-4 w-4 text-slate-400" />
            <span>{benchmarkSummary}</span>
            {navUpdatedHint ? (
              <>
                <span className="hidden md:inline text-slate-300">·</span>
                <span className="text-slate-500">{navUpdatedHint}</span>
              </>
            ) : null}
            <button
              type="button"
              className={cx(secondaryButtonClass, 'ml-auto h-9 px-3 text-xs')}
              onClick={() => setRefreshTick((n) => n + 1)}
            >
              <RefreshCw className="h-4 w-4" />
              重新读取数据
            </button>
          </div>
          {navState.error ? (
            <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>净值数据加载异常：{navState.error}</span>
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
              <p className="mt-2 text-xs text-slate-500">作为评估单笔切换是否值得的参考，触发判定本身不使用该值。</p>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">候选基金（场内）</div>
                <div className="mt-1 text-sm text-slate-600">候选池来自 data/all_nasdq.json，与持仓解耦；勾选要参与切换比对的基金。</div>
              </div>
              <div className="text-xs text-slate-500">已选 {prefs.enabledCodes.length} / 候选 {candidateUniverse.length}</div>
            </div>
            {universeError ? (
              <div className="mt-2 text-xs text-rose-600">候选基金列表加载失败：{universeError}</div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {candidateUniverse.length === 0 ? (
                <div className="text-sm text-slate-500">候选基金尚未加载。</div>
              ) : null}
              {fundsWithPremium.map((f) => {
                const checked = (prefs.enabledCodes || []).includes(f.code);
                const hasNav = Number.isFinite(f.navLatest);
                const priceSourceLabel = f.hasPosition ? '持仓' : (f.latestPriceDate || 'daily');
                return (
                  <button
                    key={f.code}
                    type="button"
                    onClick={() => toggleEnabled(f.code)}
                    title={hasNav
                      ? `NAV ${f.navLatest.toFixed(4)} (${f.navLatestDate})・现价 ${formatPrice(f.latestNav)} (${priceSourceLabel})`
                      : '净值数据未就绪'}
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
                    {f.hasPosition ? (
                      <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">持</span>
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
          title="在持有的场内 ETF 之间倒换"
          description="按下列阈值判定「哪两只 ETF 之间出现机会」，具体溢价数请到基金软件里查看后再下单。"
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
        <div className="mt-4 space-y-2">
          {!benchmark ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">先选定一只基准 ETF。</div>
          ) : null}
          {benchmark && intraSignals.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
              当前任两只 ETF 之间都没有出现机会，继续耐心等待。
            </div>
          ) : null}
          {intraSignals.map((sig, idx) => (
            <div
              key={`${sig.kind}-${sig.from}-${sig.to}-${idx}`}
              className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
            >
              <Pill tone={sig.kind === 'A' ? 'indigo' : 'emerald'}>规则 {sig.kind}</Pill>
              <div className="flex-1">
                <div className="font-semibold text-slate-700">卖 {sig.from} → 买 {sig.to}</div>
                <div className="text-xs text-slate-500">
                  {sig.fromName || ''} → {sig.toName || ''}。{sig.description}。具体溢价请到基金软件查看后再下单。
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span>
            净值来自东财 f10/lsjz 接口，通常在 T 日晚到 T+1 早更新；A 股开盘期间使用的是 T-1 日净值 · ETF 实时价，溢价估计会比 IOPV 略偏。下单前请以交易软件的实时溢价为准。
          </span>
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="场外切换信号"
          title="将场内基准换为场外 QDII 联接基金"
          description="当「基准 ETF 溢价 > A%」且「场内最低溢价 < B%」时提示反向套利。同样只输出代码对，不显示具体溢价数。"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">基准溢价 阈值</div>
            <div className="mt-1 text-slate-700">
              &gt;
              <input
                type="number"
                step="0.5"
                value={prefs.otcPremiumThresholdPct}
                onChange={(e) => setPrefValue('otcPremiumThresholdPct', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />%
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">场内最低溢价 阈值</div>
            <div className="mt-1 text-slate-700">
              &lt;
              <input
                type="number"
                step="0.5"
                value={prefs.otcMinIntraPremiumLow}
                onChange={(e) => setPrefValue('otcMinIntraPremiumLow', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />%（强） / &lt;
              <input
                type="number"
                step="0.5"
                value={prefs.otcMinIntraPremiumHigh}
                onChange={(e) => setPrefValue('otcMinIntraPremiumHigh', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />%（弱）
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          {otcSignal.ready ? (
            otcSignal.triggered ? (
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <Pill tone={otcSignal.intraLowHard ? 'emerald' : 'amber'}>{otcSignal.level}</Pill>
                <div className="flex-1">
                  <div className="font-semibold text-slate-700">
                    卖 {otcSignal.benchCode} → 申购场外 QDII 联接基金
                  </div>
                  <div className="text-xs text-slate-500">
                    「{otcSignal.benchCode} {otcSignal.benchName}」溢价偏高且「{otcSignal.lowestCode} {otcSignal.lowestName}」溢价偏低，出现反向套利机会。具体溢价请到基金软件查看后再下单。
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                当前未触发。等到「{otcSignal.benchCode} {otcSignal.benchName}」溢价偏高，且场内最低（当前为 {otcSignal.lowestCode}）溢价偏低时再看。
              </div>
            )
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
