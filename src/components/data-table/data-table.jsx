import { flexRender } from "@tanstack/react-table";
import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { getColumnPinningStyle } from "@/lib/data-table";
import { cn } from "@/lib/utils";
function DataTable({
  table,
  actionBar,
  children,
  className,
  tableContainerClassName,
  onRowClick,
  footerRow,
  resizable = false,
  onHorizontalScroll,
  tableScrollRef,
  ...props
}) {
  return <div
    className={cn(
      "flex w-full flex-col gap-2.5 overflow-auto",
      resizable && "md:min-h-[320px] md:min-w-[720px] md:max-h-[calc(100vh-160px)] md:max-w-[calc(100vw-48px)] md:resize",
      className
    )}
    {...props}
  >{children}<div ref={tableScrollRef} onScroll={onHorizontalScroll} className={cn("max-w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white", tableContainerClassName)}><Table><TableHeader>{table.getHeaderGroups().map((headerGroup) => <TableRow key={headerGroup.id}>{headerGroup.headers.map((header) => <TableHead
    key={header.id}
    colSpan={header.colSpan}
    style={{
      ...getColumnPinningStyle({ column: header.column })
    }}
  >{header.isPlaceholder ? null : flexRender(
    header.column.columnDef.header,
    header.getContext()
  )}</TableHead>)}</TableRow>)}</TableHeader><TableBody>{table.getRowModel().rows?.length ? table.getRowModel().rows.map((row) => <TableRow
    key={row.id}
    data-state={row.getIsSelected() && "selected"}
    className={onRowClick ? "cursor-pointer" : undefined}
    onClick={onRowClick ? () => onRowClick(row) : undefined}
  >{row.getVisibleCells().map((cell) => <TableCell
    key={cell.id}
    style={{
      ...getColumnPinningStyle({ column: cell.column })
    }}
  >{flexRender(
    cell.column.columnDef.cell,
    cell.getContext()
  )}</TableCell>)}</TableRow>) : <TableRow><TableCell
    colSpan={table.getAllColumns().length}
    className="h-32 text-center text-sm text-slate-500"
  >
                  暂无数据
                </TableCell></TableRow>}</TableBody>{footerRow ? <TableFooter><TableRow>{table.getVisibleLeafColumns().map((column) => <TableCell
    key={column.id}
    style={{
      ...getColumnPinningStyle({ column })
    }}
  >{footerRow[column.id] != null ? footerRow[column.id] : null}</TableCell>)}</TableRow></TableFooter> : null}</Table></div><div className="flex flex-col gap-2.5"><DataTablePagination table={table} />{actionBar && table.getFilteredSelectedRowModel().rows.length > 0 && actionBar}</div></div>;
}
export {
  DataTable
};
