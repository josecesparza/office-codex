import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "../../lib/utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-[rgba(32,26,21,0.14)] bg-[rgba(255,255,255,0.82)] transition-colors outline-none data-[state=checked]:bg-[#201a15] data-[state=checked]:text-white",
      className,
    )}
    ref={ref}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[20px]" />
  </SwitchPrimitive.Root>
));

Switch.displayName = SwitchPrimitive.Root.displayName;
