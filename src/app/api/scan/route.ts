import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getIdentity } from "@/lib/server/identity";
import { serverEnv } from "@/lib/server/env";

function error(message: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error: message, ...extra }, { status });
}

/**
 * The fields the browser's OCR extracted. The client can't be trusted, so
 * anything that isn't a value the parser could have produced becomes null.
 */
function readResult(body: unknown, storeNames: Set<string>) {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  return {
    storeName: typeof b.storeName === "string" && storeNames.has(b.storeName) ? b.storeName : null,
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

/** Host of the Origin header, or null when it is opaque ("null") or malformed. */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  // Only accept results from this site's own pages.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host && originHost(origin) !== host) {
    return error("Cross-origin requests are not allowed.", 403, { code: "cross_origin" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Expected a JSON body.", 400, { code: "bad_body" });
  }

  let result: ReturnType<typeof readResult>;
  try {
    const stores = await fetchQuery(api.stores.list, {});
    result = readResult(body, new Set(stores.map((s) => s.name)));
  } catch (err) {
    console.error("Couldn't load the store list", err);
    return error("Something went wrong while saving the receipt.", 500, { code: "save_failed" });
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
    // A receipt is only saved when the store, date and total were all found.
    const missing = [
      ...(result.storeName ? [] : ["store"]),
      ...(result.purchaseDate ? [] : ["date"]),
      ...(result.totalAmount === null ? ["total"] : []),
    ];
    if (missing.length) {
      await fetchMutation(api.scans.fail, { secret, scanId, userKey });
      return error(`Missing from the receipt: ${missing.join(", ")}.`, 422, {
        code: "missing_fields",
        missing,
      });
    }

    const saved = await fetchMutation(api.scans.complete, { secret, scanId, userKey, ...result });
    if (!saved.ok) return error(saved.message, 403, { code: "storage_full" });

    return Response.json({ receipt: { id: saved.receiptId, ...result } });
  } catch (err) {
    await fetchMutation(api.scans.fail, { secret, scanId, userKey }).catch(() => {});
    console.error("Scan failed", err);
    return error("Something went wrong while saving the receipt.", 500, { code: "save_failed" });
  }
}
