import { ScanLineIcon } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Static shell shown while the page streams in (the language comes from
 * cookies, so the real page can't be prerendered). It mirrors the layout of
 * `SiteHeader` + `ReceiptScanner` and has no text, so nothing shifts or flips
 * language when the real content replaces it.
 */
export function PageSkeleton() {
  return (
    <div className="flex flex-1 flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <ScanLineIcon className="size-5" />
            <Skeleton className="hidden h-5 w-36 sm:block" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-5 w-[30px] rounded-sm" />
            <Skeleton className="h-6 w-11 rounded-full" />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8">
        <Card className="w-full">
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="h-[180px] rounded-lg border-2 border-dashed" />
            <Skeleton className="h-9 w-full" />
            <div className="flex flex-col gap-3 border-t pt-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
