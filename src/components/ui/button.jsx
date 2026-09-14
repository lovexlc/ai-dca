import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline: "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

// React 18 需 forwardRef，否则 Radix Popover/DropdownMenu 的 asChild 拿不到 trigger 的 DOM ref。
// loading：请求进行中显示 spinner、自动禁用并标记 aria-busy，避免各处重复手写 Loader2。
// 注意 asChild 时 Slot 只接受单个子节点，因此不注入 spinner，仅透传 disabled/aria-busy。
const Button = React.forwardRef(function Button(
  { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  const showSpinner = loading && !asChild;
  const computedDisabled = asChild ? disabled : Boolean(disabled) || loading;
  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-loading={loading ? "true" : undefined}
      aria-busy={loading ? true : undefined}
      disabled={computedDisabled}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {showSpinner ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </Comp>
  );
});
Button.displayName = "Button";

export { Button, buttonVariants };
