import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, CloudUpload, Plus, Search, Sparkles } from 'lucide-react';

export function MobileTabBar({ onSearch, onAi, onNew, onPasteImport, onOcrImport }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onDocClick(event) {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(event.target)) return;
      setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, [menuOpen]);

  function pick(handler) {
    return () => {
      setMenuOpen(false);
      if (typeof handler === 'function') handler();
    };
  }

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
      <div className="relative" ref={wrapRef}>
        <button
          type="button"
          className="flex h-12 w-12 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 active:bg-slate-200"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="新增交易"
        >
          <Plus className="h-6 w-6" />
        </button>
        {menuOpen ? (
          <div
            className="absolute bottom-full right-0 z-40 mb-3 w-60 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200"
            role="menu"
          >
            <button
              type="button"
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
              onClick={pick(onNew)}
              role="menuitem"
            >
              <Plus className="mt-0.5 h-5 w-5 flex-none text-slate-500" />
              <span className="flex-1">
                <span className="block text-sm font-semibold text-slate-800">单笔新增</span>
                <span className="mt-0.5 block text-xs text-slate-500">手动添加一条交易</span>
              </span>
            </button>
            <div className="h-px bg-slate-100" />
            <button
              type="button"
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
              onClick={pick(onPasteImport)}
              role="menuitem"
            >
              <ClipboardPaste className="mt-0.5 h-5 w-5 flex-none text-slate-500" />
              <span className="flex-1">
                <span className="block text-sm font-semibold text-slate-800">粘贴 Excel</span>
                <span className="mt-0.5 block text-xs text-slate-500">从 Excel 粘贴 TSV / CSV 交易流水</span>
              </span>
            </button>
            <div className="h-px bg-slate-100" />
            <button
              type="button"
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
              onClick={pick(onOcrImport)}
              role="menuitem"
            >
              <CloudUpload className="mt-0.5 h-5 w-5 flex-none text-slate-500" />
              <span className="flex-1">
                <span className="block text-sm font-semibold text-slate-800">截图 OCR</span>
                <span className="mt-0.5 block text-xs text-slate-500">上传持仓截图识别交易</span>
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </nav>
  );
}

export default MobileTabBar;
