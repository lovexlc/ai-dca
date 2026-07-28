function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function PageHeader({ Icon, title, description, actions, className = '', hideIntro = false }) {
  if (hideIntro && !actions) return null;

  const actionsOnly = hideIntro && Boolean(actions);

  return (
    <header className={cx(
      'page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
      actionsOnly ? 'page-header--actions-only' : 'py-6 sm:py-8',
      className
    )}>
      {!hideIntro ? (
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--fg-1000)] text-[var(--bg-100)]">
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-[-0.032em] text-[var(--fg-1000)]">{title}</h1>
            {description ? <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--fg-700)]">{description}</p> : null}
          </div>
        </div>
      ) : null}
      {actions ? <div className={cx('flex shrink-0 flex-wrap items-center gap-2', hideIntro ? 'w-full justify-end' : '')}>{actions}</div> : null}
    </header>
  );
}
