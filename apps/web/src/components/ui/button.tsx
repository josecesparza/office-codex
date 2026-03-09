import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border text-sm font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-9 px-3",
      },
      variant: {
        default:
          "border-[rgba(32,26,21,0.14)] bg-[rgba(255,255,255,0.82)] text-[#201a15] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] hover:bg-[rgba(255,255,255,0.94)]",
        ghost:
          "border-transparent bg-transparent text-[#201a15] hover:border-[rgba(32,26,21,0.12)] hover:bg-[rgba(255,255,255,0.7)]",
        secondary:
          "border-[rgba(32,26,21,0.12)] bg-[rgba(245,239,228,0.94)] text-[#201a15] hover:bg-[rgba(249,244,236,0.98)]",
      },
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size, variant, ...props }, ref) => (
    <button className={cn(buttonVariants({ size, variant }), className)} ref={ref} {...props} />
  ),
);

Button.displayName = "Button";
