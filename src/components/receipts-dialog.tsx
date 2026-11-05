"use client";

import { usePaginatedQuery, useQuery, type UsePaginatedQueryReturnType } from "convex/react";
import { DatabaseIcon } from "lucide-react";

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
import { PageControls, useDeferredDialog, usePages } from "@/components/page-controls";
import { useI18n } from "@/lib/i18n";

export function ReceiptsDialog() {
  const { t } = useI18n();
  const dialog = useDeferredDialog();
  const summary = useQuery(api.receipts.summary);
  // Fetch on click; the modal opens once the first page is here.
  const data = usePaginatedQuery(
    api.receipts.list,
    dialog.active ? {} : "skip",
    { initialNumItems: LIST_PAGE_SIZE },
  );
  const ready = dialog.active && data.status !== "LoadingFirstPage";

  return (
    <Dialog {...dialog.props(ready)}>
      <DialogTrigger render={<Button variant="outline" />}>
        <DatabaseIcon />{" "}
        {t.viewAll}
        {summary ? (
          <Badge variant="secondary" className="ml-1 tabular-nums">
            {summary.totalReceipts}
          </Badge>
        ) : (
          // Reserve the badge's space so the button doesn't resize when the count arrives.
          <Skeleton className="ml-1 h-5 w-7 rounded-4xl" />
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>
            {t.dialogDescription}
            {summary &&
              t.storage(summary.totalReceipts, summary.maxTotalReceipts)}
          </DialogDescription>
        </DialogHeader>
        <ReceiptsTable {...data} />
      </DialogContent>
    </Dialog>
  );
}

function ReceiptsTable({
  results,
  status,
  loadMore,
}: UsePaginatedQueryReturnType<typeof api.receipts.list>) {
  const { t, locale } = useI18n();
  const pages = usePages(results, status, loadMore, LIST_PAGE_SIZE);

  if (results.length === 0) {
    return (
      <p className="py-12 text-center text-muted-foreground">{t.noReceipts}</p>
    );
  }

  return (
    <>
      <ScrollArea className="min-h-0 rounded-lg border">
        {/* overflow-visible lets the header stick to the ScrollArea viewport */}
        <Table containerClassName="overflow-visible">
          <TableHeader className="sticky top-0 z-10 bg-popover">
            <TableRow>
              <TableHead>{t.store}</TableHead>
              <TableHead>{t.date}</TableHead>
              <TableHead className="text-right">{t.total}</TableHead>
              <TableHead className="hidden sm:table-cell">
                {t.scanned}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pages.rows.map((r) => (
              <TableRow key={r._id}>
                <TableCell
                  className="max-w-48 truncate font-medium"
                  title={r.storeName ?? undefined}
                >
                  {r.storeName ?? (
                    <span className="text-muted-foreground">{t.unknown}</span>
                  )}
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
      </ScrollArea>
      <PageControls pages={pages} />
    </>
  );
}
