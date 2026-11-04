"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarIcon, ImageUpIcon, Loader2Icon, ReceiptIcon, StoreIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatAmount, formatDate, formatRelative } from "@/lib/format";
import { loadOcrEngine, scanReceipt } from "@/lib/ocr/scan";
import { cn } from "@/lib/utils";

type Quota = {
  scansRemaining: number;
  scansPerWindow: number;
  windowMs: number;
  resetAt: number | null;
  userReceipts: number;
  maxUserReceipts: number;
  totalReceipts: number;
  maxTotalReceipts: number;
};

type ScannedReceipt = {
  id: string;
  storeName: string | null;
  totalAmount: number | null;
  currency: string | null;
  purchaseDate: string | null;
};

type Status = "idle" | "scanning";

async function fetchQuota(): Promise<Quota | null> {
  try {
    const res = await fetch("/api/quota", { cache: "no-store" });
    return res.ok ? ((await res.json()) as Quota) : null;
  } catch {
    // Quota display is informational; the server still enforces limits.
    return null;
  }
}

export function ReceiptScanner() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ScannedReceipt | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);

  const refreshQuota = useCallback(async () => {
    const next = await fetchQuota();
    if (next) setQuota(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchQuota().then((next) => {
      if (!cancelled && next) setQuota(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function selectFile(next: File | undefined) {
    if (!next) return;
    if (!next.type.startsWith("image/") && !/\.(heic|heif)$/i.test(next.name)) {
      toast.error("Please choose an image file.");
      return;
    }
    setFile(next);
    setResult(null);
    setPreviewUrl(URL.createObjectURL(next));
    // Start downloading the OCR engine while the user looks at the preview.
    loadOcrEngine().catch(() => {});
  }

  function clearFile() {
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function scan() {
    if (!file || status === "scanning") return;
    setStatus("scanning");
    setResult(null);
    try {
      const fields = await scanReceipt(file);
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reset =
          typeof data.resetAt === "number" ? ` You can scan again in ${formatRelative(data.resetAt)}.` : "";
        toast.error((data.error ?? "Scan failed.") + reset);
        return;
      }
      setResult(data.receipt);
      toast.success("Receipt scanned and saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setStatus("idle");
      void refreshQuota();
    }
  }

  const outOfScans = quota !== null && quota.scansRemaining <= 0;
  const storageFull =
    quota !== null &&
    (quota.userReceipts >= quota.maxUserReceipts || quota.totalReceipts >= quota.maxTotalReceipts);
  const blockedReason = storageFull
    ? quota!.totalReceipts >= quota!.maxTotalReceipts
      ? "The receipt database is full."
      : `You've stored the maximum of ${quota!.maxUserReceipts} receipts.`
    : outOfScans
      ? `Scan limit reached.${quota!.resetAt ? ` Try again in ${formatRelative(quota!.resetAt)}.` : ""}`
      : null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Scan a receipt</CardTitle>
        <CardDescription>
          Upload a photo of a purchase receipt. We&apos;ll read the store name, date and total and save them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          id="receipt-file"
          onChange={(e) => selectFile(e.target.files?.[0])}
        />

        {previewUrl ? (
          <div className="relative overflow-hidden rounded-lg border bg-muted/40">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
            <img src={previewUrl} alt="Selected receipt" className="mx-auto max-h-80 object-contain" />
            <Button
              variant="secondary"
              size="icon-sm"
              className="absolute top-2 right-2"
              onClick={clearFile}
              disabled={status === "scanning"}
              aria-label="Remove image"
            >
              <XIcon />
            </Button>
          </div>
        ) : (
          <label
            htmlFor="receipt-file"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              selectFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors hover:bg-muted/50",
              dragging && "border-primary bg-muted/50",
            )}
          >
            <ImageUpIcon className="size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">Drop a receipt image here, or click to browse</p>
              <p className="text-sm text-muted-foreground">JPEG, PNG, WebP or HEIC photos</p>
            </div>
          </label>
        )}

        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            onClick={scan}
            disabled={!file || status === "scanning" || blockedReason !== null}
          >
            {status === "scanning" ? (
              <>
                <Loader2Icon className="animate-spin" /> Scanning…
              </>
            ) : (
              <>
                <ReceiptIcon /> Scan receipt
              </>
            )}
          </Button>
          {blockedReason && <p className="text-sm text-destructive">{blockedReason}</p>}
        </div>

        {result && (
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
            <Field icon={<StoreIcon />} label="Store" value={result.storeName ?? "Not found"} />
            <Field icon={<CalendarIcon />} label="Date" value={formatDate(result.purchaseDate)} />
            <Field
              icon={<ReceiptIcon />}
              label="Total"
              value={formatAmount(result.totalAmount, result.currency)}
            />
          </div>
        )}

        {quota && (
          <div className="flex flex-col gap-3 border-t pt-4 text-sm">
            <Usage
              label={`Scans left this ${quota.windowMs >= 3_600_000 ? "hour" : "period"}`}
              used={quota.scansPerWindow - quota.scansRemaining}
              max={quota.scansPerWindow}
              display={`${quota.scansRemaining} / ${quota.scansPerWindow}`}
            />
            <Usage
              label="Your stored receipts"
              used={quota.userReceipts}
              max={quota.maxUserReceipts}
              display={`${quota.userReceipts} / ${quota.maxUserReceipts}`}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-medium" title={value}>
          {value}
        </p>
      </div>
    </div>
  );
}

function Usage({ label, used, max, display }: { label: string; used: number; max: number; display: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{display}</span>
      </div>
      <Progress value={Math.min(100, (used / max) * 100)} />
    </div>
  );
}
