import { AlertCircle, LineChart, Menu, MoreVertical, MessageCircle, UserRound } from 'lucide-react';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
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

export function BrandPreviewBar({ currentPageLabel, rightSlot, onJoinGroup, onShowDisclaimer, onOpenNav }) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [accountMenuMounted, setAccountMenuMounted] = useState(false);
  const moreButtonRef = useRef(null);
  const moreMenuRef = useRef(null);
  useNotifyUnreadCount();

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
          <div className="app-header__more">
            <button
              ref={moreButtonRef}
              type="button"
              onClick={() => setMoreMenuOpen(!moreMenuOpen)}
              className="app-header__utility"
              aria-label="更多选项"
              aria-expanded={moreMenuOpen}
            >
              <MoreVertical className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
            {moreMenuOpen ? (
              <div ref={moreMenuRef} className="app-header__more-menu">
                {onJoinGroup ? (
                  <button
                    type="button"
                    onClick={() => {
                      onJoinGroup();
                      setMoreMenuOpen(false);
                    }}
                    className="app-header__more-item"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    加入群聊
                  </button>
                ) : null}
                {onShowDisclaimer ? (
                  <button
                    type="button"
                    onClick={() => {
                      onShowDisclaimer();
                      setMoreMenuOpen(false);
                    }}
                    className="app-header__more-item app-header__more-item--warning"
                  >
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    免责声明
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {rightSlot ? <div className="app-header__scenario">{rightSlot}</div> : null}
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
