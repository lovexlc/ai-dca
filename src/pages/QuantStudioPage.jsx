import { useCallback, useEffect, useState } from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import { Card, subtleButtonClass } from '../components/experience-ui.jsx';
import { useQuantStudioState } from '../components/quant/useQuantStudioState.js';
import { QuantStudioHeader } from '../components/quant/QuantStudioHeader.jsx';
import { StrategyListPanel } from '../components/quant/StrategyListPanel.jsx';
import { StrategyEditorPanel } from '../components/quant/StrategyEditorPanel.jsx';
import { BacktestRunnerPanel } from '../components/quant/BacktestRunnerPanel.jsx';
import { LivePanel } from '../components/quant/LivePanel.jsx';

const SUPPORTED_MODULES = new Set(['strategy', 'backtest', 'live']);

function normalizeModule(value = '') {
  const key = String(value || '').trim();
  return SUPPORTED_MODULES.has(key) ? key : 'strategy';
}

function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(max-width: 1023px)')?.matches ?? false;
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => isMobileViewport());
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 1023px)');
    function handler(event) {
      setMobile(event.matches);
    }
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, []);
  return mobile;
}

function LoadingState() {
  return (
    <Card className="flex items-center justify-center gap-3 p-12 text-sm text-slate-500">
      <BarChart3 className="h-5 w-5 animate-pulse text-indigo-500" />
      正在加载量化策略…
    </Card>
  );
}

const STRATEGY_TEMPLATES = [
  {
    key: 'high-low-premium',
    label: '高低溢价差策略',
    description: '监控 H/L 两个 ETF 池的溢价差，触发阈值后自动切换',
    Icon: TrendingUp,
    accent: 'emerald',
    draft: {
      name: '高低溢价差策略',
      highCodes: ['159513'],
      lowCodes: ['513100'],
      intraSellLowerPct: 1,
      intraBuyOtherPct: 3,
      activeSide: 'all',
      enabled: true,
      notifyEnabled: true,
      paperEnabled: true
    }
  },
  {
    key: 'nasdaq-etf',
    label: '纳指 ETF 预设',
    description: '纳指 100 相关 ETF 的溢价差套利',
    Icon: BarChart3,
    accent: 'indigo',
    draft: {
      name: '纳指 ETF 套利',
      highCodes: ['513300', '159941'],
      lowCodes: ['513100', '159605'],
      intraSellLowerPct: 1,
      intraBuyOtherPct: 3,
      activeSide: 'all',
      enabled: true,
      notifyEnabled: true,
      paperEnabled: true
    }
  }
];

export function QuantStudioPage({ activeModule = 'strategy', onModuleChange } = {}) {
  const module = normalizeModule(activeModule);
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState('list');
  const studio = useQuantStudioState();
  const {
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
    selectStrategy,
    saveStrategy,
    createStrategy,
    deleteStrategy,
    runBacktest,
    setLiveSignalApproved,
    runOnce,
    adjustCash,
    resetPaper,
    refresh
  } = studio;

  useEffect(() => {
    if (module !== 'strategy') return;
    if (!isMobile) {
      setMobileView('list');
    }
  }, [module, isMobile]);

  const goModule = useCallback((next) => {
    onModuleChange?.(normalizeModule(next));
  }, [onModuleChange]);

  const handleSelectStrategy = useCallback(async (id) => {
    await selectStrategy(id);
    if (isMobile && module === 'strategy') setMobileView('editor');
  }, [selectStrategy, isMobile, module]);

  const handleCreateFromTemplate = useCallback(async (templateDraft) => {
    const created = await createStrategy(templateDraft);
    if (created && isMobile && module === 'strategy') setMobileView('editor');
    return created;
  }, [createStrategy, isMobile, module]);

  const handleSaveStrategy = useCallback(async (draft) => saveStrategy(draft), [saveStrategy]);

  const handleRunBacktest = useCallback(async (strategy, options) => {
    await runBacktest(strategy, options);
  }, [runBacktest]);

  const handleDeleteStrategy = useCallback(async (id) => {
    if (!id || id === 'default') return;
    if (typeof window !== 'undefined' && !window.confirm('确定删除该策略？')) return;
    await deleteStrategy(id);
    if (isMobile && module === 'strategy') setMobileView('list');
  }, [deleteStrategy, isMobile, module]);

  const [runningStrategyId, setRunningStrategyId] = useState('');
  const [deletingStrategyId, setDeletingStrategyId] = useState('');

  const handleRunFromList = useCallback(async (strategy) => {
    setRunningStrategyId(strategy.id);
    try {
      await runOnce(strategy);
    } finally {
      setRunningStrategyId('');
    }
  }, [runOnce]);

  const handleDeleteFromList = useCallback(async (strategy) => {
    if (strategy.id === 'default') return;
    if (typeof window !== 'undefined' && !window.confirm(`确定删除策略「${strategy.name || strategy.id}」？`)) return;
    setDeletingStrategyId(strategy.id);
    try {
      await deleteStrategy(strategy.id);
    } finally {
      setDeletingStrategyId('');
    }
  }, [deleteStrategy]);

  const moduleCounts = {
    total: strategies.length,
    strategy: strategies.length,
    backtest: strategies.filter((s) => s.backtestGate?.status === 'passed').length,
    live: strategies.filter((s) => s.liveSignalEnabled).length
  };

  const errorBanner = error ? (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div>
  ) : null;

  if (loading && !strategies.length) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 sm:px-6">
        {errorBanner}
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 sm:px-6">
      <QuantStudioHeader
        activeModule={module}
        counts={moduleCounts}
        onModuleChange={goModule}
        onCreateNew={handleCreateFromTemplate}
        onRefresh={() => refresh().catch(() => {})}
        refreshing={refreshing || loading}
        templates={STRATEGY_TEMPLATES}
      />
      {errorBanner}

      {module === 'strategy' ? (
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          {(!isMobile || mobileView === 'list') && (
            <StrategyListPanel
              strategies={strategies}
              selectedStrategyId={selectedStrategyId}
              runningStrategyId={runningStrategyId}
              deletingStrategyId={deletingStrategyId}
              onSelect={handleSelectStrategy}
              onRun={handleRunFromList}
              onEdit={handleSelectStrategy}
              onDelete={handleDeleteFromList}
            />
          )}
          {(!isMobile || mobileView === 'editor') && (
            <div className="space-y-4">
              {isMobile && mobileView === 'editor' && (
                <button
                  type="button"
                  className={subtleButtonClass}
                  onClick={() => setMobileView('list')}
                >
                  ← 策略列表
                </button>
              )}
              <StrategyEditorPanel
                strategy={selectedStrategy}
                saving={saving}
                busy={backtesting}
                onSave={handleSaveStrategy}
                onDelete={handleDeleteStrategy}
              />
            </div>
          )}
        </div>
      ) : null}

      {module === 'backtest' ? (
        <BacktestRunnerPanel
          strategies={strategies}
          selectedStrategy={selectedStrategy}
          backtest={backtest}
          backtesting={backtesting}
          saving={saving || approving}
          onSelectStrategy={selectStrategy}
          onRunBacktest={handleRunBacktest}
          onSetLiveSignalApproved={setLiveSignalApproved}
          onGoLive={() => goModule('live')}
          onGoStrategy={() => goModule('strategy')}
        />
      ) : null}

      {module === 'live' ? (
        <LivePanel
          strategy={selectedStrategy}
          snapshot={snapshot}
          paperState={paperState}
          riskDecision={riskDecision}
          auditEvents={auditEvents}
          summary={summary}
          refreshing={refreshing}
          running={running}
          saving={saving}
          onRefresh={() => refresh().catch(() => {})}
          onRunOnce={runOnce}
          onAdjustCash={adjustCash}
          onResetPaper={resetPaper}
        />
      ) : null}
    </div>
  );
}

export default QuantStudioPage;
