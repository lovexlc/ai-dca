import { Plus } from 'lucide-react';

export function MobileBottomNav({ items = [], activeKey = '', onSelect, onPrimaryAction }) {
  const visibleItems = items.slice(0, 5);
  if (!visibleItems.length) return null;

  return (
    <nav className="mobile-bottom-nav" aria-label="底部导航">
      {visibleItems.map((item, index) => {
        const Icon = item.icon;
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            className={`mobile-bottom-nav__item${active ? ' is-active' : ''}${index === 2 && onPrimaryAction ? ' has-primary-gap' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onSelect?.(item.key)}
          >
            <span className="mobile-bottom-nav__icon">
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span>{item.label}</span>
          </button>
        );
      })}
      {onPrimaryAction ? (
        <button type="button" className="mobile-bottom-nav__primary" aria-label="新增持仓" onClick={onPrimaryAction}>
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}
    </nav>
  );
}
