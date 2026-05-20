import { useEffect, useState } from 'react';
import { LineChart, Search } from 'lucide-react';

function readBrandFromUrl() {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('brand');
  return v === 'google' || v === 'github' ? v : null;
}

export function useBrandPreview() {
  const [brand, setBrand] = useState(() => readBrandFromUrl());
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (brand) document.documentElement.setAttribute('data-brand-preview', brand);
    else document.documentElement.removeAttribute('data-brand-preview');
    return () => document.documentElement.removeAttribute('data-brand-preview');
  }, [brand]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setBrand(readBrandFromUrl());
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);
  return brand;
}

export function BrandPreviewBar({ variant, currentPageLabel }) {
  if (variant === 'google') {
    return (
      <div className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-purple-500 text-white">
            <LineChart className="h-4 w-4" strokeWidth={2.4} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">美股策略助手</span>
          <span className="ml-1 inline-flex items-center rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">Beta 版</span>
        </div>
        {currentPageLabel ? (
          <>
            <span className="text-slate-300">/</span>
            <span className="truncate text-sm font-medium text-slate-700">{currentPageLabel}</span>
          </>
        ) : null}
        <div className="ml-auto hidden items-center gap-2 text-xs text-slate-400 sm:flex">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">Preview · brand=google</span>
        </div>
      </div>
    );
  }
  if (variant === 'github') {
    return (
      <div className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white">
          <LineChart className="h-3.5 w-3.5" strokeWidth={2.6} />
        </span>
        {currentPageLabel ? (
          <span className="truncate text-sm font-semibold text-slate-900">{currentPageLabel}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden h-8 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs text-slate-400 sm:flex">
            <Search className="h-3.5 w-3.5" />
            <span>Type / to search</span>
          </div>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Preview · brand=github</span>
        </div>
      </div>
    );
  }
  return null;
}
