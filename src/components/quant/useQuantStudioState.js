import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  adjustQuantPremiumCashInWorker,
  approveQuantPremiumBacktestInWorker,
  deleteQuantPremiumStrategyInWorker,
  loadQuantPremiumStudioFromWorker,
  normalizeQuantPremiumConfigShape,
  resetQuantPremiumPaperStateInWorker,
  runQuantPremiumBacktestInWorker,
  runQuantPremiumOnce,
  saveQuantPremiumStrategyToWorker
} from '../../app/quantPremiumSync.js';
import { showToast } from '../../app/toast.js';

const STRATEGY_QUERY_KEY = 'strategy';

function readStrategyIdFromUrl() {
  if (typeof window === 'undefined') return '';
  try {
    return new URLSearchParams(window.location.search).get(STRATEGY_QUERY_KEY) || '';
  } catch {
    return '';
  }
}

function writeStrategyIdToUrl(id) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set(STRATEGY_QUERY_KEY, id);
    else url.searchParams.delete(STRATEGY_QUERY_KEY);
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, '', url);
    }
  } catch {
    // ignore URL persistence failures
  }
}

function pickStrategy(list, preferredId) {
  if (!Array.isArray(list) || !list.length) return null;
  if (preferredId) {
    const match = list.find((item) => item.id === preferredId);
    if (match) return match;
  }
  return list[0];
}

function normalizeStudioContract(payload = {}, preferredId = '') {
  const strategies = Array.isArray(payload?.strategies)
    ? payload.strategies.map((item) => normalizeQuantPremiumConfigShape(item))
    : [];
  const picked = pickStrategy(strategies, payload?.selectedStrategyId || preferredId);
  const resources = payload?.resources && typeof payload.resources === 'object' ? payload.resources : {};
  const strategy = normalizeQuantPremiumConfigShape(resources.strategy || payload?.strategy || picked || {});
  const selectedStrategyId = strategy.id || picked?.id || '';
  return {
    strategies: strategies.length ? strategies : (strategy.id ? [strategy] : []),
    selectedStrategyId,
    strategy,
    paperState: resources.paperPortfolio || payload?.paperState || null,
    snapshot: resources.marketSnapshot?.snapshot || payload?.snapshot || null,
    backtest: resources.backtest?.result || payload?.backtest || null,
    riskDecision: resources.riskDecision || null,
    auditEvents: Array.isArray(resources.audit?.events) ? resources.audit.events : Array.isArray(payload?.auditEvents) ? payload.auditEvents : []
  };
}

export function useQuantStudioState() {
  const [strategies, setStrategies] = useState([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState(() => readStrategyIdFromUrl());
  const [paperState, setPaperState] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [backtest, setBacktest] = useState(null);
  const [riskDecision, setRiskDecision] = useState(null);
  const [auditEvents, setAuditEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [backtesting, setBacktesting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const strategyIdRef = useRef(selectedStrategyId);
  useEffect(() => {
    strategyIdRef.current = selectedStrategyId;
    writeStrategyIdToUrl(selectedStrategyId);
  }, [selectedStrategyId]);

  const selectedStrategy = useMemo(
    () => strategies.find((item) => item.id === selectedStrategyId) || strategies[0] || null,
    [strategies, selectedStrategyId]
  );

  const applyStudioContract = useCallback((payload, preferredId = '') => {
    const contract = normalizeStudioContract(payload, preferredId);
    setStrategies(contract.strategies);
    setSelectedStrategyId(contract.selectedStrategyId);
    setPaperState(contract.paperState);
    setSnapshot(contract.snapshot);
    setBacktest(contract.backtest);
    setRiskDecision(contract.riskDecision);
    setAuditEvents(contract.auditEvents);
    return contract;
  }, []);

  const loadStrategyDetails = useCallback(async (strategyId) => {
    if (!strategyId) return null;
    setRefreshing(true);
    setError('');
    try {
      return applyStudioContract(await loadQuantPremiumStudioFromWorker(strategyId), strategyId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Worker 状态暂不可用');
      throw loadError;
    } finally {
      setRefreshing(false);
    }
  }, [applyStudioContract]);

  const refresh = useCallback(async ({ preferStrategyId = '' } = {}) => {
    setLoading(true);
    setError('');
    try {
      const desired = preferStrategyId || strategyIdRef.current;
      applyStudioContract(await loadQuantPremiumStudioFromWorker(desired), desired);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载策略失败');
    } finally {
      setLoading(false);
    }
  }, [applyStudioContract]);

  useEffect(() => {
    refresh();
    // mount-only initial fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectStrategy = useCallback(async (strategyId) => {
    if (!strategyId || strategyId === strategyIdRef.current) return;
    setSelectedStrategyId(strategyId);
    setBacktest(null);
    setSnapshot(null);
    setPaperState(null);
    setRiskDecision(null);
    setAuditEvents([]);
    await loadStrategyDetails(strategyId);
  }, [loadStrategyDetails]);

  const saveStrategy = useCallback(async (strategyDraft) => {
    setSaving(true);
    setError('');
    try {
      const result = await saveQuantPremiumStrategyToWorker(strategyDraft);
      setStrategies(result.strategies);
      setSelectedStrategyId(result.strategy.id);
      await loadStrategyDetails(result.strategy.id).catch(() => null);
      showToast({ title: '策略已保存', tone: 'emerald' });
      return result.strategy;
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '保存失败';
      setError(message);
      showToast({ title: '保存失败', description: message, tone: 'rose' });
      throw saveError;
    } finally {
      setSaving(false);
    }
  }, [loadStrategyDetails]);

  const setLiveSignalApproved = useCallback(async (enabled, { runId = '' } = {}) => {
    const id = strategyIdRef.current;
    if (!id) return null;
    setApproving(true);
    setSaving(true);
    setError('');
    try {
      const result = enabled
        ? await approveQuantPremiumBacktestInWorker(id, runId, { enableLiveSignal: true })
        : await saveQuantPremiumStrategyToWorker({
          ...(strategies.find((item) => item.id === id) || {}),
          id,
          liveSignalEnabled: false
        });
      setStrategies(result.strategies);
      if (result.strategy?.id) setSelectedStrategyId(result.strategy.id);
      await loadStrategyDetails(result.strategy?.id || id).catch(() => null);
      showToast({ title: enabled ? '实盘信号已确认' : '实盘信号已关闭', tone: 'emerald' });
      return result.strategy;
    } catch (approveError) {
      const message = approveError instanceof Error ? approveError.message : '实盘信号更新失败';
      setError(message);
      showToast({ title: '更新失败', description: message, tone: 'rose' });
      throw approveError;
    } finally {
      setApproving(false);
      setSaving(false);
    }
  }, [loadStrategyDetails, strategies]);

  const deleteStrategy = useCallback(async (strategyId) => {
    if (!strategyId || strategyId === 'default') return;
    setSaving(true);
    setError('');
    try {
      const nextStrategies = await deleteQuantPremiumStrategyInWorker(strategyId);
      setStrategies(nextStrategies);
      const next = pickStrategy(nextStrategies, '');
      if (next) {
        setSelectedStrategyId(next.id);
        await loadStrategyDetails(next.id);
      } else {
        setSelectedStrategyId('');
      }
      showToast({ title: '策略已删除', tone: 'emerald' });
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : '删除失败';
      setError(message);
      showToast({ title: '删除失败', description: message, tone: 'rose' });
      throw deleteError;
    } finally {
      setSaving(false);
    }
  }, [loadStrategyDetails]);

  const createStrategy = useCallback(async (template = {}) => {
    const draft = normalizeQuantPremiumConfigShape({
      ...template,
      id: `strategy-${Date.now().toString(36)}`,
      name: template.name || `策略 ${strategies.length + 1}`,
      enabled: template.enabled ?? false,
      liveSignalEnabled: false,
      backtestGate: { status: 'none' }
    });
    return saveStrategy(draft);
  }, [strategies.length, saveStrategy]);

  const runBacktest = useCallback(async (strategyDraft, options = {}) => {
    setBacktesting(true);
    setError('');
    try {
      const saved = await saveQuantPremiumStrategyToWorker(strategyDraft);
      setStrategies(saved.strategies);
      setSelectedStrategyId(saved.strategy.id);
      const result = await runQuantPremiumBacktestInWorker(saved.strategy.id, options);
      setBacktest(result || null);
      if (result?.status) {
        const nextGate = {
          ...(saved.strategy.backtestGate || {}),
          status: result.status,
          latestRunId: result.runId || saved.strategy.backtestGate?.latestRunId || '',
          approvedAt: saved.strategy.backtestGate?.approvedAt || '',
          approvedFingerprint: saved.strategy.backtestGate?.approvedFingerprint || '',
          summary: result.summary || saved.strategy.backtestGate?.summary || null,
          updatedAt: result.finishedAt || ''
        };
        setStrategies((current) => current.map((item) => item.id === saved.strategy.id
          ? normalizeQuantPremiumConfigShape({ ...item, backtestGate: nextGate })
          : item));
      }
      await loadStrategyDetails(saved.strategy.id).catch(() => null);
      return { strategy: saved.strategy, result };
    } catch (backtestError) {
      const message = backtestError instanceof Error ? backtestError.message : '回测失败';
      setError(message);
      showToast({ title: '回测失败', description: message, tone: 'rose' });
      throw backtestError;
    } finally {
      setBacktesting(false);
    }
  }, [loadStrategyDetails]);

  const runOnce = useCallback(async (strategy = null) => {
    const id = String(strategy?.id || strategyIdRef.current || '').trim();
    if (!id) return;
    setRunning(true);
    setError('');
    try {
      const result = await runQuantPremiumOnce(id);
      setSummary(result?.summary || null);
      await loadStrategyDetails(id);
      showToast({ title: '已完成一轮评估', tone: 'emerald' });
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : '运行失败';
      setError(message);
      showToast({ title: '手动运行失败', description: message, tone: 'rose' });
    } finally {
      setRunning(false);
    }
  }, [loadStrategyDetails]);

  const adjustCash = useCallback(async (amount, note = '') => {
    const id = strategyIdRef.current;
    if (!id) return;
    setError('');
    try {
      const result = await adjustQuantPremiumCashInWorker(amount, note, id);
      setPaperState(result.state);
      await loadStrategyDetails(id).catch(() => null);
      showToast({ title: amount < 0 ? '模拟现金已减少' : '模拟现金已增加', tone: 'emerald' });
    } catch (cashError) {
      const message = cashError instanceof Error ? cashError.message : '资金调整失败';
      setError(message);
      showToast({ title: '资金调整失败', description: message, tone: 'rose' });
      throw cashError;
    }
  }, [loadStrategyDetails]);

  const resetPaper = useCallback(async () => {
    const id = strategyIdRef.current;
    if (!id) return;
    setError('');
    try {
      const next = await resetQuantPremiumPaperStateInWorker(null, id);
      setPaperState(next);
      setSummary(null);
      await loadStrategyDetails(id).catch(() => null);
      showToast({ title: '模拟盘已重置', tone: 'emerald' });
    } catch (resetError) {
      const message = resetError instanceof Error ? resetError.message : '重置失败';
      setError(message);
      showToast({ title: '重置失败', description: message, tone: 'rose' });
      throw resetError;
    }
  }, [loadStrategyDetails]);

  return {
    strategies,
    selectedStrategy,
    selectedStrategyId,
    paperState,
    snapshot,
    backtest,
    riskDecision,
    auditEvents,
    summary,
    loading,
    saving,
    running,
    backtesting,
    approving,
    refreshing,
    error,
    refresh,
    selectStrategy,
    saveStrategy,
    deleteStrategy,
    createStrategy,
    runBacktest,
    setLiveSignalApproved,
    runOnce,
    adjustCash,
    resetPaper,
    setError
  };
}
