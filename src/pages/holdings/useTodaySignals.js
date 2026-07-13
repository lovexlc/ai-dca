import { useEffect, useMemo, useState } from 'react';
import { trackFeatureEvent } from '../../app/analytics.js';
import { readSellPlanList } from '../../app/sellPlans.js';
import { loadSwitchSnapshotFromWorker } from '../../app/switchStrategySync.js';
import {
  collectTodaySignalKeys,
  filterDismissedExitSignals,
  filterDismissedSwitchSignals,
  summarizeExitSignals,
  summarizeSwitchSignals
} from '../../app/todaySignals.js';
import { getTodayShanghaiDate, normalizeFundCode } from '../../app/holdingsLedgerCore.js';

const DISMISSED_TODAY_SIGNAL_KEY = 'aiDcaDismissedTodaySignals_v1';

function readDismissedSignalKeys() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_TODAY_SIGNAL_KEY) || 'null');
    if (!parsed || parsed.date !== getTodayShanghaiDate()) return [];
    return Array.isArray(parsed.keys) ? parsed.keys.map((key) => String(key || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeDismissedSignalKeys(keys = []) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const normalized = Array.from(new Set((Array.isArray(keys) ? keys : []).map((key) => String(key || '').trim()).filter(Boolean)));
  if (!normalized.length) {
    window.localStorage.removeItem(DISMISSED_TODAY_SIGNAL_KEY);
    return;
  }
  window.localStorage.setItem(DISMISSED_TODAY_SIGNAL_KEY, JSON.stringify({
    date: getTodayShanghaiDate(),
    keys: normalized
  }));
}

export function useTodaySignals({ links, aggregatesTableData, setSelectedCode, setSidePanelTab, setSidePanelOpen, enabled = true }) {
  const [workerSwitchSnapshot, setWorkerSwitchSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dismissedKeys, setDismissedKeys] = useState(readDismissedSignalKeys);

  const rawSwitchSummary = useMemo(
    () => summarizeSwitchSignals(workerSwitchSnapshot),
    [workerSwitchSnapshot],
  );
  const rawExitSummary = useMemo(
    () => summarizeExitSignals(readSellPlanList(), aggregatesTableData),
    [aggregatesTableData],
  );
  const dismissedKeySet = useMemo(() => new Set(dismissedKeys), [dismissedKeys]);
  const switchSummary = useMemo(
    () => filterDismissedSwitchSignals(rawSwitchSummary, dismissedKeySet),
    [dismissedKeySet, rawSwitchSummary],
  );
  const exitSummary = useMemo(
    () => filterDismissedExitSignals(rawExitSummary, dismissedKeySet),
    [dismissedKeySet, rawExitSummary],
  );
  const dismissedSignalCount = Math.max(0, collectTodaySignalKeys(rawSwitchSummary, rawExitSummary).length - collectTodaySignalKeys(switchSummary, exitSummary).length);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setLoading(true);
    loadSwitchSnapshotFromWorker()
      .then((payload) => {
        if (!cancelled) setWorkerSwitchSnapshot(payload?.snapshot || null);
      })
      .catch(() => {
        if (!cancelled) setWorkerSwitchSnapshot(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [enabled]);

  function onOpenFundSwitch() {
    if (typeof window === 'undefined') return;
    trackFeatureEvent('holdings', 'today_signal_open_fund_switch', {
      switchSignalCount: switchSummary.count,
      switchEventCount: switchSummary.signalCount,
    });
    const target = links?.fundSwitch || './index.html?tab=fundSwitch';
    const nextUrl = new URL(target, window.location.href);
    if (window.location.href === nextUrl.href) return;
    window.history.pushState({ tab: 'fundSwitch', source: 'todaySignal' }, '', nextUrl);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  function onOpenExitSignal(signal) {
    const code = normalizeFundCode(signal?.code);
    if (!code) return;
    trackFeatureEvent('holdings', 'today_signal_open_exit_detail', {
      codeLength: code.length,
      exitSignalCount: exitSummary.count,
    });
    setSelectedCode(code);
    setSidePanelTab('summary');
    setSidePanelOpen(true);
  }

  function onDismissSignals() {
    const keys = collectTodaySignalKeys(switchSummary, exitSummary);
    if (!keys.length) return;
    const nextKeys = Array.from(new Set([...dismissedKeys, ...keys]));
    writeDismissedSignalKeys(nextKeys);
    setDismissedKeys(nextKeys);
    trackFeatureEvent('holdings', 'today_signal_dismiss', {
      dismissedCount: keys.length,
      switchSignalCount: switchSummary.signalCount,
      exitSignalCount: Array.isArray(exitSummary.rows) ? exitSummary.rows.length : 0,
    });
  }

  function onRestoreSignals() {
    writeDismissedSignalKeys([]);
    setDismissedKeys([]);
    trackFeatureEvent('holdings', 'today_signal_restore', {
      dismissedCount: dismissedSignalCount,
    });
  }

  return {
    loading,
    switchSummary,
    exitSummary,
    dismissedSignalCount,
    onOpenFundSwitch,
    onOpenExitSignal,
    onDismissSignals,
    onRestoreSignals,
  };
}
