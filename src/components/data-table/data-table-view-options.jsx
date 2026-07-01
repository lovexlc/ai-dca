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
  presetActions = [],
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
    className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-normal"
    disabled={disabled}
  ><Settings2 className="text-muted-foreground" />
          {label}
        </Button></PopoverTrigger><PopoverContent align="end" className="w-52 p-0" {...props}><Command><CommandInput placeholder={searchPlaceholder} /><CommandList><CommandEmpty>没有可切换的列</CommandEmpty>{presetActions.length ? <CommandGroup>{presetActions.map((action) => <CommandItem
    key={action.key || action.label}
    onSelect={action.onSelect}
    className="flex w-full items-center gap-2 whitespace-nowrap"
  ><span className="min-w-0 flex-1 truncate text-left">{action.label}</span><Check
    className={cn(
      "ml-auto size-4 shrink-0",
      action.active ? "opacity-100" : "opacity-0"
    )}
  /></CommandItem>)}</CommandGroup> : null}<CommandGroup>{columns.map((column) => <CommandItem
    key={column.id}
    onSelect={() => column.toggleVisibility(!column.getIsVisible())}
    className="flex w-full items-center gap-2 whitespace-nowrap"
  ><span className="min-w-0 flex-1 truncate text-left">{column.columnDef.meta?.label ?? column.id}</span><Check
    className={cn(
      "ml-auto size-4 shrink-0",
      column.getIsVisible() ? "opacity-100" : "opacity-0"
    )}
  /></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover>;
}
export {
  DataTableViewOptions
};
