import { useCallback, useEffect, useState } from 'react';
import { Bot, RefreshCw } from 'lucide-react';
import { Card, cx, subtleButtonClass } from '../components/experience-ui.jsx';
import { useQuantStudioState } from '../components/quant/useQuantStudioState.js';
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
      <RefreshCw className="h-4 w-4 animate-spin text-indigo-500" />
      正在加载量化策略…
    </Card>
  );
}

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
    summary,
    loading,
    saving,
    running,
    backtesting,
    refreshing,
    error,
    selectStrategy,
    saveStrategy,
    createStrategy,
    deleteStrategy,
    runBacktest,
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
    if (isMobile) setMobileView('editor');
  }, [selectStrategy, isMobile]);

  const handleCreateFromTemplate = useCallback(async (templateDraft) => {
    const created = await createStrategy(templateDraft);
    if (created && isMobile) setMobileView('editor');
    return created;
  }, [createStrategy, isMobile]);

  const handleSaveStrategy = useCallback(async (draft) => saveStrategy(draft), [saveStrategy]);

  const handleSaveAndBacktest = useCallback(async (draft) => {
    await runBacktest(draft, { timeframe: '5m', useV2: true });
    goModule('backtest');
  }, [runBacktest, goModule]);

  const handleRunBacktest = useCallback(async (strategy, options) => {
    await runBacktest(strategy, options);
  }, [runBacktest]);

  const handleStrategyUpdated = useCallback((nextStrategy, nextList) => {
    if (Array.isArray(nextList)) {
      studio.refresh?.({ preferStrategyId: nextStrategy?.id }).catch(() => {});
    }
  }, [studio]);

  const handleDeleteStrategy = useCallback(async (id) => {
    if (!id || id === 'default') return;
    if (typeof window !== 'undefined' && !window.confirm('确定删除该策略？')) return;
    await deleteStrategy(id);
    if (isMobile) setMobileView('list');
  }, [deleteStrategy, isMobile]);

  const errorBanner = error ? (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div>
  ) : null;

  const headerActions = (
    <button
      type="button"
      className={subtleButtonClass}
      onClick={() => refresh().catch(() => {})}
      disabled={loading || refreshing}
    >
      <RefreshCw className={cx('h-4 w-4', loading || refreshing ? 'animate-spin' : '')} />
      刷新
    </button>
  );

  if (loading && !strategies.length) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 sm:px-6">
        {errorBanner}
        <LoadingState />
      </div>
    );
  }

  if (module === 'strategy') {
    const showList = !isMobile || mobileView === 'list';
    const showEditor = !isMobile || mobileView === 'editor';
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              <Bot className="h-3.5 w-3.5" />
              量化研究
            </div>
            <p className="mt-2 text-xs text-slate-500">策略 → 回测 → 实盘 三步流水线</p>
          </div>
          {headerActions}
        </div>
        {errorBanner}
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {showList ? (
            <StrategyListPanel
              strategies={strategies}
              selectedStrategyId={selectedStrategyId}
              onSelect={handleSelectStrategy}
              onCreate={handleCreateFromTemplate}
              busy={saving}
            />
          ) : null}
          {showEditor ? (
            <StrategyEditorPanel
              strategy={selectedStrategy}
              saving={saving}
              busy={backtesting}
              onSave={handleSaveStrategy}
              onBacktest={handleSaveAndBacktest}
              onDelete={handleDeleteStrategy}
              onBack={() => setMobileView('list')}
              showBackButton={isMobile && mobileView === 'editor'}
            />
          ) : null}
        </div>
      </div>
    );
  }

  if (module === 'backtest') {
    return (
      <div className="mx-auto max-w-7xl space-y-4 px-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              <Bot className="h-3.5 w-3.5" />
              量化 · 回测
            </div>
          </div>
          {headerActions}
        </div>
        {errorBanner}
        <BacktestRunnerPanel
          strategies={strategies}
          selectedStrategy={selectedStrategy}
          backtest={backtest}
          backtesting={backtesting}
          saving={saving}
          onSelectStrategy={selectStrategy}
          onRunBacktest={handleRunBacktest}
          onUpdateStrategy={handleStrategyUpdated}
          onGoLive={() => goModule('live')}
          onGoStrategy={() => goModule('strategy')}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            <Bot className="h-3.5 w-3.5" />
            量化 · 实盘
          </div>
        </div>
        {headerActions}
      </div>
      {errorBanner}
      <LivePanel
        strategy={selectedStrategy}
        snapshot={snapshot}
        paperState={paperState}
        summary={summary}
        refreshing={refreshing}
        running={running}
        saving={saving}
        onRefresh={() => refresh().catch(() => {})}
        onRunOnce={runOnce}
        onAdjustCash={adjustCash}
        onResetPaper={resetPaper}
      />
    </div>
  );
}

export default QuantStudioPage;
