import { AlertTriangle } from 'lucide-react';
import { Card, SectionHeading, cx } from '../components/experience-ui.jsx';

export function NewPlanPreviewSidebar({
  planStep,
  computed,
  maxLayerWeight,
  selectedStrategy,
  selectedInstrumentCurrency,
  selectedAnchorNameLabel,
  formatFundPrice,
  formatPercent,
  formatCurrency
}) {
  return (
    <div className={cx('min-w-0 space-y-6 lg:sticky lg:top-4 lg:block', planStep !== 4 && 'hidden')}>
      <Card className="min-w-0 overflow-hidden border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white">
        <SectionHeading eyebrow="结果预览" title="策略成本预览" />
        <div className="mt-6 rounded-[24px] border border-white/80 bg-white/90 p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">预估平均成本</div>
          <div className="mt-2 text-3xl font-extrabold tracking-tight text-indigo-700">{formatFundPrice(computed.averageCost, selectedInstrumentCurrency)}</div>
          <div className="mt-4 grid gap-3">
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>可投入资金</span>
              <strong className="text-slate-900">{formatCurrency(computed.investableCapital, '¥ ')}</strong>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>预留现金</span>
              <strong className="text-slate-900">{formatCurrency(computed.reserveCapital, '¥ ')}</strong>
            </div>
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>{computed.anchorLabel}（{selectedAnchorNameLabel}）</span>
              <strong className="text-slate-900">{formatFundPrice(computed.anchorPrice, selectedInstrumentCurrency)}</strong>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[24px] border border-slate-200 bg-white/80 p-5 shadow-sm">
          <div className="grid grid-cols-[minmax(82px,0.9fr)_minmax(112px,1.2fr)_minmax(88px,0.9fr)] items-end gap-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            <div className="text-right">Price / Condition</div>
            <div className="text-center">Stepped Pyramid</div>
            <div>Budget / Allocation</div>
          </div>
          <div className="relative mt-4 space-y-3 overflow-hidden rounded-[24px] bg-gradient-to-b from-slate-50 via-white to-indigo-50/40 px-2 py-3">
            <div className="pointer-events-none absolute bottom-4 left-1/2 top-4 border-l border-dashed border-indigo-200" />
            {computed.layers.map((layer, index) => {
              const progression = computed.layers.length > 1 ? index / (computed.layers.length - 1) : 0;
              const widthPct = Math.min(94, 35 + progression * 40 + (Number(layer.weight) || 0) / maxLayerWeight * 15);
              const allocationPct = computed.totalWeight ? layer.weight / computed.totalWeight * 100 : 0;
              return (
                <div key={layer.id} className="group grid grid-cols-[minmax(82px,0.9fr)_minmax(112px,1.2fr)_minmax(88px,0.9fr)] items-center gap-3">
                  <div className="text-right">
                    <div className="text-xs font-extrabold text-slate-900">{formatPercent(layer.drawdown, 1)}</div>
                    <div className="mt-0.5 type-data text-[11px] text-slate-400">{formatFundPrice(layer.price, selectedInstrumentCurrency)}</div>
                  </div>
                  <div className="relative flex min-h-10 items-center justify-center">
                    <div
                      className={cx(
                        'relative flex h-10 items-center justify-center overflow-hidden rounded-2xl px-3 text-xs font-extrabold text-white shadow-sm transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-indigo-200/60',
                        layer.isExtreme
                          ? 'bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500'
                          : layer.order === 1
                            ? 'bg-gradient-to-r from-slate-700 via-slate-900 to-slate-700'
                            : 'bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-600'
                      )}
                      style={{ width: `${widthPct}%` }}
                    >
                      <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-white/20 opacity-0 transition-all duration-700 group-hover:left-full group-hover:opacity-100" />
                      <span className="relative z-10">{layer.weight}x</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">{formatPercent(allocationPct, 1)}</div>
                    <div className="mt-0.5 type-data text-[11px] text-slate-400">{formatCurrency(layer.amount, '¥ ')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="min-w-0 overflow-hidden border-emerald-100 bg-emerald-50">
        <div className="font-semibold text-emerald-900">执行建议</div>
        <p className="mt-2 text-sm leading-6 text-emerald-800">
          {selectedStrategy === 'peak-drawdown'
            ? `当前计划会按 ${computed.layers.length} 档固定回撤执行，首档 ${formatPercent(computed.layers[0]?.drawdown ?? 0, 1)}，极端档 ${formatPercent(computed.layers[computed.layers.length - 1]?.drawdown ?? 0, 1)}。`
            : `当前计划会按 4 档均线模板执行，先靠近120日线建首仓，再在更深位置逐步加大投入。`}
        </p>
      </Card>

      <Card className="min-w-0 overflow-hidden border-amber-200 bg-amber-50">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
          <div>
            <div className="font-semibold text-amber-900">估计备注</div>
            <p className="mt-2 text-sm leading-6 text-amber-800">
              {selectedStrategy === 'peak-drawdown'
                ? '固定回撤模板的跌幅档位不会自动变化，调整阶段高点会整体联动 8 档价格。'
                : '均线模板下，若200日线高于深水层，它只作为风控线提示，不会反向插入加仓顺序。'}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
