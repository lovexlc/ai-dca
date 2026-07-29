import { Suspense, lazy, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  IconActivity,
  IconAlertCircle,
  IconArrowsExchange,
  IconBell,
  IconChartCandle,
  IconChartLine,
  IconDatabase,
  IconListCheck,
  IconMenu2,
  IconMessageCircle,
  IconSearch,
  IconCalendar,
  IconTrendingDown,
  IconTrendingUp,
  IconUserCircle,
  IconWallet,
} from '@tabler/icons-react';
import { NAV_GROUPS, NAV_UTILITY_ITEMS, WORKSPACE_TAB_META } from '../app/screens.js';
import { isTestEnvironment } from '../app/environment.js';
import { ACCOUNT_AUTH_OPEN_EVENT } from '../app/accountAuthEvents.js';
import { useNotifyUnreadCount } from '../app/useNotifyUnreadCount.js';
import { NotifyPopover } from './notify-popover.jsx';
import { NavDropdown } from './nav-dropdown.jsx';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet.jsx';

const AccountMenu = lazy(() => import('./account-menu.jsx').then((mod) => ({ default: mod.AccountMenu })));

gsap.registerPlugin(useGSAP);

const ICONS = {
  markets: IconChartLine,
  emotion: IconActivity,
  holdings: IconWallet,
  tradePlans: IconListCheck,
  newPlan: IconListCheck,
  planHome: IconTrendingUp,
  dca: IconCalendar,
  sell: IconTrendingDown,
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
  activeKey = '',
  activeHash = '',
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
  const [accountMenuMounted, setAccountMenuMounted] = useState(false);
  useNotifyUnreadCount();
  const headerRef = useRef(null);

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

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add({ reduceMotion: '(prefers-reduced-motion: reduce)' }, ({ conditions }) => {
      const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
      if (conditions.reduceMotion) {
        intro.set('.app-header__mark, .app-header__brand-copy, .app-header__nav-trigger, .app-header__utility', { autoAlpha: 1 });
        return;
      }
      intro
        .from('.app-header__mark', { autoAlpha: 0, scale: 0.72, rotation: -14, duration: 0.55 })
        .from('.app-header__brand-copy', { autoAlpha: 0, x: -10, duration: 0.4 }, '<0.18')
        .from('.app-header__nav-trigger', { autoAlpha: 0, y: 8, stagger: 0.055, duration: 0.34 }, '<0.12')
        .from('.app-header__utility', { autoAlpha: 0, y: 8, stagger: 0.05, duration: 0.28 }, '<0.1');
    }, headerRef);
    return () => media.revert();
  }, { scope: headerRef });

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
      <header ref={headerRef} className="app-header" data-testid="app-header">
        <div className="app-header__inner">
          <a href={links.home || './index.html'} className="app-header__brand" aria-label="美股策略助手首页">
            <span className="app-header__mark" aria-hidden="true">
              <IconChartCandle className="h-[17px] w-[17px]" strokeWidth={1.9} />
            </span>
            <span className="app-header__brand-copy">
              <span className="app-header__brand-name">美股策略助手</span>
            </span>
          </a>

          <span className="app-header__divider" aria-hidden="true" />

          <nav className="app-header__nav" aria-label="主导航">
            {groupsWithIcons.map((group) => (
              <NavDropdown key={group.key} group={group} links={links} activeKey={activeKey} activeHash={activeHash} onSelect={onSelectTab} />
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
                    <NotifyPopover notifyHref={links.notify || './index.html?tab=notify'} />
            {onJoinGroup ? (
              <button
                type="button"
                className="app-header__utility hidden sm:inline-flex"
                aria-label="加入群聊"
                title="加入群聊"
                onClick={onJoinGroup}
              >
                <IconMessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              </button>
            ) : null}
            {onShowDisclaimer ? (
              <button
                type="button"
                className="app-header__utility hidden sm:inline-flex"
                aria-label="免责声明"
                title="免责声明"
                onClick={onShowDisclaimer}
              >
                <IconAlertCircle className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              </button>
            ) : null}
            {accountMenuMounted ? (
              <Suspense fallback={<AccountMenuFallback />}>
                <AccountMenu initialOpen />
              </Suspense>
            ) : (
              <button type="button" className="app-header__utility" aria-label="登录账户" onClick={() => setAccountMenuMounted(true)}>
                <IconUserCircle className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
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
                      data-active={targetKey === activeKey && (item.hash || '') === activeHash}
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
                <button key={item.key} type="button" className="app-header__mobile-item" data-active={item.key === activeKey && (item.hash || '') === activeHash} onClick={() => selectUtility(item)}>
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
