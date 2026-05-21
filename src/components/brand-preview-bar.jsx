import { AlertCircle, LineChart } from 'lucide-react';
import { AccountMenu } from './account-menu.jsx';

/**
 * 应用顶部品牌条（Google Finance 风格）。
 * 取代各 tab 内部的大 H1 hero，释放垂直空间。
 * 手机 / PC 均可见，保证加入群聊 / 免责 / 账号菜单 三件事两端一致。
 */
export function BrandPreviewBar({ currentPageLabel, rightSlot, onJoinGroup, onShowDisclaimer }) {
  return (
    <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-slate-200 bg-white px-3 sm:gap-3 sm:px-6">
      <div className="flex shrink-0 items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-purple-500 text-white">
          <LineChart className="h-4 w-4" strokeWidth={2.4} />
        </span>
        <span className="hidden text-[15px] font-semibold tracking-tight text-slate-900 sm:inline">美股策略助手</span>
        <span className="ml-1 hidden items-center rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 sm:inline-flex">Beta</span>
      </div>
      {currentPageLabel ? (
        <>
          <span className="hidden text-slate-300 sm:inline">/</span>
          <span className="truncate text-sm font-medium text-slate-700">{currentPageLabel}</span>
        </>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        {onJoinGroup ? (
          <button
            type="button"
            onClick={onJoinGroup}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:text-indigo-600 sm:px-3 sm:text-xs"
          >
            加入群聊
          </button>
        ) : null}
        {onShowDisclaimer ? (
          <button
            type="button"
            onClick={onShowDisclaimer}
            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 transition-colors hover:bg-amber-100 sm:px-3 sm:text-xs"
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
