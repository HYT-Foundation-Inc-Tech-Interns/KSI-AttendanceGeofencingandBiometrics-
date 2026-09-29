import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * Restraint is the rule here: flat brand fills, one soft shadow, and no
 * gradients or grow-on-hover scaling. The previous set used
 * `bg-gradient-to-r from-green-600 to-lime-600` with `shadow-lg hover:shadow-xl`;
 * a flat `brand-800` fill reads as elegant where a two-stop gradient reads as
 * loud, and `brand-800` clears 8.55:1 against its white label.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "bg-brand-800 text-white hover:bg-brand-900 active:bg-brand-950",
        // `critical-600` is 6.56:1 — the same brick the flagged/rejected badges use.
        destructive: "bg-critical-600 text-white hover:bg-critical-700",
        // Same critical token, outlined — for a Reject sitting beside an Approve
        // in a table row, where two solid buttons would be heavy.
        critical:
          "border border-critical-200 bg-white text-critical-600 hover:bg-critical-50 hover:border-critical-300",
        outline:
          "border border-silver-300 bg-white text-brand-800 hover:bg-silver-50 hover:border-silver-400",
        secondary: "bg-silver-100 text-ink hover:bg-silver-200",
        ghost: "text-silver-800 hover:bg-silver-100 hover:text-brand-800",
        link: "text-brand-700 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
