import {
  IconArrowsExchange,
  IconChartLine,
  IconHome2,
  IconListCheck,
  IconWallet,
} from '@tabler/icons-react';

const ITEMS = [
  { key: 'portal', label: '首页', Icon: IconHome2 },
  { key: 'markets', label: '行情', Icon: IconChartLine },
  { key: 'holdings', label: '持仓', Icon: IconWallet },
  { key: 'tradePlans', label: '计划', Icon: IconListCheck },
  { key: 'fundSwitch', label: '换基', Icon: IconArrowsExchange },
];

export function MobileBottomNav({ activeKey = '', visibleTabs = null, onSelectTab }) {
  const items = visibleTabs ? ITEMS.filter((item) => visibleTabs.includes(item.key)) : ITEMS;
  if (items.length === 0) return null;

  return (
    <nav className="mobile-bottom-nav" aria-label="移动端主导航" data-testid="mobile-bottom-nav">
      {items.map(({ key, label, Icon }) => {
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
