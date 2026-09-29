import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * Status colour is never the only signal: every badge in this app is rendered
 * beside an icon and a word ("Verified", "Flagged", "Pending"). That pairing is
 * what makes a low-contrast status colour legal, so keep it when adding one.
 *
 * Variant keys are unchanged from the previous set — the pages already use
 * `success` / `warning` / `error` / `secondary` / `outline`, and renaming them
 * would break call sites for no visual gain.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-silver-100 text-silver-900 border border-silver-200",
        // Neutral, not blue. `secondary` reads as "no status" (e.g. exported).
        secondary: "bg-silver-100 text-silver-900 border border-silver-200",
        // `critical` — flagged / rejected / destructive.
        destructive: "bg-critical-50 text-critical-600 border border-critical-200",
        error: "bg-critical-50 text-critical-600 border border-critical-200",
        // `brand` — verified / active. 7.85:1 on the brand-50 wash.
        success: "bg-brand-50 text-brand-800 border border-brand-200",
        // `warning` — pending.
        warning: "bg-warning-50 text-warning-600 border border-warning-200",
        outline: "border border-silver-300 text-silver-800",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
