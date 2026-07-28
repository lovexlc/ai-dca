function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function InlineBar({ value = 0, max = 100, tone = 'green', className = '', label }) {
  const percent = Math.max(0, Math.min(100, (Math.abs(Number(value) || 0) / Math.max(1, Number(max) || 100)) * 100));
  const fill = tone === 'red' ? 'bg-[var(--red-text)]' : tone === 'blue' ? 'bg-[var(--blue-text)]' : 'bg-[var(--green-fill)]';
  return (
    <span className={cx('inline-flex min-w-16 items-center gap-2', className)} aria-label={label}>
      <span className="h-1.5 min-w-10 flex-1 overflow-hidden rounded-full bg-[#f0f0f0]">
        <span className={cx('block h-full rounded-full', fill)} style={{ width: `${percent}%` }} />
      </span>
      {label ? <span className="tabular-nums text-[11px] text-[var(--fg-700)]">{label}</span> : null}
    </span>
  );
}
