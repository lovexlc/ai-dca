"use client";
import { Check, PlusCircle, XCircle } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
function DataTableFacetedFilter({
  column,
  title,
  options,
  multiple
}) {
  const [open, setOpen] = React.useState(false);
  const columnFilterValue = column?.getFilterValue();
  const selectedValues = new Set(
    Array.isArray(columnFilterValue) ? columnFilterValue : []
  );
  const onItemSelect = React.useCallback(
    (option, isSelected) => {
      if (!column) return;
      if (multiple) {
        const newSelectedValues = new Set(selectedValues);
        if (isSelected) {
          newSelectedValues.delete(option.value);
        } else {
          newSelectedValues.add(option.value);
        }
        const filterValues = Array.from(newSelectedValues);
        column.setFilterValue(filterValues.length ? filterValues : void 0);
      } else {
        column.setFilterValue(isSelected ? void 0 : [option.value]);
        setOpen(false);
      }
    },
    [column, multiple, selectedValues]
  );
  const onReset = React.useCallback(
    (event) => {
      event?.stopPropagation();
      column?.setFilterValue(void 0);
    },
    [column]
  );
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button
    variant="outline"
    size="sm"
    className="border-dashed font-normal"
  >{selectedValues?.size > 0 ? <div
    role="button"
    aria-label={`Clear ${title} filter`}
    tabIndex={0}
    className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    onClick={onReset}
  ><XCircle /></div> : <PlusCircle />}{title}{selectedValues?.size > 0 && <><Separator
    orientation="vertical"
    className="mx-0.5 data-[orientation=vertical]:h-4"
  /><Badge
    variant="secondary"
    className="rounded-sm px-1 font-normal lg:hidden"
  >{selectedValues.size}</Badge><div className="hidden items-center gap-1 lg:flex">{selectedValues.size > 2 ? <Badge
    variant="secondary"
    className="rounded-sm px-1 font-normal"
  >{selectedValues.size} selected
                  </Badge> : options.filter((option) => selectedValues.has(option.value)).map((option) => <Badge
    variant="secondary"
    key={option.value}
    className="rounded-sm px-1 font-normal"
  >{option.label}</Badge>)}</div></>}</Button></PopoverTrigger><PopoverContent className="w-50 p-0" align="start"><Command><CommandInput placeholder={title} /><CommandList className="max-h-full"><CommandEmpty>No results found.</CommandEmpty><CommandGroup className="max-h-[300px] scroll-py-1 overflow-y-auto overflow-x-hidden">{options.map((option) => {
    const isSelected = selectedValues.has(option.value);
    return <CommandItem
      key={option.value}
      onSelect={() => onItemSelect(option, isSelected)}
    ><div
      className={cn(
        "flex size-4 items-center justify-center rounded-sm border border-primary",
        isSelected ? "bg-primary" : "opacity-50 [&_svg]:invisible"
      )}
    ><Check /></div>{option.icon && <option.icon />}<span className="truncate">{option.label}</span>{option.count && <span className="ml-auto type-data text-xs">{option.count}</span>}</CommandItem>;
  })}</CommandGroup>{selectedValues.size > 0 && <><CommandSeparator /><CommandGroup><CommandItem
    onSelect={() => onReset()}
    className="justify-center text-center"
  >
                    Clear filters
                  </CommandItem></CommandGroup></>}</CommandList></Command></PopoverContent></Popover>;
}
export {
  DataTableFacetedFilter
};
