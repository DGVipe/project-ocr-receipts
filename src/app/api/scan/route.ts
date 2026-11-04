import { fetchMutation } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { STORES } from "@/lib/ocr/stores";
import { getIdentity } from "@/lib/server/identity";
import { serverEnv } from "@/lib/server/env";

const STORE_NAMES = new Set(STORES.map(([name]) => name));

function error(message: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error: message, ...extra }, { status });
}

/**
 * The fields the browser's OCR extracted. The client can't be trusted, so
 * anything that isn't a value the parser could have produced becomes null.
 */
function readResult(body: unknown) {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  return {
    storeName: typeof b.storeName === "string" && STORE_NAMES.has(b.storeName) ? b.storeName : null,
    totalAmount:
      typeof b.totalAmount === "number" && Number.isFinite(b.totalAmount) && b.totalAmount > 0
        ? b.totalAmount
        : null,
    currency: b.currency === "USD" || b.currency === "CLP" ? b.currency : null,
    purchaseDate:
      typeof b.purchaseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.purchaseDate)
        ? b.purchaseDate
        : null,
  };
}

export async function POST(request: Request) {
  // Only accept results from this site's own pages.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return error("Cross-origin requests are not allowed.", 403);
  }

  let result: ReturnType<typeof readResult>;
  try {
    result = readResult(await request.json());
  } catch {
    return error("Expected a JSON body.", 400);
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
    console.error("Scan failed", err);
    return error("Something went wrong while saving the receipt.", 500);
  }
}
