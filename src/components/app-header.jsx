import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  IconActivity,
  IconAlertCircle,
  IconArrowsExchange,
  IconBell,
  IconChartLine,
  IconDatabase,
  IconDots,
  IconListCheck,
  IconMenu2,
  IconMessageCircle,
  IconSearch,
  IconUserCircle,
  IconWallet,
} from '@tabler/icons-react';
import { NAV_GROUPS, NAV_UTILITY_ITEMS, WORKSPACE_TAB_META } from '../app/screens.js';
import { isTestEnvironment } from '../app/environment.js';
import { ACCOUNT_AUTH_OPEN_EVENT } from '../app/accountAuthEvents.js';
import { useNotifyUnreadCount, clearNotifyUnread } from '../app/useNotifyUnreadCount.js';
import { NavDropdown } from './nav-dropdown.jsx';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet.jsx';

const AccountMenu = lazy(() => import('./account-menu.jsx').then((mod) => ({ default: mod.AccountMenu })));

const ICONS = {
  markets: IconChartLine,
  emotion: IconActivity,
  holdings: IconWallet,
  tradePlans: IconListCheck,
  newPlan: IconListCheck,
  fundSwitch: IconArrowsExchange,
  notify: IconBell,
  adminData: IconDatabase,
};

function AccountMenuFallback() {
  return (
    <button type="button" aria-label="登录账户" className="app-header__utility" disabled>
      <IconUserCircle className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  );
}

export function AppHeader({
  currentPageLabel = '',
  activeKey = '',
  links = {},
  rightSlot = null,
  isAdminUser = false,
  visibleTabs = null,
  onSelectTab,
  onJoinGroup,
  onShowDisclaimer,
  onOpenNav,
  onOpenSearch,
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [accountMenuMounted, setAccountMenuMounted] = useState(false);
  const unreadCount = useNotifyUnreadCount();
  const moreButtonRef = useRef(null);
  const moreMenuRef = useRef(null);

  const testEnvironment = isTestEnvironment();
  const isVisible = useCallback((item) => {
    if (!visibleTabs) return true;
    const visibilityKey = item.visibilityKey || item.targetKey || item.key;
    const meta = WORKSPACE_TAB_META[visibilityKey] || {};
    if (!visibleTabs.includes(visibilityKey)) return false;
    if (meta.testOnly && !testEnvironment) return false;
    if ((meta.adminOnly || item.adminOnly) && !isAdminUser) return false;
    return true;
  }, [visibleTabs, isAdminUser, testEnvironment]);
  const visibleGroups = useMemo(
    () => NAV_GROUPS
      .map((group) => ({ ...group, items: group.items.filter(isVisible) }))
      .filter((group) => group.items.length > 0),
    // isVisible deliberately captures the current scenario and auth state.
    [isVisible],
  );
  const visibleUtilityItems = useMemo(() => NAV_UTILITY_ITEMS.filter(isVisible), [isVisible]);

  useLayoutEffect(() => {
    function handleOpenMobileNav() {
      setMobileNavOpen(true);
    }
    function handleCloseMobileNav() {
      setMobileNavOpen(false);
    }
    function handleOpenAccountAuth() {
      setAccountMenuMounted(true);
    }
    window.addEventListener('console:open-mobile-nav', handleOpenMobileNav);
    window.addEventListener('console:close-mobile-nav', handleCloseMobileNav);
    window.addEventListener(ACCOUNT_AUTH_OPEN_EVENT, handleOpenAccountAuth);
    return () => {
      window.removeEventListener('console:open-mobile-nav', handleOpenMobileNav);
      window.removeEventListener('console:close-mobile-nav', handleCloseMobileNav);
      window.removeEventListener(ACCOUNT_AUTH_OPEN_EVENT, handleOpenAccountAuth);
    };
  }, []);

  useEffect(() => {
    if (!moreMenuOpen) return undefined;
    function handleClickOutside(event) {
      if (!moreMenuRef.current?.contains(event.target) && !moreButtonRef.current?.contains(event.target)) {
        setMoreMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moreMenuOpen]);

  function selectItem(item) {
    if (!item) return;
    setMobileNavOpen(false);
    onSelectTab?.(item.targetKey || item.key, { hash: item.hash || '' });
  }

  function selectUtility(item) {
    selectItem(item);
  }

  const groupsWithIcons = visibleGroups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, Icon: ICONS[item.key] })),
  }));

  return (
    <>
      <header className="app-header" data-testid="app-header">
        <div className="app-header__inner">
          <button
            type="button"
            className="app-header__menu-button sm:hidden"
            aria-label="打开导航"
            onClick={() => {
              setMobileNavOpen(true);
              onOpenNav?.();
            }}
          >
            <IconMenu2 className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
          </button>

          <a href={links.home || './index.html'} className="app-header__brand" aria-label="美股策略助手首页">
            <span className="app-header__mark" aria-hidden="true">
              <IconChartLine className="h-[17px] w-[17px]" strokeWidth={1.9} />
            </span>
            <span className="app-header__brand-name">美股策略助手</span>
            <span className="app-header__beta">Beta</span>
          </a>

          <span className="app-header__page-label" aria-current="page">{currentPageLabel}</span>

          <nav className="app-header__nav" aria-label="主导航">
            {groupsWithIcons.map((group) => (
              <NavDropdown key={group.key} group={group} links={links} activeKey={activeKey} onSelect={onSelectTab} />
            ))}
          </nav>

          <div className="app-header__actions">
            {rightSlot ? <div className="app-header__scenario">{rightSlot}</div> : null}
            <button
              type="button"
              className="app-header__utility hidden sm:inline-flex"
              aria-label="全局搜索"
              title="全局搜索"
              onClick={onOpenSearch}
            >
              <IconSearch className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
            </button>
            <div className="relative">
              <button
                type="button"
                className="app-header__utility hidden sm:inline-flex"
                aria-label="通知管理"
                disabled={!visibleUtilityItems.some((item) => item.key === 'notify')}
                onClick={() => {
                  const notifyItem = visibleUtilityItems.find((item) => item.key === 'notify');
                  if (notifyItem) {
                    clearNotifyUnread();
                    selectUtility(notifyItem);
                  }
                }}
              >
                <IconBell className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
                {unreadCount > 0 ? (
                  <span className="app-header__badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                ) : null}
              </button>
            </div>
            <div className="relative">
              <button
                ref={moreButtonRef}
                type="button"
                className="app-header__utility"
                aria-label="更多选项"
                aria-expanded={moreMenuOpen}
                onClick={() => setMoreMenuOpen((open) => !open)}
              >
                <IconDots className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              </button>
              {moreMenuOpen ? (
                <div ref={moreMenuRef} className="absolute right-0 top-full z-[115] mt-2 grid w-40 gap-1 rounded-[var(--radius-lg)] border border-[var(--a-200)] bg-[var(--bg-100)] p-1.5 shadow-[var(--shadow-drop)]">
                  {onJoinGroup ? (
                    <button type="button" className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--fg-900)] hover:bg-[#f4f4f4]" onClick={() => { onJoinGroup(); setMoreMenuOpen(false); }}>
                      <IconMessageCircle className="h-4 w-4" aria-hidden="true" />
                      加入群聊
                    </button>
                  ) : null}
                  {onShowDisclaimer ? (
                    <button type="button" className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-[var(--amber-text)] hover:bg-[var(--amber-tint)]" onClick={() => { onShowDisclaimer(); setMoreMenuOpen(false); }}>
                      <IconAlertCircle className="h-4 w-4" aria-hidden="true" />
                      免责声明
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {accountMenuMounted ? (
              <Suspense fallback={<AccountMenuFallback />}>
                <AccountMenu initialOpen />
              </Suspense>
            ) : (
              <button type="button" className="app-header__utility" aria-label="登录账户" onClick={() => setAccountMenuMounted(true)}>
                <IconUserCircle className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </header>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" aria-label="移动端导航" className="w-full max-w-none px-4 pt-6 sm:w-[min(88vw,360px)]">
          <SheetHeader>
            <SheetTitle>美股策略助手</SheetTitle>
            <SheetDescription>选择要打开的工作区</SheetDescription>
          </SheetHeader>
          <div className="app-header__mobile-nav">
            {groupsWithIcons.map((group) => (
              <div key={group.key} className="app-header__mobile-group">
                <div className="app-header__mobile-group-label">{group.label}</div>
                {group.items.map((item) => {
                  const targetKey = item.targetKey || item.key;
                  const Icon = item.Icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className="app-header__mobile-item"
                      data-active={targetKey === activeKey}
                      onClick={() => selectItem(item)}
                    >
                      <span className="flex items-center gap-2">
                        {Icon ? <Icon className="h-4 w-4 text-[var(--fg-700)]" strokeWidth={1.8} aria-hidden="true" /> : null}
                        <span className="app-header__mobile-item-label">{item.label}</span>
                      </span>
                      <span className="app-header__mobile-item-description">{item.description}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="app-header__mobile-group">
              <div className="app-header__mobile-group-label">更多</div>
              {visibleUtilityItems.map((item) => (
                <button key={item.key} type="button" className="app-header__mobile-item" data-active={item.key === activeKey} onClick={() => selectUtility(item)}>
                  <span className="flex items-center gap-2">
                    {item.key === 'notify' ? <IconBell className="h-4 w-4 text-[var(--fg-700)]" strokeWidth={1.8} aria-hidden="true" /> : <IconDatabase className="h-4 w-4 text-[var(--fg-700)]" strokeWidth={1.8} aria-hidden="true" />}
                    <span className="app-header__mobile-item-label">{item.label}</span>
                  </span>
                  <span className="app-header__mobile-item-description">{item.description}</span>
                </button>
              ))}
            </div>
            <div className="app-header__mobile-footer">
              {onJoinGroup ? <button type="button" className="app-header__mobile-item" onClick={() => { setMobileNavOpen(false); onJoinGroup(); }}>加入群聊</button> : null}
              {onShowDisclaimer ? <button type="button" className="app-header__mobile-item text-[var(--amber-text)]" onClick={() => { setMobileNavOpen(false); onShowDisclaimer(); }}>免责声明</button> : null}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
