import { useEffect } from 'react';
import { X } from 'lucide-react';
import { setMobileBottomSheetOpen } from '../../app/mobileBottomSheet.js';

export function HoldingsSidePanel({ open, title, children, onClose, variant = 'default' }) {
  const isSummary = variant === 'summary';
  const summaryBottomSheetOpen = Boolean(open && isSummary);

  useEffect(() => {
    setMobileBottomSheetOpen('holdings-summary', summaryBottomSheetOpen);
    return () => setMobileBottomSheetOpen('holdings-summary', false);
  }, [summaryBottomSheetOpen]);

  if (!open) return null;
  return (
    <div
      className={`fixed inset-0 z-[100] flex bg-slate-900/40 ${isSummary ? 'items-end justify-center px-0 py-0 sm:items-center sm:px-4 sm:py-6' : 'items-center justify-center px-4 py-6'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="holdings-side-panel-title"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose?.();
      }}
    >
      <div
        className={`relative flex w-full flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-slate-200 ${isSummary ? 'max-h-[92dvh] max-w-xl rounded-t-[28px] sm:max-h-[90vh] sm:rounded-2xl' : 'max-h-[90vh] max-w-xl rounded-2xl'}`}
        onClick={(event) => event.stopPropagation()}
      >
        {isSummary ? (
          <div className="relative shrink-0 px-5 pt-3 sm:px-6 sm:pt-4">
            <div className="mx-auto h-1.5 w-16 rounded-full bg-slate-200" aria-hidden="true" />
            <div id="holdings-side-panel-title" className="sr-only">{title}</div>
            <button
              type="button"
              aria-label="关闭弹层"
              className="absolute right-4 top-3 rounded-full p-2 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-700 sm:right-5 sm:top-4"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3">
            <div id="holdings-side-panel-title" className="text-sm font-bold text-slate-900">
              {title}
            </div>
            <button
              type="button"
              aria-label="关闭弹层"
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className={`flex min-h-0 flex-col overflow-y-auto px-5 ${isSummary ? 'pb-[calc(24px+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-7 sm:pt-4' : 'gap-3 py-4'}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
