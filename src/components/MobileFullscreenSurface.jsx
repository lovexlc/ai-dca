import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { cx } from './experience-ui.jsx';

function getIsLandscape() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= window.innerHeight;
}

export function requestLandscapeLock() {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const orientation = window.screen?.orientation;
  if (typeof orientation?.lock !== 'function') return Promise.resolve(false);
  try {
    return Promise.resolve(orientation.lock('landscape'))
      .then(() => true)
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function requestNativeFullscreen(element) {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (document.fullscreenElement) return Promise.resolve(true);
  const target = element || document.documentElement;
  if (typeof target?.requestFullscreen !== 'function') return Promise.resolve(false);
  try {
    return Promise.resolve(target.requestFullscreen())
      .then(() => true)
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function exitNativeFullscreen() {
  if (typeof document === 'undefined' || typeof document.exitFullscreen !== 'function') {
    return Promise.resolve(false);
  }
  if (!document.fullscreenElement) return Promise.resolve(true);
  try {
    return Promise.resolve(document.exitFullscreen())
      .then(() => true)
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function MobileFullscreenSurface({
  open = false,
  title = '全屏查看',
  onClose,
  children,
  showHeader = true,
  className = '',
  contentClassName = '',
}) {
  const [isLandscape, setIsLandscape] = useState(getIsLandscape);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const syncViewport = () => setIsLandscape(getIsLandscape());
    syncViewport();
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);

    const orientation = window.screen?.orientation;
    let locked = false;
    let disposed = false;
    if (typeof orientation?.lock === 'function') {
      requestLandscapeLock().then((didLock) => {
        if (!didLock) return;
        if (disposed) {
          if (typeof orientation?.unlock === 'function') {
            try { orientation.unlock(); } catch { /* ignore */ }
          }
          return;
        }
        locked = true;
      });
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
      disposed = true;
      if (locked && typeof orientation?.unlock === 'function') {
        try { orientation.unlock(); } catch { /* ignore */ }
      }
      if (document.fullscreenElement === document.documentElement) {
        void exitNativeFullscreen();
      }
    };
  }, [open]);

  const surface = (
    <div
      className={cx(
        open
          ? 'fixed inset-0 z-[130] flex h-[100dvh] w-[100dvw] min-h-0 flex-col overflow-hidden bg-white'
          : 'contents',
        className
      )}
      role={open ? 'dialog' : undefined}
      aria-modal={open ? 'true' : undefined}
      aria-label={open ? title : undefined}
    >
      {open && showHeader ? (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--market-border)] bg-white/95 px-3 pb-2.5 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-sm">
            <div className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--market-text-strong)]">{title}</div>
            {!isLandscape ? (
              <div className="hidden items-center gap-1 text-xs font-medium text-[var(--market-text-muted)] sm:flex">
                <RotateCcw size={13} /> 横屏查看更宽
              </div>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="退出全屏"
              title="退出全屏"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--market-text-muted)] transition hover:bg-[var(--market-surface-muted)] hover:text-[var(--market-text-strong)]"
            >
              <Minimize2 size={18} />
            </button>
          </div>
          {!isLandscape ? (
            <div className="flex shrink-0 items-center justify-center gap-1 bg-[var(--market-surface-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--market-text-muted)] sm:hidden">
              <RotateCcw size={13} /> 旋转设备横屏可获得更宽的查看区域
            </div>
          ) : null}
        </>
      ) : null}
      <div className={cx(open ? 'min-h-0 flex-1' : 'contents', contentClassName)}>{children}</div>
    </div>
  );

  return open && typeof document !== 'undefined' ? createPortal(surface, document.body) : surface;
}

export function MobileFullscreenButton({ open = false, onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? '退出全屏' : '全屏查看'}
      title={open ? '退出全屏' : '全屏查看'}
      className={cx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--market-text-muted)] transition hover:bg-[var(--market-surface-muted)] hover:text-[var(--market-text-strong)]', className)}
    >
      {open ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
    </button>
  );
}
