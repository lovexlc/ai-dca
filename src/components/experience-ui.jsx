import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';

export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export const primaryButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold leading-5 text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2';
export const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold leading-5 text-slate-700 transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2';
export const subtleButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-white px-4 py-2 text-sm font-semibold leading-5 text-slate-700 ring-1 ring-slate-200/70 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2';
export const inputClass = 'h-11 w-full rounded-xl border border-slate-200/70 bg-white px-3 text-sm text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';
export const tableInputClass = 'h-10 w-full rounded-xl border border-transparent bg-transparent px-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-300 hover:border-slate-200/70 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100';

const pillToneClasses = {
  slate: 'bg-slate-100 text-slate-600',
  indigo: 'bg-indigo-50 text-indigo-700',
  emerald: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-500',
  amber: 'bg-amber-50 text-amber-600'
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

export function Card({ children, className = '' }) {
  return <div className={cx('rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.05)]', className)}>{children}</div>;
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
            className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-indigo-600"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </button>
        ) : backHref ? (
          <a className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-indigo-600" href={backHref}>
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </a>
        ) : null}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            {eyebrow ? <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{eyebrow}</div> : null}
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 md:text-[2rem]">{title}</h1>
            {description ? <p className="mt-2.5 max-w-2xl text-sm leading-6 text-slate-500">{description}</p> : null}
          </div>
          {badges.length || actions ? (
            <div className="flex flex-col items-start gap-2.5 md:items-end">
              {badges.length ? <div className="flex flex-wrap items-center gap-2">{badges.map((badge, index) => <span key={index}>{badge}</span>)}</div> : null}
              {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
            </div>
          ) : null}
        </div>
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
        <h2 className="text-lg font-bold text-slate-800">{title}</h2>
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
      <div className="inline-flex min-w-full items-center gap-1.5 rounded-xl bg-slate-100 p-1 sm:min-w-0">
        {tabs.map((tab) => {
          const isActive = tab.key === activeKey;
          return (
            <a
              key={tab.key}
              className={cx(
                'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-semibold transition-all',
                isActive ? 'bg-white text-slate-900 shadow-sm shadow-slate-200' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700'
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
