import { cx } from '../experience-ui.jsx';

export function SwitchButton({ children, className = '', variant = 'primary', ...props }) {
  const variants = {
    primary: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-700',
    secondary: 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
    quiet: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
    danger: 'border border-rose-200 bg-white text-rose-600 hover:bg-rose-50'
  };
  return (
    <button
      type="button"
      className={cx(
        'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out active:translate-y-px active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 disabled:active:scale-100',
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function SwitchPanel({ children, className = '', ...props }) {
  return (
    <section
      className={cx('rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5', className)}
      {...props}
    >
      {children}
    </section>
  );
}

export function formatSwitchPercent(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits)}%` : '—';
}
