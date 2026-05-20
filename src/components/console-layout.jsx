import { useEffect, useState } from 'react';
import { Menu, ChevronsRight, ChevronsLeft } from 'lucide-react';
import { consumePendingToasts, subscribeToToasts } from '../app/toast.js';
import { cx } from './experience-ui.jsx';

const toastToneClasses = {
  slate: 'border-slate-200 bg-white text-slate-700',
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  red: 'border-red-200 bg-red-50 text-red-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700'
};

function ConsoleToastViewport() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    function appendToast(toast) {
      setToasts((current) => [...current.filter((item) => item.id !== toast.id), toast].slice(-4));
    }

    consumePendingToasts().forEach(appendToast);
    return subscribeToToasts(appendToast);
  }, []);

  useEffect(() => {
    const timers = toasts.map((toast) =>
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, toast.durationMs || 3200)
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [toasts]);

  if (!toasts.length) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[120] flex w-[min(92vw,24rem)] flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cx(
            'pointer-events-auto rounded-2xl border px-4 py-3 shadow-lg shadow-slate-200/70 backdrop-blur-sm',
            toastToneClasses[toast.tone] || toastToneClasses.slate
          )}
        >
          <div className="text-sm font-bold">{toast.title}</div>
          {toast.description ? (
            <div className="mt-1 text-sm leading-6 opacity-90">{toast.description}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * ConsoleLayout: a dashboard-style shell with left sidebar, optional topbar, main content,
 * and an optional right context panel. Replaces the previous PageShell + TopBar (tabs) combo.
 *
 * Props:
 * - sidebarNav: Array<{ key, label, href?, icon? }>
 * - activeKey: string
 * - onSelectNav: (key) => void
 * - brand: string (sidebar brand)
 * - topbarTitle / topbarDescription / topbarRight: optional. Topbar is hidden if all are empty.
 * - contextPanel / contextPanelTitle: optional right panel content.
 * - sidebarFooter: optional node rendered at the bottom of the sidebar (e.g. quick actions or market snapshot).
 */
export function ConsoleLayout({
  sidebarNav = [],
  activeKey = '',
  onSelectNav,
  brand = 'ai-dca',
  topbarTitle,
  topbarDescription,
  topbarRight,
  contextPanel,
  contextPanelTitle,
  sidebarFooter,
  children
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [desktopNavCollapsed, setDesktopNavCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem('console:navCollapsed') === '1'; } catch (_) { return false; }
  });
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem('console:navCollapsed', desktopNavCollapsed ? '1' : '0'); } catch (_) { /* ignore */ }
  }, [desktopNavCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(max-width: 1023px)');
    const syncViewport = () => setIsMobileViewport(Boolean(query.matches));
    syncViewport();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', syncViewport);
      return () => query.removeEventListener('change', syncViewport);
    }
    query.addListener(syncViewport);
    return () => query.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [activeKey]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  const hasTopbar = Boolean(topbarTitle || topbarDescription || topbarRight);
  const hasContext = Boolean(contextPanel);
  const mobileSidebarHidden = isMobileViewport && !mobileNavOpen;
  const currentNavItem = sidebarNav.find((item) => item.key === activeKey);
  const mobileTitle = topbarTitle || currentNavItem?.label || brand;

  return (
    <div className="console-root">
      <ConsoleToastViewport />

      {/* Mobile top bar with menu button */}
      <div className="console-mobilebar">
        <button
          type="button"
          aria-label="打开导航"
          className="console-iconbtn"
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="console-mobilebar__title">{mobileTitle}</div>
        {topbarRight ? <div className="console-mobilebar__right">{topbarRight}</div> : null}
      </div>

      <div className={cx('console-shell', desktopNavCollapsed && 'is-nav-collapsed')}>
        <aside
          className={cx('console-sidebar', mobileNavOpen && 'is-open')}
          aria-label="模块导航"
          hidden={mobileSidebarHidden}
          aria-hidden={mobileSidebarHidden ? 'true' : undefined}
          {...(mobileSidebarHidden ? { inert: '' } : {})}
        >
          <nav className="console-sidenav" aria-label="模块导航">
            {sidebarNav.map((item) => {
              const isActive = item.key === activeKey;
              const Icon = item.icon;
              return (
                <a
                  key={item.key}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cx('console-sidenav__link', isActive && 'is-active')}
                  onClick={(event) => {
                    if (!onSelectNav) {
                      return;
                    }
                    event.preventDefault();
                    onSelectNav(item.key);
                  }}
                >
                  {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                  <span className="truncate">{item.label}</span>
                </a>
              );
            })}
          </nav>
          {sidebarFooter ? <div className="console-sidebar__footer">{sidebarFooter}</div> : null}
          <button
            type="button"
            aria-label={desktopNavCollapsed ? "展开导航" : "收起导航"}
            className="console-sidebar__expand"
            onClick={() => setDesktopNavCollapsed((v) => !v)}
          >
            {desktopNavCollapsed ? (
              <ChevronsRight className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </aside>

        {mobileNavOpen ? (
          <button
            type="button"
            aria-label="关闭导航遮罩"
            className="console-backdrop"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}

        <main className="console-main">
          {hasTopbar ? (
            <header className="console-topbar">
              <div className="console-topbar__title">
                {topbarTitle ? <div className="console-topbar__heading">{topbarTitle}</div> : null}
                {topbarDescription ? <div className="console-topbar__desc">{topbarDescription}</div> : null}
              </div>
              {topbarRight ? <div className="console-topbar__right">{topbarRight}</div> : null}
            </header>
          ) : null}
          <div className="console-main__body">{children}</div>
        </main>

        {hasContext ? (
          <aside className="console-ctx" aria-label="详情面板">
            <div className="console-ctx__header">
              <div className="console-ctx__title">{contextPanelTitle || '详情'}</div>
            </div>
            <div className="console-ctx__body">{contextPanel}</div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
