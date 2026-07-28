import { ArrowLeft, ChevronDown } from 'lucide-react';

export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[var(--brand)] bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold leading-5 text-white transition-colors hover:border-[var(--brand-text)] hover:bg-[var(--brand-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
export const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[var(--a-200)] bg-[var(--bg-100)] px-4 py-2.5 text-sm font-semibold leading-5 text-[var(--fg-900)] transition-colors hover:border-[var(--a-400)] hover:bg-[var(--market-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
export const subtleButtonClass = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[var(--a-200)] bg-[var(--bg-100)] px-4 py-2.5 text-sm font-semibold leading-5 text-[var(--fg-900)] transition-colors hover:bg-[var(--market-surface-subtle)] hover:text-[var(--fg-1000)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
export const inputClass = 'h-11 w-full rounded-md border border-[var(--a-200)] bg-[var(--bg-100)] px-3 text-sm text-[var(--fg-1000)] outline-none transition-colors placeholder:text-[var(--fg-600)] focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-tint)]';
export const tableInputClass = 'h-10 w-full rounded-md border border-transparent bg-transparent px-3 text-sm text-[var(--fg-900)] outline-none transition-colors placeholder:text-[var(--fg-600)] hover:border-[var(--a-200)] focus:border-[var(--brand)] focus:bg-[var(--bg-100)] focus:ring-2 focus:ring-[var(--brand-tint)]';

const pillToneClasses = {
  slate: 'bg-[var(--market-surface-subtle)] text-[var(--fg-700)]',
  indigo: 'bg-[var(--brand-tint)] text-[var(--brand-text)]',
  emerald: 'bg-[var(--green-tint)] text-[var(--green-text)]',
  red: 'bg-[var(--red-tint)] text-[var(--red-text)]',
  amber: 'bg-[var(--amber-tint)] text-[var(--amber-text)]',
  purple: 'bg-[var(--purple-tint)] text-[var(--purple-text)]'
};

const statAccentClasses = {
  slate: 'border-[var(--a-200)] bg-white',
  indigo: 'border-[var(--a-200)] bg-white',
  emerald: 'border-[var(--a-200)] bg-white',
  red: 'border-[var(--a-200)] bg-white'
};

const statValueClasses = {
  slate: 'text-[var(--fg-1000)]',
  indigo: 'text-[var(--fg-1000)]',
  emerald: 'text-[var(--green-text)]',
  red: 'text-[var(--red-text)]'
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
      className={cx('rounded-xl border border-[var(--a-200)] bg-white p-5 sm:p-6', className)}
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
        {eyebrow ? <div className="mb-1 text-xs font-semibold text-slate-500">{eyebrow}</div> : null}
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
      <div className="inline-flex min-w-full items-center gap-1.5 rounded-lg bg-slate-100 p-1.5 sm:min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          return (
            <a
              key={tab.key}
              className={cx(
                'inline-flex min-h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3.5 py-2 text-[13px] font-semibold transition-colors',
                isActive ? 'bg-[var(--fg-1000)] text-white' : 'text-slate-500 hover:bg-white hover:text-slate-800'
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
        {rightLabel ? <span className="text-slate-500">{rightLabel}</span> : null}
      </span>
      {children}
      {helper ? <span className="block text-xs leading-5 text-slate-500">{helper}</span> : null}
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
        {eyebrow ? <div className="text-xs font-semibold text-slate-500">{eyebrow}</div> : null}
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
  const base = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue-text)]/30 focus-visible:ring-offset-2';
  const cls = active
    ? 'border border-[var(--fg-1000)] bg-[var(--fg-1000)] text-white'
    : 'border border-[var(--a-200)] bg-white text-[var(--fg-700)] hover:border-[var(--a-400)] hover:bg-[#f4f4f4] hover:text-[var(--fg-1000)]';
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
