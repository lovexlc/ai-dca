import { useEffect, useState } from 'react';
import { Bell, House, LineChart, ListChecks, MoreHorizontal, Shuffle, Wallet } from 'lucide-react';
import { splitMobileBottomNavItems } from './mobile-bottom-nav-config.js';

const ITEM_ICONS = {
  home: House,
  markets: LineChart,
  holdings: Wallet,
  tradePlans: ListChecks,
  fundSwitch: Shuffle,
  notify: Bell,
};

function MobileNavItem({ item, active, onSelect }) {
  const Icon = ITEM_ICONS[item.key];
  if (!Icon) return null;
  return (
    <button
      key={item.key}
      type="button"
      className="mobile-bottom-nav__item"
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect?.(item.key)}
    >
      <Icon className="mobile-bottom-nav__icon" strokeWidth={active ? 2 : 1.8} aria-hidden="true" />
      <span>{item.label}</span>
    </button>
  );
}

export function MobileBottomNav({ activeKey = '', visibleTabs = null, onSelectTab }) {
  const [{ directItems, overflowItems }, setItems] = useState(() => splitMobileBottomNavItems(visibleTabs));
  const [moreOpen, setMoreOpen] = useState(false);
  const overflowActive = overflowItems.some((item) => item.key === activeKey);

  useEffect(() => {
    setItems(splitMobileBottomNavItems(visibleTabs));
  }, [visibleTabs]);

  useEffect(() => {
    setMoreOpen(false);
  }, [activeKey]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape') setMoreOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moreOpen]);

  if (directItems.length === 0 && overflowItems.length === 0) return null;

  function selectOverflowTab(key) {
    setMoreOpen(false);
    onSelectTab?.(key);
  }

  return (
    <>
      {moreOpen && overflowItems.length > 0 ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[94] cursor-default bg-slate-950/10 sm:hidden"
            aria-label="关闭更多导航"
            onClick={() => setMoreOpen(false)}
          />
          <div
            id="mobile-bottom-nav-more"
            className="fixed inset-x-3 bottom-[calc(70px+env(safe-area-inset-bottom))] z-[96] grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-900/20 sm:hidden"
            role="menu"
            aria-label="更多页面"
          >
            {overflowItems.map((item) => {
              const Icon = ITEM_ICONS[item.key];
              const active = item.key === activeKey;
              if (!Icon) return null;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className={`flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'bg-slate-50 text-slate-700 active:bg-slate-100'
                  }`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => selectOverflowTab(item.key)}
                >
                  <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2 : 1.8} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      <nav className="mobile-bottom-nav" aria-label="移动端主导航" data-testid="mobile-bottom-nav">
        {directItems.map((item) => (
          <MobileNavItem
            key={item.key}
            item={item}
            active={item.key === activeKey}
            onSelect={onSelectTab}
          />
        ))}
        {overflowItems.length > 0 ? (
          <button
            type="button"
            className="mobile-bottom-nav__item"
            data-active={overflowActive || moreOpen || undefined}
            aria-label="更多页面"
            aria-expanded={moreOpen}
            aria-controls="mobile-bottom-nav-more"
            onClick={() => setMoreOpen((open) => !open)}
          >
            <MoreHorizontal className="mobile-bottom-nav__icon" strokeWidth={overflowActive ? 2 : 1.8} aria-hidden="true" />
            <span>…</span>
          </button>
        ) : null}
      </nav>
    </>
  );
}
