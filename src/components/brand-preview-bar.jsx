import { AlertCircle, LineChart, Menu, MessageCircle, UserRound } from 'lucide-react';
import { Suspense, lazy, useEffect, useState } from 'react';
import { ACCOUNT_AUTH_OPEN_EVENT } from '../app/accountAuthEvents.js';
import { useNotifyUnreadCount } from '../app/useNotifyUnreadCount.js';
import { NotifyPopover } from './notify-popover.jsx';
import './brand-preview-bar.css';
import './header-actions.css';

const AccountMenu = lazy(() => import('./account-menu.jsx').then((mod) => ({ default: mod.AccountMenu })));

function AccountMenuFallback() {
  return (
    <button type="button" aria-label="账户" className="app-header__utility" disabled>
      <UserRound className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  );
}

export function BrandPreviewBar({ currentPageLabel, onJoinGroup, onShowDisclaimer, onOpenNav }) {
  const [accountMenuMounted, setAccountMenuMounted] = useState(false);
  useNotifyUnreadCount();

  useEffect(() => {
    function handleOpenAccountAuth() {
      setAccountMenuMounted(true);
    }
    window.addEventListener(ACCOUNT_AUTH_OPEN_EVENT, handleOpenAccountAuth);
    return () => window.removeEventListener(ACCOUNT_AUTH_OPEN_EVENT, handleOpenAccountAuth);
  }, []);

  return (
    <header className="app-header brand-preview-bar" data-testid="brand-preview-bar">
      <div className="app-header__inner">
        <div className="app-header__brand">
          <span className="app-header__mark" aria-hidden="true">
            <LineChart className="h-[17px] w-[17px]" strokeWidth={1.9} />
          </span>
          <span className="app-header__brand-copy">
            <span className="app-header__brand-name">美股策略助手</span>
            <span className="app-header__brand-badge">Beta</span>
          </span>
        </div>

        {currentPageLabel ? (
          <>
            <span className="app-header__divider" aria-hidden="true" />
            <span className="app-header__page-title">{currentPageLabel}</span>
          </>
        ) : null}

        <div className="app-header__actions">
          <div className="hidden items-center gap-1 md:flex" aria-label="帮助与社区">
            {onJoinGroup ? (
              <button
                type="button"
                onClick={onJoinGroup}
                className="inline-flex min-h-[34px] items-center gap-2 rounded-md px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                加入群聊
              </button>
            ) : null}
            {onShowDisclaimer ? (
              <button
                type="button"
                onClick={onShowDisclaimer}
                className="inline-flex min-h-[34px] items-center gap-2 rounded-md px-3 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 hover:text-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
              >
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                免责声明
              </button>
            ) : null}
          </div>
          <NotifyPopover />
          {accountMenuMounted ? (
            <Suspense fallback={<AccountMenuFallback />}>
              <AccountMenu initialOpen />
            </Suspense>
          ) : (
            <button type="button" aria-label="账户" onClick={() => setAccountMenuMounted(true)} className="app-header__utility">
              <UserRound className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          )}
          {onOpenNav ? (
            <button type="button" className="app-header__menu-button" aria-label="打开导航" onClick={onOpenNav}>
              <Menu className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
