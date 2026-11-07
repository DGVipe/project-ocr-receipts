"use client";

import { useConvex, usePaginatedQuery, useQuery, type UsePaginatedQueryReturnType } from "convex/react";
import { useState } from "react";
import { DatabaseIcon, DownloadIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { api } from "@convex/_generated/api";
import { LIST_PAGE_SIZE } from "@convex/limits";
import { TapRevealCell } from "@/components/tap-reveal-cell";
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
import { receiptsToXlsx } from "@/lib/export-xlsx";

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
      <DialogTrigger
        render={<Button variant="outline" aria-label={t.viewAll} />}
      >
        <DatabaseIcon />
        <span className="hidden sm:inline">{t.viewAll}</span>
        {summary ? (
          <Badge variant="secondary" className="sm:ml-1 tabular-nums">
            {summary.totalReceipts}
          </Badge>
        ) : (
          // Reserve the badge's space so the button doesn't resize when the count arrives.
          <Skeleton className="h-5 w-7 rounded-4xl sm:ml-1" />
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-[min(48rem,calc(100%-2rem))]">
        {/* Sits left of the dialog's close (X) button */}
        {summary && summary.totalReceipts > 0 && <ExportXlsButton />}
        <DialogHeader className="pr-28 sm:pr-40">
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
        <Table containerClassName="overflow-visible" className="table-fixed">
          <TableHeader className="sticky top-0 z-10 bg-popover">
            <TableRow>
              <TableHead className="px-1.5 sm:px-2">{t.store}</TableHead>
              <TableHead className="w-24 px-1.5 sm:w-32 sm:px-2">{t.date}</TableHead>
              <TableHead className="w-20 px-1.5 text-right sm:w-32 sm:px-2">{t.total}</TableHead>
              <TableHead className="hidden w-44 sm:table-cell">
                {t.scanned}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pages.rows.map((r) => (
              <TableRow key={r._id}>
                <TapRevealCell
                  className="px-1.5 font-medium sm:px-2"
                  title={r.storeName ?? undefined}
                >
                  {r.storeName ?? (
                    <span className="text-muted-foreground">{t.unknown}</span>
                  )}
                </TapRevealCell>
                <TableCell className="truncate px-1.5 text-xs sm:px-2 sm:text-sm">
                  {formatDate(r.purchaseDate, locale)}
                </TableCell>
                <TableCell className="truncate px-1.5 text-right text-xs tabular-nums sm:px-2 sm:text-sm">
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

/** Fetches every receipt and downloads them as an Excel file. */
function ExportXlsButton() {
  const { t } = useI18n();
  const convex = useConvex();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const rows = await convex.query(api.receipts.exportAll, {});
      const blob = await receiptsToXlsx(rows, {
        store: t.store,
        date: t.date,
        total: t.total,
        currency: t.currency,
        scanned: t.scanned,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipts-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t.exportFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="absolute top-2 right-11"
      onClick={download}
      disabled={busy}
      aria-label={t.exportXls}
    >
      {busy ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
      <span className="hidden sm:inline">{busy ? t.exporting : t.exportXls}</span>
    </Button>
  );
}
