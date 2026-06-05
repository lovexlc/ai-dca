import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readLedgerState, persistLedgerState } from '../app/holdingsLedger.js';
import { aggregateByCode, buildTransactionId, detectFundKind, normalizeTransaction } from '../app/holdingsLedgerCore.js';
import { getNavSnapshots } from '../app/navService.js';
import {
  buildSwitchConfigSyncKey,
  loadSwitchConfigFromWorker,
  loadSwitchSnapshotFromWorker,
  normalizeSwitchConfigShape,
  readSwitchConfigCache,
  runSwitchOnce,
  saveSwitchConfigToWorker
} from '../app/switchStrategySync.js';
import {
  formatSwitchDate as formatDate,
  formatSwitchPercent as formatPercent,
  formatSwitchPrice as formatPrice,
  loadNasdaqList as loadNasdqList,
  nowIso,
  readSwitchPrefs as readPrefs,
  writeSwitchPrefs as writePrefs,
} from './switchStrategyHelpers.js';
import {
  SwitchStrategyQuickRecordModal,
  SwitchStrategySnapshotModal,
  SwitchStrategyWorkerPanel
} from './SwitchStrategyPanels.jsx';
import { SwitchStrategyClassificationPanel } from './SwitchStrategyClassificationPanel.jsx';
import { SwitchStrategyOpportunityPanels } from './SwitchStrategyOpportunityPanels.jsx';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';

// 场内 / 场外纳指 100 切换套利策略实时建议器；纯格式化、偏好读写和候选列表 helper 在 switchStrategyHelpers.js。

export function SwitchStrategyExperience({ links, inPagesDir = false, embedded = false, initialView = 'opportunity', hideViewTabs = false } = {}) {
  const [prefs, setPrefs] = useState(readPrefs);
  // 「记录此次切换」快捷入口的 Modal 表单状态。
  // 为 null 时不渲染 Modal；设为表单对象后开启录入。
  const [quickRecord, setQuickRecord] = useState(null);
  // worker 最近一次计算里点击「查看候选」后弹出的详情 modal。
  // 为空时不渲染 modal；设为 { bench, sellLower, buyOther, cls } 后弹起。
  const [snapshotCandModal, setSnapshotCandModal] = useState(null);
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
  // 实时行情：统一来自 markets Worker fund metrics。
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
  const postConfigRunKeyRef = useRef('');
  // “所有纳指 ETF（未分类）”折叠状态：当 H/L 组都有内容时默认折叠。
  const [nasdaqPoolExpanded, setNasdaqPoolExpanded] = useState(true);
  const [nasdaqPoolTouched, setNasdaqPoolTouched] = useState(false);
  const [switchView, setSwitchView] = useState(initialView === 'config' ? 'config' : 'opportunity');

  const switchMeta = () => ({
    embedded,
    initialView,
    switchView,
    workerEnabled: Boolean(workerConfig.enabled),
    workerHasSnapshot: Boolean(workerSnapshot),
    workerConfigExpanded,
    benchmarkCount: Array.isArray(prefs?.benchmarkCodes) ? prefs.benchmarkCodes.length : 0,
    enabledCodeCount: Array.isArray(prefs?.enabledCodes) ? prefs.enabledCodes.length : 0,
    exchangeHoldingCount: Array.isArray(exchangeFunds) ? exchangeFunds.length : 0,
    universeCount: Array.isArray(candidateUniverse) ? candidateUniverse.length : 0,
    hClassCount: premiumClassCounts.h,
    lClassCount: premiumClassCounts.l,
    pairCount: Number(switchSummary?.pairs || 0),
    intraSignalCount: Array.isArray(intraSignals) ? intraSignals.length : 0,
    otcReady: Boolean(otcSignal?.ready),
    otcTriggered: Boolean(otcSignal?.triggered),
    navError: Boolean(navState.error),
    universeError: Boolean(universeError)
  });

  const premiumClassCounts = useMemo(() => {
    const cls = (prefs && prefs.premiumClass) || {};
    let h = 0;
    let l = 0;
    Object.values(cls).forEach((v) => {
      if (v === 'H') h += 1;
      else if (v === 'L') l += 1;
    });
    return { h, l };
  }, [prefs?.premiumClass]);

  useEffect(() => {
    if (nasdaqPoolTouched) return;
    const shouldAutoCollapsePool = premiumClassCounts.h > 0 && premiumClassCounts.l > 0;
    setNasdaqPoolExpanded(!shouldAutoCollapsePool);
  }, [premiumClassCounts.h, premiumClassCounts.l, nasdaqPoolTouched]);

  useEffect(() => { writePrefs(prefs); }, [prefs]);

  useEffect(() => {
    setSwitchView(initialView === 'config' ? 'config' : 'opportunity');
  }, [initialView]);

  // 首次入页：从 worker 拉取配置 + 快照。失败不阻断 UI（本地缓存仍可用）。
  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    trackFeatureEvent('switch_strategy', 'worker_initial_load_start', switchMeta());
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
        trackActionResult('switch_strategy', 'worker_initial_load', 'success', {
          ...switchMeta(),
          hasConfig: Boolean(config),
          hasSnapshot: Boolean(snapshotPayload?.snapshot),
          durationMs: Date.now() - startedAt
        });
      } catch (error) {
        if (cancelled) return;
        setWorkerStatus((prev) => ({
          ...prev,
          loading: false,
          error: error?.message || '加载 worker 配置失败'
        }));
        trackActionResult('switch_strategy', 'worker_initial_load', 'error', {
          ...switchMeta(),
          durationMs: Date.now() - startedAt,
          errorName: error?.name || '',
          errorMessage: String(error?.message || error || '').slice(0, 160)
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const persistWorkerConfig = useCallback(async (nextConfig) => {
    const normalized = normalizeSwitchConfigShape(nextConfig);
    const startedAt = Date.now();
    trackFeatureEvent('switch_strategy', 'worker_config_save_start', {
      enabled: Boolean(normalized.enabled),
      benchmarkCount: Array.isArray(normalized.benchmarkCodes) ? normalized.benchmarkCodes.length : 0,
      enabledCodeCount: Array.isArray(normalized.enabledCodes) ? normalized.enabledCodes.length : 0,
      classCount: Object.keys(normalized.premiumClass || {}).length
    });
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
      // 配置推完后马上跳一次 worker run，让页面的「场内信号」立刻拿到新 prefs
      // 计算出的 snapshot.signals（不启用监控时 worker 也会计 snapshot、仅不推送）。
      // 同一份归一化配置只自动 run 一次；否则保存响应中的 metadata 或重复 autosave
      // 会把 /switch/run 放大成连续请求。
      try {
        const runKey = buildSwitchConfigSyncKey(stored);
        if (postConfigRunKeyRef.current !== runKey) {
          postConfigRunKeyRef.current = runKey;
          const runPayload = await runSwitchOnce();
          if (runPayload?.snapshot) setWorkerSnapshot(runPayload.snapshot);
          trackActionResult('switch_strategy', 'worker_post_config_run', 'success', {
            triggeredCount: Number(runPayload?.summary?.triggered || 0),
            pushedCount: Number(runPayload?.summary?.pushed || 0),
            hasSnapshot: Boolean(runPayload?.snapshot)
          });
        }
      } catch (runErr) {
        // 静默失败：下一轮定时拉取会填上，不覆盖 saving notice。
        if (typeof console !== 'undefined') console.warn('[switch] post-config run failed', runErr);
        trackActionResult('switch_strategy', 'worker_post_config_run', 'error', {
          errorName: runErr?.name || '',
          errorMessage: String(runErr?.message || runErr || '').slice(0, 160)
        });
      }
      trackActionResult('switch_strategy', 'worker_config_save', 'success', {
        enabled: Boolean(stored.enabled),
        benchmarkCount: Array.isArray(benchmarkCodes) ? benchmarkCodes.length : 0,
        candidateCount,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      setWorkerStatus((prev) => ({
        ...prev,
        saving: false,
        error: error?.message || '保存到 worker 失败'
      }));
      trackActionResult('switch_strategy', 'worker_config_save', 'error', {
        enabled: Boolean(normalized.enabled),
        durationMs: Date.now() - startedAt,
        errorName: error?.name || '',
        errorMessage: String(error?.message || error || '').slice(0, 160)
      });
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

  // 启用时将页面 prefs 一起带上，worker 立刻获得可运行的配置。
  const handleWorkerToggle = useCallback((enabled) => {
    trackFeatureEvent('switch_strategy', 'worker_toggle', {
      enabled: Boolean(enabled),
      benchmarkCount: Array.isArray(prefs?.benchmarkCodes) ? prefs.benchmarkCodes.length : 0,
      enabledCodeCount: Array.isArray(prefs?.enabledCodes) ? prefs.enabledCodes.length : 0
    });
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
        intraBuyOtherPct: Number(prefs?.intraBuyOtherPct),
        otcPremiumThresholdPct: Number(prefs?.otcPremiumThresholdPct),
        otcMinIntraPremiumLow: Number(prefs?.otcMinIntraPremiumLow),
        otcMinIntraPremiumHigh: Number(prefs?.otcMinIntraPremiumHigh)
      });
    } else {
      void persistWorkerConfig({ ...workerConfig, enabled: false });
    }
  }, [workerConfig, persistWorkerConfig, prefs]);

  const desiredWorkerConfig = useMemo(() => normalizeSwitchConfigShape({
    // enabled 保留开关状态：未启用时仍然同步配置，worker run 仅计不推。
    enabled: Boolean(workerConfig.enabled),
    benchmarkCodes: prefs?.benchmarkCodes || [],
    enabledCodes: prefs?.enabledCodes || [],
    premiumClass: prefs?.premiumClass || {},
    intraSellLowerPct: prefs?.intraSellLowerPct,
    intraBuyOtherPct: prefs?.intraBuyOtherPct,
    otcPremiumThresholdPct: prefs?.otcPremiumThresholdPct,
    otcMinIntraPremiumLow: prefs?.otcMinIntraPremiumLow,
    otcMinIntraPremiumHigh: prefs?.otcMinIntraPremiumHigh
  }), [
    workerConfig.enabled,
    prefs?.benchmarkCodes,
    prefs?.enabledCodes,
    prefs?.premiumClass,
    prefs?.intraSellLowerPct,
    prefs?.intraBuyOtherPct,
    prefs?.otcPremiumThresholdPct,
    prefs?.otcMinIntraPremiumLow,
    prefs?.otcMinIntraPremiumHigh
  ]);
  const desiredWorkerConfigKey = useMemo(
    () => buildSwitchConfigSyncKey(desiredWorkerConfig),
    [desiredWorkerConfig]
  );
  const workerConfigKey = useMemo(
    () => buildSwitchConfigSyncKey(workerConfig),
    [workerConfig]
  );

  // prefs 变动同步到 worker（debounce 800ms）。
  // v4：不再受 enabled 制约 —— 只要本地 prefs 与 worker 存的不一致就推。UI 现在统一
  // 渲染 worker 计算的 signals，必须保证 worker 这边的 benchmarkCodes / premiumClass 始终
  // 与本地 prefs 同步，否则 snapshot 会用陈旧配置算。
  useEffect(() => {
    // 关键：把 desired 也跑一遍 normalizeSwitchConfigShape，让本地 diff 口径与
    // 服务端持久化口径完全一致。否则会出现：
    //   prefs.premiumClass 里有些 code 不在 benchmark ∪ enabled 里 → 服务端归一化
    //   会剔除它们 → 本地 diff 用未归一化的 prefs 比较时永远 != → 800ms 反复
    //   POST /switch/config，浏览器看上去一直在刷新。
    // 同理各类阈值若为 NaN，归一化会 fallback 到
    // 默认值，也会形成同款死循环。
    if (!desiredWorkerConfig.benchmarkCodes.length) return undefined;
    if (workerConfigKey === desiredWorkerConfigKey) return undefined;
    const timer = setTimeout(() => {
      // 直接下发已归一化的 desired，避免 server 再次裁剪后产生新的状态差。
      void persistWorkerConfig(desiredWorkerConfig);
    }, 800);
    return () => clearTimeout(timer);
  }, [
    desiredWorkerConfig,
    desiredWorkerConfigKey,
    persistWorkerConfig,
    workerConfigKey
  ]);

  // 自动刷新「worker 最近一次计算」：从 worker 拉取 snapshot（只保留最后一条）。
  // 无论是否启用自动监控，都应该能看到 worker 端最近一次执行留下的快照；
  // 否则 UI 会只剩「手动跑一次」写入的记录。
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const payload = await loadSwitchSnapshotFromWorker();
        if (cancelled) return;
        if (payload?.snapshot) setWorkerSnapshot(payload.snapshot);
      } catch (_error) {
        // ignore
      }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const handleWorkerRunOnce = useCallback(async () => {
    const startedAt = Date.now();
    trackFeatureEvent('switch_strategy', 'worker_run_once_start', switchMeta());
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
      trackActionResult('switch_strategy', 'worker_run_once', 'success', {
        ...switchMeta(),
        triggeredCount: triggered,
        pushedCount: pushed,
        hasSnapshot: Boolean(payload?.snapshot),
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      setWorkerStatus((prev) => ({
        ...prev,
        running: false,
        error: error?.message || '手动运行失败'
      }));
      trackActionResult('switch_strategy', 'worker_run_once', 'error', {
        ...switchMeta(),
        durationMs: Date.now() - startedAt,
        errorName: error?.name || '',
        errorMessage: String(error?.message || error || '').slice(0, 160)
      });
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
  // 里所有 code 都必须落在 exchangeFunds 之内。这里在 exchangeFunds 变化后：
  //   1) 先按原顺序保留仍然持仓且已分类（H/L）的 code；
  //   2) 再把当前持仓中已分类、但尚未列入 benchmarkCodes 的 code 追加进去；
  //   3) 如果最终为空（极端情况：暂时没有任何已分类持仓），fallback 到第一只持仓 ETF。
  // 这样：
  //   - 新增已分类持仓（例如再买入一只 L 类 ETF）会自动成为基准；
  //   - 持仓但还没分类的 ETF（premiumClass 没标 H/L，例如 563020）不会被算成基准，
  //     避免顶部绿条把它统计进 "基准 N 只"，因为没有 class 也无法参与任何规则。
  const benchmarkCodesJoined = (prefs?.benchmarkCodes || []).join(',');
  useEffect(() => {
    if (!exchangeFunds.length) return;
    const cls = (prefs && prefs.premiumClass) || {};
    const heldOrder = exchangeFunds.map((f) => f.code);
    const heldClassified = heldOrder.filter((code) => cls[code] === 'H' || cls[code] === 'L');
    const heldClassifiedSet = new Set(heldClassified);
    setPrefs((prev) => {
      const before = Array.isArray(prev.benchmarkCodes) ? prev.benchmarkCodes : [];
      const kept = before.filter((code) => heldClassifiedSet.has(code));
      const keptSet = new Set(kept);
      // 按 exchangeFunds 顺序追加尚未在 benchmarkCodes 中、但已分类的持仓 code。
      const appended = heldClassified.filter((code) => !keptSet.has(code));
      const merged = [...kept, ...appended];
      // fallback：如果没有任何已分类持仓，至少保住一个非空 benchmarkCodes（用首个持仓），
      // 避免下游空数组造成的边角问题；用户分类后下次 effect 会刷成正确值。
      const next = merged.length ? merged : [heldOrder[0]];
      if (next.length === before.length && next.every((v, i) => v === before[i])) return prev;
      return { ...prev, benchmarkCodes: next };
    });
  }, [exchangeFunds, benchmarkCodesJoined, premiumClassKey]);

  // 拉取所有候选 ETF 的 Worker 统一指标（候选池来自 data/all_nasdq.json，不仅限于持仓）。
  const loadNav = useCallback(async () => {
    const startedAt = Date.now();
    trackFeatureEvent('switch_strategy', 'metrics_refresh_start', {
      universeCount: candidateUniverse.length
    });
    setNavState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const codes = candidateUniverse.map((f) => f.code);
      if (!codes.length) {
        setNavState({ loading: false, error: '', navByCode: {}, generatedAt: nowIso() });
        setPriceState({ priceByCode: {} });
        trackActionResult('switch_strategy', 'metrics_refresh', 'empty', {
          universeCount: 0,
          durationMs: Date.now() - startedAt
        });
        return;
      }
      const navByCode = {};
      const priceByCode = {};
      const result = await getNavSnapshots(codes, { forceRefresh: true });
      for (const item of result?.items || []) {
        if (!item?.code || item.ok === false) continue;
        const price = Number(item.price ?? item.currentPrice ?? item.close);
        const latestNav = Number(item.latestNav);
        navByCode[item.code] = {
          code: item.code,
          name: item.name || '',
          latestNav: Number.isFinite(latestNav) && latestNav > 0 ? latestNav : null,
          latestNavDate: item.latestNavDate || item.navDate || '',
          previousNav: Number.isFinite(item.previousNav) && item.previousNav > 0 ? item.previousNav : null,
          previousNavDate: item.previousNavDate || '',
          source: item.source || 'fund-metrics',
          iopv: Number.isFinite(Number(item.iopv)) && Number(item.iopv) > 0 ? Number(item.iopv) : null,
          navBase: Number.isFinite(Number(item.navBase)) && Number(item.navBase) > 0 ? Number(item.navBase) : null,
          premiumPercent: Number.isFinite(Number(item.premiumPercent)) ? Number(item.premiumPercent) : null
        };
        if (Number.isFinite(price) && price > 0) {
          priceByCode[item.code] = {
            code: item.code,
            close: price,
            date: item.asOf || item.updatedAt || result.generatedAt || ''
          };
        }
      }

      setNavState({
        loading: false,
        error: Object.keys(navByCode).length === 0 ? '未拿到 ETF 实时数据，请稍后重试。' : '',
        navByCode,
        generatedAt: nowIso()
      });
      setPriceState({ priceByCode });
      trackActionResult('switch_strategy', 'metrics_refresh', Object.keys(navByCode).length === 0 ? 'empty' : 'success', {
        requestedCount: codes.length,
        successCount: Object.keys(navByCode).length,
        priceCount: Object.keys(priceByCode).length,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      setNavState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : '实时数据加载失败'
      }));
      trackActionResult('switch_strategy', 'metrics_refresh', 'error', {
        universeCount: candidateUniverse.length,
        durationMs: Date.now() - startedAt,
        errorName: error?.name || '',
        errorMessage: String(error?.message || error || '').slice(0, 160)
      });
    }
  }, [candidateUniverse]);

  useEffect(() => { loadNav(); }, [loadNav, refreshTick]);

  // 合并 Worker 返回的价格、净值与溢价；浏览器不再重复计算溢价。
  const fundsWithPremium = useMemo(() => {
    return candidateUniverse.map((u) => {
      const navEntry = navState.navByCode?.[u.code] || null;
      const priceEntry = priceState.priceByCode?.[u.code] || null;
      const px = Number(priceEntry?.close);
      const nav = Number(navEntry?.latestNav);
      const premiumPct = Number.isFinite(Number(navEntry?.premiumPercent)) ? Number(navEntry.premiumPercent) : null;
      return {
        code: u.code,
        name: navEntry?.name || u.name || '',
        kind: exchangeFunds.find((f) => f.code === u.code)?.kind || 'exchange',
        hasPosition: exchangeFunds.some((f) => f.code === u.code),
        latestNav: Number.isFinite(px) && px > 0 ? px : null,
        latestPriceDate: priceEntry?.date || '',
        navLatest: nav > 0 ? nav : null,
        navLatestDate: navEntry?.latestNavDate || '',
        premiumRate: premiumPct,
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
    trackFeatureEvent('switch_strategy', 'pref_change', {
      key,
      valueKind: value === '' ? 'empty' : Number.isFinite(Number(value)) ? 'number' : typeof value,
      ...switchMeta()
    });
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }
  // 拖拽分类：将 code 套入 H / L / 未分类。targetClass=null 表示从分类中移出。
  function setCodeClass(code, targetClass) {
    if (!code) return;
    const beforeClass = prefs?.premiumClass?.[code] || null;
    trackFeatureEvent('switch_strategy', 'code_class_change', {
      codeLength: String(code || '').length,
      beforeClass,
      targetClass: targetClass || 'none',
      via: 'button_or_drop',
      ...switchMeta()
    });
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
    trackFeatureEvent('switch_strategy', 'code_drop', {
      codeLength: String(code || '').length,
      targetClass: targetClass || 'none'
    });
    setCodeClass(code, targetClass);
  }, []);

  // 场内信号：统一使用 worker 计算的 snapshot.signals，不再在浏览器重复算一份。
  //  - workerSnapshot 来自 /api/notify/switch/snapshot（本页顶部 useEffect 会定期拉）。
  //  - 没启用自动监控也能看到 signals：未启用时 worker 仅计算不推送。
  //  - prefs 变动后会 auto-sync config 到 worker，随后手动/定时 run 刷新 snapshot。
  const intraSignals = useMemo(() => {
    const list = Array.isArray(workerSnapshot?.signals) ? workerSnapshot.signals : [];
    return list.map((s) => ({
      kind: s.kind,
      from: s.from,
      fromName: s.fromName || s.from,
      to: s.to,
      toName: s.toName || s.to,
      description: s.description || ''
    }));
  }, [workerSnapshot]);

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
        message: navState.loading ? '正在加载实时基金指标…' : (navState.error || '实时数据未就绪。')
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

  const workerRunDisabledReason = workerStatus.running
    ? '正在运行'
    : workerStatus.saving
    ? '配置同步中'
    : !switchSummary.benches.length
    ? '先配置 H/L 基准'
    : switchSummary.pairs === 0
    ? '先配置候选配对'
    : '';

  // 机会卡片点「记录此次切换」后的快捷入口：
  //   1. 从 intra signal / otc signal 预填表单 → setQuickRecord(form)。
  //   2. 用户在 Modal 里补全价格、份额、备注 → saveQuickRecord 写入持仓 ledger。
  //   3. 两笔交易 (SELL + BUY) 互指 switchPairId，复盘页 buildAutoSwitchChains 会自动推导出切换链路；
  //      持仓总览也读同一份 holdings ledger，无需额外同步。
  const openQuickRecordFromIntra = useCallback((sig) => {
    trackFeatureEvent('switch_strategy', 'quick_record_open', {
      sourceKind: 'intra',
      ruleKind: sig?.kind || '',
      fromCodeLength: String(sig?.from || '').length,
      toCodeLength: String(sig?.to || '').length,
      intraSignalCount: intraSignals.length
    });
    setQuickRecord({
      date: new Date().toISOString().slice(0, 10),
      sellCode: sig?.from || '',
      sellName: sig?.fromName || '',
      sellPrice: '',
      sellShares: '',
      buyCode: sig?.to || '',
      buyName: sig?.toName || '',
      buyPrice: '',
      buyShares: '',
      note: `规则 ${sig?.kind || ''} · ${sig?.description || ''}`.trim(),
      sourceKind: 'intra'
    });
  }, [intraSignals.length]);

  const openQuickRecordFromOtc = useCallback(() => {
    trackFeatureEvent('switch_strategy', 'quick_record_open', {
      sourceKind: 'otc',
      benchCodeLength: String(otcSignal?.benchCode || '').length,
      lowestCodeLength: String(otcSignal?.lowestCode || '').length,
      otcLevel: otcSignal?.level || ''
    });
    setQuickRecord({
      date: new Date().toISOString().slice(0, 10),
      sellCode: otcSignal?.benchCode || '',
      sellName: otcSignal?.benchName || '',
      sellPrice: '',
      sellShares: '',
      buyCode: '',
      buyName: '',
      buyPrice: '',
      buyShares: '',
      note: `场外申购 QDII 联接 · 参考场内最低溢价 ${otcSignal?.lowestCode || ''}`,
      sourceKind: 'otc'
    });
  }, [otcSignal?.benchCode, otcSignal?.benchName, otcSignal?.lowestCode]);

  const quickRecordValid = !!(
    quickRecord
    && quickRecord.sellCode && quickRecord.buyCode
    && Number(quickRecord.sellPrice) > 0
    && Number(quickRecord.sellShares) > 0
    && Number(quickRecord.buyPrice) > 0
    && Number(quickRecord.buyShares) > 0
  );

  const saveQuickRecord = useCallback(() => {
    if (!quickRecord) return;
    const sellPrice = Number(quickRecord.sellPrice);
    const sellShares = Number(quickRecord.sellShares);
    const buyPrice = Number(quickRecord.buyPrice);
    const buyShares = Number(quickRecord.buyShares);
    if (!quickRecord.sellCode || !quickRecord.buyCode) {
      trackActionResult('switch_strategy', 'quick_record_save', 'validation_error', {
        reason: 'missing_code',
        sourceKind: quickRecord.sourceKind || ''
      });
      return;
    }
    if (!(sellPrice > 0) || !(sellShares > 0) || !(buyPrice > 0) || !(buyShares > 0)) {
      trackActionResult('switch_strategy', 'quick_record_save', 'validation_error', {
        reason: 'invalid_trade_numbers',
        sourceKind: quickRecord.sourceKind || '',
        hasSellPrice: sellPrice > 0,
        hasSellShares: sellShares > 0,
        hasBuyPrice: buyPrice > 0,
        hasBuyShares: buyShares > 0
      });
      return;
    }
    const sellId = buildTransactionId('quick');
    const buyId = buildTransactionId('quick');
    const sellTx = normalizeTransaction({
      id: sellId,
      code: quickRecord.sellCode,
      name: quickRecord.sellName || '',
      kind: detectFundKind(quickRecord.sellCode, quickRecord.sellName || ''),
      type: 'SELL',
      date: quickRecord.date,
      price: sellPrice,
      shares: sellShares,
      switchPairId: buyId,
      note: quickRecord.note || ''
    }, { idPrefix: 'quick' });
    const buyTx = normalizeTransaction({
      id: buyId,
      code: quickRecord.buyCode,
      name: quickRecord.buyName || '',
      kind: detectFundKind(quickRecord.buyCode, quickRecord.buyName || ''),
      type: 'BUY',
      date: quickRecord.date,
      price: buyPrice,
      shares: buyShares,
      switchPairId: sellId,
      note: quickRecord.note || ''
    }, { idPrefix: 'quick' });
    const current = readLedgerState();
    persistLedgerState({
      ...current,
      transactions: [...(Array.isArray(current.transactions) ? current.transactions : []), sellTx, buyTx]
    });
    // 同窗口其它组件（复盘页、持仓总览页）不会自动收到 localStorage 的 storage 事件，
    // 主动 dispatch 一下便于订阅了 storage 的页面重新读取 ledger。
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new StorageEvent('storage', { key: 'aiDcaFundHoldingsLedger' }));
      }
    } catch (_error) { /* ignore */ }
    trackActionResult('switch_strategy', 'quick_record_save', 'success', {
      sourceKind: quickRecord.sourceKind || '',
      sellCodeLength: String(quickRecord.sellCode || '').length,
      buyCodeLength: String(quickRecord.buyCode || '').length
    });
    setQuickRecord(null);
  }, [quickRecord]);

  return (
    <div className="space-y-6">
      <SwitchStrategyWorkerPanel
        prefs={prefs}
        switchSummary={switchSummary}
        workerConfig={workerConfig}
        workerStatus={workerStatus}
        workerConfigExpanded={workerConfigExpanded}
        workerSnapshot={workerSnapshot}
        workerRunDisabledReason={workerRunDisabledReason}
        handleWorkerToggle={handleWorkerToggle}
        handleWorkerRunOnce={handleWorkerRunOnce}
        setWorkerConfigExpanded={setWorkerConfigExpanded}
        setSnapshotCandModal={(payload) => {
          trackFeatureEvent('switch_strategy', 'snapshot_candidates_open', {
            benchmarkCodeLength: String(payload?.bench?.benchmarkCode || '').length,
            candidateCount: Array.isArray(payload?.bench?.candidates) ? payload.bench.candidates.length : 0
          });
          setSnapshotCandModal(payload);
        }}
        formatDate={formatDate}
        formatPrice={formatPrice}
        formatPercent={formatPercent}
      />
      <SwitchStrategyClassificationPanel
        prefs={prefs}
        benchmarkSummary={benchmarkSummary}
        navUpdatedHint={navUpdatedHint}
        navError={navState.error}
        onRefresh={() => {
          trackFeatureEvent('switch_strategy', 'manual_refresh_click', switchMeta());
          setRefreshTick((n) => n + 1);
        }}
        setPrefValue={setPrefValue}
        fundsWithPremium={fundsWithPremium}
        exchangeFunds={exchangeFunds}
        universeError={universeError}
        nasdaqPoolExpanded={nasdaqPoolExpanded}
        setNasdaqPoolExpanded={setNasdaqPoolExpanded}
        setNasdaqPoolTouched={setNasdaqPoolTouched}
        dragOverZone={dragOverZone}
        handleChipDragStart={handleChipDragStart}
        handleZoneDragOver={handleZoneDragOver}
        handleZoneDragLeave={handleZoneDragLeave}
        handleZoneDrop={handleZoneDrop}
        setCodeClass={setCodeClass}
        formatPrice={formatPrice}
      />
      <SwitchStrategyOpportunityPanels
        prefs={prefs}
        setPrefValue={setPrefValue}
        intraSignals={intraSignals}
        openQuickRecordFromIntra={openQuickRecordFromIntra}
        otcSignal={otcSignal}
        openQuickRecordFromOtc={openQuickRecordFromOtc}
        links={links}
      />

      <SwitchStrategyQuickRecordModal
        quickRecord={quickRecord}
        setQuickRecord={setQuickRecord}
        quickRecordValid={quickRecordValid}
        saveQuickRecord={saveQuickRecord}
      />

      <SwitchStrategySnapshotModal
        snapshotCandModal={snapshotCandModal}
        setSnapshotCandModal={setSnapshotCandModal}
        formatPrice={formatPrice}
        formatPercent={formatPercent}
      />

    </div>
  );
}

export default SwitchStrategyExperience;
