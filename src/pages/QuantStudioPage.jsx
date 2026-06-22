import { useCallback, useEffect, useState } from 'react';
import { BarChart3, TrendingUp, X } from 'lucide-react';
import { Card } from '../components/experience-ui.jsx';
import { useQuantStudioState } from '../components/quant/useQuantStudioState.js';
import { QuantStudioHeader } from '../components/quant/QuantStudioHeader.jsx';
import { StrategyListPanel } from '../components/quant/StrategyListPanel.jsx';
import { StrategyEditorPanel } from '../components/quant/StrategyEditorPanel.jsx';
import { BacktestRunnerPanel } from '../components/quant/BacktestRunnerPanel.jsx';
import { LivePanel } from '../components/quant/LivePanel.jsx';
import '../styles/quant-studio-redesign.css';

const SUPPORTED_MODULES = new Set(['strategy', 'backtest', 'live']);

function normalizeModule(value = '') {
  const key = String(value || '').trim();
  return SUPPORTED_MODULES.has(key) ? key : 'strategy';
}

function LoadingState() {
  return (
    <Card className="flex items-center justify-center gap-3 p-12 text-sm text-slate-500">
      <BarChart3 className="h-5 w-5 animate-pulse text-indigo-500" />
      正在加载量化策略…
    </Card>
  );
}

function StrategyEditorDrawer({ open, onClose, children }) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="关闭策略配置抽屉"
        className="fixed inset-0 z-[999] cursor-default bg-slate-950/35 backdrop-blur-[2px] animate-in fade-in duration-200"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="策略配置"
        className="fixed right-0 top-0 z-[1000] flex h-[100vh] w-[min(520px,100vw)] flex-col bg-[#F0F2F8] shadow-2xl animate-in fade-in slide-in-from-right-7 duration-200"
      >
        <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-5">
          <div className="text-sm font-bold text-slate-900">策略配置</div>
          <button
            type="button"
            aria-label="关闭"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {children}
        </div>
      </aside>
    </>
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
  const [editorDrawerOpen, setEditorDrawerOpen] = useState(false);
  const [drawerStrategyId, setDrawerStrategyId] = useState('');
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

  const goModule = useCallback((next) => {
    onModuleChange?.(normalizeModule(next));
  }, [onModuleChange]);

  const handleSelectStrategy = useCallback(async (id) => {
    await selectStrategy(id);
  }, [selectStrategy]);

  const closeEditorDrawer = useCallback(() => {
    setEditorDrawerOpen(false);
  }, []);

  const openEditorDrawer = useCallback(async (strategyOrId) => {
    const id = typeof strategyOrId === 'string' ? strategyOrId : strategyOrId?.id;
    if (!id) return;
    setDrawerStrategyId(id);
    setEditorDrawerOpen(true);
    if (id !== selectedStrategyId) {
      await selectStrategy(id);
    }
  }, [selectStrategy, selectedStrategyId]);

  const handleCreateFromTemplate = useCallback(async (templateDraft) => {
    const created = await createStrategy(templateDraft);
    if (created?.id) {
      setDrawerStrategyId(created.id);
      setEditorDrawerOpen(true);
    }
    return created;
  }, [createStrategy]);

  const handleSaveStrategy = useCallback(async (draft) => saveStrategy(draft), [saveStrategy]);

  const handleRunBacktest = useCallback(async (strategy, options) => {
    await runBacktest(strategy, options);
  }, [runBacktest]);

  const handleDeleteStrategy = useCallback(async (id) => {
    if (!id || id === 'default') return;
    if (typeof window !== 'undefined' && !window.confirm('确定删除该策略？')) return;
    await deleteStrategy(id);
  }, [deleteStrategy]);

  const handleDeleteFromEditor = useCallback(async (id) => {
    await handleDeleteStrategy(id);
    setEditorDrawerOpen(false);
    setDrawerStrategyId('');
  }, [handleDeleteStrategy]);

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
      if (drawerStrategyId === strategy.id) {
        setEditorDrawerOpen(false);
        setDrawerStrategyId('');
      }
    } finally {
      setDeletingStrategyId('');
    }
  }, [deleteStrategy, drawerStrategyId]);

  useEffect(() => {
    if (module !== 'strategy') {
      setEditorDrawerOpen(false);
    }
  }, [module]);

  useEffect(() => {
    if (!editorDrawerOpen || !drawerStrategyId || !strategies.length) return;
    if (!strategies.some((strategy) => strategy.id === drawerStrategyId)) {
      setEditorDrawerOpen(false);
      setDrawerStrategyId('');
    }
  }, [drawerStrategyId, editorDrawerOpen, strategies]);

  const moduleCounts = {
    total: strategies.length,
    strategy: strategies.length,
    backtest: strategies.filter((s) => s.backtestGate?.status === 'passed').length,
    live: strategies.filter((s) => s.liveSignalEnabled).length
  };

  const errorBanner = error ? (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div>
  ) : null;

  const drawerStrategy = strategies.find((strategy) => strategy.id === drawerStrategyId)
    || (editorDrawerOpen ? selectedStrategy : null);

  if (loading && !strategies.length) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 sm:px-6">
        {errorBanner}
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="quant-studio-v2 mx-auto max-w-7xl space-y-4 px-4 sm:px-6">
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
        <div className="flex flex-col gap-4">
          <StrategyListPanel
            strategies={strategies}
            selectedStrategyId={selectedStrategyId}
            runningStrategyId={runningStrategyId}
            deletingStrategyId={deletingStrategyId}
            onSelect={handleSelectStrategy}
            onRun={handleRunFromList}
            onEdit={openEditorDrawer}
            onDelete={handleDeleteFromList}
          />
          <StrategyEditorDrawer open={editorDrawerOpen} onClose={closeEditorDrawer}>
            <StrategyEditorPanel
              strategy={drawerStrategy}
              saving={saving}
              busy={backtesting}
              onSave={handleSaveStrategy}
              onDelete={handleDeleteFromEditor}
            />
          </StrategyEditorDrawer>
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
          onRunOnce={() => runOnce(selectedStrategy)}
          onAdjustCash={adjustCash}
          onResetPaper={resetPaper}
        />
      ) : null}
    </div>
  );
}

export default QuantStudioPage;
