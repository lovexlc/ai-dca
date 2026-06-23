import { AlertTriangle, ChevronDown, Info, RefreshCw } from 'lucide-react';
import { Card, SectionHeading, cx, secondaryButtonClass } from '../components/experience-ui.jsx';

export function SwitchStrategyClassificationPanel({
  prefs,
  benchmarkSummary,
  navUpdatedHint,
  navError,
  onRefresh,
  setPrefValue,
  fundsWithPremium,
  exchangeFunds,
  universeError,
  nasdaqPoolExpanded,
  setNasdaqPoolExpanded,
  setNasdaqPoolTouched,
  dragOverZone,
  handleChipDragStart,
  handleZoneDragOver,
  handleZoneDragLeave,
  handleZoneDrop,
  setCodeClass,
  setCodeBenchmark,
  formatPrice
}) {
  const cls = prefs.premiumClass || {};
  const benchmarkSet = new Set(Array.isArray(prefs.benchmarkCodes) ? prefs.benchmarkCodes : []);
  const heldSet = new Set(exchangeFunds.map((fund) => fund.code));
  const poolList = fundsWithPremium.filter((fund) => !cls[fund.code]);
  const hList = fundsWithPremium.filter((fund) => cls[fund.code] === 'H');
  const lList = fundsWithPremium.filter((fund) => cls[fund.code] === 'L');

  const renderChip = (fund) => {
    const code = fund.code;
    const currentClass = cls[code] || null;
    const isBenchmark = benchmarkSet.has(code);
    const isHeld = heldSet.has(code);
    const canManualBenchmark = Boolean(currentClass);
    const hasNav = Number.isFinite(fund.navLatest);
    const priceSourceLabel = fund.latestPriceDate || 'daily';
    const benchmarkTitle = canManualBenchmark
      ? (isHeld ? '设为当前规则基准' : '设为当前规则模拟基准；未持有 ETF 只用于监控提醒')
      : '先设为 H 或 L 后才能设为基准';
    return (
      <div
        key={code}
        draggable
        onDragStart={(event) => handleChipDragStart(event, code)}
        title={hasNav
          ? `雪球净值 ${fund.navLatest.toFixed(4)} (${fund.navLatestDate})・现价 ${formatPrice(fund.latestNav)} (${priceSourceLabel})`
          : '实时数据未就绪'}
        className={cx(
          'group inline-flex max-w-full select-none flex-wrap items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold transition-colors cursor-grab active:cursor-grabbing',
          currentClass === 'H' ? 'border-rose-200 bg-rose-50 text-rose-800' :
          currentClass === 'L' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' :
          'border-slate-200 bg-white text-slate-600'
        )}
      >
        <span>{code}</span>
        {fund.name ? (
          <>
            <span className="text-slate-400">·</span>
            <span className="max-w-[88px] truncate text-slate-500">{fund.name}</span>
          </>
        ) : null}
        {isHeld ? <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">持</span> : null}
        {isBenchmark ? <span className="rounded bg-indigo-100 px-1 py-0.5 text-[10px] text-indigo-800">基准</span> : null}
        <span className="ml-1 inline-flex max-w-full flex-wrap overflow-hidden rounded-lg border border-slate-200 text-[10px]">
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setCodeClass(code, currentClass === 'H' ? null : 'H'); }}
            className={cx('inline-flex min-h-7 items-center px-2 py-1', currentClass === 'H' ? 'bg-rose-500 text-white' : 'bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-700')}
            aria-label={`将 ${code} 设为 H 组`}
          >
            设为 H
          </button>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setCodeClass(code, currentClass === 'L' ? null : 'L'); }}
            className={cx('inline-flex min-h-7 items-center border-l border-slate-200 px-2 py-1', currentClass === 'L' ? 'bg-emerald-500 text-white' : 'bg-white text-slate-500 hover:bg-emerald-50 hover:text-emerald-700')}
            aria-label={`将 ${code} 设为 L 组`}
          >
            设为 L
          </button>
          {currentClass ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (canManualBenchmark) setCodeBenchmark(code, !isBenchmark);
              }}
              disabled={!canManualBenchmark}
              title={benchmarkTitle}
              className={cx(
                'inline-flex min-h-7 items-center border-l border-slate-200 px-2 py-1',
                isBenchmark ? 'bg-indigo-500 text-white' : 'bg-white text-slate-500 hover:bg-indigo-50 hover:text-indigo-700',
                !canManualBenchmark && 'cursor-not-allowed opacity-45 hover:bg-white hover:text-slate-500'
              )}
              aria-label={isBenchmark ? `取消 ${code} 基准` : `将 ${code} 设为基准`}
            >
              {isBenchmark ? '取消基准' : '设为基准'}
            </button>
          ) : null}
        </span>
      </div>
    );
  };

  return (
    <Card>
      <SectionHeading
        eyebrow="规则配置"
        title="场内 / 场外纳指 100 / 标普 500 切换套利"
      />
      <div className="mt-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <Info className="h-4 w-4 text-slate-400" />
          <span>{benchmarkSummary}</span>
          {navUpdatedHint ? (
            <>
              <span className="hidden text-slate-300 md:inline">·</span>
              <span className="text-slate-500">{navUpdatedHint}</span>
            </>
          ) : null}
          <button
            type="button"
            className={cx(secondaryButtonClass, 'ml-auto h-9 px-3 text-xs')}
            onClick={onRefresh}
          >
            <RefreshCw className="h-4 w-4" />
            重新读取数据
          </button>
        </div>
        {navError ? (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>实时数据加载异常：{navError}</span>
          </div>
        ) : null}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">套利目标</div>
            <input
              type="number"
              step="0.5"
              className="w-24 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 focus:border-indigo-300 focus:outline-none"
              value={prefs.arbTargetPct}
              onChange={(event) => setPrefValue('arbTargetPct', event.target.value)}
            />
            <span className="text-sm text-slate-600">% / 周期</span>
          </div>
        </div>
        <div className="space-y-3">
          <div
            onDragOver={(event) => handleZoneDragOver(event, 'pool')}
            onDragLeave={handleZoneDragLeave}
            onDrop={(event) => handleZoneDrop(event, null)}
            className={cx(
              'rounded-2xl border bg-white p-4 transition-colors',
              dragOverZone === 'pool' ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200'
            )}
          >
            <button
              type="button"
              onClick={() => {
                setNasdaqPoolTouched(true);
                setNasdaqPoolExpanded((prev) => !prev);
              }}
              className="flex w-full items-center justify-between rounded-lg p-1 text-left transition-colors hover:bg-slate-50"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">所有纳指 / 标普 ETF（未分类）</div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-slate-500">{poolList.length} / 共 {fundsWithPremium.length} 只</div>
                <ChevronDown className={cx('h-4 w-4 shrink-0 text-slate-400 transition-transform', nasdaqPoolExpanded ? 'rotate-180' : '')} />
              </div>
            </button>
            {universeError ? (
              <div className="mt-2 text-xs text-rose-600">候选基金列表加载失败：{universeError}</div>
            ) : null}
            {nasdaqPoolExpanded ? (
              <>
                <div className="mt-3 flex min-h-[44px] flex-wrap gap-2">
                  {fundsWithPremium.length === 0 ? (
                    <div className="text-sm text-slate-500">候选基金尚未加载。</div>
                  ) : poolList.length === 0 ? (
                    <div className="text-xs text-slate-400">所有 ETF 都已分类。可把 chip 拖回此处取消分类。</div>
                  ) : poolList.map(renderChip)}
                </div>
                <div className="mt-2 text-[11px] text-slate-500">点击每个 chip 右侧的 <strong className="text-rose-700">设为 H</strong> / <strong className="text-emerald-700">设为 L</strong> 完成分类；已有持仓时，持仓 ETF 会默认成为基准。</div>
              </>
            ) : null}
          </div>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs leading-5 text-indigo-900">
            基准按“当前监控规则”单独保存。默认使用已持有的场内 ETF 作为基准，也可以手动把任意已分类 ETF 设为模拟基准。未持有基准只用于监控提醒，不代表已经有可卖出的份额。
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div
              onDragOver={(event) => handleZoneDragOver(event, 'H')}
              onDragLeave={handleZoneDragLeave}
              onDrop={(event) => handleZoneDrop(event, 'H')}
              className={cx(
                'rounded-2xl border bg-white p-4 transition-colors',
                dragOverZone === 'H' ? 'border-rose-400 ring-2 ring-rose-200' : 'border-rose-200'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">高溢价组 H</div>
                <div className="text-xs text-slate-500">{hList.length} 只</div>
              </div>
              <div className="mt-3 flex min-h-[44px] flex-wrap gap-2">
                {hList.length === 0 ? (
                  <div className="text-xs text-slate-400">点击未分类 chip 的“设为 H”。</div>
                ) : hList.map(renderChip)}
              </div>
            </div>
            <div
              onDragOver={(event) => handleZoneDragOver(event, 'L')}
              onDragLeave={handleZoneDragLeave}
              onDrop={(event) => handleZoneDrop(event, 'L')}
              className={cx(
                'rounded-2xl border bg-white p-4 transition-colors',
                dragOverZone === 'L' ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-emerald-200'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">低溢价组 L</div>
                <div className="text-xs text-slate-500">{lList.length} 只</div>
              </div>
              <div className="mt-3 flex min-h-[44px] flex-wrap gap-2">
                {lList.length === 0 ? (
                  <div className="text-xs text-slate-400">点击未分类 chip 的“设为 L”。</div>
                ) : lList.map(renderChip)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
