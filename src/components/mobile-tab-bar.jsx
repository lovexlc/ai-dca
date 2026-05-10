import { useEffect, useState } from 'react';
import { ClipboardPaste, CloudUpload, Plus, Search, Sparkles, X } from 'lucide-react';

const ADD_TABS = [
  {
    key: 'single',
    label: '单笔新增',
    icon: Plus,
    desc: '手动添加一条买入 / 卖出交易',
    action: '开始新增',
    handlerKey: 'onNew',
  },
  {
    key: 'paste',
    label: '粘贴 Excel',
    icon: ClipboardPaste,
    desc: '从 Excel 粘贴 TSV / CSV 数据批量导入',
    action: '开始粘贴',
    handlerKey: 'onPasteImport',
  },
  {
    key: 'ocr',
    label: '截图 OCR',
    icon: CloudUpload,
    desc: '上传持仓截图自动识别交易',
    action: '上传截图',
    handlerKey: 'onOcrImport',
  },
];

export function MobileTabBar({ onSearch, onAi, onNew, onPasteImport, onOcrImport }) {
  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState('single');

  const handlers = { onNew, onPasteImport, onOcrImport };
  const active = ADD_TABS.find((t) => t.key === addTab) || ADD_TABS[0];
  const ActiveIcon = active.icon;

  useEffect(() => {
    if (!addOpen) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') setAddOpen(false);
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [addOpen]);

  function triggerAction(key) {
    const tab = ADD_TABS.find((t) => t.key === key);
    if (!tab) return;
    setAddOpen(false);
    const fn = handlers[tab.handlerKey];
    if (typeof fn === 'function') fn();
  }

  function openAdd() {
    setAddTab('single');
    setAddOpen(true);
  }

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-slate-200 bg-white/95 px-6 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_24px_rgba(15,23,42,0.06)] backdrop-blur sm:hidden"
        aria-label="底部快捷导航"
      >
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200 active:bg-slate-300"
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
          className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200 active:bg-slate-300"
          onClick={openAdd}
          aria-label="新增交易"
        >
          <Plus className="h-6 w-6" />
        </button>
      </nav>

      {addOpen ? (
        <div
          className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-900/40 backdrop-blur-sm sm:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="新增交易"
          onClick={() => setAddOpen(false)}
        >
          <div
            className="w-full overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-4">
              <div className="text-base font-semibold text-slate-900">新增交易</div>
              <button
                type="button"
                className="-mr-2 flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 active:bg-slate-200"
                onClick={() => setAddOpen(false)}
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3 flex gap-1 border-b border-slate-100 px-3" role="tablist">
              {ADD_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.key === addTab;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={[
                      'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-3 text-sm font-medium transition-colors',
                      isActive
                        ? 'border-indigo-500 text-indigo-600'
                        : 'border-transparent text-slate-500 hover:text-slate-700',
                    ].join(' ')}
                    onClick={() => setAddTab(tab.key)}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="px-5 pb-6 pt-7" role="tabpanel">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                  <ActiveIcon className="h-7 w-7" />
                </div>
                <div className="mt-3 text-base font-semibold text-slate-900">{active.label}</div>
                <div className="mt-1 max-w-xs text-sm leading-relaxed text-slate-500">{active.desc}</div>
                <button
                  type="button"
                  className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-md transition-colors hover:bg-indigo-500 active:bg-indigo-700"
                  onClick={() => triggerAction(active.key)}
                >
                  {active.action}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default MobileTabBar;
