import { CloudDownload, CloudUpload, RefreshCw } from 'lucide-react';

export function clampHydrationProgress(value) {
  return Math.round(Math.min(Math.max(Number(value) || 0, 0), 100));
}

export function RestoreCard({ children, className = '' }) {
  return (
    <div className={`relative w-full max-w-[300px] rounded-[22px] border border-slate-100 bg-white px-5 py-8 shadow-[0_8px_28px_rgba(15,23,42,0.06)] ${className}`}>
      {children}
    </div>
  );
}

export function RestoreIcon({ children }) {
  return <div className="mb-5 flex justify-center text-violet-600">{children}</div>;
}

export function RestoreProgress({ hydration }) {
  const progress = clampHydrationProgress(hydration?.progress);
  return (
    <div className="mt-7" aria-live="polite">
      <div className="flex items-center gap-3">
        <div
          className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-violet-100"
          role="progressbar"
          aria-label="云端数据恢复进度"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={progress}
          aria-valuetext={hydration?.message || '正在恢复云端数据'}
        >
          <div className="h-full rounded-full bg-violet-600 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-violet-600">{progress}%</span>
      </div>
    </div>
  );
}

export function CloudRestoreLoadingCard({ syncingLocalData = false, hydration, onRetry }) {
  return (
    <RestoreCard>
      {syncingLocalData && onRetry ? <button type="button" aria-label="重新同步" className="absolute right-4 top-4 rounded-full p-1 text-slate-400 transition hover:bg-slate-50 hover:text-violet-600" onClick={onRetry}><RefreshCw className="h-4 w-4" /></button> : null}
      <RestoreIcon>{syncingLocalData ? <CloudUpload className="h-12 w-12" strokeWidth={1.5} /> : <CloudDownload className="h-12 w-12" strokeWidth={1.5} />}</RestoreIcon>
      <h1 className="text-center text-sm font-bold text-slate-900">{syncingLocalData ? '正在同步本机数据' : '正在恢复账户数据'}</h1>
      <p className="mt-3 text-center text-xs leading-5 text-slate-500">{syncingLocalData ? '正在保存并恢复本机配置，请稍候…' : '正在读取云端数据，请稍候…'}</p>
      <RestoreProgress hydration={hydration} />
    </RestoreCard>
  );
}
