"use client";

import { usePaginatedQuery, type UsePaginatedQueryReturnType } from "convex/react";
import { StoreIcon } from "lucide-react";

import { api } from "@convex/_generated/api";
import { LIST_PAGE_SIZE } from "@convex/limits";
import { TapRevealCell } from "@/components/tap-reveal-cell";
import {
  initialNumItems,
  PageControls,
  useDeferredDialog,
  usePages,
} from "@/components/page-controls";
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
import {
  Table,
  TableBody,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";

export function StoresDialog() {
  const { t } = useI18n();
  const dialog = useDeferredDialog();
  // Fetch on click; the modal opens once the first page is here.
  const data = usePaginatedQuery(
    api.stores.listPage,
    dialog.active ? {} : "skip",
    { initialNumItems: initialNumItems(LIST_PAGE_SIZE) },
  );
  const ready = dialog.active && data.status !== "LoadingFirstPage";

  return (
    <Dialog {...dialog.props(ready)}>
      <DialogTrigger
        render={<Button variant="outline" aria-label={t.supportedStores} />}
      >
        <StoreIcon />
        <span className="hidden sm:inline">{t.supportedStores}</span>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.storesDialogTitle}</DialogTitle>
          <DialogDescription>{t.storesDialogDescription}</DialogDescription>
        </DialogHeader>
        <StoresTable {...data} />
      </DialogContent>
    </Dialog>
  );
}

function StoresTable({
  results,
  status,
  loadMore,
}: UsePaginatedQueryReturnType<typeof api.stores.listPage>) {
  const { t } = useI18n();
  const pages = usePages(results, status, loadMore, LIST_PAGE_SIZE);

  if (results.length === 0) {
    return <p className="py-12 text-center text-muted-foreground">{t.noStores}</p>;
  }

  return (
    <>
      <ScrollArea className="min-h-0 rounded-lg border">
        <Table containerClassName="overflow-visible" className="table-fixed">
          <TableBody>
            {pages.rows.map((s) => (
              <TableRow key={s._id}>
                <TapRevealCell className="font-medium" title={s.name}>
                  {s.name}
                </TapRevealCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
      <PageControls pages={pages} />
    </>
  );
}
