function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function DeltaChip({ value, positive, neutral = false, className = '' }) {
  const number = Number(value);
  const isPositive = positive ?? number > 0;
  const isNegative = !neutral && (positive === false || number < 0);
  const arrow = neutral ? '' : isPositive ? '↑' : isNegative ? '↓' : '→';
  const tone = neutral || (!isPositive && !isNegative)
    ? 'bg-[#f4f4f4] text-[var(--fg-700)]'
    : isPositive
      ? 'bg-[var(--green-tint)] text-[var(--green-text)]'
      : 'bg-[var(--red-tint)] text-[var(--red-text)]';

  return <span className={cx('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums', tone, className)}>{arrow}{value}</span>;
}
