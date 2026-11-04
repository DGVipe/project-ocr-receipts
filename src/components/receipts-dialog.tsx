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
import { useI18n } from "@/lib/i18n";

export function ReceiptsDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const summary = useQuery(api.receipts.summary);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <DatabaseIcon /> {t.viewAll}
        {summary && (
          <Badge variant="secondary" className="ml-1 tabular-nums">
            {summary.totalReceipts}
          </Badge>
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>
            {t.dialogDescription}
            {summary && t.storage(summary.totalReceipts, summary.maxTotalReceipts)}
          </DialogDescription>
        </DialogHeader>
        {/* Only subscribe while the modal is open. */}
        {open && <ReceiptsTable />}
      </DialogContent>
    </Dialog>
  );
}

function ReceiptsTable() {
  const { t, locale } = useI18n();
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
        {t.noReceipts}
      </p>
    );
  }

  return (
    <ScrollArea className="h-[60vh] min-h-0 rounded-lg border">
      {/* overflow-visible lets the header stick to the ScrollArea viewport */}
      <Table containerClassName="overflow-visible">
        <TableHeader className="sticky top-0 z-10 bg-popover">
          <TableRow>
            <TableHead>{t.store}</TableHead>
            <TableHead>{t.date}</TableHead>
            <TableHead className="text-right">{t.total}</TableHead>
            <TableHead className="hidden sm:table-cell">{t.scanned}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((r) => (
            <TableRow key={r._id}>
              <TableCell className="max-w-48 truncate font-medium" title={r.storeName ?? undefined}>
                {r.storeName ?? <span className="text-muted-foreground">{t.unknown}</span>}
              </TableCell>
              <TableCell>{formatDate(r.purchaseDate, locale)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatAmount(r.totalAmount, r.currency, locale)}
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {formatTimestamp(r._creationTime, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div ref={sentinelRef} className="flex h-12 items-center justify-center text-sm text-muted-foreground">
        {status === "LoadingMore" && <Loader2Icon className="size-4 animate-spin" />}
        {status === "CanLoadMore" && (
          <Button variant="ghost" size="sm" onClick={() => loadMore(LIST_PAGE_SIZE)}>
            {t.loadMore}
          </Button>
        )}
        {status === "Exhausted" && <span>{t.endOfList(results.length)}</span>}
      </div>
    </ScrollArea>
  );
}
