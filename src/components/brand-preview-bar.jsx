import { AlertCircle, ArrowLeftRight, ChevronDown, LineChart, Menu, MoreVertical, MessageCircle, Search, UserRound } from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ACCOUNT_AUTH_OPEN_EVENT } from '../app/accountAuthEvents.js';

const AccountMenu = lazy(() => import('./account-menu.jsx').then((mod) => ({ default: mod.AccountMenu })));

function AccountMenuFallback() {
  return (
    <button
      type="button"
      aria-label="账户"
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"
      disabled
    >
      <UserRound className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/**
 * 应用顶部品牌条（Google Finance 风格）。
 * 取代各 tab 内部的大 H1 hero，释放垂直空间。
 * 手机 / PC 均可见，保证加入群聊 / 免责 / 账号菜单 三件事两端一致。
 */
export function BrandPreviewBar({ currentPageLabel, rightSlot, onJoinGroup, onShowDisclaimer, onOpenNav, onOpenSearch, onOpenTrade }) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [accountMenuMounted, setAccountMenuMounted] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const moreButtonRef = useRef(null);
  const moreMenuRef = useRef(null);

  useEffect(() => {
    if (!moreMenuOpen) return;

    function handleClickOutside(event) {
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(event.target) &&
        moreButtonRef.current &&
        !moreButtonRef.current.contains(event.target)
      ) {
        setMoreMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moreMenuOpen]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(max-width: 1023.98px)');
    const syncViewport = () => setIsMobileViewport(media.matches);
    syncViewport();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', syncViewport);
      return () => media.removeEventListener('change', syncViewport);
    }
    media.addListener(syncViewport);
    return () => media.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    function handleOpenAccountAuth() {
      setAccountMenuMounted(true);
    }
    function handleCloseMobileAccount() {
      setAccountMenuMounted(false);
    }
    window.addEventListener(ACCOUNT_AUTH_OPEN_EVENT, handleOpenAccountAuth);
    window.addEventListener('console:close-mobile-account', handleCloseMobileAccount);
    return () => {
      window.removeEventListener(ACCOUNT_AUTH_OPEN_EVENT, handleOpenAccountAuth);
      window.removeEventListener('console:close-mobile-account', handleCloseMobileAccount);
    };
  }, []);

  return (
    <>
      <div className="app-brand-bar sticky top-0 z-[100] flex h-12 items-center gap-2 border-b border-slate-200 bg-white px-3 sm:gap-3 sm:px-6">
      <div className="app-mobile-topbar">
        <button type="button" aria-label="打开导航" onClick={onOpenNav} className="app-mobile-topbar__brand">
          <LineChart className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
        </button>
        <button type="button" className="app-mobile-topbar__title" onClick={onOpenNav} aria-label="打开模块导航">
          <span>{currentPageLabel || '持仓总览'}</span><ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className="app-mobile-topbar__actions">
          <button type="button" aria-label="搜索" onClick={onOpenSearch}><Search className="h-4 w-4" /></button>
          <button type="button" aria-label="交易" onClick={onOpenTrade}><ArrowLeftRight className="h-4 w-4" /></button>
          <button type="button" aria-label="我的" onClick={() => setAccountMenuMounted(true)}><UserRound className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="app-brand-bar__desktop-content">
      <div className="flex shrink-0 items-center gap-2">
        {onOpenNav ? (
          <>
            <button
              type="button"
              aria-label="打开导航"
              onClick={onOpenNav}
              className="relative inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-sm transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 sm:hidden"
            >
              <LineChart className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
              <span className="absolute -bottom-1 -right-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white bg-slate-900 text-white shadow-sm" aria-hidden="true">
                <Menu className="h-2.5 w-2.5" strokeWidth={2.6} />
              </span>
            </button>
            <span className="hidden h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-purple-500 text-white sm:inline-flex" aria-hidden="true">
              <LineChart className="h-4 w-4" strokeWidth={2.4} />
            </span>
          </>
        ) : (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-purple-500 text-white">
            <LineChart className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
          </span>
        )}
        <span className="hidden text-[15px] font-semibold tracking-tight text-slate-900 sm:inline">美股策略助手</span>
        <span className="ml-1 hidden items-center rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 sm:inline-flex">Beta</span>
      </div>
      {currentPageLabel ? (
        <>
          <span className="hidden text-slate-300 sm:inline">/</span>
          <span className="truncate text-sm font-medium text-slate-700">{currentPageLabel}</span>
        </>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <div className="relative">
          <button
            ref={moreButtonRef}
            type="button"
            onClick={() => setMoreMenuOpen(!moreMenuOpen)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
            aria-label="更多选项"
          >
            <MoreVertical className="h-4 w-4 text-slate-600" />
          </button>
          {moreMenuOpen && (
            <div
              ref={moreMenuRef}
              className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            >
              {onJoinGroup && (
                <button
                  type="button"
                  onClick={() => {
                    onJoinGroup();
                    setMoreMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <MessageCircle className="h-4 w-4" />
                  加入群聊
                </button>
              )}
              {onShowDisclaimer && (
                <button
                  type="button"
                  onClick={() => {
                    onShowDisclaimer();
                    setMoreMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-amber-700 hover:bg-amber-50"
                >
                  <AlertCircle className="h-4 w-4" />
                  免责声明
                </button>
              )}
            </div>
          )}
        </div>
        {rightSlot}
        {accountMenuMounted && !isMobileViewport ? (
          <Suspense fallback={<AccountMenuFallback />}>
            <AccountMenu initialOpen />
          </Suspense>
        ) : (
          <button
            type="button"
            aria-label="登录账户"
            onClick={() => setAccountMenuMounted(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      </div>
    </div>
    {isMobileViewport && accountMenuMounted ? (
      <div className="app-mobile-account-host app-mobile-account-page-host">
        <Suspense fallback={<AccountMenuFallback />}>
          <AccountMenu initialOpen mobilePage />
        </Suspense>
      </div>
    ) : null}
    </>
  );
}
