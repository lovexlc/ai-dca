import { useState, useRef } from 'react';
import { ChevronDown, Edit3, ListPlus, Trash2, TrendingUp } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { getPopularSymbols } from './marketsSearchHistory.js';
import { useClickOutside } from '../../hooks/useClickOutside.js';

export function WatchlistSelector({ lists = [], activeListId, onSelect, onCreate, onRename, onDelete, onAddPopular }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useClickOutside(containerRef, () => setOpen(false), open);

  const active = (lists || []).find((item) => item.id === activeListId) || lists[0];
  const canDelete = (item) => item?.id !== 'default' && (lists || []).length > 1;
  const popularSymbols = getPopularSymbols('cn');

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label="切换监控列表"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-9 max-w-[min(62vw,18rem)] items-center gap-1 rounded-md px-2 py-1 text-[17px] leading-6 font-normal tracking-tight text-[#1f1f1f] hover:bg-[#f1f3f4] sm:max-w-none sm:text-[20px] sm:leading-7"
        title="列表切换"
      >
        <span className="truncate whitespace-nowrap">{active?.name || '列表'}</span>
        <ChevronDown size={18} className="shrink-0 text-[#5f6368]" />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-2xl border border-[#e8eaed] bg-white py-1 shadow-lg">
          {(lists || []).map((item) => (
            <div key={item.id} className={cx('flex w-full items-center gap-1 px-3 py-2 text-sm hover:bg-[#f8fafd]', item.id === activeListId ? 'text-[#1a73e8]' : 'text-[#1f1f1f]')}>
              <button type="button" onClick={() => { onSelect?.(item.id); setOpen(false); }} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left">
                <span className="truncate">{item.name}</span>
                <span className="text-[11px] text-[#9aa0a6]">{(item.us?.length || 0) + (item.cn?.length || 0)}</span>
              </button>
              <button
                type="button"
                aria-label={`重命名${item.name}`}
                title="改名"
                onClick={(event) => { event.stopPropagation(); onRename?.(item); setOpen(false); }}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#e8f0fe] hover:text-[#1a73e8]"
              >
                <Edit3 size={13} />
              </button>
              {canDelete(item) ? (
                <button
                  type="button"
                  aria-label={`删除${item.name}`}
                  title="删除"
                  onClick={(event) => { event.stopPropagation(); onDelete?.(item); setOpen(false); }}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#fce8e6] hover:text-[#d93025]"
                >
                  <Trash2 size={13} />
                </button>
              ) : null}
            </div>
          ))}
          <div className="border-t border-[#e8eaed]">
            <button type="button" onClick={() => { onCreate?.(); setOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-[#1a73e8] hover:bg-[#f8fafd]">
              <ListPlus size={14} /> 新建列表
            </button>
            {popularSymbols.length > 0 && onAddPopular && (
              <button type="button" onClick={() => { onAddPopular?.(popularSymbols); setOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-[#1a73e8] hover:bg-[#f8fafd]">
                <TrendingUp size={14} /> 添加热门基金
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WatchlistNameDialog({ dialog, onChangeName, onCancel, onSubmit }) {
  if (!dialog) return null;
  const isDelete = dialog.type === 'delete';
  const title = isDelete ? '删除列表' : (dialog.type === 'rename' ? '编辑列表名称' : '新建列表');
  const total = (dialog.list?.us?.length || 0) + (dialog.list?.cn?.length || 0);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/30 px-4 py-6 sm:items-center" onMouseDown={onCancel}>
      <div className="w-full max-w-sm rounded-[28px] bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-5 text-center text-xl font-semibold leading-snug text-[#1f1f1f]">{title}</div>
        {isDelete ? (
          <div className="mb-5 rounded-2xl bg-[#f8fafd] px-4 py-3 text-sm text-[#5f6368]">
            确认删除「<span className="font-semibold text-[#1f1f1f]">{dialog.list?.name || '列表'}</span>」？{total ? `其中 ${total} 个标的也会移除。` : ''}
          </div>
        ) : (
          <label className="mb-5 block text-sm text-[#5f6368]">
            输入新的列表名称
            <input
              autoFocus
              value={dialog.name || ''}
              onChange={(event) => onChangeName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') onSubmit(); }}
              className="mt-3 h-14 w-full rounded-2xl border-0 bg-[#f1f3f4] px-4 text-base text-[#1f1f1f] outline-none focus:ring-2 focus:ring-[#1a73e8]/35"
            />
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={onCancel} className="h-12 rounded-2xl bg-[#f1f3f4] text-base font-semibold text-[#1f1f1f] hover:bg-[#e8eaed]">取消</button>
          <button type="button" onClick={onSubmit} className={cx('h-12 rounded-2xl text-base font-semibold text-white', isDelete ? 'bg-[#d93025] hover:bg-[#b3261e]' : 'bg-[#1a73e8] hover:bg-[#1557b0]')}>{isDelete ? '删除' : '确定'}</button>
        </div>
      </div>
    </div>
  );
}
