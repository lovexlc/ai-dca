// Adapted from sadmann7/tablecn (MIT). Inline filters were moved into per-column header dropdowns,
// so this toolbar now only carries reset + view-options + caller-provided children.
import { X } from "lucide-react";
import * as React from "react";
import { DataTableViewOptions } from "@/components/data-table/data-table-view-options";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function DataTableToolbar({ table, children, className, ...props }) {
  const isFiltered = table.getState().columnFilters.length > 0;
  const onReset = React.useCallback(() => {
    table.resetColumnFilters();
  }, [table]);
  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      className={cn(
        "flex w-full flex-col items-stretch justify-between gap-2 p-1 sm:flex-row sm:items-start",
        className
      )}
      {...props}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {isFiltered && (
          <Button
            aria-label="Reset filters"
            variant="outline"
            size="sm"
            className="border-dashed"
            onClick={onReset}
          >
            <X />
            重置过滤
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

export { DataTableToolbar };
