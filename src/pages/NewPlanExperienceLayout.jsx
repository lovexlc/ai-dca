import { useMemo } from 'react';
import { ArrowLeft, Check, Search, ShieldCheck } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';

const HOT_SYMBOLS = [
  { symbol: '159632', name: '纳指ETF', price: 1.340, market: '深市 ETF', currency: '¥' },
  { symbol: '513500', name: '标普500', price: 1.458, market: '沪市 ETF', currency: '¥' },
  { symbol: '513100', name: '纳指科技', price: 2.577, market: '沪市 ETF', currency: '¥' },
  { symbol: 'QQQ', name: '美股纳指', price: 505.20, market: '美股 NASDAQ', currency: '$' },
  { symbol: 'SPY', name: '标普500', price: 560.10, market: '美股 NYSE', currency: '$' },
  { symbol: 'NVDA', name: '科技七巨头', price: 132.50, market: '美股 NASDAQ', currency: '$' }
];

export function NewPlanExperienceLayout(props) {
  const {
    activeStrategy,
    computed,
    customDrawdown,
    extraQuote,
    formatCurrency,
    formatFundPrice,
    formatPercent,
    handleCreatePlan,
    isSaving,
    onBack,
    selectedAnchorNameLabel,
    selectedAssetTypeLabel,
    selectedFund,
    selectedInstrumentCurrency,
    setCustomDrawdown,
    setState,
    setSymbolSearch,
    state,
    symbolSearch
  } = props;

  const currentPrice = Number(selectedFund?.price || extraQuote?.price || state?.basePrice || 0);
  const avgCost = Number(computed?.averageCost) || 0;
  const anchorPrice = Number(computed?.anchorPrice || state?.basePrice || 0);
  const safetyCushion = anchorPrice > 0 && avgCost > 0 ? ((anchorPrice - avgCost) / anchorPrice) * 100 : 0;
  const layers = Array.isArray(computed?.layers) ? computed.layers : [];

  const firstDrawdown = customDrawdown?.first || state?.firstDrawdown || 10;
  const stepDrawdown = customDrawdown?.step || state?.stepDrawdown || 5;

  function handleSelectHot(h) {
    setState((cur) => ({
      ...cur,
      symbol: h.symbol,
      basePrice: h.price,
      targetPrice: h.price
    }));
    if (typeof setSymbolSearch === 'function') {
      setSymbolSearch('');
    }
  }

  function handleUseCurrentPriceAsPeak() {
    if (currentPrice > 0) {
      setState((cur) => ({
        ...cur,
        basePrice: currentPrice
      }));
    }
  }

  const handleBack = onBack || (() => {
    if (typeof window !== 'undefined') {
      if (window.location.hash.includes('new')) {
        window.history.back();
      } else {
        window.location.hash = '#list';
      }
    }
  });

  return (
    <div className="bg-slate-50 text-slate-900 rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xl">
      {/* Header Banner (1:1 原型顶栏) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
            STEPPED PYRAMID ACCUMULATION WIZARD
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-950 mt-1">金字塔阶梯加仓策略设计器</h2>
          <p className="text-xs text-slate-500 mt-1">基于高点回撤 / 120日均线自动梯级布阵，平滑建仓成本，深水区拉大筹码安全垫</p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleBack}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
          >
            <ArrowLeft className="w-4 h-4" />
            返回看板
          </button>
          <button
            type="button"
            onClick={handleCreatePlan}
            disabled={isSaving}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {isSaving ? '保存中...' : '保存策略并加入监控'}
          </button>
        </div>
      </div>

      {/* Main 2-Column Grid (1:1 原型布局) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(380px,1fr)] gap-7 mt-6 items-start">
        {/* Left Side: Config Cards */}
        <div className="space-y-5">
          {/* Card 1: 选标的 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="text-xs font-bold uppercase text-slate-400">第一步</div>
            <div className="text-base font-bold text-slate-950 mt-0.5">选择标的</div>

            <div className="mt-3 p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 flex items-center justify-between text-xs">
              <span className="font-bold text-indigo-900">
                当前资产类型：{selectedAssetTypeLabel || '智能识别分类'}
              </span>
              <span className="text-indigo-600 font-semibold cursor-default">智能识别规范</span>
            </div>

            {/* Search input */}
            <div className="mt-3.5">
              <label className="block text-xs font-bold text-slate-700 mb-1">资产标的</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={symbolSearch !== undefined ? symbolSearch : state.symbol}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (typeof setSymbolSearch === 'function') setSymbolSearch(val);
                      setState((cur) => ({ ...cur, symbol: val }));
                    }}
                    placeholder="输入代码 / 拼音 / 简称 (如 513100、纳指、QQQ、NVDA)..."
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>
                <button
                  type="button"
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shrink-0"
                >
                  搜索标的
                </button>
              </div>
            </div>

            {/* Hot Symbols Chips */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-400 text-[11px] font-semibold">热门快捷：</span>
              {HOT_SYMBOLS.map((h) => {
                const isSelected = String(state.symbol || '').trim().toUpperCase() === h.symbol;
                return (
                  <button
                    key={h.symbol}
                    type="button"
                    onClick={() => handleSelectHot(h)}
                    className={cx(
                      'px-2.5 py-1 rounded-lg border text-xs font-bold transition-all',
                      isSelected
                        ? 'bg-indigo-50 border-indigo-500 text-indigo-700 ring-2 ring-indigo-500/20'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    )}
                  >
                    {h.symbol} {h.name}
                  </button>
                );
              })}
            </div>

            {/* Selected Symbol Price Box */}
            <div className="mt-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">{state.symbol || '未选择'}</span>
                <span className="text-xs font-bold text-slate-600">{selectedAnchorNameLabel || selectedFund?.name || '标的资产'}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-100 text-indigo-700">已选标的</span>
              </div>
              <div className="text-right">
                <span className="text-base font-bold text-indigo-700 font-mono">
                  {formatFundPrice(currentPrice, selectedInstrumentCurrency)}
                </span>
                <span className="block text-[10px] text-slate-400 font-medium">基准现价</span>
              </div>
            </div>
          </div>

          {/* Card 2: 调控参数与金字塔梯度 */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="text-xs font-bold uppercase text-slate-400">第二步</div>
            <div className="text-base font-bold text-slate-950 mt-0.5">调控参数与金字塔梯度</div>

            {/* Mode Info Badge */}
            <div className="mt-3 p-3 rounded-xl bg-indigo-50/70 border border-indigo-100 text-xs font-bold text-indigo-900 leading-relaxed">
              <span className="px-1.5 py-0.5 rounded bg-indigo-200 text-indigo-800 mr-1">
                {activeStrategy?.label || '金字塔模式'}
              </span>
              首买跌幅 {firstDrawdown}% · 加仓步长 {stepDrawdown}% · {layers.length} 档
              <span className="block mt-0.5 text-indigo-600 font-medium">
                倍数 {layers.map((l) => l.weight + 'x').join(' / ')} · 留存现金 {state.reserveRatio || 30}%
              </span>
            </div>

            {/* Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">总投资额 (¥ / $)</label>
                <input
                  type="number"
                  value={state.totalCapital || ''}
                  onChange={(e) => setState((cur) => ({ ...cur, totalCapital: Number(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">阶段高点价格</label>
                  <button
                    type="button"
                    onClick={handleUseCurrentPriceAsPeak}
                    className="text-[10px] text-indigo-600 font-bold hover:underline"
                  >
                    推荐现价
                  </button>
                </div>
                <input
                  type="number"
                  step="0.001"
                  value={state.basePrice || ''}
                  onChange={(e) => setState((cur) => ({ ...cur, basePrice: Number(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">现金留存比例 (防守安全垫)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="10"
                    max="60"
                    step="5"
                    value={state.reserveRatio || 30}
                    onChange={(e) => setState((cur) => ({ ...cur, reserveRatio: Number(e.target.value) }))}
                    className="flex-1 accent-indigo-600"
                  />
                  <span className="font-mono font-bold text-indigo-600 w-12 text-right">{state.reserveRatio || 30}%</span>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">首档触发回撤阈值</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="10"
                    max="50"
                    step="1"
                    value={firstDrawdown}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (typeof setCustomDrawdown === 'function') {
                        setCustomDrawdown((cur) => ({ ...cur, enabled: true, first: val }));
                      }
                      setState((cur) => ({ ...cur, firstDrawdown: val }));
                    }}
                    className="flex-1 accent-indigo-600"
                  />
                  <span className="font-mono font-bold text-indigo-600 w-12 text-right">-{firstDrawdown}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: 1:1 Stepped Pyramid & Safety Cushion Preview */}
        <div className="space-y-5 lg:sticky lg:top-4">
          <div className="bg-white rounded-2xl border border-indigo-100 p-5 shadow-md bg-gradient-to-br from-indigo-50/40 via-white to-white">
            {/* Preview Top Badge */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold text-indigo-500">结果预览</div>
                <h3 className="text-base font-bold text-slate-950 mt-0.5">策略成本预览</h3>
              </div>
              {safetyCushion > 0 ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-xs flex items-center gap-1">
                  🛡️ 安全垫 +{safetyCushion.toFixed(1)}%
                </span>
              ) : null}
            </div>

            {/* Average Cost Box */}
            <div className="mt-4 p-4 rounded-xl bg-white border border-indigo-100 shadow-xs">
              <div className="text-[10px] font-bold text-indigo-500">预估平均成本</div>
              <div className="text-3xl font-bold text-indigo-700 mt-1 font-mono">
                {formatFundPrice(computed?.averageCost, selectedInstrumentCurrency)}
              </div>

              <div className="grid gap-2 border-t border-slate-100 pt-3 mt-3 text-xs">
                <div className="flex justify-between text-slate-500">
                  <span>可投入资金</span>
                  <strong className="font-mono font-bold text-slate-900">
                    {formatCurrency(computed?.investableCapital, '¥ ')}
                  </strong>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>预留防守现金 ({state.reserveRatio || 30}%)</span>
                  <strong className="font-mono font-bold text-slate-900">
                    {formatCurrency(computed?.reserveCapital, '¥ ')}
                  </strong>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>阶段参考高点</span>
                  <strong className="font-mono font-bold text-slate-900">
                    {formatFundPrice(computed?.anchorPrice || state.basePrice, selectedInstrumentCurrency)}
                  </strong>
                </div>
              </div>
            </div>

            {/* 1:1 Stepped Pyramid Visualization (阶梯加仓金字塔) */}
            <div className="mt-4 p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
              <div className="grid grid-cols-[minmax(65px,0.8fr)_minmax(110px,1.4fr)_minmax(75px,0.9fr)] items-center gap-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <div className="text-left">触发跌幅 / 现价</div>
                <div className="text-center">阶梯加仓金字塔</div>
                <div className="text-right">加仓预算 / 占比</div>
              </div>

              <div className="mt-3 space-y-2">
                {layers.map((l, i) => {
                  const widthPct = Math.min(96, Math.max(45, 45 + i * 10));
                  let barGradient = 'from-indigo-500 to-indigo-600';
                  if (i === 0) barGradient = 'from-slate-700 to-slate-800';
                  else if (i >= layers.length - 2) barGradient = 'from-amber-500 via-rose-500 to-rose-600';

                  const allocationPct = computed?.totalWeight ? (l.weight / computed.totalWeight) * 100 : 0;

                  return (
                    <div key={l.id || i} className="grid grid-cols-[minmax(65px,0.8fr)_minmax(110px,1.4fr)_minmax(75px,0.9fr)] items-center gap-2 py-0.5 group">
                      <div>
                        <div className="font-mono text-xs font-extrabold text-slate-900">{formatPercent(l.drawdown, 1)}</div>
                        <div className="font-mono text-[10px] text-slate-400">
                          {formatFundPrice(l.price, selectedInstrumentCurrency)}
                        </div>
                      </div>

                      <div className="flex items-center justify-center">
                        <div
                          className={cx(
                            'h-7 rounded-xl bg-gradient-to-r flex items-center justify-center text-[11px] font-extrabold text-white shadow-xs transition-all duration-300 group-hover:scale-[1.02]',
                            barGradient
                          )}
                          style={{ width: `${widthPct}%` }}
                        >
                          {l.weight}x
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-mono text-xs font-bold text-slate-900">
                          {formatCurrency(l.amount, '¥ ')}
                        </div>
                        <div className="font-mono text-[10px] text-indigo-500 font-semibold">
                          {formatPercent(allocationPct, 0)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action button */}
            <div className="mt-5">
              <button
                type="button"
                onClick={handleCreatePlan}
                disabled={isSaving}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                将此金字塔策略加入监控中心
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
