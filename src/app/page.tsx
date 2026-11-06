import { ReceiptScanner } from "@/components/receipt-scanner";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-muted/30">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-3 py-4 sm:px-4 sm:py-8">
        <ReceiptScanner />
      </main>
    </div>
  );
}
