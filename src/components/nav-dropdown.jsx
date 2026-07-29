"use client";

import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { IconChevronDown } from '@tabler/icons-react';

export function NavDropdown({ group, links = {}, activeKey = '', activeHash = '', onSelect }) {
  const isItemActive = (item) => (
    (item.targetKey || item.key) === activeKey
    && (item.hash || '') === activeHash
  );
  const isActive = group.items.some((item) => (item.targetKey || item.key) === activeKey);
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef(null);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  function cancelClose() {
    if (!closeTimerRef.current) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function openOnHover() {
    cancelClose();
    setOpen(true);
  }

  function closeAfterPointerLeaves() {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 160);
  }

  return (
    <DropdownMenu.Root
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        cancelClose();
        setOpen(nextOpen);
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="app-header__nav-trigger"
          data-active={isActive || undefined}
          onPointerEnter={openOnHover}
          onPointerLeave={closeAfterPointerLeaves}
        >
          {group.label}
          <IconChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="nav-dropdown__content"
          sideOffset={8}
          align="start"
          onPointerEnter={cancelClose}
          onPointerLeave={closeAfterPointerLeaves}
        >
          {group.items.map((item) => {
            const targetKey = item.targetKey || item.key;
            const href = item.href || (item.hrefKey ? links[item.hrefKey] : undefined);
            const Icon = item.Icon;
            return (
              <DropdownMenu.Item
                key={item.key}
                className="nav-dropdown__item"
                data-active={isItemActive(item) || undefined}
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
