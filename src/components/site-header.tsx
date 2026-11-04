"use client";

import { ScanLineIcon } from "lucide-react";

import { ReceiptsDialog } from "@/components/receipts-dialog";
import { SiteControls } from "@/components/site-controls";
import { useI18n } from "@/lib/i18n";

export function SiteHeader() {
  const { t } = useI18n();
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-2 font-semibold">
          <ScanLineIcon className="size-5" />
          <span className="hidden sm:inline">{t.appName}</span>
        </div>
        <div className="flex items-center gap-3">
          <ReceiptsDialog />
          <SiteControls />
        </div>
      </div>
    </header>
  );
}
