import * as SelectPrimitive from "@radix-ui/react-select";
import * as React from "react";

import { cn } from "../../lib/utils";

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" height="14" viewBox="0 0 20 20" width="14">
      <path
        d="M5.5 7.5 10 12l4.5-4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    className={cn(
      "flex h-11 w-full items-center justify-between rounded-2xl border border-[rgba(32,26,21,0.14)] bg-[rgba(255,255,255,0.82)] px-4 text-sm text-[#201a15] outline-none",
      className,
    )}
    ref={ref}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon className="text-[#6f6258]">
      <ChevronDownIcon />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));

SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      className={cn(
        "z-50 min-w-[10rem] overflow-hidden rounded-2xl border border-[rgba(32,26,21,0.12)] bg-[rgba(255,252,244,0.98)] p-1 text-[#201a15] shadow-[0_18px_40px_rgba(32,26,21,0.18)]",
        className,
      )}
      position={position}
      ref={ref}
      {...props}
    >
      <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));

SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    className={cn(
      "relative flex w-full cursor-pointer select-none items-center rounded-xl px-3 py-2 text-sm outline-none data-[highlighted]:bg-[rgba(32,26,21,0.08)] data-[state=checked]:bg-[rgba(32,26,21,0.12)]",
      className,
    )}
    ref={ref}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));

SelectItem.displayName = SelectPrimitive.Item.displayName;
