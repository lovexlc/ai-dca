import { Plus, Search, Sparkles } from 'lucide-react';

export function MobileTabBar({ onSearch, onAi, onNew }) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-slate-200 bg-white/95 px-6 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_24px_rgba(15,23,42,0.06)] backdrop-blur sm:hidden"
      aria-label="底部快捷导航"
    >
      <button
        type="button"
        className="flex h-12 w-12 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 active:bg-slate-200"
        onClick={onSearch}
        aria-label="搜索"
      >
        <Search className="h-5 w-5" />
      </button>
      <button
        type="button"
        className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-[0_8px_24px_rgba(79,70,229,0.35)] transition-colors hover:bg-indigo-500 active:bg-indigo-700"
        onClick={onAi}
        aria-label="AI 咨询"
      >
        <Sparkles className="h-6 w-6" />
      </button>
      <button
        type="button"
        className="flex h-12 w-12 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 active:bg-slate-200"
        onClick={onNew}
        aria-label="新增交易"
      >
        <Plus className="h-6 w-6" />
      </button>
    </nav>
  );
}

export default MobileTabBar;
