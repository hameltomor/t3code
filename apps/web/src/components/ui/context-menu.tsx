"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type * as React from "react";

import { cn } from "~/lib/utils";

const ContextMenu = ContextMenuPrimitive.Root;

const ContextMenuPortal = ContextMenuPrimitive.Portal;

function ContextMenuTrigger({ className, ...props }: ContextMenuPrimitive.Trigger.Props) {
  return (
    <ContextMenuPrimitive.Trigger
      className={cn("select-none [-webkit-user-select:none]", className)}
      data-slot="context-menu-trigger"
      {...props}
    />
  );
}

function ContextMenuPopup({
  children,
  className,
  sideOffset = 4,
  align = "start",
  alignOffset,
  side = "bottom",
  anchor,
  ...props
}: ContextMenuPrimitive.Popup.Props & {
  align?: ContextMenuPrimitive.Positioner.Props["align"];
  sideOffset?: ContextMenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: ContextMenuPrimitive.Positioner.Props["alignOffset"];
  side?: ContextMenuPrimitive.Positioner.Props["side"];
  anchor?: ContextMenuPrimitive.Positioner.Props["anchor"];
}) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Backdrop className="fixed inset-0 z-50" />
      <ContextMenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50"
        data-slot="context-menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <ContextMenuPrimitive.Popup
          className={cn(
            "relative flex not-[class*='w-']:min-w-32 origin-(--transform-origin) rounded-[4px] border bg-popover not-dark:bg-clip-padding shadow-lg/5 outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[3px] before:shadow-[0_1px_--theme(--color-black/4%)] focus:outline-none dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            className,
          )}
          data-slot="context-menu-popup"
          {...props}
        >
          <div className="max-h-(--available-height) w-full overflow-y-auto p-1">{children}</div>
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: ContextMenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "[&>svg]:-mx-0.5 flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1 text-base text-foreground outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-inset:ps-8 data-[variant=destructive]:text-destructive-foreground data-highlighted:text-accent-foreground data-disabled:opacity-50 sm:min-h-7 sm:text-sm [&>svg:not([class*='opacity-'])]:opacity-80 [&>svg:not([class*='size-'])]:size-4.5 sm:[&>svg:not([class*='size-'])]:size-4 [&>svg]:pointer-events-none [&>svg]:shrink-0",
        className,
      )}
      data-inset={inset}
      data-slot="context-menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mx-2 my-1 h-px bg-border", className)}
      data-slot="context-menu-separator"
      role="separator"
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuPortal,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator,
};
