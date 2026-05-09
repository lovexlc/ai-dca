import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cx } from '../experience-ui.jsx';

// 受 tablecn data-table-pagination 启发，精简为中文 + 单行布局。
export function DataTablePagination({ table, pageSizeOptions = [10, 20, 50, 100] }) {
  const pageSize = table.getState().pagination.pageSize;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();
  const rowCount = table.getFilteredRowModel().rows.length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
      <div className="text-slate-500">共 {rowCount} 条</div>
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center gap-1.5">
          <span>每页</span>
          <select
            className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-200"
            value={pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="tabular-nums text-slate-500">
          {pageCount === 0 ? 0 : pageIndex + 1} / {Math.max(1, pageCount)}
        </div>
        <div className="inline-flex items-center gap-1">
          <NavBtn onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
            <ChevronsLeft className="h-3.5 w-3.5" />
          </NavBtn>
          <NavBtn onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </NavBtn>
          <NavBtn onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            <ChevronRight className="h-3.5 w-3.5" />
          </NavBtn>
          <NavBtn onClick={() => table.setPageIndex(pageCount - 1)} disabled={!table.getCanNextPage()}>
            <ChevronsRight className="h-3.5 w-3.5" />
          </NavBtn>
        </div>
      </div>
    </div>
  );
}

function NavBtn({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800'
      )}
    >
      {children}
    </button>
  );
}
