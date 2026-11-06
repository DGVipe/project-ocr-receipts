"use client";

import { ScanLineIcon } from "lucide-react";

import { ReceiptsDialog } from "@/components/receipts-dialog";
import { StoresDialog } from "@/components/stores-dialog";
import { SiteControls } from "@/components/site-controls";
import { useI18n } from "@/lib/i18n";

export function SiteHeader() {
  const { t } = useI18n();
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-4 py-3">
        <div className="flex shrink-0 items-center gap-2 font-semibold whitespace-nowrap">
          <ScanLineIcon className="size-5" />
          <span className="hidden md:inline">{t.appName}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <StoresDialog />
          <ReceiptsDialog />
          <SiteControls />
        </div>
      </div>
    </header>
  );
}
