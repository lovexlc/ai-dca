"use client";

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { IconChevronDown } from '@tabler/icons-react';

export function NavDropdown({ group, links = {}, activeKey = '', onSelect }) {
  const isActive = group.items.some((item) => (item.targetKey || item.key) === activeKey);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="app-header__nav-trigger" data-active={isActive || undefined}>
          {group.label}
          <IconChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="nav-dropdown__content" sideOffset={8} align="start">
          {group.items.map((item) => {
            const targetKey = item.targetKey || item.key;
            const href = item.href || (item.hrefKey ? links[item.hrefKey] : undefined);
            const Icon = item.Icon;
            return (
              <DropdownMenu.Item
                key={item.key}
                className="nav-dropdown__item"
                data-active={targetKey === activeKey || undefined}
                onSelect={() => onSelect?.(targetKey, { hash: item.hash || '' })}
                asChild={false}
              >
                {Icon ? <span className="nav-dropdown__item-icon"><Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" /></span> : null}
                <span className="nav-dropdown__item-copy">
                  <span className="nav-dropdown__item-label">{item.label}</span>
                  <span className="nav-dropdown__item-description">{item.description}</span>
                </span>
                {href ? <span className="sr-only">{href}</span> : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
