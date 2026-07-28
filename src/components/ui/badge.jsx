import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive: "border-transparent bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/70 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline: "border-[var(--a-200)] bg-transparent text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        success: "border-transparent bg-[var(--green-tint)] text-[var(--green-text)]",
        danger: "border-transparent bg-[var(--red-tint)] text-[var(--red-text)]",
        warning: "border-transparent bg-[var(--amber-tint)] text-[var(--amber-text)]",
        info: "border-transparent bg-[var(--blue-tint)] text-[var(--blue-text)]",
        purple: "border-transparent bg-[var(--purple-tint)] text-[var(--purple-text)]"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
function Badge({
  className,
  variant,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot : "span";
  return <Comp
    data-slot="badge"
    className={cn(badgeVariants({ variant }), className)}
    {...props}
  />;
}
export {
  Badge,
  badgeVariants
};
