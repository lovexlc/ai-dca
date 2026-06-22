import { BarChart3, ChevronRight, MoreHorizontal, Pencil, Play, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { Card, cx } from '../experience-ui.jsx';

function strategyTone(strategy) {
  if (!strategy) return 'slate';
  if (strategy.liveSignalEnabled && strategy.enabled) return 'emerald';
  if (strategy.enabled) return 'emerald';
  return 'slate';
}

function strategyToneLabel(strategy) {
  if (!strategy) return '未启用';
  if (strategy.liveSignalEnabled && strategy.enabled) return '已确认实盘';
  if (strategy.enabled) return '已启用';
  return '未启用';
}

const TONE_CLASS = {
  emerald: {
    pill: 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-200',
    icon: 'bg-emerald-100 text-emerald-600'
  },
  amber: {
    pill: 'bg-amber-50 text-amber-700',
    icon: 'bg-amber-100 text-amber-600'
  },
  indigo: {
    pill: 'bg-indigo-50 text-indigo-700',
    icon: 'bg-indigo-100 text-indigo-600'
  },
  slate: {
    pill: 'border border-slate-200 bg-slate-100 text-slate-600',
    icon: 'bg-slate-100 text-slate-400'
  }
};

const BACKTEST_CLASS = {
  passed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-600',
  stale: 'border-amber-200 bg-amber-50 text-amber-700',
  none: 'border-amber-200 bg-amber-50 text-amber-700'
};

function StrategyCardMenu({ strategy, onRun, onEdit, onDelete, running, deleting }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen(!isOpen);
        }}
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {isOpen ? (
        <>
          <button
            type="button"
            aria-label="关闭操作菜单"
            className="fixed inset-0 z-[110] cursor-default bg-transparent sm:hidden"
            onClick={() => setIsOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 top-10 z-[120] w-44 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg sm:z-10"
          >
            <button
              type="button"
              role="menuitem"
              disabled={running}
              onClick={() => {
                onRun?.(strategy);
                setIsOpen(false);
              }}
              className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:font-normal"
            >
              <Play className="h-4 w-4 text-slate-400" />
              {running ? '运行中…' : '手动跑一轮'}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onEdit?.(strategy.id);
                setIsOpen(false);
              }}
              className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:min-h-0 sm:font-normal"
            >
              <Pencil className="h-4 w-4 text-slate-400" />
              编辑
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={deleting || strategy.id === 'default'}
              onClick={() => {
                onDelete?.(strategy);
                setIsOpen(false);
              }}
              className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0 sm:font-normal"
            >
              <Trash2 className="h-4 w-4" />
              删除
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function StrategyListPanel({
  strategies = [],
  selectedStrategyId = '',
  runningStrategyId = '',
  deletingStrategyId = '',
  onSelect,
  onRun,
  onEdit,
  onDelete
}) {
  if (!strategies.length) {
    return (
      <Card className="min-w-0">
        <div className="rounded-3xl border border-dashed border-indigo-200 bg-slate-50 px-6 py-10 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
            <BarChart3 className="h-8 w-8" aria-hidden="true" />
          </div>
          <div className="text-lg font-bold text-slate-950">还没有策略</div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            点击页面顶部的「新建策略」按钮，从模板开始配置你的第一个溢价差策略。
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {strategies.map((strategy) => {
        const tone = strategyTone(strategy);
        const toneClass = TONE_CLASS[tone] || TONE_CLASS.slate;
        const toneLabel = strategyToneLabel(strategy);
        const highCount = strategy.highCodes?.length || 0;
        const lowCount = strategy.lowCodes?.length || 0;
        const backtestStatus = strategy.backtestGate?.status || 'none';
        const backtestLabel = backtestStatus === 'passed' ? '回测有效'
          : backtestStatus === 'failed' ? '回测无效'
          : backtestStatus === 'stale' ? '需重新回测'
          : '未回测';
        const isRunning = runningStrategyId === strategy.id;
        const isDeleting = deletingStrategyId === strategy.id;
        const isSelected = selectedStrategyId === strategy.id;

        return (
          <div
            key={strategy.id}
            className={cx(
              "group relative min-w-0 max-w-full cursor-pointer overflow-hidden rounded-2xl border bg-white px-4 py-4 transition-all duration-200 before:absolute before:left-0 before:top-4 before:bottom-4 before:w-[3px] before:rounded-r-full before:content-[''] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-200/70 sm:px-5",
              strategy.enabled ? 'before:bg-emerald-500' : 'before:bg-slate-200',
              isSelected ? 'border-indigo-300 bg-indigo-50/30' : 'border-slate-200 hover:border-indigo-100'
            )}
            onClick={() => onSelect?.(strategy.id)}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                  <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold', toneClass.pill)}>
                    {toneLabel}
                  </span>
                  <span className="line-clamp-2 min-w-0 flex-1 basis-0 text-sm font-bold leading-5 text-slate-950 sm:truncate" title={strategy.name}>
                    {strategy.name || strategy.id}
                  </span>
                </div>
                <div className="mt-2 flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500">
                  <span className="shrink-0 font-bold text-slate-700">H {highCount} · L {lowCount}</span>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span className={cx(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold leading-4',
                    BACKTEST_CLASS[backtestStatus] || BACKTEST_CLASS.none
                  )}>
                    {backtestLabel}
                  </span>
                  {strategy.liveSignalEnabled ? (
                    <>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <ShieldCheck className="h-3 w-3" />
                        实盘已确认
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="hidden h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-[#EEF2FF] hover:text-[#4F46E5] disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex"
                  aria-label="手动跑一轮"
                  title="手动跑一轮"
                  disabled={isRunning}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRun?.(strategy);
                  }}
                >
                  <Play className={cx('h-4 w-4', isRunning ? 'animate-pulse' : '')} />
                </button>
                <button
                  type="button"
                  className="hidden h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-[#EEF2FF] hover:text-[#4F46E5] sm:inline-flex"
                  aria-label="编辑策略"
                  title="编辑策略"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit?.(strategy.id);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="hidden h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex"
                  aria-label="删除策略"
                  title="删除策略"
                  disabled={isDeleting || strategy.id === 'default'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete?.(strategy);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <StrategyCardMenu
                  strategy={strategy}
                  onRun={onRun}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  running={isRunning}
                  deleting={isDeleting}
                />
              </div>
            </div>

            <div className="mt-3 flex min-w-0 items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              <span className="min-w-0 truncate">
                Rule A: {strategy.intraSellLowerPct || 0}% · Rule B: {strategy.intraBuyOtherPct || 0}%
              </span>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
