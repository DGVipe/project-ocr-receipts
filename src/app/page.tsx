import { ReceiptScanner } from "@/components/receipt-scanner";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-muted/30">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8">
        <ReceiptScanner />
      </main>
    </div>
  );
}
