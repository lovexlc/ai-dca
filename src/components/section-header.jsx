function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function SectionHeader({ title, description, action, className = '' }) {
  return (
    <div className={cx('flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-[-0.012em] text-[var(--fg-1000)]">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-5 text-[var(--fg-700)]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
