// Adapted from sadmann7/tablecn (MIT). Removed date/slider/range branches — we don't ship those filters.
import { X } from "lucide-react";
import * as React from "react";
import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter";
import { DataTableViewOptions } from "@/components/data-table/data-table-view-options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function DataTableToolbar({ table, children, className, ...props }) {
  const isFiltered = table.getState().columnFilters.length > 0;
  const columns = React.useMemo(
    () => table.getAllColumns().filter((column) => column.getCanFilter()),
    [table]
  );
  const onReset = React.useCallback(() => {
    table.resetColumnFilters();
  }, [table]);
  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      className={cn("flex w-full flex-col items-stretch justify-between gap-2 p-1 sm:flex-row sm:items-start", className)}
      {...props}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {columns.map((column) => (
          <DataTableToolbarFilter key={column.id} column={column} />
        ))}
        {isFiltered && (
          <Button
            aria-label="Reset filters"
            variant="outline"
            size="sm"
            className="border-dashed"
            onClick={onReset}
          >
            <X />
            Reset
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {children}
        <DataTableViewOptions table={table} align="end" />
      </div>
    </div>
  );
}

function DataTableToolbarFilter({ column }) {
  const columnMeta = column.columnDef.meta;
  const onFilterRender = React.useCallback(() => {
    if (!columnMeta?.variant) return null;
    switch (columnMeta.variant) {
      case "text":
        return (
          <Input
            placeholder={columnMeta.placeholder ?? columnMeta.label}
            value={column.getFilterValue() ?? ""}
            onChange={(event) => column.setFilterValue(event.target.value)}
            className="h-8 w-40 lg:w-56"
          />
        );
      case "number":
        return (
          <div className="relative">
            <Input
              type="number"
              inputMode="numeric"
              placeholder={columnMeta.placeholder ?? columnMeta.label}
              value={column.getFilterValue() ?? ""}
              onChange={(event) => column.setFilterValue(event.target.value)}
              className={cn("h-8 w-[120px]", columnMeta.unit && "pr-8")}
            />
            {columnMeta.unit && (
              <span className="absolute top-0 right-0 bottom-0 flex items-center rounded-r-md bg-accent px-2 text-muted-foreground text-sm">
                {columnMeta.unit}
              </span>
            )}
          </div>
        );
      case "select":
      case "multiSelect":
        return (
          <DataTableFacetedFilter
            column={column}
            title={columnMeta.label ?? column.id}
            options={columnMeta.options ?? []}
            multiple={columnMeta.variant === "multiSelect"}
          />
        );
      default:
        return null;
    }
  }, [column, columnMeta]);
  return onFilterRender();
}

export { DataTableToolbar };
