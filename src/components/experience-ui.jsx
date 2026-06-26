import { ArrowLeft, ChevronDown } from 'lucide-react';

export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-indigo-600 bg-indigo-600 px-4 py-2.5 text-sm font-semibold leading-5 text-white shadow-sm shadow-indigo-200/70 transition-colors hover:border-indigo-700 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
export const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold leading-5 text-indigo-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
export const subtleButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-white px-4 py-2.5 text-sm font-semibold leading-5 text-slate-800 ring-1 ring-slate-300 transition-colors hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
export const inputClass = 'h-11 w-full rounded-xl border border-slate-200/70 bg-white px-3 text-sm text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';
export const tableInputClass = 'h-10 w-full rounded-xl border border-transparent bg-transparent px-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-300 hover:border-slate-200/70 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100';

const pillToneClasses = {
  slate: 'bg-slate-100 text-slate-600',
  indigo: 'bg-indigo-50 text-indigo-700',
  emerald: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-500',
  amber: 'bg-amber-50 text-amber-600',
  purple: 'bg-purple-50 text-purple-700'
};

const statAccentClasses = {
  slate: 'border-slate-200 bg-white',
  indigo: 'border-slate-200 bg-white',
  emerald: 'border-slate-200 bg-white',
  red: 'border-slate-200 bg-white'
};

const statValueClasses = {
  slate: 'text-slate-900',
  indigo: 'text-slate-900',
  emerald: 'text-emerald-600',
  red: 'text-red-500'
};




export function Pill({ children, tone = 'slate', className = '' }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold leading-none', pillToneClasses[tone] || pillToneClasses.slate, className)}>
      {children}
    </span>
  );
}

export function Card({ children, className = '', ...props }) {
  return (
    <div
      data-scroll-card="true"
      {...props}
      className={cx('rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-7', className)}
    >
      {children}
    </div>
  );
}


export function PageHero({
  backHref,
  onBack,
  backLabel = '返回',
  eyebrow,
  title,
  description,
  badges = [],
  actions,
  children
}) {
  return (
    <div className="border-b border-slate-200 bg-white px-5 pb-6 pt-5 sm:px-6 sm:pb-8 sm:pt-6">
      <div className="mx-auto max-w-6xl">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-2 mb-4 inline-flex min-h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </button>
        ) : backHref ? (
          <a className="-ml-2 mb-4 inline-flex min-h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600" href={backHref}>
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </a>
        ) : null}
        {badges.length || actions ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {badges.length ? <div className="flex flex-wrap items-center gap-2">{badges.map((badge, index) => <span key={index}>{badge}</span>)}</div> : null}
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
        {children ? <div className="mt-5">{children}</div> : null}
      </div>
    </div>
  );
}

export function SectionHeading({ eyebrow, title, description, action, className = '' }) {
  return (
    <div className={cx('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div>
        {eyebrow ? <div className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{eyebrow}</div> : null}
        <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-3">{action}</div> : null}
    </div>
  );
}

export function PageTabs({ tabs = [], activeKey = '', className = '', onSelect }) {
  if (!tabs.length) {
    return null;
  }

  return (
    <div className={cx('overflow-x-auto', className)}>
      <div className="inline-flex min-w-full items-center gap-1.5 rounded-2xl bg-slate-100 p-1.5 sm:min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          return (
            <a
              key={tab.key}
              className={cx(
                'inline-flex min-h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-all',
                isActive ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200' : 'text-slate-500 hover:bg-white hover:text-slate-800'
              )}
              href={tab.href}
              onClick={(event) => {
                if (!onSelect) {
                  return;
                }
                event.preventDefault();
                onSelect(tab.key);
              }}
            >
              {tab.label}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function Field({ label, helper, rightLabel, children, className = '' }) {
  return (
    <label className={cx('block space-y-2', className)}>
      <span className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
        <span>{label}</span>
        {rightLabel ? <span className="text-slate-400">{rightLabel}</span> : null}
      </span>
      {children}
      {helper ? <span className="block text-xs leading-5 text-slate-400">{helper}</span> : null}
    </label>
  );
}

export function TextInput({ className = '', ...props }) {
  return <input className={cx(inputClass, className)} {...props} />;
}

export function NumberInput({ className = '', ...props }) {
  return <input className={cx(inputClass, className)} type="number" {...props} />;
}

export function SelectField({ options, className = '', ...props }) {
  return (
    <div className="relative">
      <select className={cx(inputClass, 'appearance-none pr-10', className)} {...props}>
        {options.map((option) => {
          const normalized = typeof option === 'string' ? { label: option, value: option } : option;
          return (
            <option key={normalized.value} value={normalized.value}>
              {normalized.label}
            </option>
          );
        })}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

export function StatCard({ eyebrow, value, note, accent = 'slate', progress }) {
  return (
    <Card className={cx('flex min-h-[132px] flex-col justify-between p-5', statAccentClasses[accent] || statAccentClasses.slate)}>
      <div>
        {eyebrow ? <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{eyebrow}</div> : null}
        <div className={cx('mt-3 text-2xl font-semibold tracking-tight tabular-nums', statValueClasses[accent] || statValueClasses.slate)}>{value}</div>
      </div>
      {note ? <div className="mt-2 text-sm leading-6 text-slate-500">{note}</div> : null}
      {typeof progress === 'number' ? (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={cx('h-full rounded-full', accent === 'indigo' ? 'bg-indigo-500' : accent === 'emerald' ? 'bg-emerald-500' : 'bg-slate-400')} style={{ width: `${Math.max(Math.min(progress, 100), 0)}%` }} />
        </div>
      ) : null}
    </Card>
  );
}

export function NavPill({ href, onClick, active = false, children, className = '' }) {
  const base = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2';
  const cls = active
    ? 'border border-indigo-600 bg-indigo-600 text-white shadow-sm shadow-indigo-200'
    : 'border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700';
  const handleClick = (event) => {
    if (onClick) onClick(event);
    if (href && href.startsWith('#')) {
      event.preventDefault();
      const id = href.slice(1);
      const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  if (href) {
    return <a href={href} onClick={handleClick} aria-current={active ? 'page' : undefined} className={cx(base, cls, className)}>{children}</a>;
  }
  return <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className={cx(base, cls, className)}>{children}</button>;
}

export function DisclosureBanner({ icon = null, summary, details = null, tone = 'amber', defaultOpen = false, className = '' }) {
  const tones = {
    amber: { box: 'border-amber-300 bg-amber-50', text: 'text-amber-900', accent: 'text-amber-700' },
    slate: { box: 'border-slate-200 bg-slate-50', text: 'text-slate-700', accent: 'text-slate-500' }
  };
  const t = tones[tone] || tones.amber;
  return (
    <details open={defaultOpen} className={cx('group rounded-2xl border-l-4 px-4 py-3 text-sm leading-6', t.box, t.text, className)}>
      <summary className={cx('flex cursor-pointer items-start gap-2.5 list-none [&::-webkit-details-marker]:hidden')}>
        {icon ? <span className={cx('mt-0.5 shrink-0', t.accent)}>{icon}</span> : null}
        <span className="flex-1">{summary}</span>
        {details ? <ChevronDown className={cx('mt-0.5 h-4 w-4 shrink-0 transition-transform group-open:rotate-180', t.accent)} /> : null}
      </summary>
      {details ? <div className={cx('mt-2 pl-6 text-[13px] leading-6', t.accent)}>{details}</div> : null}
    </details>
  );
}
