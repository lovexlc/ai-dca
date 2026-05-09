"use client";
import { Check, ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
const FacetedContext = React.createContext(
  null
);
function useFacetedContext(name) {
  const context = React.useContext(FacetedContext);
  if (!context) {
    throw new Error(`\`${name}\` must be within Faceted`);
  }
  return context;
}
function Faceted(props) {
  const {
    open: openProp,
    onOpenChange: onOpenChangeProp,
    value,
    onValueChange,
    children,
    multiple = false,
    ...facetedProps
  } = props;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = openProp !== void 0;
  const open = isControlled ? openProp : uncontrolledOpen;
  const onOpenChange = React.useCallback(
    (newOpen) => {
      if (!isControlled) {
        setUncontrolledOpen(newOpen);
      }
      onOpenChangeProp?.(newOpen);
    },
    [isControlled, onOpenChangeProp]
  );
  const onItemSelect = React.useCallback(
    (selectedValue) => {
      if (!onValueChange) return;
      if (multiple) {
        const currentValue = Array.isArray(value) ? value : [];
        const newValue = currentValue.includes(selectedValue) ? currentValue.filter((v) => v !== selectedValue) : [...currentValue, selectedValue];
        onValueChange(newValue);
      } else {
        if (value === selectedValue) {
          onValueChange(void 0);
        } else {
          onValueChange(selectedValue);
        }
        requestAnimationFrame(() => onOpenChange(false));
      }
    },
    [multiple, value, onValueChange, onOpenChange]
  );
  const contextValue = React.useMemo(
    () => ({ value, onItemSelect, multiple }),
    [value, onItemSelect, multiple]
  );
  return <FacetedContext.Provider value={contextValue}><Popover open={open} onOpenChange={onOpenChange} {...facetedProps}>{children}</Popover></FacetedContext.Provider>;
}
function FacetedTrigger(props) {
  const { className, children, ...triggerProps } = props;
  return <PopoverTrigger
    {...triggerProps}
    className={cn("justify-between text-left", className)}
  >{children}</PopoverTrigger>;
}
function FacetedBadgeList(props) {
  const {
    options = [],
    max = 2,
    placeholder = "Select options...",
    className,
    badgeClassName,
    ...badgeListProps
  } = props;
  const context = useFacetedContext("FacetedBadgeList");
  const values = Array.isArray(context.value) ? context.value : [context.value].filter(Boolean);
  const getLabel = React.useCallback(
    (value) => {
      const option = options.find((opt) => opt.value === value);
      return option?.label ?? value;
    },
    [options]
  );
  if (!values || values.length === 0) {
    return <div
      {...badgeListProps}
      className="flex w-full items-center gap-1 text-muted-foreground"
    >{placeholder}<ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" /></div>;
  }
  return <div
    {...badgeListProps}
    className={cn("flex flex-wrap items-center gap-1", className)}
  >{values.length > max ? <Badge
    variant="secondary"
    className={cn("rounded-sm px-1 font-normal", badgeClassName)}
  >{values.length} selected
        </Badge> : values.map((value) => <Badge
    key={value}
    variant="secondary"
    className={cn("rounded-sm px-1 font-normal", badgeClassName)}
  ><span className="truncate">{getLabel(value)}</span></Badge>)}</div>;
}
function FacetedContent(props) {
  const { className, children, ...contentProps } = props;
  return <PopoverContent
    {...contentProps}
    align="start"
    className={cn(
      "w-[200px] origin-(--radix-popover-content-transform-origin) p-0",
      className
    )}
  ><Command>{children}</Command></PopoverContent>;
}
const FacetedInput = CommandInput;
const FacetedList = CommandList;
const FacetedEmpty = CommandEmpty;
const FacetedGroup = CommandGroup;
function FacetedItem(props) {
  const { value, onSelect, className, children, ...itemProps } = props;
  const context = useFacetedContext("FacetedItem");
  const isSelected = context.multiple ? Array.isArray(context.value) && context.value.includes(value) : context.value === value;
  const onItemSelect = React.useCallback(
    (currentValue) => {
      if (onSelect) {
        onSelect(currentValue);
      } else if (context.onItemSelect) {
        context.onItemSelect(currentValue);
      }
    },
    [onSelect, context]
  );
  return <CommandItem
    aria-selected={isSelected}
    data-selected={isSelected}
    className={cn("gap-2", className)}
    onSelect={() => onItemSelect(value)}
    {...itemProps}
  ><span
    className={cn(
      "flex size-4 items-center justify-center rounded-sm border border-primary",
      isSelected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
    )}
  ><Check className="size-4" /></span>{children}</CommandItem>;
}
const FacetedSeparator = CommandSeparator;
export {
  Faceted,
  FacetedBadgeList,
  FacetedContent,
  FacetedEmpty,
  FacetedGroup,
  FacetedInput,
  FacetedItem,
  FacetedList,
  FacetedSeparator,
  FacetedTrigger
};
