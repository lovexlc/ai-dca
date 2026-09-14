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
  const avgCost = Number(computed?.averageCost) || 0;
  const anchorPrice = Number(computed?.anchorPrice) || 0;
  const safetyCushion = anchorPrice > 0 && avgCost > 0 ? ((anchorPrice - avgCost) / anchorPrice) * 100 : null;
  const layers = Array.isArray(computed?.layers) ? computed.layers : [];

  return (
    <div className={cx('min-w-0 space-y-6 lg:sticky lg:top-4', planStep !== 4 ? 'hidden lg:block' : 'block')}>
      <Card className="min-w-0 overflow-hidden border-indigo-100 bg-gradient-to-br from-indigo-50/50 via-white to-white shadow-xs">
        <div className="flex items-center justify-between">
          <SectionHeading eyebrow="结果预览" title="策略成本预览" />
          {safetyCushion != null && safetyCushion > 0 ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 shadow-xs">
              🛡️ 安全垫 +{safetyCushion.toFixed(1)}%
            </span>
          ) : null}
        </div>

        {/* 预估成本卡片 */}
        <div className="mt-5 rounded-2xl border border-indigo-100/70 bg-white/95 p-5 shadow-xs">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-500">预估平均成本</div>
          <div className="mt-1 text-3xl font-black tracking-tight text-indigo-700">
            {formatFundPrice(computed.averageCost, selectedInstrumentCurrency)}
          </div>
          <div className="mt-4 grid gap-2.5 border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>可投入资金</span>
              <strong className="font-mono text-slate-900 font-bold">{formatCurrency(computed.investableCapital, '¥ ')}</strong>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>预留防守现金</span>
              <strong className="font-mono text-slate-900 font-bold">{formatCurrency(computed.reserveCapital, '¥ ')}</strong>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{computed.anchorLabel || '基准触发价'}</span>
              <strong className="font-mono text-slate-900 font-bold">{formatFundPrice(computed.anchorPrice, selectedInstrumentCurrency)}</strong>
            </div>
          </div>
        </div>

        {/* 真正横向延展的阶梯金字塔 */}
        <div className="mt-5 rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-xs">
          <div className="grid grid-cols-[minmax(70px,0.8fr)_minmax(120px,1.5fr)_minmax(80px,0.9fr)] items-center gap-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
            <div className="text-left">触发跌幅 / 现价</div>
            <div className="text-center">阶梯加仓金字塔</div>
            <div className="text-right">加仓预算 / 占比</div>
          </div>

          <div className="mt-3 space-y-2.5">
            {layers.map((layer, index) => {
              const progression = layers.length > 1 ? index / (layers.length - 1) : 0;
              // 柱状图宽度从 45% 到 95% 平滑梯级延展
              const widthPct = Math.min(96, Math.max(45, 45 + progression * 45 + ((Number(layer.weight) || 1) / (maxLayerWeight || 3)) * 8));
              const allocationPct = computed.totalWeight ? (layer.weight / computed.totalWeight) * 100 : 0;

              let barGradient = 'from-indigo-500 to-indigo-600';
              if (index === 0) barGradient = 'from-slate-600 to-slate-800';
              else if (layer.isExtreme || index >= layers.length - 2) barGradient = 'from-amber-500 via-rose-500 to-rose-600';

              return (
                <div key={layer.id || index} className="group grid grid-cols-[minmax(70px,0.8fr)_minmax(120px,1.5fr)_minmax(80px,0.9fr)] items-center gap-2 py-0.5">
                  {/* 左侧：跌幅与触发价 */}
                  <div>
                    <div className="font-mono text-xs font-extrabold text-slate-900">{formatPercent(layer.drawdown, 1)}</div>
                    <div className="font-mono text-[10px] text-slate-400">{formatFundPrice(layer.price, selectedInstrumentCurrency)}</div>
                  </div>

                  {/* 中间：真实横向展开的梯级条 */}
                  <div className="flex items-center justify-center">
                    <div
                      className={cx(
                        'h-7 rounded-xl bg-gradient-to-r flex items-center justify-center text-[11px] font-extrabold text-white shadow-xs transition-all duration-300 group-hover:scale-[1.02]',
                        barGradient
                      )}
                      style={{ width: `${widthPct}%` }}
                    >
                      <span>{layer.weight}x</span>
                    </div>
                  </div>

                  {/* 右侧：金额与占比 */}
                  <div className="text-right">
                    <div className="font-mono text-xs font-bold text-slate-900">{formatCurrency(layer.amount, '¥ ')}</div>
                    <div className="font-mono text-[10px] text-indigo-500 font-semibold">{formatPercent(allocationPct, 0)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="min-w-0 overflow-hidden border-emerald-100 bg-emerald-50/60 p-4">
        <div className="font-semibold text-xs text-emerald-900 flex items-center space-x-1.5">
          <span>🎯 执行纪律建议</span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-emerald-800">
          当前策略共分为 {layers.length} 档阶梯。首层轻仓介入试水，随后每档按梯度加仓，在深水区最大化安全垫与筹码优势。
        </p>
      </Card>
    </div>
  );
}
