import { useEffect, useMemo, useState } from 'react';
import { trackFeatureEvent } from '../../app/analytics.js';
import { readSellPlanList } from '../../app/sellPlans.js';
import { loadSwitchSnapshotFromWorker } from '../../app/switchStrategySync.js';
import { summarizeExitSignals, summarizeSwitchSignals } from '../../app/todaySignals.js';
import { normalizeFundCode } from '../../app/holdingsLedgerCore.js';

export function useTodaySignals({ links, aggregatesTableData, setSelectedCode, setSidePanelTab, setSidePanelOpen }) {
  const [workerSwitchSnapshot, setWorkerSwitchSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);

  const switchSummary = useMemo(
    () => summarizeSwitchSignals(workerSwitchSnapshot),
    [workerSwitchSnapshot],
  );
  const exitSummary = useMemo(
    () => summarizeExitSignals(readSellPlanList(), aggregatesTableData),
    [aggregatesTableData],
  );

  useEffect(() => {
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
  }, []);

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

  return {
    loading,
    switchSummary,
    exitSummary,
    onOpenFundSwitch,
    onOpenExitSignal,
  };
}
