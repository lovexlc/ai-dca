import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  adjustQuantPremiumCashInWorker,
  deleteQuantPremiumStrategyInWorker,
  loadQuantPremiumBacktestLatestFromWorker,
  loadQuantPremiumPaperStateFromWorker,
  loadQuantPremiumStrategiesFromWorker,
  loadQuantPremiumStrategySnapshotFromWorker,
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

export function useQuantStudioState() {
  const [strategies, setStrategies] = useState([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState(() => readStrategyIdFromUrl());
  const [paperState, setPaperState] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [backtest, setBacktest] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [backtesting, setBacktesting] = useState(false);
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

  const loadStrategyDetails = useCallback(async (strategyId) => {
    if (!strategyId) return;
    setRefreshing(true);
    setError('');
    const [paperResult, snapshotResult, backtestResult] = await Promise.allSettled([
      loadQuantPremiumPaperStateFromWorker(strategyId),
      loadQuantPremiumStrategySnapshotFromWorker(strategyId),
      loadQuantPremiumBacktestLatestFromWorker(strategyId)
    ]);
    if (paperResult.status === 'fulfilled') setPaperState(paperResult.value);
    if (snapshotResult.status === 'fulfilled') setSnapshot(snapshotResult.value?.snapshot || null);
    if (backtestResult.status === 'fulfilled') {
      const latest = backtestResult.value || {};
      setBacktest(latest.result || null);
      if (latest.gate) {
        setStrategies((current) => current.map((item) => item.id === strategyId
          ? normalizeQuantPremiumConfigShape({ ...item, backtestGate: latest.gate })
          : item));
      }
    }
    const failures = [paperResult, snapshotResult, backtestResult].filter((item) => item.status === 'rejected');
    if (failures.length === 3) {
      setError(failures[0].reason instanceof Error ? failures[0].reason.message : 'Worker 状态暂不可用');
    } else if (failures.length) {
      setError('部分 Worker 状态暂不可用');
    }
    setRefreshing(false);
  }, []);

  const refresh = useCallback(async ({ preferStrategyId = '' } = {}) => {
    setLoading(true);
    setError('');
    try {
      const list = await loadQuantPremiumStrategiesFromWorker();
      setStrategies(list);
      const desired = preferStrategyId || strategyIdRef.current;
      const picked = pickStrategy(list, desired);
      if (picked) {
        setSelectedStrategyId(picked.id);
        await loadStrategyDetails(picked.id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载策略失败');
    } finally {
      setLoading(false);
    }
  }, [loadStrategyDetails]);

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
    await loadStrategyDetails(strategyId);
  }, [loadStrategyDetails]);

  const saveStrategy = useCallback(async (strategyDraft, { approveLiveSignal = false } = {}) => {
    setSaving(true);
    setError('');
    try {
      const result = await saveQuantPremiumStrategyToWorker({ ...strategyDraft, approveLiveSignal });
      setStrategies(result.strategies);
      setSelectedStrategyId(result.strategy.id);
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
  }, []);

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
      return { strategy: saved.strategy, result };
    } catch (backtestError) {
      const message = backtestError instanceof Error ? backtestError.message : '回测失败';
      setError(message);
      showToast({ title: '回测失败', description: message, tone: 'rose' });
      throw backtestError;
    } finally {
      setBacktesting(false);
    }
  }, []);

  const runOnce = useCallback(async () => {
    const id = strategyIdRef.current;
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
      showToast({ title: amount < 0 ? '模拟现金已减少' : '模拟现金已增加', tone: 'emerald' });
    } catch (cashError) {
      const message = cashError instanceof Error ? cashError.message : '资金调整失败';
      setError(message);
      showToast({ title: '资金调整失败', description: message, tone: 'rose' });
      throw cashError;
    }
  }, []);

  const resetPaper = useCallback(async () => {
    const id = strategyIdRef.current;
    if (!id) return;
    setError('');
    try {
      const next = await resetQuantPremiumPaperStateInWorker(null, id);
      setPaperState(next);
      setSummary(null);
      showToast({ title: '模拟盘已重置', tone: 'emerald' });
    } catch (resetError) {
      const message = resetError instanceof Error ? resetError.message : '重置失败';
      setError(message);
      showToast({ title: '重置失败', description: message, tone: 'rose' });
      throw resetError;
    }
  }, []);

  return {
    strategies,
    selectedStrategy,
    selectedStrategyId,
    paperState,
    snapshot,
    backtest,
    summary,
    loading,
    saving,
    running,
    backtesting,
    refreshing,
    error,
    refresh,
    selectStrategy,
    saveStrategy,
    deleteStrategy,
    createStrategy,
    runBacktest,
    runOnce,
    adjustCash,
    resetPaper,
    setError
  };
}
