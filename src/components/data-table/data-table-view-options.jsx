"use client";
import { Check, Settings2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
function DataTableViewOptions({
  table,
  disabled,
  label = "列设置",
  searchPlaceholder = "搜索列...",
  ...props
}) {
  const columns = React.useMemo(
    () => table.getAllColumns().filter(
      (column) => typeof column.accessorFn !== "undefined" && column.getCanHide()
    ),
    [table]
  );
  return <Popover><PopoverTrigger asChild><Button
    aria-label="切换表格列"
    title="切换表格列"
    role="combobox"
    variant="outline"
    size="sm"
    className="flex h-8 font-normal"
    disabled={disabled}
  ><Settings2 className="text-muted-foreground" />
          {label}
        </Button></PopoverTrigger><PopoverContent className="w-44 p-0" {...props}><Command><CommandInput placeholder={searchPlaceholder} /><CommandList><CommandEmpty>没有可切换的列</CommandEmpty><CommandGroup>{columns.map((column) => <CommandItem
    key={column.id}
    onSelect={() => column.toggleVisibility(!column.getIsVisible())}
  ><span className="truncate">{column.columnDef.meta?.label ?? column.id}</span><Check
    className={cn(
      "ml-auto size-4 shrink-0",
      column.getIsVisible() ? "opacity-100" : "opacity-0"
    )}
  /></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover>;
}
export {
  DataTableViewOptions
};
