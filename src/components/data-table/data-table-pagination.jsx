import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
function DataTablePagination({
  table,
  pageSizeOptions = [10, 20, 30, 40, 50],
  labels = {},
  showTotalCount = false,
  className,
  ...props
}) {
  const rowsPerPageLabel = labels.rowsPerPage || 'Rows per page';
  const pageLabel = labels.page || 'Page';
  const ofLabel = labels.of || 'of';
  const totalLabel = labels.total || '条';
  const pageSuffix = labels.pageSuffix || '';
  const pageSizeSuffix = labels.pageSizeSuffix || '';
  return <div
    className={cn(
      "flex w-full flex-col-reverse items-center justify-between gap-4 overflow-auto p-1 sm:flex-row sm:gap-8",
      className
    )}
    {...props}
  ><div className="flex-1 whitespace-nowrap text-muted-foreground text-sm">{table.getFilteredSelectedRowModel().rows.length > 0 ? `${table.getFilteredSelectedRowModel().rows.length} of ${table.getFilteredRowModel().rows.length} row(s) selected.` : showTotalCount ? `共 ${table.getFilteredRowModel().rows.length} ${totalLabel}` : null}</div><div className="flex flex-col-reverse items-center gap-4 sm:flex-row sm:gap-6 lg:gap-8"><div className="flex items-center space-x-2"><p className="whitespace-nowrap font-medium text-sm">{rowsPerPageLabel}</p><Select
    value={`${table.getState().pagination.pageSize}`}
    onValueChange={(value) => {
      table.setPageSize(Number(value));
    }}
  ><SelectTrigger className="h-8 w-18 data-size:h-8"><SelectValue placeholder={table.getState().pagination.pageSize} /></SelectTrigger><SelectContent side="top">{pageSizeOptions.map((pageSize) => <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>)}</SelectContent></Select>{pageSizeSuffix ? <span className="whitespace-nowrap">{pageSizeSuffix}</span> : null}</div><div className="flex items-center justify-center font-medium text-sm">
          {pageLabel} {table.getState().pagination.pageIndex + 1} {ofLabel} {table.getPageCount()} {pageSuffix}</div><div className="flex items-center space-x-2"><Button
    aria-label="Go to first page"
    variant="outline"
    size="icon"
    className="hidden size-8 lg:flex"
    onClick={() => table.setPageIndex(0)}
    disabled={!table.getCanPreviousPage()}
  ><ChevronsLeft /></Button><Button
    aria-label="Go to previous page"
    variant="outline"
    size="icon"
    className="size-8"
    onClick={() => table.previousPage()}
    disabled={!table.getCanPreviousPage()}
  ><ChevronLeft /></Button><Button
    aria-label="Go to next page"
    variant="outline"
    size="icon"
    className="size-8"
    onClick={() => table.nextPage()}
    disabled={!table.getCanNextPage()}
  ><ChevronRight /></Button><Button
    aria-label="Go to last page"
    variant="outline"
    size="icon"
    className="hidden size-8 lg:flex"
    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
    disabled={!table.getCanNextPage()}
  ><ChevronsRight /></Button></div></div></div>;
}
export {
  DataTablePagination
};
