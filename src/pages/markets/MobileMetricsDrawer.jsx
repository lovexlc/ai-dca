import { useEffect, useMemo, useState } from 'react';
import { GripVertical, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cx } from '../../components/experience-ui.jsx';
import { MOBILE_METRIC_MAX, catalogForMode, defaultMobileMetrics } from './mobileFundMetrics.js';

export function MobileMetricsDrawer({ open = false, onOpenChange, isOtc = false, selectedIds = [], onSave }) {
  const [draft, setDraft] = useState(() => selectedIds.slice(0, MOBILE_METRIC_MAX));
  const [dragId, setDragId] = useState(null);

  useEffect(() => {
    if (open) setDraft((selectedIds || []).slice(0, MOBILE_METRIC_MAX));
  }, [open, selectedIds]);

  const catalog = useMemo(() => catalogForMode(isOtc), [isOtc]);
  const selectedSet = useMemo(() => new Set(draft), [draft]);
  const available = catalog.filter((item) => !selectedSet.has(item.id));

  const remove = (id) => setDraft((prev) => prev.filter((item) => item !== id));
  const add = (id) => setDraft((prev) => prev.length >= MOBILE_METRIC_MAX || prev.includes(id) ? prev : [...prev, id]);
  const move = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    setDraft((prev) => {
      const next = [...prev];
      const from = next.indexOf(fromId);
      const to = next.indexOf(toId);
      if (from < 0 || to < 0) return prev;
      next.splice(from, 1);
      next.splice(to, 0, fromId);
      return next;
    });
  };
  const save = () => {
    onSave?.((draft.length ? draft : defaultMobileMetrics(isOtc)).slice(0, MOBILE_METRIC_MAX));
    onOpenChange?.(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="fixed inset-x-0 bottom-0 top-auto z-50 flex max-h-[78vh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-t-2xl border bg-background p-0 shadow-lg sm:max-w-none data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3 text-left">
          <div>
            <DialogTitle className="text-base">显示指标</DialogTitle>
            <DialogDescription className="text-xs text-[var(--market-text-muted)]">已选 {draft.length}/{MOBILE_METRIC_MAX} · {isOtc ? '场外基金' : '场内基金'}独立配置</DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} className="rounded-full bg-[var(--market-accent)] px-3 py-1.5 text-sm font-semibold text-white">完成</button>
            <button type="button" aria-label="关闭" onClick={() => onOpenChange?.(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--market-text-muted)]"><X size={16} /></button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-2 text-xs font-semibold text-[var(--market-text-muted)]">已选（可拖动排序）</div>
          <div className="space-y-1.5">
            {draft.map((id) => {
              const item = catalog.find((entry) => entry.id === id);
              if (!item) return null;
              return (
                <div key={id} draggable onDragStart={() => setDragId(id)} onDragOver={(event) => event.preventDefault()} onDrop={() => { move(dragId, id); setDragId(null); }} onDragEnd={() => setDragId(null)} className={cx('flex items-center gap-2 rounded-xl border border-[var(--market-border)] bg-white px-2 py-2', dragId === id && 'opacity-60')}>
                  <GripVertical size={16} className="shrink-0 text-[var(--market-text-muted)]" />
                  <span className="min-w-0 flex-1 text-sm font-medium text-[var(--market-text-strong)]">{item.label}</span>
                  <button type="button" onClick={() => remove(id)} className="text-xs font-medium text-[var(--market-text-muted)]">移除</button>
                </div>
              );
            })}
          </div>
          <div className="mb-2 mt-5 text-xs font-semibold text-[var(--market-text-muted)]">可添加指标</div>
          <div className="space-y-1.5 pb-6">
            {available.map((item) => {
              const full = draft.length >= MOBILE_METRIC_MAX;
              return (
                <button key={item.id} type="button" disabled={full} onClick={() => add(item.id)} className={cx('flex w-full items-center gap-2 rounded-xl border border-[var(--market-border)] px-3 py-2 text-left text-sm', full ? 'cursor-not-allowed text-[var(--market-text-subtle)] opacity-60' : 'text-[var(--market-text-strong)] hover:bg-[var(--market-surface-muted)]')}>
                  <span className="text-[var(--market-accent)]">＋</span><span className="min-w-0 flex-1">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MobileMetricsDrawer;
