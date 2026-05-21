import { AlertCircle, LineChart } from 'lucide-react';
import { AccountMenu } from './account-menu.jsx';

/**
 * 应用顶部品牌条（Google Finance 风格）。
 * 取代各 tab 内部的大 H1 hero，释放垂直空间。
 */
export function BrandPreviewBar({ currentPageLabel, rightSlot, onJoinGroup, onShowDisclaimer }) {
  return (
    <div className="sticky top-0 z-30 hidden h-12 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:flex sm:px-6">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-purple-500 text-white">
          <LineChart className="h-4 w-4" strokeWidth={2.4} />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">美股策略助手</span>
        <span className="ml-1 inline-flex items-center rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">Beta</span>
      </div>
      {currentPageLabel ? (
        <>
          <span className="text-slate-300">/</span>
          <span className="truncate text-sm font-medium text-slate-700">{currentPageLabel}</span>
        </>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {onJoinGroup ? (
          <button
            type="button"
            onClick={onJoinGroup}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-600"
          >
            加入群聊
          </button>
        ) : null}
        {onShowDisclaimer ? (
          <button
            type="button"
            onClick={onShowDisclaimer}
            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200 transition-colors hover:bg-amber-100"
          >
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            免责
          </button>
        ) : null}
        {rightSlot || <AccountMenu />}
      </div>
    </div>
  );
}
