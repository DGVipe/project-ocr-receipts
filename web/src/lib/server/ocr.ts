import "server-only";
import { serverEnv } from "./env";

export type OcrResult = {
  storeName: string | null;
  totalAmount: number | null;
  currency: string | null;
  purchaseDate: string | null;
};

export class OcrError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type OcrResponse = {
  store_name: string | null;
  total_amount: number | null;
  currency: "USD" | "CLP" | null;
  purchase_date: string | null;
};

const TIMEOUT_MS = 50_000;

/** Sends the image to the pytesseract service and returns the parsed fields. */
export async function scanReceipt(file: File): Promise<OcrResult> {
  const body = new FormData();
  body.append("file", file, file.name || "receipt.jpg");

  let res: Response;
  try {
    res = await fetch(`${serverEnv.ocrServiceUrl}/scan`, {
      method: "POST",
      headers: { "X-API-Key": serverEnv.ocrApiKey },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new OcrError(
      timedOut ? "The OCR service took too long to respond." : "The OCR service is unreachable.",
      timedOut ? 504 : 502,
    );
  }

  if (!res.ok) {
    if (res.status === 400 || res.status === 413) {
      throw new OcrError("That file could not be read as an image.", 422);
    }
    if (res.status === 503) {
      throw new OcrError("The OCR service is busy. Try again in a moment.", 503);
    }
    if (res.status === 504) {
      throw new OcrError("The OCR service took too long to respond.", 504);
    }
    throw new OcrError("The OCR service failed to process the image.", 502);
  }

  const data = (await res.json()) as OcrResponse;
  return {
    storeName: typeof data.store_name === "string" ? data.store_name.slice(0, 120) : null,
    totalAmount:
      typeof data.total_amount === "number" && Number.isFinite(data.total_amount)
        ? data.total_amount
        : null,
    currency: data.currency === "USD" || data.currency === "CLP" ? data.currency : null,
    purchaseDate:
      typeof data.purchase_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.purchase_date)
        ? data.purchase_date
        : null,
  };
}
