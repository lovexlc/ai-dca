import { useEffect, useRef, useState } from 'react';
import { FlaskConical, MoreHorizontal, PauseCircle, Play, Settings2, Trash2 } from 'lucide-react';
import { cx } from '../experience-ui.jsx';

export function PlanActionMenu({
  enabled = true,
  noHolding = false,
  onEdit,
  onToggle,
  onDelete,
  onTest,
  showManagement = true
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const choose = (handler) => {
    setOpen(false);
    handler?.();
  };

  return (
    <div ref={rootRef} className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label="更多方案操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
      >
        <MoreHorizontal className="h-4 w-4" />
        <span className="sr-only">更多</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-12 z-20 w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg shadow-slate-900/10"
        >
          {onTest ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onTest)}
              className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              快速测试
            </button>
          ) : null}
          {showManagement ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(onEdit)}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {noHolding ? '重新选择持仓' : '编辑规则'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(onToggle)}
                className={cx(
                  'flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold hover:bg-slate-50',
                  enabled ? 'text-amber-700 hover:text-amber-800' : 'text-emerald-700 hover:text-emerald-800'
                )}
              >
                {enabled ? <PauseCircle className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {enabled ? '暂停规则' : '恢复规则'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(onDelete)}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除规则
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
