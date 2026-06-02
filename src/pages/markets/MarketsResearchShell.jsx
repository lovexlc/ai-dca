import { cx } from '../../components/experience-ui.jsx';
import { MarketsResearchPanel } from './MarketsResearchPanel.jsx';

export function MarketsResearchShell({
  market,
  mode,
  onModeChange,
  watchSymbols,
  watchQuotes,
  selectedSymbol,
  selectedQuote,
  pendingAnalysis,
  onAnalysisConsumed,
  isMobile,
  vpHeight,
  asideRef,
  researchDragRef,
  isDraggingRef,
  onHandleClick,
  onDragInit,
  onDragMove,
  onDragEnd,
  onDragCancel
}) {
  return (
    <aside
      id="markets-research-anchor"
      ref={asideRef}
      className={cx(
        'bg-white',
        'lg:relative lg:z-auto lg:order-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-3 lg:bg-transparent lg:overflow-hidden lg:rounded-none lg:border-t-0 lg:shadow-none',
        selectedSymbol ? 'hidden lg:flex' : 'fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden border-t border-[#e8eaed] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] [transition:height_300ms_ease-out]',
        !selectedSymbol && (mode === 'conversation' ? 'top-0 rounded-none' : 'rounded-t-2xl')
      )}
      style={isMobile && !isDraggingRef.current ? {
        height: (
          mode === 'conversation'
            ? (vpHeight || (typeof window !== 'undefined' ? window.innerHeight : 844))
            : mode === 'search'
              ? (vpHeight || (typeof window !== 'undefined' ? window.innerHeight : 844))
              : 130
        ) + 'px'
      } : undefined}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={mode === 'peek' ? '展开研究' : '收起研究'}
        className="flex h-9 w-full shrink-0 cursor-pointer touch-none select-none items-center justify-center bg-white lg:hidden"
        onClick={onHandleClick}
        onPointerDown={onDragInit}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragCancel}
        onTouchMove={(event) => event.preventDefault()}
      >
        <span className="h-1 w-9 rounded-full bg-[#dadce0]" />
      </div>
      <MarketsResearchPanel
        market={market}
        mode={mode}
        onModeChange={onModeChange}
        watchSymbols={watchSymbols}
        watchQuotes={watchQuotes}
        selectedSymbol={selectedSymbol}
        selectedQuote={selectedQuote}
        pendingAnalysis={pendingAnalysis}
        onAnalysisConsumed={onAnalysisConsumed}
      />
    </aside>
  );
}
