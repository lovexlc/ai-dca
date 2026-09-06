import { Bell, LineChart, ListChecks, Shuffle, Wallet } from 'lucide-react';
import { resolveMobileBottomNavItems } from './mobile-bottom-nav-config.js';

const ITEM_ICONS = {
  markets: LineChart,
  holdings: Wallet,
  tradePlans: ListChecks,
  fundSwitch: Shuffle,
  notify: Bell,
};

export function MobileBottomNav({ activeKey = '', visibleTabs = null, onSelectTab }) {
  const items = resolveMobileBottomNavItems(visibleTabs);
  if (items.length === 0) return null;

  return (
    <nav className="mobile-bottom-nav" aria-label="移动端主导航" data-testid="mobile-bottom-nav">
      {items.map(({ key, label }) => {
        const Icon = ITEM_ICONS[key];
        const active = key === activeKey;
        return (
          <button
            key={key}
            type="button"
            className="mobile-bottom-nav__item"
            data-active={active || undefined}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelectTab?.(key)}
          >
            <Icon className="mobile-bottom-nav__icon" strokeWidth={active ? 2 : 1.8} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
