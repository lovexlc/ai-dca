"use client";

import { useEffect, useRef, useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { useClickOutside } from '../hooks/useClickOutside.js';

export function NavDropdown({ group, links = {}, activeKey = '', activeHash = '', onSelect }) {
  const isItemActive = (item) => (
    (item.targetKey || item.key) === activeKey
    && (item.hash || '') === activeHash
  );
  const isActive = group.items.some((item) => (item.targetKey || item.key) === activeKey);
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  useClickOutside(containerRef, () => setOpen(false), open);

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

  function handleSelect(targetKey, hash) {
    setOpen(false);
    onSelect?.(targetKey, { hash: hash || '' });
  }

  if (group.items.length === 1) {
    const item = group.items[0];
    const targetKey = item.targetKey || item.key;
    return (
      <button
        type="button"
        className="app-header__nav-trigger"
        data-active={isActive || undefined}
        onClick={() => handleSelect(targetKey, item.hash)}
      >
        {group.label}
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-flex"
      onMouseEnter={openOnHover}
      onMouseLeave={closeAfterPointerLeaves}
    >
      <button
        type="button"
        className="app-header__nav-trigger"
        data-active={isActive || undefined}
        data-state={open ? 'open' : 'closed'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {group.label}
        <IconChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="nav-dropdown__content"
          role="menu"
          style={{ position: 'absolute', top: '100%', left: 0, marginTop: '8px' }}
          onMouseEnter={cancelClose}
          onMouseLeave={closeAfterPointerLeaves}
        >
          {group.items.map((item) => {
            const targetKey = item.targetKey || item.key;
            const href = item.href || (item.hrefKey ? links[item.hrefKey] : undefined);
            const Icon = item.Icon;
            return (
              <button
                key={item.key}
                type="button"
                className="nav-dropdown__item"
                role="menuitem"
                data-active={isItemActive(item) || undefined}
                onClick={() => handleSelect(targetKey, item.hash)}
              >
                {Icon ? <span className="nav-dropdown__item-icon"><Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" /></span> : null}
                <span className="nav-dropdown__item-copy">
                  <span className="nav-dropdown__item-label">{item.label}</span>
                  <span className="nav-dropdown__item-description">{item.description}</span>
                </span>
                {href ? <span className="sr-only">{href}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
