"use client";

import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

type Status = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

/**
 * Page-by-page view over a Convex paginated query: fetches the next batch
 * only when the user moves past what has been loaded.
 */
export function usePages<T>(
  results: T[],
  status: Status,
  loadMore: (n: number) => void,
  size: number,
) {
  const [requested, setRequested] = useState(0);
  const lastLoaded = Math.max(0, Math.ceil(results.length / size) - 1);
  // Once everything is loaded, never stay on a page past the end.
  const page = status === "Exhausted" ? Math.min(requested, lastLoaded) : requested;
  const hasNext = (page + 1) * size < results.length || status === "CanLoadMore";
  const loading = status === "LoadingMore";

  return {
    page,
    hasNext,
    loading,
    rows: results.slice(page * size, (page + 1) * size),
    prev: () => setRequested(Math.max(0, page - 1)),
    next: () => {
      if ((page + 2) * size > results.length && status === "CanLoadMore") loadMore(size);
      setRequested(page + 1);
    },
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
        disabled={!pages.hasNext || pages.loading}
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
