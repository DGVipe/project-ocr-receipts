import { fetchMutation } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getIdentity } from "@/lib/server/identity";
import { serverEnv } from "@/lib/server/env";
import { OcrError, scanReceipt } from "@/lib/server/ocr";

// Leave headroom for a cold-starting OCR service.
export const maxDuration = 60;

// Vercel rejects request bodies above 4.5 MB; the client downsizes images first.
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/gif",
]);

function error(message: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error: message, ...extra }, { status });
}

export async function POST(request: Request) {
  // Only accept uploads from this site's own pages.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return error("Cross-origin requests are not allowed.", 403);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return error("Expected a multipart form upload.", 400);
  }
  if (!(file instanceof File) || file.size === 0) {
    return error("No image was uploaded.", 400);
  }
  if (file.size > MAX_BYTES) {
    return error("Image is too large (max 4 MB).", 413);
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return error("Unsupported file type. Upload a JPEG, PNG or WebP image.", 415);
  }

  const { userKey, ipKey } = await getIdentity();
  const secret = serverEnv.convexServerSecret;

  const reservation = await fetchMutation(api.scans.reserve, { secret, userKey, ipKey });
  if (!reservation.ok) {
    const status = reservation.code === "rate_limited" || reservation.code === "busy" ? 429 : 403;
    return error(reservation.message, status, {
      code: reservation.code,
      resetAt: reservation.resetAt ?? null,
    });
  }
  const { scanId } = reservation;

  try {
    const result = await scanReceipt(file);
    if (!result.storeName && result.totalAmount === null && !result.purchaseDate) {
      await fetchMutation(api.scans.fail, { secret, scanId, userKey });
      return error(
        "No receipt details were found. Try a sharper, well-lit photo with the receipt filling the frame.",
        422,
      );
    }

    const saved = await fetchMutation(api.scans.complete, { secret, scanId, userKey, ...result });
    if (!saved.ok) return error(saved.message, 403);

    return Response.json({ receipt: { id: saved.receiptId, ...result } });
  } catch (err) {
    await fetchMutation(api.scans.fail, { secret, scanId, userKey }).catch(() => {});
    if (err instanceof OcrError) return error(err.message, err.status);
    console.error("Scan failed", err);
    return error("Something went wrong while scanning the receipt.", 500);
  }
}
