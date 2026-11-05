"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarIcon, ImageUpIcon, Loader2Icon, ReceiptIcon, StoreIcon, XIcon } from "lucide-react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@convex/_generated/api";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAmount, formatDate, formatRelative } from "@/lib/format";
import { loadOcrEngine, scanReceipt } from "@/lib/ocr/scan";
import { useI18n, type Messages } from "@/lib/i18n";
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

let activeError: string | number | undefined;
let stopListening: (() => void) | undefined;

function dismissScanError() {
  stopListening?.();
  stopListening = undefined;
  if (activeError !== undefined) toast.dismiss(activeError);
  activeError = undefined;
}

/**
 * Scan errors have no timeout. They go away with the X button, or on the next
 * click anywhere on the page (that click still reaches whatever was clicked).
 */
function scanError(message: string) {
  dismissScanError();
  activeError = toast.error(message, {
    duration: Infinity,
    closeButton: true,
    icon: null,
    className: "whitespace-pre-line",
  });
  document.addEventListener("click", dismissScanError, { capture: true, once: true });
  stopListening = () => document.removeEventListener("click", dismissScanError, { capture: true });
}

const MISSING_MESSAGE = {
  store: "missingStore",
  date: "missingDate",
  total: "missingTotal",
} as const;

/** One sentence per missing field, so the user knows exactly what wasn't found. */
function missingMessage(t: Messages, missing: unknown): string {
  const lines = (Array.isArray(missing) ? missing : [])
    .filter((f): f is keyof typeof MISSING_MESSAGE => f in MISSING_MESSAGE)
    .map((f) => t[MISSING_MESSAGE[f]]);
  return lines.length ? [...lines, t.retryTip].join("\n") : t.missing_fields;
}

function serverMessage(t: Messages, data: { code?: string; error?: string }): string | undefined {
  const m = data.code ? t[data.code as keyof Messages] : undefined;
  return typeof m === "string" ? m : data.error;
}

export function ReceiptScanner() {
  const { t, locale } = useI18n();
  const relative = (ms: number) => formatRelative(ms, t.hour, t.minute);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ScannedReceipt | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const stores = useQuery(api.stores.list);

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
      toast.error(t.chooseImage);
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
    if (!file || !stores || status === "scanning") return;
    setStatus("scanning");
    setResult(null);
    try {
      const fields = await scanReceipt(file, stores);
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reset =
          typeof data.resetAt === "number" ? t.canScanAgain(relative(data.resetAt)) : "";
        if (data.code === "missing_fields") {
          scanError(missingMessage(t, data.missing));
          return;
        }
        scanError((serverMessage(t, data) ?? t.scanFailed) + reset);
        return;
      }
      setResult(data.receipt);
      toast.success(t.scanSaved);
    } catch (err) {
      scanError(err instanceof Error ? ocrMessage(t, err.message) : t.scanFailed);
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
      ? t.dbFull
      : t.userMax(quota!.maxUserReceipts)
    : outOfScans
      ? `${t.scanLimit}${quota!.resetAt ? t.tryAgainIn(relative(quota!.resetAt)) : ""}`
      : null;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t.scanTitle}</CardTitle>
        <CardDescription>{t.scanDescription}</CardDescription>
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
            <img src={previewUrl} alt={t.selectedReceipt} className="mx-auto max-h-80 object-contain" />
            <Button
              variant="secondary"
              size="icon-sm"
              className="absolute top-2 right-2"
              onClick={clearFile}
              disabled={status === "scanning"}
              aria-label={t.removeImage}
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
              <p className="font-medium">{t.dropHere}</p>
              <p className="text-sm text-muted-foreground">{t.formats}</p>
            </div>
          </label>
        )}

        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            onClick={scan}
            disabled={!file || !stores || status === "scanning" || blockedReason !== null}
          >
            {status === "scanning" ? (
              <>
                <Loader2Icon className="animate-spin" /> {t.scanning}
              </>
            ) : (
              <>
                <ReceiptIcon /> {t.scanReceipt}
              </>
            )}
          </Button>
          {blockedReason && <p className="text-sm text-destructive">{blockedReason}</p>}
        </div>

        {result && (
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-3">
            <Field icon={<StoreIcon />} label={t.store} value={result.storeName ?? t.notFound} />
            <Field icon={<CalendarIcon />} label={t.date} value={formatDate(result.purchaseDate, locale)} />
            <Field
              icon={<ReceiptIcon />}
              label={t.total}
              value={formatAmount(result.totalAmount, result.currency, locale)}
            />
          </div>
        )}

        {/* Always rendered; the numbers fade in place until the quota arrives, so nothing shifts. */}
        <div className="flex flex-col gap-3 border-t pt-4 text-sm">
          <Usage
            label={quota && quota.windowMs < 3_600_000 ? t.scansLeftPeriod : t.scansLeftHour}
            used={quota ? quota.scansPerWindow - quota.scansRemaining : 0}
            max={quota?.scansPerWindow ?? 1}
            display={quota ? `${quota.scansRemaining} / ${quota.scansPerWindow}` : undefined}
          />
          <Usage
            label={t.yourReceipts}
            used={quota?.userReceipts ?? 0}
            max={quota?.maxUserReceipts ?? 1}
            display={quota ? `${quota.userReceipts} / ${quota.maxUserReceipts}` : undefined}
          />
        </div>
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

function Usage({
  label,
  used,
  max,
  display,
}: {
  label: string;
  used: number;
  max: number;
  /** Undefined while loading. */
  display: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-muted-foreground">
        <span>{label}</span>
        {display === undefined ? (
          <Skeleton className="h-5 w-12" />
        ) : (
          <span className="tabular-nums">{display}</span>
        )}
      </div>
      <Progress value={Math.min(100, (used / max) * 100)} />
    </div>
  );
}

/** The OCR layer throws fixed English messages; map them to the active language. */
function ocrMessage(t: Messages, message: string): string {
  const known: Record<string, string> = {
    "The OCR engine couldn't be loaded. Check your connection and try again.": t.ocrLoad,
    "This image format isn't supported. Try a JPEG or PNG photo.": t.ocrFormat,
    "Your browser can't process images here.": t.ocrBrowser,
  };
  return known[message] ?? message;
}
