import { useCallback, useEffect, useMemo, useState } from 'react';
import { readLedgerState, persistLedgerState } from '../app/holdingsLedger.js';
import { aggregateByCode } from '../app/holdingsLedgerCore.js';
import { getNavSnapshots } from '../app/navService.js';
import {
  addSwitchRule,
  buildSwitchConfigSyncKey,
  duplicateSwitchRule,
  getActiveSwitchRule,
  loadSwitchConfigFromWorker,
  loadSwitchSnapshotFromWorker,
  loadSwitchDataFromWorker,
  normalizeSwitchConfigShape,
  readSwitchConfigCache,
  removeSwitchRule,
  runSwitchOnce,
  selectSwitchRule,
  saveSwitchConfigToWorker,
  updateActiveSwitchRule
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
  SwitchStrategySnapshotModal,
  SwitchStrategyWorkerPanel,
  SwitchStrategyQuickRecordModal
} from './SwitchStrategyPanels.jsx';
import { cx } from '../components/experience-ui.jsx';
import { FundSwitchBenchmarkPicker } from '../components/FundSwitchBenchmarkPicker.jsx';
import { SwitchStrategyClassificationPanel } from './SwitchStrategyClassificationPanel.jsx';
import { SwitchStrategyOpportunityPanels } from './SwitchStrategyOpportunityPanels.jsx';
import { MobileFundSwitchOpportunity, MobileFundSwitchWatchlist } from './mobile/MobileFundSwitchOpportunity.jsx';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';
import {
  countRunnableSwitchRulesForUi,
  normalizeSwitchEntryAttribution,
  pickSwitchSnapshotForRule
} from './switchStrategyViewUtils.js';
import { buildQuickSwitchTransactions, isQuickSwitchRecordValid } from './fundSwitchRecordUtils.js';
import { buildFundSwitchOpportunityModel } from './mobile/fundSwitchOpportunityModel.js';

// 场内 / 场外纳指 100 切换套利策略实时建议器；纯格式化、偏好读写和候选列表 helper 在 switchStrategyHelpers.js。

export function SwitchStrategyExperience({ links, inPagesDir = false, embedded = false, initialView = 'opportunity', hideViewTabs = false, mobileView = 'opportunity', mobileOnly = false, initialSymbol = '', entryAttribution = null, refreshToken = 0 } = {}) {
  const [prefs, setPrefs] = useState(readPrefs);
  // worker 最近一次计算里点击「查看候选」后弹出的详情 modal。
  // 为空时不渲染 modal；设为 { bench, sellLower, buyOther, cls } 后弹起。
  const [snapshotCandModal, setSnapshotCandModal] = useState(null);
  // 快速记录切换交易的 modal 状态
  const [quickRecord, setQuickRecord] = useState(null);
  const [aggregates, setAggregates] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [navState, setNavState] = useState({
    loading: true,
    error: '',
    navByCode: {},
    generatedAt: ''
  });

  // 候选基金 universe = 内置纳指 100 场内 ETF 全集，并非仅限于持仓。
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
  // “所有纳指 ETF（未分类）”折叠状态：当 H/L 组都有内容时默认折叠。
  const [nasdaqPoolExpanded, setNasdaqPoolExpanded] = useState(true);
  const [nasdaqPoolTouched, setNasdaqPoolTouched] = useState(false);
  const [switchView, setSwitchView] = useState(initialView === 'config' ? 'config' : 'opportunity');
  const activeRule = useMemo(() => getActiveSwitchRule(prefs), [prefs]);
  const switchRules = Array.isArray(prefs?.rules) ? prefs.rules : [];
  const activeRuleId = prefs?.activeRuleId || activeRule?.id || '';
  const activeWorkerSnapshot = useMemo(
    () => pickSwitchSnapshotForRule(workerSnapshot, activeRuleId),
    [workerSnapshot, activeRuleId]
  );
  const switchEntryAttribution = useMemo(
    () => normalizeSwitchEntryAttribution(entryAttribution || {}),
    [entryAttribution]
  );

  const switchMeta = () => ({
    ...switchEntryAttribution,
    embedded,
    initialView,
    switchView,
    workerEnabled: Boolean(workerConfig.enabled),
    workerHasSnapshot: Boolean(workerSnapshot),
    workerConfigExpanded,
    activeRuleId,
    ruleCount: switchRules.length,
    activeRuleEnabled: Boolean(activeRule?.enabled),
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
    if (!refreshToken) return;
    setRefreshTick((value) => value + 1);
  }, [refreshToken]);

  useEffect(() => {
    setSwitchView(initialView === 'config' ? 'config' : 'opportunity');
  }, [initialView]);

  // 从行情页等入口带进来的初始标的：自动加入当前规则的候选池并展示机会面板。
  useEffect(() => {
    const code = String(initialSymbol || '').trim().toUpperCase();
    if (!code) return;
    setPrefs((prev) => {
      const current = getActiveSwitchRule(prev);
      const enabledCodes = Array.isArray(current?.enabledCodes) ? current.enabledCodes : [];
      if (enabledCodes.includes(code)) return prev;
      trackFeatureEvent('switch_strategy', 'symbol_param_add', {
        codeLength: code.length,
        previousEnabledCount: enabledCodes.length,
        ...switchEntryAttribution
      });
      return updateActiveSwitchRule(prev, { enabledCodes: Array.from(new Set([...enabledCodes, code])) });
    });
    setSwitchView('opportunity');
  }, [initialSymbol, switchEntryAttribution]);
  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    trackFeatureEvent('switch_strategy', 'worker_initial_load_start', switchMeta());
    (async () => {
      try {
        setWorkerStatus((prev) => ({ ...prev, loading: true, error: '' }));
        const { config, snapshotPayload, workerError } = await loadSwitchDataFromWorker();
        if (cancelled) return;
        if (config) {
          setWorkerConfig(config);
          setPrefs((prev) => {
            const normalizedPrev = normalizeSwitchConfigShape(prev);
            const shouldAdoptWorkerRules = (!normalizedPrev.rules.some((rule) => (rule.benchmarkCodes || []).length || (rule.enabledCodes || []).length || Object.keys(rule.premiumClass || {}).length) && config.rules.some((rule) => (rule.benchmarkCodes || []).length || (rule.enabledCodes || []).length || Object.keys(rule.premiumClass || {}).length)) || (Array.isArray(config.rules) && config.rules.length > normalizedPrev.rules.length);
            return shouldAdoptWorkerRules
              ? normalizeSwitchConfigShape({ ...config, enabled: normalizedPrev.enabled })
              : normalizedPrev;
          });
        }
        if (snapshotPayload?.snapshot) {
          setWorkerSnapshot(snapshotPayload.snapshot);
        }
        setWorkerStatus((prev) => ({
          ...prev,
          loading: false,
          error: workerError?.message || '',
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
      activeRuleId: normalized.activeRuleId,
      ruleCount: normalized.rules.length,
      benchmarkCount: Array.isArray(normalized.benchmarkCodes) ? normalized.benchmarkCodes.length : 0,
      enabledCodeCount: Array.isArray(normalized.enabledCodes) ? normalized.enabledCodes.length : 0,
      classCount: Object.keys(normalized.premiumClass || {}).length,
      ...switchEntryAttribution
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
      const candidateCount = Number.isFinite(result?.candidateCount)
        ? result.candidateCount
        : (stored.rules || []).reduce((acc, rule) => {
            const ruleBenchSet = new Set(rule.benchmarkCodes || []);
            return acc + (rule.enabledCodes || []).filter((c) => c && !ruleBenchSet.has(c)).length;
          }, 0);
      const benchmarkLabel = benchmarkCodes.length
        ? (benchmarkCodes.length === 1 ? benchmarkCodes[0] : `${benchmarkCodes.length} 只 (${benchmarkCodes.join(', ')})`)
        : '未设定';
      const ruleHint = `${stored.rules?.length || 1} 条规则`;
      const clientHint = clientId ? `· client ${clientId.slice(0, 18)}…` : '';
      const baseHint = `${ruleHint} / 当前持仓 ${benchmarkLabel} / 总候选 ${candidateCount} 只 ${clientHint}`.trim();
      setWorkerStatus((prev) => ({
        ...prev,
        saving: false,
        notice: stored.enabled
          ? `配置已同步到 worker（${baseHint}），交易时段内每分钟按规则 A/B 扫描。`
          : `配置已保存（未启用自动监控 · ${baseHint}）。`,
        lastSyncedAt: new Date().toISOString()
      }));
      trackActionResult('switch_strategy', 'worker_config_save', 'success', {
        ...switchEntryAttribution,
        enabled: Boolean(stored.enabled),
        activeRuleId: stored.activeRuleId,
        ruleCount: stored.rules?.length || 1,
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
        ...switchEntryAttribution,
        enabled: Boolean(normalized.enabled),
        durationMs: Date.now() - startedAt,
        errorName: error?.name || '',
        errorMessage: String(error?.message || error || '').slice(0, 160)
      });
    }
  }, [switchEntryAttribution]);

  // benchmarkCodes 变动时清掉旧快照，避免页面顶部 / 中部还在渲染旧基准的 worker 数据。
  const benchmarkCodesKey = (prefs?.benchmarkCodes || []).slice().sort().join(',');
  useEffect(() => {
    setWorkerSnapshot((prev) => {
      if (!prev) return prev;
      const activeSnapshot = pickSwitchSnapshotForRule(prev, activeRuleId);
      const prevBenchmarks = Array.isArray(activeSnapshot?.byBenchmark)
        ? activeSnapshot.byBenchmark.map((b) => b?.benchmarkCode).filter(Boolean)
        : (activeSnapshot?.benchmarkCode ? [activeSnapshot.benchmarkCode] : []);
      const prevKey = prevBenchmarks.slice().sort().join(',');
      if (prevKey === benchmarkCodesKey) return prev;
      return null;
    });
  }, [benchmarkCodesKey, activeRuleId]);

  // 启用时将页面 prefs 一起带上，worker 立刻获得可运行的配置。
  const handleWorkerToggle = useCallback((enabled) => {
    trackFeatureEvent('switch_strategy', 'worker_toggle', {
      enabled: Boolean(enabled),
      benchmarkCount: Array.isArray(prefs?.benchmarkCodes) ? prefs.benchmarkCodes.length : 0,
      enabledCodeCount: Array.isArray(prefs?.enabledCodes) ? prefs.enabledCodes.length : 0,
      ...switchEntryAttribution
    });
    if (enabled) {
      void persistWorkerConfig({
        ...prefs,
        enabled: true
      });
    } else {
      void persistWorkerConfig({ ...prefs, enabled: false });
    }
  }, [persistWorkerConfig, prefs, switchEntryAttribution]);

  const desiredWorkerConfig = useMemo(() => normalizeSwitchConfigShape({
    // enabled 保留开关状态：未启用时仍然同步配置，worker run 仅计不推。
    ...prefs,
    enabled: Boolean(workerConfig.enabled)
  }), [
    workerConfig.enabled,
    prefs
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
    const hasAnyBenchmark = (desiredWorkerConfig.rules || [])
      .some((rule) => Array.isArray(rule.benchmarkCodes) && rule.benchmarkCodes.length);
    if (!hasAnyBenchmark) return undefined;
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

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const payload = await loadSwitchSnapshotFromWorker();
        if (cancelled) return;
        if (payload?.snapshot) {
          setWorkerSnapshot(payload.snapshot);
          setWorkerStatus((prev) => ({ ...prev, error: "" }));
        }
      } catch (_error) {
        if (!cancelled) {
          setWorkerStatus((prev) => ({
            ...prev,
            error: _error?.message || "切换策略数据加载失败"
          }));
        }
      }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshTick]);

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

  const handleRuleSelect = useCallback((ruleId) => {
    trackFeatureEvent('switch_strategy', 'rule_select', {
      ruleId,
      ruleCount: switchRules.length,
      ...switchEntryAttribution
    });
    setSnapshotCandModal(null);
    setPrefs((prev) => selectSwitchRule(prev, ruleId));
  }, [switchEntryAttribution, switchRules.length]);

  const handleRuleAdd = useCallback(() => {
    trackFeatureEvent('switch_strategy', 'rule_add', {
      ruleCount: switchRules.length,
      ...switchEntryAttribution
    });
    setWorkerConfigExpanded(true);
    setSnapshotCandModal(null);
    setPrefs((prev) => addSwitchRule(prev));
  }, [switchEntryAttribution, switchRules.length]);

  const handleRuleDuplicate = useCallback((ruleId) => {
    trackFeatureEvent('switch_strategy', 'rule_duplicate', {
      ruleId,
      ruleCount: switchRules.length,
      ...switchEntryAttribution
    });
    setWorkerConfigExpanded(true);
    setSnapshotCandModal(null);
    setPrefs((prev) => duplicateSwitchRule(prev, ruleId));
  }, [switchEntryAttribution, switchRules.length]);

  const handleRuleRemove = useCallback((ruleId) => {
    trackFeatureEvent('switch_strategy', 'rule_remove', {
      ruleId,
      ruleCount: switchRules.length,
      ...switchEntryAttribution
    });
    setSnapshotCandModal(null);
    setPrefs((prev) => removeSwitchRule(prev, ruleId));
  }, [switchEntryAttribution, switchRules.length]);

  const handleRuleNameChange = useCallback((ruleId, name) => {
    setPrefs((prev) => {
      const normalized = normalizeSwitchConfigShape(prev);
      return normalizeSwitchConfigShape({
        ...normalized,
        rules: normalized.rules.map((rule) => (
          rule.id === ruleId ? { ...rule, name } : rule
        ))
      });
    });
  }, []);

  const handleRuleEnabledChange = useCallback((ruleId, enabled) => {
    setPrefs((prev) => {
      const normalized = normalizeSwitchConfigShape(prev);
      return normalizeSwitchConfigShape({
        ...normalized,
        rules: normalized.rules.map((rule) => (
          rule.id === ruleId ? { ...rule, enabled: Boolean(enabled) } : rule
        ))
      });
    });
  }, []);

  const handleOpenRuleBacktest = useCallback((rule) => {
    if (typeof window === 'undefined' || !rule) return;
    const benchmarkCodes = Array.isArray(rule.benchmarkCodes) ? rule.benchmarkCodes.filter(Boolean) : [];
    const enabledCodes = Array.isArray(rule.enabledCodes) ? rule.enabledCodes.filter(Boolean) : [];
    const symbol = benchmarkCodes[0] || enabledCodes[0] || Object.keys(rule.premiumClass || {}).filter(Boolean)[0] || '';
    if (!symbol) return;
    trackFeatureEvent('switch_strategy', 'rule_backtest_open', { ruleId: rule.id || '', symbolLength: symbol.length, benchmarkCount: benchmarkCodes.length, candidateCount: enabledCodes.length, ...switchEntryAttribution });
    const target = links?.markets || './index.html?tab=markets';
    const nextUrl = new URL(target, window.location.href);
    nextUrl.searchParams.set('tab', 'markets');
    nextUrl.searchParams.set('symbol', symbol);
    nextUrl.searchParams.set('backtest', '1');
    nextUrl.searchParams.set('source', 'fundSwitchRule');
    if (rule.id) nextUrl.searchParams.set('rule', rule.id);
    window.dispatchEvent(new CustomEvent('workspace:navigate', { detail: { tab: 'markets', search: nextUrl.search.replace(/^\?/, '') } }));
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('markets:select-symbol', { detail: { symbol, source: 'fundSwitchRule' } }));
      window.dispatchEvent(new CustomEvent('markets:open-backtest', { detail: { symbol, source: 'fundSwitchRule', ruleId: rule.id || '' } }));
    }, 0);
  }, [links?.markets, switchEntryAttribution]);

  useEffect(() => {
    const syncHoldings = () => {
      try {
        const state = readLedgerState();
        const aggs = aggregateByCode(state.transactions || [], state.snapshotsByCode || {});
        setAggregates(Array.isArray(aggs) ? aggs : []);
      } catch {
        setAggregates([]);
      }
    };
    syncHoldings();
    if (typeof window === 'undefined') return undefined;
    const onHoldingsChanged = () => syncHoldings();
    const onStorage = (event) => { if (!event?.key || event.key === 'aiDcaFundHoldingsLedger') syncHoldings(); };
    ['holdings:ledger-updated', 'cloud-sync:auto-restored', 'cloud-sync:auto-pulled', 'ai-dca:backup-applied']
      .forEach((eventName) => window.addEventListener(eventName, onHoldingsChanged));
    window.addEventListener('storage', onStorage);
    return () => {
      ['holdings:ledger-updated', 'cloud-sync:auto-restored', 'cloud-sync:auto-pulled', 'ai-dca:backup-applied']
        .forEach((eventName) => window.removeEventListener(eventName, onHoldingsChanged));
      window.removeEventListener('storage', onStorage);
    };
  }, [mobileView, refreshTick]);
  const exchangeFunds = useMemo(
    () => (aggregates || []).filter((a) => a.kind === 'exchange' && a.hasPosition),
    [aggregates]
  );

  // 候选基金 universe（内置纳指 ETF 候选池）
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

  // 持仓仅用于展示当前持仓和计算机会，不反向改写用户保存的规则。
  // 尤其不能因为 worker 扫描时暂时没有匹配持仓，就把规则自动写成 enabled: false。
  const loadNav = useCallback(async () => {
    const startedAt = Date.now();
    trackFeatureEvent('switch_strategy', 'metrics_refresh_start', {
      universeCount: candidateUniverse.length,
      ...switchEntryAttribution
    });
    setNavState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const codes = candidateUniverse.map((f) => f.code);
      if (!codes.length) {
        setNavState({ loading: false, error: '', navByCode: {}, generatedAt: nowIso() });
        setPriceState({ priceByCode: {} });
        trackActionResult('switch_strategy', 'metrics_refresh', 'empty', {
          ...switchEntryAttribution,
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
        ...switchEntryAttribution,
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
        ...switchEntryAttribution,
        universeCount: candidateUniverse.length,
        durationMs: Date.now() - startedAt,
        errorName: error?.name || '',
        errorMessage: String(error?.message || error || '').slice(0, 160)
      });
    }
  }, [candidateUniverse, switchEntryAttribution]);

  useEffect(() => { loadNav(); }, [loadNav, refreshTick]);

  // 自动刷新：每 2 分钟自动刷新净值数据
  useEffect(() => {
    if (!candidateUniverse.length) return undefined;
    const interval = setInterval(() => {
      setRefreshTick((n) => n + 1);
    }, 2 * 60 * 1000); // 2 分钟
    return () => clearInterval(interval);
  }, [candidateUniverse.length]);

  const fundsWithPremium = useMemo(() => {
    return candidateUniverse.map((u) => {
      const navEntry = navState.navByCode?.[u.code] || null;
      const priceEntry = priceState.priceByCode?.[u.code] || null;
      const px = Number(priceEntry?.close);
      const nav = Number(navEntry?.latestNav);
      const premiumPct = Number.isFinite(Number(navEntry?.premiumPercent)) ? Number(navEntry.premiumPercent) : null;
      return {
        code: u.code,
        name: u.name || navEntry?.name || '',
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
  const benchmark = benchmarks[0] || null;

  function setPrefValue(key, value) {
    trackFeatureEvent('switch_strategy', 'pref_change', {
      key,
      valueKind: value === '' ? 'empty' : Number.isFinite(Number(value)) ? 'number' : typeof value,
      ...switchMeta()
    });
    setPrefs((prev) => updateActiveSwitchRule(prev, { [key]: value }));
  }
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
      const current = getActiveSwitchRule(prev);
      const cls = { ...((current && current.premiumClass) || {}) };
      const heldCodes = new Set(exchangeFunds.map((fund) => fund.code));
      const isHeld = heldCodes.has(code);
      const benchmarkCodes = Array.isArray(current?.benchmarkCodes) ? current.benchmarkCodes.filter(Boolean) : [];
      const enabledCodes = Array.isArray(current?.enabledCodes) ? current.enabledCodes.filter(Boolean) : [];
      const wasBenchmark = benchmarkCodes.includes(code);
      let nextBenchmarkCodes = benchmarkCodes;
      let nextEnabledCodes = enabledCodes;
      if (targetClass === 'H' || targetClass === 'L') {
        cls[code] = targetClass;
        if (isHeld || wasBenchmark) {
          nextBenchmarkCodes = Array.from(new Set([...benchmarkCodes, code]));
          nextEnabledCodes = enabledCodes.filter((item) => item !== code);
        } else {
          nextEnabledCodes = Array.from(new Set([...enabledCodes, code]));
          nextBenchmarkCodes = benchmarkCodes.filter((item) => item !== code);
        }
      } else {
        delete cls[code];
        nextBenchmarkCodes = benchmarkCodes.filter((item) => item !== code);
        nextEnabledCodes = enabledCodes.filter((item) => item !== code);
      }
      return updateActiveSwitchRule(prev, {
        benchmarkCodes: nextBenchmarkCodes,
        enabledCodes: nextEnabledCodes,
        premiumClass: cls
      });
    });
  }
  function setCodeBenchmark(code, shouldBeBenchmark) {
    if (!code) return;
    trackFeatureEvent('switch_strategy', 'code_benchmark_change', {
      codeLength: String(code || '').length,
      shouldBeBenchmark: Boolean(shouldBeBenchmark),
      ...switchMeta()
    });
    setPrefs((prev) => {
      const current = getActiveSwitchRule(prev);
      const cls = { ...((current && current.premiumClass) || {}) };
      if (cls[code] !== 'H' && cls[code] !== 'L') return prev;
      const classifiedCodes = Object.keys(cls).filter((item) => cls[item] === 'H' || cls[item] === 'L');
      const currentBenchmarks = Array.isArray(current?.benchmarkCodes)
        ? current.benchmarkCodes.filter((item) => cls[item] === 'H' || cls[item] === 'L')
        : [];
      const nextBenchmarkCodes = shouldBeBenchmark
        ? Array.from(new Set([...currentBenchmarks, code]))
        : currentBenchmarks.filter((item) => item !== code);
      const benchmarkSet = new Set(nextBenchmarkCodes);
      const nextEnabledCodes = classifiedCodes.filter((item) => !benchmarkSet.has(item)).sort();
      return updateActiveSwitchRule(prev, {
        benchmarkCodes: nextBenchmarkCodes,
        enabledCodes: nextEnabledCodes,
        premiumClass: cls
      });
    });
  }
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
      targetClass: targetClass || 'none',
      ...switchEntryAttribution
    });
    setCodeClass(code, targetClass);
  }, [switchEntryAttribution]);

  const intraSignals = useMemo(() => {
    const heldCodes = exchangeFunds.map((fund) => fund.code).filter(Boolean);
    const model = buildFundSwitchOpportunityModel({
      snapshot: activeWorkerSnapshot,
      signals: Array.isArray(activeWorkerSnapshot?.signals) ? activeWorkerSnapshot.signals : [],
      funds: fundsWithPremium,
      prefs,
      heldCodes
    });
    return model.opportunityPairs.map((pair) => ({
      kind: pair.rule,
      from: pair.from,
      fromName: pair.fromName || pair.from,
      to: pair.to,
      toName: pair.toName || pair.to,
      gapPct: pair.spread,
      threshold: pair.threshold,
      ruleId: pair.ruleId || '',
      ruleName: pair.ruleName || '',
      description: pair.description || ''
    }));
  }, [activeWorkerSnapshot, exchangeFunds, fundsWithPremium, prefs]);

  const otcSignal = useMemo(() => {
    const heldCodeSet = new Set(exchangeFunds.map((fund) => fund.code).filter(Boolean));
    let topBench = null;
    benchmarks.filter((b) => heldCodeSet.has(b?.code)).forEach((b) => {
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
    exchangeFunds,
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
    if (!benchmarks.length) return '请先选择至少一只持仓 ETF。';
    const heldCodes = new Set(exchangeFunds.map((fund) => fund.code));
    const hasUnheldBenchmark = benchmarks.some((b) => b?.code && !heldCodes.has(b.code));
    const prefix = exchangeFunds.length
      ? (hasUnheldBenchmark ? '持仓/模拟持仓' : '持仓')
      : '模拟持仓';
    return `${prefix}：${benchmarks.map((b) => `${b.code} · ${b.name || ''}`).join(' / ')}`;
  }, [exchangeFunds, benchmarks]);
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

  const runnableRuleCount = useMemo(() => {
    return countRunnableSwitchRulesForUi(switchRules);
  }, [switchRules]);

  const workerRunDisabledReason = workerStatus.running
    ? '正在运行'
    : workerStatus.saving
    ? '配置同步中'
    : runnableRuleCount === 0
    ? '先配置至少一条可运行规则'
    : '';

  // 快速记录切换交易的验证和保存
  const quickRecordValid = useMemo(() => {
    return isQuickSwitchRecordValid(quickRecord);
  }, [quickRecord]);
  const saveQuickRecord = useCallback(() => {
    if (!quickRecordValid) return;
    const ledger = readLedgerState();
    const [sellTx, buyTx] = buildQuickSwitchTransactions(quickRecord, { now: nowIso() });
    if (!sellTx || !buyTx) return;
    const updatedLedger = {
      ...ledger,
      transactions: [...(ledger.transactions || []), sellTx, buyTx],
    };
    persistLedgerState(updatedLedger);
    setQuickRecord(null);
    trackActionResult('switch_strategy', 'quick_record_saved', 'success', {
      sellCode: sellTx.code,
      buyCode: buyTx.code,
      ...switchEntryAttribution
    });
  }, [quickRecordValid, quickRecord, switchEntryAttribution]);
  const openMobilePlan = useCallback((pair) => {
    setQuickRecord({ date: nowIso().slice(0, 10), sellCode: pair.from || '', sellName: pair.fromName || '', sellPrice: pair.fromFund?.latestNav || pair.fromFund?.latestPrice || '', sellShares: '', buyCode: pair.to || '', buyName: pair.toName || '', buyPrice: pair.toFund?.latestNav || pair.toFund?.latestPrice || '', buyShares: '', note: '来自推荐切换机会' });
    trackFeatureEvent('switch_strategy', 'mobile_opportunity_plan_open', { fromCode: pair.from, toCode: pair.to, ...switchEntryAttribution });
  }, [switchEntryAttribution]);
  return (
    <>
      {mobileOnly ? (mobileView === "opportunity" ? <MobileFundSwitchOpportunity fundsWithPremium={fundsWithPremium} heldCodes={exchangeFunds.map((fund) => fund.code).filter(Boolean)} intraSignals={intraSignals} workerSnapshot={activeWorkerSnapshot} workerError={workerStatus.error} otcSignal={otcSignal} prefs={prefs} navError={navState.error} navUpdatedHint={navUpdatedHint} workerConfig={workerConfig} onSetPrefValue={setPrefValue} onViewPlan={openMobilePlan} onEnableAutomation={() => { if (!workerConfig.enabled) handleWorkerToggle(true); }} /> : <MobileFundSwitchWatchlist prefs={prefs} fundsWithPremium={fundsWithPremium} workerConfig={workerConfig} onToggleWorker={handleWorkerToggle} onRuleSelect={handleRuleSelect} onRuleNameChange={handleRuleNameChange} onRuleEnabledChange={handleRuleEnabledChange} onRuleRemove={handleRuleRemove} />) : (
    <div className={cx('space-y-6 fund-switch-mobile-content', 'fund-switch-mobile-content--' + mobileView)}>
      <div className="fund-switch-mobile-block fund-switch-mobile-block--picker">
      <FundSwitchBenchmarkPicker
        fundsWithPremium={fundsWithPremium}
        exchangeFunds={exchangeFunds}
        activeRule={activeRule}
        setCodeClass={setCodeClass}
        setCodeBenchmark={setCodeBenchmark}
      />
      </div>
      <div className="fund-switch-mobile-block fund-switch-mobile-block--worker">
      <SwitchStrategyWorkerPanel
        prefs={prefs}
        switchSummary={switchSummary}
        workerConfig={workerConfig}
        workerStatus={workerStatus}
        workerConfigExpanded={workerConfigExpanded}
        workerSnapshot={activeWorkerSnapshot}
        workerRunDisabledReason={workerRunDisabledReason}
        rules={switchRules}
        activeRuleId={activeRuleId}
        handleWorkerToggle={handleWorkerToggle}
        handleWorkerRunOnce={handleWorkerRunOnce}
        onRuleSelect={handleRuleSelect}
        onRuleAdd={handleRuleAdd}
        onRuleDuplicate={handleRuleDuplicate}
        onRuleRemove={handleRuleRemove}
        onRuleNameChange={handleRuleNameChange}
        onRuleEnabledChange={handleRuleEnabledChange}
        onOpenBacktest={handleOpenRuleBacktest}
        setWorkerConfigExpanded={setWorkerConfigExpanded}
        setSnapshotCandModal={(payload) => {
          trackFeatureEvent('switch_strategy', 'snapshot_candidates_open', {
            benchmarkCodeLength: String(payload?.bench?.benchmarkCode || '').length,
            candidateCount: Array.isArray(payload?.bench?.candidates) ? payload.bench.candidates.length : 0,
            ...switchEntryAttribution
          });
          setSnapshotCandModal(payload);
        }}
        onQuickRecordOpen={() => {
          setQuickRecord({
            date: nowIso().slice(0, 10),
            sellCode: '',
            sellName: '',
            sellPrice: '',
            sellShares: '',
            buyCode: '',
            buyName: '',
            buyPrice: '',
            buyShares: '',
            note: '',
          });
          trackFeatureEvent('switch_strategy', 'quick_record_open', switchEntryAttribution);
        }}
        formatDate={formatDate}
        formatPrice={formatPrice}
        formatPercent={formatPercent}
      />
      </div>
      <div className="fund-switch-mobile-block fund-switch-mobile-block--classification">
      <SwitchStrategyClassificationPanel
        prefs={prefs}
        benchmarkSummary={benchmarkSummary}
        navUpdatedHint={navUpdatedHint}
        navError={navState.error}
        onRefresh={() => {
          trackFeatureEvent('switch_strategy', 'manual_refresh_click', switchMeta());
          setRefreshTick((n) => n + 1);
        }}
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
        setCodeBenchmark={setCodeBenchmark}
        formatPrice={formatPrice}
      />
      </div>
      <div className="fund-switch-mobile-block fund-switch-mobile-block--opportunity">
      <SwitchStrategyOpportunityPanels
        prefs={prefs}
        setPrefValue={setPrefValue}
        intraSignals={intraSignals}
        otcSignal={otcSignal}
        links={links}
      />
      </div>
      <SwitchStrategySnapshotModal
        snapshotCandModal={snapshotCandModal}
        setSnapshotCandModal={setSnapshotCandModal}
        formatPrice={formatPrice}
        formatPercent={formatPercent}
      />
    </div>
    )}
      <SwitchStrategyQuickRecordModal quickRecord={quickRecord} setQuickRecord={setQuickRecord} quickRecordValid={quickRecordValid} saveQuickRecord={saveQuickRecord} />
    </>
  );
}
export default SwitchStrategyExperience;
