import { flexRender } from '@tanstack/react-table';
import { cx } from '../experience-ui.jsx';

// 受 tablecn data-table 启发：包住 thead/tbody 渲染。体验代码里调用者只需传 table 实例。
export function DataTable({
  table,
  emptyState = null,
  onRowClick,
  rowClassName,
  minWidth = 1200,
  cellClassName = 'px-3 py-2',
  headerClassName = 'bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500',
}) {
  const rows = table.getRowModel().rows;
  const tableStyle = { minWidth };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={tableStyle}>
        <thead className={headerClassName}>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const meta = header.column.columnDef.meta || {};
                const align = meta.align || 'left';
                return (
                  <th
                    key={header.id}
                    colSpan={header.colSpan}
                    className={cx(
                      cellClassName,
                      align === 'right' && 'text-right',
                      align === 'center' && 'text-center',
                      meta.sticky && 'sticky left-0 z-20 bg-slate-50 shadow-[1px_0_0_rgba(15,23,42,0.08)]',
                      meta.headerClassName
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={table.getAllLeafColumns().length} className="p-0">
                {emptyState}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className={cx(
                  'text-slate-700 transition-colors hover:bg-slate-50',
                  onRowClick && 'cursor-pointer',
                  typeof rowClassName === 'function' ? rowClassName(row) : rowClassName
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta || {};
                  const align = meta.align || 'left';
                  const dyn = typeof meta.cellClassName === 'function' ? meta.cellClassName(cell) : meta.cellClassName;
                  return (
                    <td
                      key={cell.id}
                      className={cx(
                        cellClassName,
                        'whitespace-nowrap',
                        align === 'right' && 'text-right',
                        align === 'center' && 'text-center',
                        meta.sticky && 'sticky left-0 z-10 shadow-[1px_0_0_rgba(15,23,42,0.06)] bg-white',
                        dyn
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
