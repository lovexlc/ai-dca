// Adapted from sadmann7/tablecn (MIT).
// v6.6: View options dropdown removed per UX. Toolbar now only renders when there's
// either an active column filter (重置过滤 button) or caller-provided children;
// otherwise it returns null so the empty row above the table disappears.
import { X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function DataTableToolbar({ table, children, className, ...props }) {
  const isFiltered = table.getState().columnFilters.length > 0;
  const onReset = React.useCallback(() => {
    table.resetColumnFilters();
  }, [table]);
  if (!isFiltered && !children) return null;
  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      className={cn(
        "flex w-full flex-col items-stretch justify-between gap-2 sm:flex-row sm:items-start",
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
      </div>
    </div>
  );
}

export { DataTableToolbar };
