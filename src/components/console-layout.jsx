import { useEffect, useRef, useState } from 'react';
import { Bell, ChartNoAxesCombined, Ellipsis, Home, Menu, ChevronsRight, ChevronsLeft, X, CalendarDays, ShieldCheck, UserRound } from 'lucide-react';
import { consumePendingToasts, subscribeToToasts } from '../app/toast.js';
import { MobileBottomNav } from './mobile/MobileBottomNav.jsx';
import { isNativeApp } from '../app/platform.js';
import { openAccountAuth } from '../app/accountAuthEvents.js';

const MOBILE_NAV_ITEMS = [
  { key: 'overview', label: '总览', icon: Home },
  { key: 'market', label: '行情', icon: ChartNoAxesCombined },
  { key: 'signals', label: '信号', icon: Bell },
  { key: 'notifications', label: '通知', icon: Bell },
  { key: 'more', label: '更多', icon: Ellipsis },
];

function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

const MOBILE_MORE_ITEMS = [
  { key: 'tradePlans', label: '计划', icon: CalendarDays, kind: 'nav' },
  { key: 'fundSwitch', label: '规则', icon: ShieldCheck, kind: 'nav' },
  { key: 'account', label: '账户', icon: UserRound, kind: 'utility' },
];

function MobileMoreSheet({ open, onClose, onSelectNav, onSelectUtility }) {
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;
  const select = (item) => {
    onClose?.();
    if (item.kind === 'nav') onSelectNav?.(item.key);
    else if (item.kind === 'utility' && item.key === 'account') openAccountAuth({ mode: 'login', source: 'mobile-more', trigger: 'account' });
    else if (item.kind === 'utility') onSelectUtility?.(item.key);
    else window.dispatchEvent(new CustomEvent(`console:mobile-more:${item.key}`));
  };
  return (
    <div className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="更多功能">
      <button type="button" className="mobile-more-sheet__backdrop" aria-label="关闭更多功能" onClick={onClose} />
      <section className="mobile-more-sheet__panel">
        <div className="mobile-more-sheet__handle" aria-hidden="true" />
        <div className="mobile-more-sheet__heading">
          <div><h2>更多功能</h2><p>扩展导航 · 更多专业工具与服务</p></div>
          <button type="button" className="mobile-more-sheet__close" onClick={onClose} aria-label="关闭更多功能"><X className="h-5 w-5" /></button>
        </div>
        <div className="mobile-more-sheet__grid">
          {MOBILE_MORE_ITEMS.map((item) => {
            const Icon = item.icon;
            return <button type="button" key={item.key} className="mobile-more-sheet__item" onClick={() => select(item)}><span className="mobile-more-sheet__item-icon"><Icon className="h-5 w-5" /></span><span>{item.label}</span>{item.badge ? <b>{item.badge}</b> : null}</button>;
          })}
        </div>
      </section>
    </div>
  );
}

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

  useEffect(() => {
    if (!toasts.some((toast) => toast.dismissOnInteraction)) {
      return undefined;
    }

    function dismissInteractiveToasts() {
      setToasts((current) => current.filter((toast) => !toast.dismissOnInteraction));
    }

    window.addEventListener('pointerdown', dismissInteractiveToasts, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', dismissInteractiveToasts, { capture: true });
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
 * - sidebarNav: Array<{ key, label, href?, icon? }> — 主导航项
 * - sidebarAdminNav: Array<{ key, label, href?, icon? }> — 管理项（可选，会在底部单独分组）
 * - activeKey: string
 * - onSelectNav: (key) => void
 * - brand: string (sidebar brand)
 * - topbarTitle / topbarDescription / topbarRight: optional. Topbar is hidden if all are empty.
 * - contextPanel / contextPanelTitle: optional right panel content.
 * - sidebarFooter: optional node rendered at the bottom of the sidebar (e.g. quick actions or market snapshot).
 */
export function ConsoleLayout({
  sidebarNav = [],
  sidebarAdminNav = [],
  utilityNav = [],
  onSelectUtility,
  activeKey = '',
  onSelectNav,
  brand = 'ai-dca',
  topbarTitle,
  topbarDescription,
  topbarRight,
  contextPanel,
  contextPanelTitle,
  sidebarFooter,
  showMobileBar = true,
  autoCollapseOnActiveKeyChange = false,
  children
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [desktopNavCollapsed, setDesktopNavCollapsed] = useState(() => {
    if (autoCollapseOnActiveKeyChange) return true;
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem('console:navCollapsed') === '1'; } catch (_) { return false; }
  });
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const sidebarRef = useRef(null);
  const touchStartXRef = useRef(null);

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
    if (!mobileNavOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTarget = sidebarRef.current?.querySelector('button, a, [tabindex]:not([tabindex="-1"])');
    focusTarget?.focus?.();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    setMobileNavOpen(false);
    setMobileMoreOpen(false);
  }, [activeKey]);

  useEffect(() => {
    if (autoCollapseOnActiveKeyChange) {
      setDesktopNavCollapsed(true);
    }
  }, [activeKey, autoCollapseOnActiveKeyChange]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function handleOpenMobileNav() {
      setMobileNavOpen(true);
    }
    window.addEventListener('console:open-mobile-nav', handleOpenMobileNav);
    return () => window.removeEventListener('console:open-mobile-nav', handleOpenMobileNav);
  }, []);

  const hasTopbar = Boolean(topbarTitle || topbarDescription || topbarRight);
  const hasContext = Boolean(contextPanel);
  const mobileSidebarHidden = isMobileViewport && !mobileNavOpen;
  const currentNavItem = sidebarNav.find((item) => item.key === activeKey) || sidebarAdminNav.find((item) => item.key === activeKey);
  const mobileTitle = topbarTitle || currentNavItem?.label || brand;
  const mobileActiveKey = activeKey === 'holdings' ? 'overview' : activeKey === 'markets' ? 'market' : activeKey === 'fundSwitch' ? 'signals' : activeKey === 'notify' ? 'notifications' : '';
  function handleMobileNavSelect(key) {
    if (key === 'more') {
      setMobileMoreOpen(true);
      return;
    }
    if (key === 'overview') onSelectNav?.('holdings');
    else if (key === 'market') onSelectNav?.('markets');
    else if (key === 'signals') onSelectNav?.('fundSwitch');
    else if (key === 'notifications') onSelectNav?.('notify');
  }

  return (
    <div className={cx('console-root', isNativeApp() && 'console-root--native', activeKey === 'holdings' && 'console-root--holdings')}>
      <ConsoleToastViewport />

      {/* Mobile top bar with menu button */}
      {showMobileBar ? (
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
      ) : null}

      <div className={cx('console-shell', desktopNavCollapsed && 'is-nav-collapsed')}>
        <aside
          ref={sidebarRef}
          className={cx('console-sidebar', mobileNavOpen && 'is-open')}
          aria-label="模块导航"
          hidden={mobileSidebarHidden}
          aria-hidden={mobileSidebarHidden ? 'true' : undefined}
          {...(mobileSidebarHidden ? { inert: true } : {})}
          onTouchStart={(event) => { touchStartXRef.current = event.touches[0]?.clientX ?? null; }}
          onTouchEnd={(event) => {
            const startX = touchStartXRef.current;
            const endX = event.changedTouches[0]?.clientX;
            touchStartXRef.current = null;
            if (mobileNavOpen && Number.isFinite(startX) && Number.isFinite(endX) && startX - endX > 56) setMobileNavOpen(false);
          }}
        >
          <div className="console-sidebar__mobile-header">
            <div className="console-sidebar__profile">
              <span className="console-sidebar__profile-mark" aria-hidden="true">AI</span>
              <div className="min-w-0">
                <span className="console-brand">{brand}</span>
                <span className="console-sidebar__profile-caption">账户与策略工作台</span>
              </div>
            </div>
            <button
              type="button"
              aria-label="关闭导航"
              className="console-sidebar__close-btn"
              onClick={() => setMobileNavOpen(false)}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
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
            {utilityNav.length > 0 && (
              <>
                <div className="px-3 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">更多功能</div>
                {utilityNav.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className="console-sidenav__link w-full text-left"
                      onClick={() => onSelectUtility?.(item.key)}
                    >
                      {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </>
            )}
            {sidebarAdminNav.length > 0 && (
              <>
                <div className="px-3 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">管理</div>
                {sidebarAdminNav.map((item) => {
                  const isActive = item.key === activeKey;
                  const Icon = item.icon;
                  return (
                    <a
                      key={item.key}
                      href={item.href}
                      aria-current={isActive ? 'page' : undefined}
                      className={cx('console-sidenav__link', isActive && 'is-active', 'opacity-75')}
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
              </>
            )}
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
      <MobileBottomNav
        items={MOBILE_NAV_ITEMS}
        activeKey={mobileMoreOpen ? 'more' : mobileActiveKey}
        onSelect={handleMobileNavSelect}
      />
      <MobileMoreSheet
        open={mobileMoreOpen}
        onClose={() => setMobileMoreOpen(false)}
        onSelectNav={onSelectNav}
        onSelectUtility={onSelectUtility}
      />
    </div>
  );
}
