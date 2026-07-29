import { useEffect, useState } from 'react';
import {
  IconArrowsExchange,
  IconBell,
  IconChartLine,
  IconListCheck,
  IconWallet,
} from '@tabler/icons-react';
import { clearNotifyUnread } from '../app/useNotifyUnreadCount.js';

const ITEMS = [
  { key: 'markets', label: '行情', Icon: IconChartLine },
  { key: 'holdings', label: '持仓', Icon: IconWallet },
  { key: 'tradePlans', label: '计划', Icon: IconListCheck },
  { key: 'fundSwitch', label: '换基', Icon: IconArrowsExchange },
  { key: 'notify', label: '通知', Icon: IconBell },
];

export function MobileBottomNav({ activeKey = '', visibleTabs = null, onSelectTab }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    function handleCount(e) {
      setUnreadCount(e?.detail?.count || 0);
    }
    function handleClear() {
      setUnreadCount(0);
    }
    window.addEventListener('ai-dca-notify-unread-count', handleCount);
    window.addEventListener('ai-dca-notify-clear-unread', handleClear);
    return () => {
      window.removeEventListener('ai-dca-notify-unread-count', handleCount);
      window.removeEventListener('ai-dca-notify-clear-unread', handleClear);
    };
  }, []);

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
            onClick={() => {
              if (key === 'notify') clearNotifyUnread();
              onSelectTab?.(key);
            }}
          >
            <Icon className="mobile-bottom-nav__icon" strokeWidth={active ? 2 : 1.8} aria-hidden="true" />
            <span>{label}</span>
            {key === 'notify' && unreadCount > 0 ? (
              <span className="mobile-bottom-nav__badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
