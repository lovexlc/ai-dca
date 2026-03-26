import { ArrowLeft, ChevronDown } from 'lucide-react';

export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-indigo-200 transition-all hover:-translate-y-0.5 hover:bg-indigo-700';
export const secondaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200';
export const subtleButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50';
export const inputClass = 'h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white';
export const tableInputClass = 'h-10 w-full rounded-lg border border-transparent bg-transparent px-3 text-sm text-slate-700 outline-none transition-all placeholder:text-slate-300 hover:border-slate-200 focus:border-indigo-400 focus:bg-white';

const pillToneClasses = {
  slate: 'bg-slate-100 text-slate-600',
  indigo: 'bg-indigo-50 text-indigo-700',
  emerald: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-500',
  amber: 'bg-amber-50 text-amber-600'
};

const statAccentClasses = {
  slate: 'border-slate-200 bg-white',
  indigo: 'border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white',
  emerald: 'border-emerald-100 bg-emerald-50/70',
  red: 'border-red-100 bg-red-50/70'
};

const statValueClasses = {
  slate: 'text-slate-900',
  indigo: 'text-indigo-700',
  emerald: 'text-emerald-600',
  red: 'text-red-500'
};

export function PageShell({ children, className = '' }) {
  return (
    <div className={cx('min-h-screen bg-slate-50 pb-32 font-sans text-slate-900 selection:bg-indigo-100 selection:text-indigo-900', className)}>
      {children}
    </div>
  );
}

export function Pill({ children, tone = 'slate', className = '' }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold', pillToneClasses[tone] || pillToneClasses.slate, className)}>
      {children}
    </span>
  );
}

export function Card({ children, className = '' }) {
  return <div className={cx('rounded-xl border border-slate-200 bg-white p-6 shadow-sm', className)}>{children}</div>;
}

export function PageHero({
  backHref,
  backLabel = '返回',
  eyebrow,
  title,
  description,
  badges = [],
  actions,
  children
}) {
  return (
    <div className="border-b border-slate-200 bg-white px-6 pb-12 pt-10">
      <div className="mx-auto max-w-6xl">
        {backHref ? (
          <a className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-indigo-600" href={backHref}>
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </a>
        ) : null}
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            {eyebrow ? <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</div> : null}
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">{title}</h1>
            {description ? <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-500">{description}</p> : null}
          </div>
          {badges.length || actions ? (
            <div className="flex flex-col items-start gap-3 md:items-end">
              {badges.length ? <div className="flex flex-wrap items-center gap-3">{badges.map((badge, index) => <span key={index}>{badge}</span>)}</div> : null}
              {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
            </div>
          ) : null}
        </div>
        {children ? <div className="mt-8">{children}</div> : null}
      </div>
    </div>
  );
}

export function SectionHeading({ eyebrow, title, description, action, className = '' }) {
  return (
    <div className={cx('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div>
        {eyebrow ? <div className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{eyebrow}</div> : null}
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-3">{action}</div> : null}
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
    <Card className={cx('p-5', statAccentClasses[accent] || statAccentClasses.slate)}>
      {eyebrow ? <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{eyebrow}</div> : null}
      <div className={cx('mt-3 text-2xl font-extrabold tracking-tight', statValueClasses[accent] || statValueClasses.slate)}>{value}</div>
      {note ? <div className="mt-2 text-sm leading-6 text-slate-500">{note}</div> : null}
      {typeof progress === 'number' ? (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={cx('h-full rounded-full', accent === 'indigo' ? 'bg-indigo-500' : accent === 'emerald' ? 'bg-emerald-500' : 'bg-slate-400')} style={{ width: `${Math.max(Math.min(progress, 100), 0)}%` }} />
        </div>
      ) : null}
    </Card>
  );
}
