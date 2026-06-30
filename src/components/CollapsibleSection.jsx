import { useState } from 'react';
import { cx } from './experience-ui.jsx';

export function CollapsibleSection({
  id,
  title,
  subtitle,
  defaultOpen = true,
  children,
  className,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={cx(
        'rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden',
        className
      )}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-5 py-4 text-left"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((value) => !value)}
      >
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          {subtitle ? (
            <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
          ) : null}
        </div>

        <span className={cx('text-lg transition-transform duration-200', open && 'rotate-180')}>
          ⌄
        </span>
      </button>

      {open ? (
        <div id={`${id}-panel`} className="px-5 pb-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}
