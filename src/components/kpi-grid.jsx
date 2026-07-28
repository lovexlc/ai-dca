function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function KpiGrid({ children, className = '' }) {
  return <div className={cx('grid grid-cols-2 gap-3 md:grid-cols-4', className)}>{children}</div>;
}
