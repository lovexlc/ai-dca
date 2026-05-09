import { useMemo, useState } from 'react';
import { Check, ListFilter, Search, X } from 'lucide-react';
import { cx } from '../experience-ui.jsx';
import { Popover } from './Popover.jsx';

// 受 tablecn data-table-faceted-filter 启发：多选 + 搜索 + 计数 + 清空。
export function DataTableFacetedFilter({
  column,
  title = '筛选',
  options = [],
  multiple = true,
  searchable = true,
  triggerClassName = '',
}) {
  const [open, setOpen] = useState(false);
  const [needle, setNeedle] = useState('');
  const facets = column?.getFacetedUniqueValues?.();

  const rawValue = column?.getFilterValue();
  const selectedValues = useMemo(
    () => new Set(Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : []),
    [rawValue]
  );

  const filteredOptions = useMemo(() => {
    if (!searchable || !needle.trim()) return options;
    const n = needle.trim().toLowerCase();
    return options.filter(
      (o) => String(o.label).toLowerCase().includes(n) || String(o.value).toLowerCase().includes(n)
    );
  }, [options, needle, searchable]);

  function setSelected(next) {
    if (!column) return;
    const arr = Array.from(next);
    column.setFilterValue(arr.length ? arr : undefined);
  }

  function toggle(value) {
    const next = new Set(selectedValues);
    if (multiple) {
      if (next.has(value)) next.delete(value);
      else next.add(value);
      setSelected(next);
    } else {
      if (next.has(value)) {
        column.setFilterValue(undefined);
      } else {
        column.setFilterValue([value]);
      }
      setOpen(false);
    }
  }

  function reset(e) {
    e?.stopPropagation();
    column?.setFilterValue(undefined);
  }

  const triggerLabel = (
    <span className="inline-flex items-center gap-1.5">
      <ListFilter className="h-3.5 w-3.5" />
      <span>{title}</span>
      {selectedValues.size > 0 ? (
        <>
          <span className="mx-0.5 h-3 w-px bg-slate-300" />
          {selectedValues.size <= 2 ? (
            <span className="flex items-center gap-1">
              {options
                .filter((o) => selectedValues.has(o.value))
                .map((o) => (
                  <span
                    key={o.value}
                    className="rounded-sm bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700"
                  >
                    {o.label}
                  </span>
                ))}
            </span>
          ) : (
            <span className="rounded-sm bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
              {selectedValues.size} 项
            </span>
          )}
        </>
      ) : null}
    </span>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={triggerLabel}
      contentWidth={220}
      triggerClassName={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 focus:outline-none',
        selectedValues.size > 0 && 'border-solid border-indigo-200 bg-indigo-50/50 text-indigo-700',
        triggerClassName
      )}
    >
      {searchable ? (
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-2 pb-1.5">
          <Search className="h-3 w-3 text-slate-400" />
          <input
            value={needle}
            onChange={(e) => setNeedle(e.target.value)}
            placeholder={`搜索 ${title}…`}
            className="h-6 flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
      ) : null}
      <div className="max-h-64 overflow-y-auto py-1">
        {filteredOptions.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-slate-400">无匹配选项</div>
        ) : (
          filteredOptions.map((option) => {
            const checked = selectedValues.has(option.value);
            const count = facets?.get?.(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggle(option.value)}
                className={cx(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                  checked ? 'bg-indigo-50/70 text-indigo-700' : 'text-slate-700 hover:bg-slate-100'
                )}
              >
                <span
                  className={cx(
                    'inline-flex h-4 w-4 items-center justify-center rounded border',
                    checked ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300 bg-white'
                  )}
                >
                  {checked ? <Check className="h-3 w-3" /> : null}
                </span>
                {option.icon ? <span className="text-slate-500">{option.icon}</span> : null}
                <span className="flex-1 truncate">{option.label}</span>
                {count != null ? (
                  <span className="text-[10px] tabular-nums text-slate-400">{count}</span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
      {selectedValues.size > 0 ? (
        <>
          <div className="my-1 h-px bg-slate-100" />
          <button
            type="button"
            onClick={reset}
            className="flex w-full items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            <X className="h-3 w-3" />
            清除筛选
          </button>
        </>
      ) : null}
    </Popover>
  );
}
