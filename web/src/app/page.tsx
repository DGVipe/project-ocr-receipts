import { ScanLineIcon } from "lucide-react";
import { ReceiptScanner } from "@/components/receipt-scanner";
import { ReceiptsDialog } from "@/components/receipts-dialog";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <ScanLineIcon className="size-5" />
            Receipt Scanner
          </div>
          <ReceiptsDialog />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8">
        <ReceiptScanner />
      </main>
    </div>
  );
}
