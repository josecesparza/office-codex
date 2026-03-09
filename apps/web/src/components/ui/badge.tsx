import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em]",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "border-[rgba(32,26,21,0.1)] bg-[rgba(255,255,255,0.76)] text-[#6f6258]",
        outline: "border-[rgba(32,26,21,0.14)] bg-transparent text-[#201a15]",
      },
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
