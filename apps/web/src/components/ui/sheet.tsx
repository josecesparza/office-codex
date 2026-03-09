import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";

import { cn } from "../../lib/utils";

function CloseIcon() {
  return (
    <svg aria-hidden="true" height="16" viewBox="0 0 20 20" width="16">
      <path
        d="M5 5 15 15M15 5 5 15"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    className={cn("fixed inset-0 z-40 bg-[rgba(32,26,21,0.32)] backdrop-blur-[2px]", className)}
    ref={ref}
    {...props}
  />
));

SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col gap-5 border-l border-[rgba(32,26,21,0.12)] bg-[rgba(255,252,244,0.98)] p-6 shadow-[-24px_0_60px_rgba(32,26,21,0.18)] outline-none",
        className,
      )}
      ref={ref}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label="Close settings"
        className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(32,26,21,0.12)] bg-white/80 text-[#201a15]"
      >
        <CloseIcon />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
));

SheetContent.displayName = DialogPrimitive.Content.displayName;

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-1.5 pr-10", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-auto flex flex-wrap gap-3", className)} {...props} />;
}

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    className={cn("text-2xl font-semibold text-[#201a15]", className)}
    ref={ref}
    {...props}
  />
));

SheetTitle.displayName = DialogPrimitive.Title.displayName;

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    className={cn("text-sm text-[#6f6258]", className)}
    ref={ref}
    {...props}
  />
));

SheetDescription.displayName = DialogPrimitive.Description.displayName;
