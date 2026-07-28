"use client";

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { IconX } from '@tabler/icons-react';
import { cn } from '../../lib/utils.js';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

const SheetOverlay = React.forwardRef(function SheetOverlay({ className, ...props }, ref) {
  return <DialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-[110] bg-[rgba(23,23,23,0.32)]', className)} {...props} />;
});
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

const sideClasses = {
  top: 'inset-x-0 top-0 border-b',
  bottom: 'inset-x-0 bottom-0 border-t',
  left: 'inset-y-0 left-0 h-full border-r',
  right: 'inset-y-0 right-0 h-full border-l'
};

const SheetContent = React.forwardRef(function SheetContent({ side = 'right', className, children, showCloseButton = true, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'sheet-content fixed z-[111] flex w-full flex-col gap-4 border-[var(--a-200)] bg-[var(--bg-100)] p-5 text-[var(--fg-1000)] outline-none sm:max-w-md',
          sideClasses[side] || sideClasses.right,
          side === 'top' || side === 'bottom' ? 'max-h-[85vh]' : 'max-w-[min(100vw,420px)]',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-700)] hover:bg-[#f4f4f4] hover:text-[var(--fg-1000)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue-text)]" aria-label="关闭">
            <IconX className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
SheetContent.displayName = DialogPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }) => <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />;
const SheetFooter = ({ className, ...props }) => <div className={cn('mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
const SheetTitle = React.forwardRef(function SheetTitle({ className, ...props }, ref) {
  return <DialogPrimitive.Title ref={ref} className={cn('text-base font-semibold tracking-[-0.012em]', className)} {...props} />;
});
SheetTitle.displayName = DialogPrimitive.Title.displayName;
const SheetDescription = React.forwardRef(function SheetDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn('text-sm leading-6 text-[var(--fg-700)]', className)} {...props} />;
});
SheetDescription.displayName = DialogPrimitive.Description.displayName;

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
