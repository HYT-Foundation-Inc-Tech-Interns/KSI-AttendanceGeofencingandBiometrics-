import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/*
 * `silver-300` border rather than a 2px grey one; the focus ring comes from the
 * shared `:focus-visible` rule in globals.css, so it is not restated per
 * component. Placeholder sits at `silver-600` — light enough to recede, dark
 * enough to read.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-silver-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-silver-600 transition-colors duration-150 focus-visible:outline-none focus-visible:border-brand-600 focus-visible:ring-1 focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:bg-silver-50 disabled:opacity-60",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
