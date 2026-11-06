"use client";

import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";

import { TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Table cell whose long text is cut with an ellipsis. Touch screens have no
 * hover, so tapping opens a bubble with the full text under the cell; tapping
 * again (or anywhere else) closes it. A mouse click does nothing, and the
 * native `title` tooltip keeps working on hover.
 * Needs `table-fixed` on the table so the column width stays put.
 */
export function TapRevealCell({
  className,
  children,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const touched = useRef(false);

  return (
    <TableCell className={cn("truncate", className)} title={title}>
      <Popover.Root
        open={open}
        // Mouse clicks never open the bubble, so desktop behaves as before.
        onOpenChange={(next) => setOpen(next && touched.current)}
      >
        <Popover.Trigger
          render={<span />}
          nativeButton={false}
          className="block truncate"
          onPointerDown={(e) => {
            touched.current = e.pointerType !== "mouse";
          }}
        >
          {children}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-[60]">
            <Popover.Popup className="max-w-[min(18rem,calc(100vw-2rem))] rounded-lg bg-popover px-3 py-2 text-sm font-medium break-words text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
              {children}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </TableCell>
  );
}
