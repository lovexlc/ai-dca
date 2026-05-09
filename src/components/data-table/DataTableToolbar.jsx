import { X } from 'lucide-react';
import { cx } from '../experience-ui.jsx';

// 受 tablecn data-table-toolbar 启发：左侧业务过滤（children），右侧可插槽。
// 下方以 chip 形式列出生效的列筛选 / 排序。
export function DataTableToolbar({
  table,
  children,
  rightSlot = null,
  chipLabelMap = {},
  className = '',
}) {
  const filterState = table.getState().columnFilters || [];
  const isFiltered = filterState.length > 0;
  const sortState = table.getState().sorting || [];

  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2">{children}</div>
        {isFiltered ? (
          <button
            type="button"
            onClick={() => table.resetColumnFilters()}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            重置
            <X className="h-3 w-3" />
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">{rightSlot}</div>
      </div>
      {(isFiltered || sortState.length > 0) ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {filterState.map((f) => {
            const labels = chipLabelMap[f.id] || {};
            const values = Array.isArray(f.value) ? f.value : [f.value];
            return values.map((v) => (
              <span
                key={`${f.id}-${v}`}
                className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-indigo-700"
              >
                <span className="text-indigo-400">{labels.title || f.id}</span>
                <span>· {labels[v] || String(v)}</span>
                <button
                  type="button"
                  aria-label="移除筛选"
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-indigo-500 transition-colors hover:bg-indigo-100 hover:text-indigo-700"
                  onClick={() => {
                    const col = table.getColumn(f.id);
                    if (!col) return;
                    const next = values.filter((x) => x !== v);
                    col.setFilterValue(next.length ? next : undefined);
                  }}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ));
          })}
          {sortState.map((s) => (
            <span
              key={`sort-${s.id}`}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-slate-600"
            >
              <span className="text-slate-400">排序</span>
              <span>· {(chipLabelMap[s.id] && chipLabelMap[s.id].title) || s.id} {s.desc ? '↓' : '↑'}</span>
              <button
                type="button"
                aria-label="移除排序"
                className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-200"
                onClick={() => table.getColumn(s.id)?.clearSorting()}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
