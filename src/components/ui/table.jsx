"use client";
import { cn } from "@/lib/utils";
function Table({ className, ...props }) {
  return <div
    data-slot="table-container"
    className="relative w-full overflow-x-auto"
  ><table
    data-slot="table"
    className={cn("w-full caption-bottom text-sm tabular-nums", className)}
    {...props}
  /></div>;
}
function TableHeader({ className, ...props }) {
  return <thead
    data-slot="table-header"
    className={cn("bg-[var(--market-surface-subtle)] text-xs tracking-wide text-[var(--fg-700)] [&_tr]:border-b [&_tr]:border-[var(--a-200)]", className)}
    {...props}
  />;
}
function TableBody({ className, ...props }) {
  return <tbody
    data-slot="table-body"
    className={cn("[&_tr:last-child]:border-0 [&_tr:nth-child(even)]:bg-[var(--a-100)]", className)}
    {...props}
  />;
}
function TableFooter({ className, ...props }) {
  return <tfoot
    data-slot="table-footer"
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />;
}
function TableRow({ className, ...props }) {
  return <tr
    data-slot="table-row"
    className={cn(
      "h-11 border-b border-[var(--a-200)] transition-colors hover:bg-[var(--blue-tint)]/40 data-[state=selected]:bg-[var(--blue-tint)]",
      className
    )}
    {...props}
  />;
}
function TableHead({ className, ...props }) {
  return <th
    data-slot="table-head"
    className={cn(
      "h-11 whitespace-nowrap px-4 text-left align-middle font-medium text-[var(--fg-700)] [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />;
}
function TableCell({ className, ...props }) {
  return <td
    data-slot="table-cell"
    className={cn(
      "whitespace-nowrap px-4 py-3 align-middle text-[var(--fg-900)] [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props}
  />;
}
function TableCaption({
  className,
  ...props
}) {
  return <caption
    data-slot="table-caption"
    className={cn("mt-4 text-muted-foreground text-sm", className)}
    {...props}
  />;
}
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
};
