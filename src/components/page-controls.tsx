"use client";

import { useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

type Status = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

/**
 * Rows to request up front: the first page plus one page of lookahead, so the
 * modal opens already knowing whether there is a second page.
 */
export function initialNumItems(size: number) {
  return 2 * size;
}

/**
 * Page-by-page view over a Convex paginated query. Convex reports more data
 * (`CanLoadMore`) whenever the last batch came back full, even if nothing
 * follows it, so status alone can't decide whether Next is shown. Instead, the
 * hook keeps one page loaded past the current one and offers Next only for
 * rows that have actually arrived. Pair it with `initialNumItems(size)`.
 */
export function usePages<T>(
  results: T[],
  status: Status,
  loadMore: (n: number) => void,
  size: number,
) {
  const [requested, setRequested] = useState(0);
  const lastPage = Math.max(0, Math.ceil(results.length / size) - 1);
  const page = Math.min(requested, lastPage);
  const hasNext = (page + 1) * size < results.length;

  const needsLookahead = status === "CanLoadMore" && results.length < (page + 2) * size;
  useEffect(() => {
    if (needsLookahead) loadMore(size);
  }, [needsLookahead, loadMore, size]);

  return {
    page,
    hasNext,
    rows: results.slice(page * size, (page + 1) * size),
    prev: () => setRequested(Math.max(0, page - 1)),
    next: () => setRequested(page + 1),
  };
}

export function PageControls({ pages }: { pages: ReturnType<typeof usePages> }) {
  const { t } = useI18n();
  if (pages.page === 0 && !pages.hasNext) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <Button variant="outline" size="sm" onClick={pages.prev} disabled={pages.page === 0}>
        <ChevronLeftIcon /> {t.previous}
      </Button>
      <span className="text-sm text-muted-foreground tabular-nums">{t.pageLabel(pages.page + 1)}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={pages.next}
        disabled={!pages.hasNext}
      >
        {t.next} <ChevronRightIcon />
      </Button>
    </div>
  );
}

/**
 * Open state for a modal that shows server data. The modal only opens once the
 * data has arrived, so its opening animation plays at its final size, and the
 * subscription (`active`) stays alive until the close animation has finished.
 */
export function useDeferredDialog() {
  const [wantOpen, setWantOpen] = useState(false);
  const [active, setActive] = useState(false);
  return {
    active,
    wantOpen,
    props: (ready: boolean) => ({
      open: wantOpen && ready,
      onOpenChange: (next: boolean) => {
        setWantOpen(next);
        if (next) setActive(true);
      },
      onOpenChangeComplete: (isOpen: boolean) => {
        if (!isOpen) setActive(false);
      },
    }),
  };
}
