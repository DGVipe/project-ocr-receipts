"use client";

import { useEffect, useRef, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { DatabaseIcon, Loader2Icon } from "lucide-react";

import { api } from "@convex/_generated/api";
import { LIST_PAGE_SIZE } from "@convex/limits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAmount, formatDate, formatTimestamp } from "@/lib/format";

export function ReceiptsDialog() {
  const [open, setOpen] = useState(false);
  const summary = useQuery(api.receipts.summary);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <DatabaseIcon /> View all receipts
        {summary && (
          <Badge variant="secondary" className="ml-1 tabular-nums">
            {summary.totalReceipts}
          </Badge>
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>All scanned receipts</DialogTitle>
          <DialogDescription>
            Every receipt collected by all users, newest first.
            {summary && (
              <>
                {" "}
                Storage: {summary.totalReceipts} / {summary.maxTotalReceipts} receipts.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {/* Only subscribe while the modal is open. */}
        {open && <ReceiptsTable />}
      </DialogContent>
    </Dialog>
  );
}

function ReceiptsTable() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.receipts.list,
    {},
    { initialNumItems: LIST_PAGE_SIZE },
  );
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Infinite scroll: load the next page when the bottom of the list is visible.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || status !== "CanLoadMore") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore(LIST_PAGE_SIZE);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [status, loadMore]);

  if (status === "LoadingFirstPage") {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <p className="py-12 text-center text-muted-foreground">
        No receipts yet. Scan one to get started.
      </p>
    );
  }

  return (
    <ScrollArea className="h-[60vh] min-h-0 rounded-lg border">
      {/* overflow-visible lets the header stick to the ScrollArea viewport */}
      <Table containerClassName="overflow-visible">
        <TableHeader className="sticky top-0 z-10 bg-popover">
          <TableRow>
            <TableHead>Store</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="hidden sm:table-cell">Scanned</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((r) => (
            <TableRow key={r._id}>
              <TableCell className="max-w-48 truncate font-medium" title={r.storeName ?? undefined}>
                {r.storeName ?? <span className="text-muted-foreground">Unknown</span>}
              </TableCell>
              <TableCell>{formatDate(r.purchaseDate)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(r.totalAmount, r.currency)}
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {formatTimestamp(r._creationTime)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div ref={sentinelRef} className="flex h-12 items-center justify-center text-sm text-muted-foreground">
        {status === "LoadingMore" && <Loader2Icon className="size-4 animate-spin" />}
        {status === "CanLoadMore" && (
          <Button variant="ghost" size="sm" onClick={() => loadMore(LIST_PAGE_SIZE)}>
            Load more
          </Button>
        )}
        {status === "Exhausted" && <span>{results.length} receipts — end of list</span>}
      </div>
    </ScrollArea>
  );
}
