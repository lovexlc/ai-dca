import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownUp, Info, RefreshCw, Radio, PlayCircle, ChevronDown } from 'lucide-react';
import { Card, Pill, SectionHeading, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';
import { readLedgerState } from '../app/holdingsLedger.js';
import { aggregateByCode } from '../app/holdingsLedgerCore.js';
import {
  buildDefaultSwitchConfig,
  loadSwitchConfigFromWorker,
  loadSwitchSnapshotFromWorker,
  normalizeSwitchConfigShape,
  readSwitchConfigCache,
  runSwitchOnce,
  saveSwitchConfigToWorker,
  resetSwitchConfigOnWorker
} from '../app/switchStrategySync.js';

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

// v3 持仓 + H/L 双维度语义：
//   benchmarkCodes = 持仓基准（从持仓详情自动派生，不手选）
//   enabledCodes   = 用户勾选的候选，UI 仅呈现「对侧分类」的 ETF
//   premiumClass   = { [code]: 'H' | 'L' }，每只 ETF 的溢价中枢标签（与持仓/候选解耦）
//   gap = H溢价 − L溢价（始终 H 在前，正常市况 > 0）
//   bench ∈ L 持有 → 仅看规则 A：gap < intraSellLowerPct → 卖 bench(L) 买 cand(H)
//   bench ∈ H 持有 → 仅看规则 B：gap > intraBuyOtherPct  → 卖 bench(H) 买 cand(L)
//   同类、未分类都不触发，UI 会提示补全分类。
const DEFAULT_PREFS = {
  benchmarkCodes: ['513100'],
  enabledCodes: [],
  premiumClass: {},
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
    // 兼容旧格式：parsed.benchmarkCode (string) → [benchmarkCode]。
    let benchmarkCodes = Array.isArray(parsed?.benchmarkCodes) ? parsed.benchmarkCodes.filter(Boolean) : null;
    if (!benchmarkCodes && typeof parsed?.benchmarkCode === 'string' && parsed.benchmarkCode) {
      benchmarkCodes = [parsed.benchmarkCode];
    }
    if (!Array.isArray(benchmarkCodes) || !benchmarkCodes.length) {
      benchmarkCodes = [...DEFAULT_PREFS.benchmarkCodes];
    }
    const { benchmarkCode: _legacyBenchmark, ...rest } = parsed || {};
    void _legacyBenchmark;
    // premiumClass：只保留值为 'H' | 'L'。未出现在持仓或候选中的代码不会出现在这里（运行时过滤）。
    const rawClass = (parsed && typeof parsed.premiumClass === 'object' && parsed.premiumClass) ? parsed.premiumClass : {};
    const premiumClass = {};
    for (const [code, value] of Object.entries(rawClass)) {
      const v = String(value || '').trim().toUpperCase();
      if (/^\d{6}$/.test(String(code)) && (v === 'H' || v === 'L')) premiumClass[code] = v;
    }
    return {
      ...DEFAULT_PREFS,
      ...rest,
      benchmarkCodes,
      enabledCodes: Array.isArray(parsed?.enabledCodes) ? parsed.enabledCodes : [],
      premiumClass
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
  // 先抦掉 null / undefined，避免 Number(null) → 0 被当成「0.00%」。
  if (value === null || value === undefined || value === '') return '—';
  const v = Number(value);
  if (!Number.isFinite(v)) return '—';
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

  // ---- 「自动监控」worker 驱动的场内切换信号 ----
  // 配置源头为 `prefs`（基准 / 候选 / 规则 A&B 阈值）。
  // 本 Card 不重复提供表单，仅负责将 prefs debounce 同步到 worker。
  const [workerConfig, setWorkerConfig] = useState(() => readSwitchConfigCache());
  const [workerSnapshot, setWorkerSnapshot] = useState(null);
  const [workerStatus, setWorkerStatus] = useState({
    loading: true,
    saving: false,
    running: false,
    error: '',
    notice: '',
    lastSyncedAt: ''
  });
  const [workerConfigExpanded, setWorkerConfigExpanded] = useState(false);

  useEffect(() => { writePrefs(prefs); }, [prefs]);
  useEffect(() => { writeSwitchLedger(switchLedger); }, [switchLedger]);

  // 首次入页：从 worker 拉取配置 + 快照。失败不阻断 UI（本地缓存仍可用）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setWorkerStatus((prev) => ({ ...prev, loading: true, error: '' }));
        const [config, snapshotPayload] = await Promise.all([
          loadSwitchConfigFromWorker().catch(() => null),
          loadSwitchSnapshotFromWorker().catch(() => null)
        ]);
        if (cancelled) return;
        if (config) {
          setWorkerConfig(config);
        }
        if (snapshotPayload?.snapshot) {
          setWorkerSnapshot(snapshotPayload.snapshot);
        }
        setWorkerStatus((prev) => ({
          ...prev,
          loading: false,
          error: '',
          lastSyncedAt: new Date().toISOString()
        }));
      } catch (error) {
        if (cancelled) return;
        setWorkerStatus((prev) => ({
          ...prev,
          loading: false,
          error: error?.message || '加载 worker 配置失败'
        }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const persistWorkerConfig = useCallback(async (nextConfig) => {
    const normalized = normalizeSwitchConfigShape(nextConfig);
    setWorkerConfig(normalized);
    setWorkerStatus((prev) => ({ ...prev, saving: true, error: '', notice: '' }));
    try {
      const result = await saveSwitchConfigToWorker(normalized);
      // saveSwitchConfigToWorker 现在返回 { config, clientId, benchmarkCodes, candidateCount }
      const stored = (result && result.config) ? result.config : result;
      setWorkerConfig(stored);
      const clientId = result?.clientId || '';
      const benchmarkCodes = Array.isArray(result?.benchmarkCodes)
        ? result.benchmarkCodes
        : (stored.benchmarkCodes || []);
      const benchSet = new Set(benchmarkCodes);
      const candidateCount = Number.isFinite(result?.candidateCount)
        ? result.candidateCount
        : (stored.enabledCodes || []).filter((c) => c && !benchSet.has(c)).length;
      const benchmarkLabel = benchmarkCodes.length
        ? (benchmarkCodes.length === 1 ? benchmarkCodes[0] : `${benchmarkCodes.length} 只 (${benchmarkCodes.join(', ')})`)
        : '未设定';
      const clientHint = clientId ? `· client ${clientId.slice(0, 18)}…` : '';
      const baseHint = `基准 ${benchmarkLabel} / 候选 ${candidateCount} 只 ${clientHint}`.trim();
      setWorkerStatus((prev) => ({
        ...prev,
        saving: false,
        notice: stored.enabled
          ? `配置已同步到 worker（${baseHint}），交易时段内每分钟按规则 A/B 扫描。`
          : `配置已保存（未启用自动监控 · ${baseHint}）。`,
        lastSyncedAt: new Date().toISOString()
      }));
    } catch (error) {
      setWorkerStatus((prev) => ({
        ...prev,
        saving: false,
        error: error?.message || '保存到 worker 失败'
      }));
    }
  }, []);

  // benchmarkCodes 变动时清掉旧快照，避免页面顶部 / 中部还在渲染旧基准的 worker 数据。
  const benchmarkCodesKey = (prefs?.benchmarkCodes || []).slice().sort().join(',');
  useEffect(() => {
    setWorkerSnapshot((prev) => {
      if (!prev) return prev;
      const prevBenchmarks = Array.isArray(prev.byBenchmark)
        ? prev.byBenchmark.map((b) => b?.benchmarkCode).filter(Boolean)
        : (prev.benchmarkCode ? [prev.benchmarkCode] : []);
      const prevKey = prevBenchmarks.slice().sort().join(',');
      if (prevKey === benchmarkCodesKey) return prev;
      return null;
    });
  }, [benchmarkCodesKey]);

  // 手动清理 worker 端历史脈数据（config / snapshot / state）。
  const handleResetWorkerConfig = useCallback(async () => {
    setWorkerStatus((prev) => ({ ...prev, saving: true, error: '', notice: '' }));
    try {
      const result = await resetSwitchConfigOnWorker();
      // 本地 state 同步重置为默认值，后续调同步会重新写入。
      const fresh = buildDefaultSwitchConfig();
      setWorkerConfig(fresh);
      setWorkerSnapshot(null);
      const clientId = result?.clientId || '';
      const cleared = Array.isArray(result?.clearedKeys) ? result.clearedKeys.length : 0;
      const examined = Array.isArray(result?.examinedKeys) ? result.examinedKeys.length : 3;
      setWorkerStatus((prev) => ({
        ...prev,
        saving: false,
        notice: `worker 已清理 ${cleared}/${examined} 个 KV 键${clientId ? ` · client ${clientId.slice(0, 18)}…` : ''}。重新启用自动监控以同步新配置。`,
        lastSyncedAt: new Date().toISOString()
      }));
    } catch (error) {
      setWorkerStatus((prev) => ({
        ...prev,
        saving: false,
        error: error?.message || '清理 worker 配置失败'
      }));
    }
  }, []);

  // 启用时将页面 prefs 一起带上，worker 立刻获得可运行的配置。
  const handleWorkerToggle = useCallback((enabled) => {
    if (enabled) {
      const benchmarkCodes = Array.from(new Set([
        ...(prefs?.benchmarkCodes || []),
        ...(workerConfig.benchmarkCodes || [])
      ].map(String).filter(Boolean)));
      const benchSet = new Set(benchmarkCodes);
      const enabledCodes = Array.from(new Set((prefs?.enabledCodes || []).map(String)))
        .filter((code) => code && !benchSet.has(code));
      void persistWorkerConfig({
        ...workerConfig,
        enabled: true,
        benchmarkCodes,
        enabledCodes,
        premiumClass: (prefs && typeof prefs.premiumClass === 'object' && prefs.premiumClass) ? prefs.premiumClass : {},
        intraSellLowerPct: Number(prefs?.intraSellLowerPct),
        intraBuyOtherPct: Number(prefs?.intraBuyOtherPct)
      });
    } else {
      void persistWorkerConfig({ ...workerConfig, enabled: false });
    }
  }, [workerConfig, persistWorkerConfig, prefs]);

  // prefs 变动同步到 worker（debounce 800ms）。
  // 仅在已启用自动监控时推送，以免未启用状态下频繁写入 worker。
  useEffect(() => {
    if (!workerConfig.enabled) return undefined;
    // 关键：把 desired 也跑一遍 normalizeSwitchConfigShape，让本地 diff 口径与
    // 服务端持久化口径完全一致。否则会出现：
    //   prefs.premiumClass 里有些 code 不在 benchmark ∪ enabled 里 → 服务端归一化
    //   会剔除它们 → 本地 diff 用未归一化的 prefs 比较时永远 != → 800ms 反复
    //   POST /switch/config，浏览器看上去一直在刷新。
    // 同理 intraSellLowerPct / intraBuyOtherPct 若为 NaN，归一化会 fallback 到
    // 默认值，也会形成同款死循环。
    const desired = normalizeSwitchConfigShape({
      ...workerConfig,
      enabled: true,
      benchmarkCodes: prefs?.benchmarkCodes || [],
      enabledCodes: prefs?.enabledCodes || [],
      premiumClass: prefs?.premiumClass || {},
      intraSellLowerPct: prefs?.intraSellLowerPct,
      intraBuyOtherPct: prefs?.intraBuyOtherPct
    });
    if (!desired.benchmarkCodes.length) return undefined;
    const sameCodes = (a, b) => {
      if (a.length !== b.length) return false;
      const sa = a.slice().sort();
      const sb = b.slice().sort();
      return sa.every((v, i) => v === sb[i]);
    };
    const sameClassMap = (a, b) => {
      const ka = Object.keys(a || {}).sort();
      const kb = Object.keys(b || {}).sort();
      if (ka.length !== kb.length) return false;
      return ka.every((k, i) => k === kb[i] && a[k] === b[k]);
    };
    const drift = (
      !sameCodes(workerConfig.benchmarkCodes || [], desired.benchmarkCodes)
      || !sameCodes(workerConfig.enabledCodes || [], desired.enabledCodes)
      || !sameClassMap(workerConfig.premiumClass || {}, desired.premiumClass)
      || Number(workerConfig.intraSellLowerPct) !== desired.intraSellLowerPct
      || Number(workerConfig.intraBuyOtherPct) !== desired.intraBuyOtherPct
    );
    if (!drift) return undefined;
    const timer = setTimeout(() => {
      // 直接下发已归一化的 desired，避免 server 再次裁剪后产生新的状态差。
      void persistWorkerConfig(desired);
    }, 800);
    return () => clearTimeout(timer);
  }, [
    workerConfig.enabled,
    workerConfig.benchmarkCodes,
    workerConfig.enabledCodes,
    workerConfig.premiumClass,
    workerConfig.intraSellLowerPct,
    workerConfig.intraBuyOtherPct,
    prefs?.benchmarkCodes,
    prefs?.enabledCodes,
    prefs?.premiumClass,
    prefs?.intraSellLowerPct,
    prefs?.intraBuyOtherPct,
    persistWorkerConfig,
    workerConfig
  ]);

  const handleWorkerRunOnce = useCallback(async () => {
    setWorkerStatus((prev) => ({ ...prev, running: true, error: '', notice: '' }));
    try {
      const payload = await runSwitchOnce();
      if (payload?.snapshot) {
        setWorkerSnapshot(payload.snapshot);
      }
      const triggered = Number(payload?.summary?.triggered || 0);
      const pushed = Number(payload?.summary?.pushed || 0);
      setWorkerStatus((prev) => ({
        ...prev,
        running: false,
        notice: triggered
          ? `手动执行完成：本轮命中 ${triggered} 个信号，推送 ${pushed} 次。`
          : '手动执行完成：当前未触达阈值。',
        lastSyncedAt: new Date().toISOString()
      }));
    } catch (error) {
      setWorkerStatus((prev) => ({
        ...prev,
        running: false,
        error: error?.message || '手动运行失败'
      }));
    }
  }, []);

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

  // 候选集合 = 用户在 H/L 两表里拖入的代码 ∩ 排除持仓。
  // 不再让用户手动勾选“候选基金”：入 H/L 即可作为候选。
  const premiumClassKey = JSON.stringify(prefs?.premiumClass || {});
  useEffect(() => {
    const cls = (prefs && prefs.premiumClass) || {};
    const heldCodes = new Set(exchangeFunds.map((f) => f.code));
    const next = Object.keys(cls).filter((code) => !heldCodes.has(code)).sort();
    setPrefs((prev) => {
      const before = Array.isArray(prev.enabledCodes) ? prev.enabledCodes : [];
      if (before.length === next.length && before.every((v, i) => v === next[i])) return prev;
      return { ...prev, enabledCodes: next };
    });
  }, [exchangeFunds, premiumClassKey]);

  // 单一数据源：基准 ETF 只能从「持仓的场内 ETF」里选，所以 prefs.benchmarkCodes
  // 里所有 code 都必须落在 exchangeFunds 之内。这里在 exchangeFunds 变化后自动过滤
  // 不再持有的 code，并在清空后 fallback 到第一只持仓 ETF。
  const benchmarkCodesJoined = (prefs?.benchmarkCodes || []).join(',');
  useEffect(() => {
    if (!exchangeFunds.length) return;
    const heldCodes = new Set(exchangeFunds.map((f) => f.code));
    setPrefs((prev) => {
      const before = Array.isArray(prev.benchmarkCodes) ? prev.benchmarkCodes : [];
      const after = before.filter((code) => heldCodes.has(code));
      const next = after.length ? after : [exchangeFunds[0].code];
      if (next.length === before.length && next.every((v, i) => v === before[i])) return prev;
      return { ...prev, benchmarkCodes: next };
    });
  }, [exchangeFunds, benchmarkCodesJoined]);

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

  // 多基准：按 prefs.benchmarkCodes 顺序取 fundsWithPremium 中对应项。
  const benchmarks = useMemo(() => {
    const codes = Array.isArray(prefs.benchmarkCodes) ? prefs.benchmarkCodes : [];
    const list = codes
      .map((code) => fundsWithPremium.find((f) => f.code === code))
      .filter(Boolean);
    if (list.length) return list;
    if (enabledFunds[0]) return [enabledFunds[0]];
    if (fundsWithPremium[0]) return [fundsWithPremium[0]];
    return [];
  }, [fundsWithPremium, enabledFunds, prefs.benchmarkCodes]);
  // 第一只基准，供需要单一基准上下文的位置使用（如 benchmarkSummary 默认提示、套利轮次默认记录）。
  const benchmark = benchmarks[0] || null;

  function setPrefValue(key, value) {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }
  // 拖拽分类：将 code 套入 H / L / 未分类。targetClass=null 表示从分类中移出。
  function setCodeClass(code, targetClass) {
    if (!code) return;
    setPrefs((prev) => {
      const cls = { ...((prev && prev.premiumClass) || {}) };
      if (targetClass === 'H' || targetClass === 'L') cls[code] = targetClass;
      else delete cls[code];
      return { ...prev, premiumClass: cls };
    });
  }
  // 拖拽状态：高亮当前悬停中的接收区。
  const [dragOverZone, setDragOverZone] = useState(null);
  const handleChipDragStart = useCallback((event, code) => {
    if (!event || !event.dataTransfer || !code) return;
    event.dataTransfer.setData('text/plain', code);
    event.dataTransfer.effectAllowed = 'move';
  }, []);
  const handleZoneDragOver = useCallback((event, zone) => {
    if (!event) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    setDragOverZone(zone);
  }, []);
  const handleZoneDragLeave = useCallback(() => {
    setDragOverZone(null);
  }, []);
  const handleZoneDrop = useCallback((event, targetClass) => {
    if (!event) return;
    event.preventDefault();
    setDragOverZone(null);
    const code = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
    if (!code) return;
    setCodeClass(code, targetClass);
  }, []);

  // 场内信号（v3 持仓 + premiumClass H/L 双维度）：
  //   bench = 持仓基准，cand = 候选。仅当两者均已分类且不同类时考虑。
  //   gap = H溢价 − L溢价（不依赖 bench/cand 谁减谁）
  //   bench=L 且 gap < sellLower → 规则 A：卖 bench(L) 买 cand(H)
  //   bench=H 且 gap > buyOther  → 规则 B：卖 bench(H) 买 cand(L)
  const intraSignals = useMemo(() => {
    if (!benchmarks.length) return [];
    const sellLower = Number(prefs.intraSellLowerPct || 0);
    const buyOther = Number(prefs.intraBuyOtherPct || 0);
    const cls = (prefs && prefs.premiumClass) || {};
    const benchmarkCodeSet = new Set(benchmarks.map((b) => b.code));
    const list = [];
    benchmarks.forEach((bench) => {
      if (!Number.isFinite(bench?.premiumPct)) return;
      const benchClass = cls[bench.code];
      if (benchClass !== 'H' && benchClass !== 'L') return;
      enabledFunds
        .filter((f) => !benchmarkCodeSet.has(f.code) && Number.isFinite(f.premiumPct))
        .forEach((f) => {
          const candClass = cls[f.code];
          if (candClass !== 'H' && candClass !== 'L') return;
          if (candClass === benchClass) return;
          const hPremium = benchClass === 'H' ? bench.premiumPct : f.premiumPct;
          const lPremium = benchClass === 'H' ? f.premiumPct : bench.premiumPct;
          const gap = hPremium - lPremium;
          if (!Number.isFinite(gap)) return;
          let kind = null;
          let threshold = 0;
          let cmp = '';
          if (benchClass === 'L' && gap < sellLower) { kind = 'A'; threshold = sellLower; cmp = '<'; }
          else if (benchClass === 'H' && gap > buyOther) { kind = 'B'; threshold = buyOther; cmp = '>'; }
          if (!kind) return;
          const fromCode = bench.code;
          const toCode = f.code;
          const fromName = bench.name || bench.code;
          const toName = f.name || f.code;
          const tag = kind === 'A' ? '差价收窄' : '差价扩大';
          const arrow = kind === 'A' ? '低→高' : '高→低';
          const gapStr = (gap >= 0 ? '+' : '') + gap.toFixed(2);
          const hCode = benchClass === 'H' ? bench.code : f.code;
          const lCode = benchClass === 'H' ? f.code : bench.code;
          list.push({
            kind,
            from: fromCode,
            fromName,
            to: toCode,
            toName,
            description: `${hCode}(H) − ${lCode}(L) 溢价差 ${gapStr}% ${cmp} ${threshold}%（${tag}，${arrow}）：卖 ${fromCode} 买 ${toCode}`
          });
        });
    });
    return list;
  }, [enabledFunds, benchmarks, prefs.intraSellLowerPct, prefs.intraBuyOtherPct, prefs.premiumClass]);

  // 场外信号：多基准下取「溢价最高」的基准（表示场内已充分偏高，走场外更交同）。
  const otcSignal = useMemo(() => {
    let topBench = null;
    benchmarks.forEach((b) => {
      if (Number.isFinite(b?.premiumPct)) {
        if (!topBench || b.premiumPct > topBench.premiumPct) topBench = b;
      }
    });
    let minFund = null;
    enabledFunds.forEach((f) => {
      if (Number.isFinite(f.premiumPct)) {
        if (!minFund || f.premiumPct < minFund.premiumPct) minFund = f;
      }
    });
    if (!topBench || !minFund) {
      return {
        ready: false,
        message: navState.loading ? '正在加载 ETF 净值…' : (navState.error || 'ETF 净值数据未就绪。')
      };
    }
    const benchPrem = topBench.premiumPct;
    const benchHigh = benchPrem > Number(prefs.otcPremiumThresholdPct || 0);
    const intraLowSoft = minFund.premiumPct < Number(prefs.otcMinIntraPremiumHigh || 0);
    const intraLowHard = minFund.premiumPct < Number(prefs.otcMinIntraPremiumLow || 0);
    const triggered = benchHigh && (intraLowSoft || intraLowHard);

    let level = '未触发';
    if (triggered && intraLowHard) level = '强信号';
    else if (triggered) level = '弱信号';

    return {
      ready: true,
      benchCode: topBench.code,
      benchName: topBench.name || topBench.code,
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
    benchmarks,
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
      // 套利轮次 ledger 仍为单轮单基准；多基准时默认取第一只。
      benchmarkCode: (prefs.benchmarkCodes || [])[0] || '',
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
    if (!benchmarks.length) return '请先选择至少一只基准 ETF。';
    return `基准：${benchmarks.map((b) => `${b.code} · ${b.name || ''}`).join(' / ')}`;
  }, [exchangeFunds.length, benchmarks]);

  const switchSummary = useMemo(() => {
    const cls = prefs?.premiumClass || {};
    const benches = (prefs?.benchmarkCodes || []).filter(Boolean);
    const enabled = (prefs?.enabledCodes || []).filter(Boolean);
    // 候选池 = (所有分类过的代码) = enabledCodes ∪ benchmarkCodes，
    // 这样另一只持仓（在另一个分类里）也能成为当前 bench 的候选。
    const classifiedPool = Array.from(new Set([...benches, ...enabled]))
      .filter((c) => cls[c] === 'H' || cls[c] === 'L');
    const Hpool = classifiedPool.filter((c) => cls[c] === 'H');
    const Lpool = classifiedPool.filter((c) => cls[c] === 'L');
    const Lbenches = benches.filter((c) => cls[c] === 'L');
    const Hbenches = benches.filter((c) => cls[c] === 'H');
    // L bench 的候选 = Hpool（不同类、无需排除自身）；H bench 的候选 = Lpool。
    const Lrow = Lbenches.length ? { benches: Lbenches, cands: Hpool } : null;
    const Hrow = Hbenches.length ? { benches: Hbenches, cands: Lpool } : null;
    const pairs = (Lrow ? Lrow.benches.length * Lrow.cands.length : 0)
      + (Hrow ? Hrow.benches.length * Hrow.cands.length : 0);
    return { benches, Lbenches, Hbenches, Lrow, Hrow, pairs, Hpool, Lpool, cls };
  }, [prefs?.benchmarkCodes, prefs?.enabledCodes, prefs?.premiumClass]);

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeading
          eyebrow="自动监控"
          title="worker 每分钟扫描场内切换信号"
        />
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={Boolean(workerConfig.enabled)}
                disabled={workerStatus.loading || workerStatus.saving}
                onChange={(e) => handleWorkerToggle(e.target.checked)}
              />
              <span className="font-semibold text-slate-700">启用 worker 自动监控</span>
            </label>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600">
              <Radio className="h-3.5 w-3.5" />
              cron: 周一至周五 09:30-11:30 / 13:00-15:00
            </span>
            <button
              type="button"
              className={cx(secondaryButtonClass, 'ml-auto h-9 px-3 text-xs')}
              onClick={handleWorkerRunOnce}
              disabled={workerStatus.running || workerStatus.saving || !workerConfig.enabled || !switchSummary.benches.length || switchSummary.pairs === 0}
              title={workerConfig.enabled ? '手动跑一次：拉价 + 算 diff + 命中规则 A/B 则推送' : '需先启用自动监控'}
            >
              <PlayCircle className="h-4 w-4" />
              {workerStatus.running ? '运行中…' : '手动跑一次'}
            </button>
            <button
              type="button"
              onClick={handleResetWorkerConfig}
              disabled={workerStatus.saving || workerStatus.running}
              title="清理 worker 上这个 clientId 的 config / snapshot / state。适用于旧基准污染、需重建脈络的场景。清理后请重新启用自动监控以同步新配置。"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {workerStatus.saving ? '清理中…' : '清理 worker 配置'}
            </button>
          </div>
          {workerStatus.error ? (
            <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{workerStatus.error}</span>
            </div>
          ) : null}
          {workerStatus.notice && !workerStatus.error ? (
            <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{workerStatus.notice}</span>
            </div>
          ) : null}
          <div className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
            <button
              type="button"
              onClick={() => setWorkerConfigExpanded((prev) => !prev)}
              className="w-full rounded-lg p-2 text-left transition-colors hover:bg-slate-50"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {(() => {
                    const sellLower = Number.isFinite(Number(prefs?.intraSellLowerPct)) ? prefs.intraSellLowerPct : null;
                    const buyOther = Number.isFinite(Number(prefs?.intraBuyOtherPct)) ? prefs.intraBuyOtherPct : null;
                    const fmtCls = (c) => `${c}${switchSummary.cls[c] === 'H' ? 'H' : (switchSummary.cls[c] === 'L' ? 'L' : '')}`;
                    const fmtList = (arr) => (arr || []).map(fmtCls).join(', ');
                    if (!switchSummary.benches.length) {
                      return <span className="text-slate-500">未配置基准（在上方 H/L 表拖入你的持仓代码）</span>;
                    }
                    const Lline = switchSummary.Lrow ? (
                      <span key="L" className="text-slate-500">
                        <span className="font-semibold text-slate-700">L 基准 {switchSummary.Lrow.benches.length} 只</span>
                        <span className="text-[11px] text-slate-400">{' '}({fmtList(switchSummary.Lrow.benches)})</span>
                        {' · 候选 '}<span className="font-semibold text-slate-700">{switchSummary.Lrow.cands.length}</span> 对{' '}
                        <span className="text-[11px] text-slate-400">({fmtList(switchSummary.Lrow.cands) || '无'})</span>
                        {' · 规则 A：H-L ≤'}<span className="font-semibold text-slate-700">{sellLower !== null ? `${sellLower}%` : '—'}</span>
                      </span>
                    ) : null;
                    const Hline = switchSummary.Hrow ? (
                      <span key="H" className="text-slate-500">
                        <span className="font-semibold text-slate-700">H 基准 {switchSummary.Hrow.benches.length} 只</span>
                        <span className="text-[11px] text-slate-400">{' '}({fmtList(switchSummary.Hrow.benches)})</span>
                        {' · 候选 '}<span className="font-semibold text-slate-700">{switchSummary.Hrow.cands.length}</span> 对{' '}
                        <span className="text-[11px] text-slate-400">({fmtList(switchSummary.Hrow.cands) || '无'})</span>
                        {' · 规则 B：H-L ≥'}<span className="font-semibold text-slate-700">{buyOther !== null ? `${buyOther}%` : '—'}</span>
                      </span>
                    ) : null;
                    return (
                      <div className="flex flex-col gap-1">
                        {Lline}
                        {Hline}
                      </div>
                    );
                  })()}
                </div>
                <ChevronDown className={cx('h-4 w-4 shrink-0 transition-transform', workerConfigExpanded ? 'rotate-180' : '')} />
              </div>
            </button>

            {workerConfigExpanded ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {/* 单一数据源：选择的 prefs.benchmarkCodes / enabledCodes / 阈值。 */}
                  {workerConfig.updatedAt ? (
                    <span className="ml-auto text-[11px] text-slate-400">上次同步 {formatDate(workerConfig.updatedAt) || workerConfig.updatedAt}</span>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">worker 最近一次计算</div>
                    {workerSnapshot?.computedAt ? (
                      <div className="text-xs text-slate-500">算于 {formatDate(workerSnapshot.computedAt) || workerSnapshot.computedAt}</div>
                    ) : <div className="text-xs text-slate-400">尚无快照</div>}
                  </div>
                  {workerSnapshot ? (
                    <div className="mt-3 space-y-2 text-sm">
                      {(() => {
                        // 兼容旧版快照（顶层 benchmarkCode + candidates）。
                        const benchSnapshots = Array.isArray(workerSnapshot.byBenchmark) && workerSnapshot.byBenchmark.length
                          ? workerSnapshot.byBenchmark
                          : (workerSnapshot.benchmarkCode ? [{
                              benchmarkCode: workerSnapshot.benchmarkCode,
                              benchmarkName: workerSnapshot.benchmarkName,
                              benchmarkPrice: workerSnapshot.benchmarkPrice,
                              benchmarkNav: workerSnapshot.benchmarkNav,
                              benchmarkNavDate: workerSnapshot.benchmarkNavDate,
                              benchmarkPremiumPct: workerSnapshot.benchmarkPremiumPct,
                              candidates: workerSnapshot.candidates || []
                            }] : []);
                        if (!benchSnapshots.length) {
                          return (
                            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-400">
                              快照中暂无基准数据。
                            </div>
                          );
                        }
                        const sellLower = Number(workerSnapshot.intraSellLowerPct);
                        const buyOther = Number(workerSnapshot.intraBuyOtherPct);
                        const cls = prefs.premiumClass || {};
                        return benchSnapshots.map((bench) => (
                          <div key={`bench-${bench.benchmarkCode}`} className="space-y-2">
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">基准 {bench.benchmarkCode}{bench.benchmarkName ? ` · ${bench.benchmarkName}` : ''}</div>
                              <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-slate-600">
                                <div>现价 <span className="font-semibold text-slate-800">{formatPrice(bench.benchmarkPrice)}</span></div>
                                <div>净值 <span className="font-semibold text-slate-800">{formatPrice(bench.benchmarkNav)}</span>{bench.benchmarkNavDate ? <span className="ml-1 text-slate-400">@{bench.benchmarkNavDate}</span> : null}</div>
                                <div>溢价 <span className="font-semibold text-slate-800">{formatPercent(bench.benchmarkPremiumPct, 2, true)}</span></div>
                              </div>
                            </div>
                            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-100 text-slate-500">
                                  <tr>
                                    <th className="px-3 py-2 text-left">候选</th>
                                    <th className="px-3 py-2 text-right">现价</th>
                                    <th className="px-3 py-2 text-right">净值</th>
                                    <th className="px-3 py-2 text-right">溢价</th>
                                    <th className="px-3 py-2 text-right">与基准差</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(bench.candidates || []).map((c) => {
                                    // v3: class-aware highlight. diff = bench.premium - cand.premium.
                                    //   bench=L → gap = -diff; 规则 A: gap < sellLower
                                    //   bench=H → gap = diff;  规则 B: gap > buyOther
                                    const diff = Number(c.spreadVsBenchmarkPct);
                                    const benchClass = cls[bench.benchmarkCode];
                                    const candClass = cls[c.code];
                                    const eligible = (benchClass === 'H' || benchClass === 'L') && (candClass === 'H' || candClass === 'L') && benchClass !== candClass;
                                    let inA = false;
                                    let inB = false;
                                    if (eligible && Number.isFinite(diff)) {
                                      const gap = benchClass === 'H' ? diff : -diff;
                                      if (benchClass === 'L' && Number.isFinite(sellLower) && gap < sellLower) inA = true;
                                      if (benchClass === 'H' && Number.isFinite(buyOther) && gap > buyOther) inB = true;
                                    }
                                    const colorCls = inA ? 'text-emerald-700 font-semibold' : inB ? 'text-rose-700 font-semibold' : 'text-slate-600';
                                    return (
                                      <tr key={`snap-${bench.benchmarkCode}-${c.code}`} className="border-t border-slate-100">
                                        <td className="px-3 py-2"><span className="font-semibold">{c.code}</span>{c.name ? <span className="ml-1 text-slate-400">{c.name}</span> : null}</td>
                                        <td className="px-3 py-2 text-right">{formatPrice(c.price)}</td>
                                        <td className="px-3 py-2 text-right">{formatPrice(c.nav)}{c.navDate ? <span className="ml-1 text-slate-400">@{c.navDate}</span> : null}</td>
                                        <td className="px-3 py-2 text-right">{formatPercent(c.premiumPct, 2, true)}</td>
                                        <td className={cx('px-3 py-2 text-right', colorCls)}>{formatPercent(c.spreadVsBenchmarkPct, 2, true)}</td>
                                      </tr>
                                    );
                                  })}
                                  {(!bench.candidates || bench.candidates.length === 0) ? (
                                    <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">快照中暂无候选数据。</td></tr>
                                  ) : null}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ));
                      })()}
                      {(workerSnapshot.triggers || []).length > 0 ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                          <div className="font-semibold">本轮触发 {workerSnapshot.triggers.length} 个信号</div>
                          <ul className="mt-1 list-disc pl-4">
                            {workerSnapshot.triggers.map((t, idx) => (
                              <li key={`trig-${idx}`}>规则 {t.rule || (Number(t.diffPct ?? t.spreadPct) >= 0 ? 'B' : 'A')} · 卖 {t.fromCode} → 买 {t.toCode}：diff {formatPercent(t.diffPct ?? t.spreadPct, 2, true)}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-400">
                      暂无最近一次计算结果，先手动跑一次或等待 worker 扫描。
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="切换策略"
          title="场内 / 场外纳指 100 切换套利"
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
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">套利目标</div>
              <input
                type="number"
                step="0.5"
                className="w-24 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 focus:border-indigo-300 focus:outline-none"
                value={prefs.arbTargetPct}
                onChange={(e) => setPrefValue('arbTargetPct', e.target.value)}
              />
              <span className="text-sm text-slate-600">% / 周期</span>
            </div>
          </div>
          {(() => {
            const cls = prefs.premiumClass || {};
            const held = exchangeFunds.map((f) => ({ code: f.code, name: f.name || '', cls: cls[f.code] || null }));
            if (!held.length) return null;
            return (
              <div className="space-y-1 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs leading-relaxed text-indigo-900">
                {held.map((h) => {
                  if (h.cls === 'H' || h.cls === 'L') {
                    const opp = h.cls === 'H' ? 'L' : 'H';
                    const candCount = Object.entries(cls).filter(([c, v]) => v === opp && c !== h.code).length;
                    const ruleStr = h.cls === 'H'
                      ? `规则 B（gap > ${prefs.intraBuyOtherPct}%）`
                      : `规则 A（gap < ${prefs.intraSellLowerPct}%）`;
                    return (
                      <div key={h.code}>
                        持仓 <strong>{h.code}</strong>{h.name ? `（${h.name}）` : ''} 属于 <strong>{h.cls}</strong> 组 → 仅看 {opp} 组的 {candCount} 只候选，触发条件 {ruleStr}。
                      </div>
                    );
                  }
                  return (
                    <div key={h.code}>
                      持仓 <strong>{h.code}</strong>{h.name ? `（${h.name}）` : ''} 还没分类。请把它拖入下方的 <strong>H</strong> 或 <strong>L</strong> 表格才会触发信号。
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {(() => {
            const cls = prefs.premiumClass || {};
            const heldSet = new Set(exchangeFunds.map((f) => f.code));
            const renderChip = (f) => {
              const code = f.code;
              const cur = cls[code] || null;
              const isHeld = heldSet.has(code);
              const hasNav = Number.isFinite(f.navLatest);
              const priceSourceLabel = f.latestPriceDate || 'daily';
              return (
                <div
                  key={code}
                  draggable
                  onDragStart={(e) => handleChipDragStart(e, code)}
                  title={hasNav
                    ? `NAV ${f.navLatest.toFixed(4)} (${f.navLatestDate})・现价 ${formatPrice(f.latestNav)} (${priceSourceLabel})`
                    : '净值数据未就绪'}
                  className={cx(
                    'group inline-flex select-none items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold transition-colors cursor-grab active:cursor-grabbing',
                    cur === 'H' ? 'border-rose-200 bg-rose-50 text-rose-800' :
                    cur === 'L' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' :
                    'border-slate-200 bg-white text-slate-600'
                  )}
                >
                  <span>{code}</span>
                  {f.name ? (
                    <>
                      <span className="text-slate-400">·</span>
                      <span className="max-w-[100px] truncate text-slate-500">{f.name}</span>
                    </>
                  ) : null}
                  {isHeld ? <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">持</span> : null}
                  <span className="ml-1 inline-flex overflow-hidden rounded border border-slate-200 text-[10px]">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCodeClass(code, cur === 'H' ? null : 'H'); }}
                      className={cx('px-1.5 py-0.5', cur === 'H' ? 'bg-rose-500 text-white' : 'bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-700')}
                    >H</button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCodeClass(code, cur === 'L' ? null : 'L'); }}
                      className={cx('px-1.5 py-0.5 border-l border-slate-200', cur === 'L' ? 'bg-emerald-500 text-white' : 'bg-white text-slate-500 hover:bg-emerald-50 hover:text-emerald-700')}
                    >L</button>
                  </span>
                </div>
              );
            };
            const poolList = fundsWithPremium.filter((f) => !cls[f.code]);
            const hList = fundsWithPremium.filter((f) => cls[f.code] === 'H');
            const lList = fundsWithPremium.filter((f) => cls[f.code] === 'L');
            return (
              <div className="space-y-3">
                <div
                  onDragOver={(e) => handleZoneDragOver(e, 'pool')}
                  onDragLeave={handleZoneDragLeave}
                  onDrop={(e) => handleZoneDrop(e, null)}
                  className={cx(
                    'rounded-2xl border bg-white p-4 transition-colors',
                    dragOverZone === 'pool' ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">所有纳指 ETF（未分类）</div>
                    <div className="text-xs text-slate-500">{poolList.length} / 共 {fundsWithPremium.length} 只</div>
                  </div>
                  {universeError ? (
                    <div className="mt-2 text-xs text-rose-600">候选基金列表加载失败：{universeError}</div>
                  ) : null}
                  <div className="mt-3 flex min-h-[44px] flex-wrap gap-2">
                    {fundsWithPremium.length === 0 ? (
                      <div className="text-sm text-slate-500">候选基金尚未加载。</div>
                    ) : poolList.length === 0 ? (
                      <div className="text-xs text-slate-400">所有 ETF 都已分类。可把 chip 拖回此处取消分类。</div>
                    ) : poolList.map(renderChip)}
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">把溢价常年更高的拖到 <strong className="text-rose-700">H 组</strong>（如 513100），溢价常年更低的拖到 <strong className="text-emerald-700">L 组</strong>（如 159632）。也可点 chip 右侧的 H/L 按钮直接归类。</div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div
                    onDragOver={(e) => handleZoneDragOver(e, 'H')}
                    onDragLeave={handleZoneDragLeave}
                    onDrop={(e) => handleZoneDrop(e, 'H')}
                    className={cx(
                      'rounded-2xl border bg-white p-4 transition-colors',
                      dragOverZone === 'H' ? 'border-rose-400 ring-2 ring-rose-200' : 'border-rose-200'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">高溢价组 H</div>
                      <div className="text-xs text-slate-500">{hList.length} 只</div>
                    </div>
                    <div className="mt-3 flex min-h-[44px] flex-wrap gap-2">
                      {hList.length === 0 ? (
                        <div className="text-xs text-slate-400">把溢价常年更高的 ETF 拖到这里。</div>
                      ) : hList.map(renderChip)}
                    </div>
                  </div>
                  <div
                    onDragOver={(e) => handleZoneDragOver(e, 'L')}
                    onDragLeave={handleZoneDragLeave}
                    onDrop={(e) => handleZoneDrop(e, 'L')}
                    className={cx(
                      'rounded-2xl border bg-white p-4 transition-colors',
                      dragOverZone === 'L' ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-emerald-200'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">低溢价组 L</div>
                      <div className="text-xs text-slate-500">{lList.length} 只</div>
                    </div>
                    <div className="mt-3 flex min-h-[44px] flex-wrap gap-2">
                      {lList.length === 0 ? (
                        <div className="text-xs text-slate-400">把溢价常年更低的 ETF 拖到这里。</div>
                      ) : lList.map(renderChip)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="场内切换信号"
          title="在持有的场内 ETF 之间倒换"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">规则 A</div>
            <div className="mt-1 text-slate-700">
              H溢价 − L溢价 {'<'}
              <input
                type="number"
                step="0.5"
                value={prefs.intraSellLowerPct}
                onChange={(e) => setPrefValue('intraSellLowerPct', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />
              %（差价收窄，低→高）→ 卖 L 买 H
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">规则 B</div>
            <div className="mt-1 text-slate-700">
              H溢价 − L溢价 {'>'}
              <input
                type="number"
                step="0.5"
                value={prefs.intraBuyOtherPct}
                onChange={(e) => setPrefValue('intraBuyOtherPct', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />
              %（差价扩大，高→低）→ 卖 H 买 L
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

      </Card>

      <Card>
        <SectionHeading
          eyebrow="场外切换信号"
          title="将场内基准换为场外 QDII 联接基金"
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
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="套利轮次记录"
          title="切换周期人工日志"
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
