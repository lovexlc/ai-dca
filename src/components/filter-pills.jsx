function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function FilterPills({ items = [], value, onChange, className = '', ariaLabel = '筛选条件' }) {
  return (
    <div className={cx('inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-[#f4f4f4] p-1', className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={cx(
              'inline-flex min-h-8 shrink-0 items-center justify-center rounded-md px-3 text-xs font-medium transition-colors',
              active ? 'bg-[var(--fg-1000)] text-white' : 'text-[var(--fg-700)] hover:bg-white hover:text-[var(--fg-1000)]'
            )}
            onClick={() => onChange?.(item.key)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
