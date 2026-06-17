import { Bot, ChevronRight, Plus, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';
import { Card, cx, subtleButtonClass } from '../experience-ui.jsx';

const TEMPLATE_DEFINITIONS = [
  {
    key: 'premium',
    label: '高低溢价差',
    description: '在 H/L 两组 ETF 之间按溢价差阈值切换',
    Icon: Sparkles,
    accent: 'indigo',
    draft: {
      name: '新溢价差策略',
      highCodes: [],
      lowCodes: [],
      intraSellLowerPct: 1,
      intraBuyOtherPct: 3,
      activeSide: 'all'
    }
  },
  {
    key: 'nasdaq',
    label: '纳指 ETF（推荐）',
    description: '预填 159513 / 513100 / 159501，开箱即用',
    Icon: TrendingUp,
    accent: 'emerald',
    draft: {
      name: '纳指 ETF 溢价差',
      highCodes: ['159513'],
      lowCodes: ['513100', '159501'],
      intraSellLowerPct: 1,
      intraBuyOtherPct: 3,
      activeSide: 'all'
    }
  }
];

function StatusDot({ tone }) {
  const toneClass = tone === 'emerald'
    ? 'bg-emerald-500'
    : tone === 'amber'
      ? 'bg-amber-500'
      : 'bg-slate-300';
  return <span className={cx('inline-block h-2 w-2 rounded-full', toneClass)} />;
}

function strategyTone(strategy) {
  if (!strategy) return 'slate';
  if (strategy.liveSignalEnabled && strategy.enabled) return 'emerald';
  if (strategy.enabled) return 'amber';
  return 'slate';
}

function strategyHint(strategy) {
  if (!strategy) return '未启用';
  if (strategy.liveSignalEnabled && strategy.enabled) return '已启用 · 实盘信号已确认';
  if (strategy.enabled) return '已启用 · 未确认实盘信号';
  return '未启用';
}

export function StrategyListPanel({
  strategies = [],
  selectedStrategyId = '',
  onSelect,
  onCreate,
  busy = false
}) {
  return (
    <div className="flex h-full flex-col gap-4">
      <Card className="space-y-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Templates</div>
            <h2 className="mt-1 text-base font-bold text-slate-900">从模板开始</h2>
          </div>
          <Bot className="h-5 w-5 text-slate-300" />
        </div>
        <div className="space-y-2">
          {TEMPLATE_DEFINITIONS.map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => onCreate?.(template.draft)}
              disabled={busy}
              className={cx(
                'group flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 disabled:opacity-60',
                'min-h-[64px]'
              )}
            >
              <span className={cx(
                'inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
                template.accent === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'
              )}>
                <template.Icon className="h-4 w-4" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-bold text-slate-900">{template.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">{template.description}</span>
              </span>
              <Plus className="mt-1 h-4 w-4 text-slate-400 transition-colors group-hover:text-indigo-500" />
            </button>
          ))}
        </div>
      </Card>

      <Card className="flex-1 space-y-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Strategies</div>
            <h2 className="mt-1 text-base font-bold text-slate-900">我的策略</h2>
          </div>
          <button
            type="button"
            className={subtleButtonClass}
            onClick={() => onCreate?.(TEMPLATE_DEFINITIONS[0].draft)}
            disabled={busy}
          >
            <Plus className="h-4 w-4" />
            新建
          </button>
        </div>
        {strategies.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
            还没有策略，先从上方模板新建一个吧。
          </div>
        ) : (
          <ul className="space-y-2">
            {strategies.map((strategy) => {
              const active = strategy.id === selectedStrategyId;
              const tone = strategyTone(strategy);
              const hint = strategyHint(strategy);
              const highCount = strategy.highCodes?.length || 0;
              const lowCount = strategy.lowCodes?.length || 0;
              return (
                <li key={strategy.id}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(strategy.id)}
                    className={cx(
                      'group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors min-h-[64px]',
                      active
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
                        : 'border-slate-200 bg-white text-slate-800 hover:border-indigo-200 hover:bg-indigo-50/40'
                    )}
                    aria-pressed={active}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <StatusDot tone={tone} />
                        <span className="truncate text-sm font-bold">{strategy.name || strategy.id}</span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-slate-500">
                        {hint}
                      </span>
                      <span className="mt-1 block text-xs text-slate-400">
                        H {highCount} · L {lowCount}
                      </span>
                    </span>
                    {strategy.liveSignalEnabled ? (
                      <ShieldCheck className="h-4 w-4 flex-shrink-0 text-emerald-500" aria-label="已确认实盘信号" />
                    ) : null}
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400 transition-colors group-hover:text-indigo-500" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

export { TEMPLATE_DEFINITIONS };
export const STRATEGY_TEMPLATE_DEFAULT = TEMPLATE_DEFINITIONS[0].draft;
