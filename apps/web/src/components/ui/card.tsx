import * as React from "react";

import { cn } from "../../lib/utils";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      className={cn(
        "rounded-[20px] border border-[rgba(32,26,21,0.12)] bg-[rgba(255,255,255,0.76)] backdrop-blur-[10px]",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);

Card.displayName = "Card";
