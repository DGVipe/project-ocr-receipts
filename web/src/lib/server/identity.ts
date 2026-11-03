import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { serverEnv } from "./env";

const COOKIE_NAME = "receipt_uid";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function hash(value: string) {
  return createHmac("sha256", serverEnv.convexServerSecret).update(value).digest("hex");
}

/**
 * Identifies the caller without a login: a random id kept in an httpOnly
 * cookie, plus the client IP. Both are HMAC-hashed before they reach the
 * database, so raw IPs are never stored.
 *
 * Must be called from a Route Handler or Server Function (it may set a cookie).
 */
export async function getIdentity() {
  const jar = await cookies();
  let uid = jar.get(COOKIE_NAME)?.value;
  if (!uid || !UUID_RE.test(uid)) {
    uid = randomUUID();
    jar.set(COOKIE_NAME, uid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }

  const h = await headers();
  // On Vercel these headers are set by the platform and can't be spoofed.
  const ip =
    h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  return { userKey: hash(`user:${uid}`), ipKey: hash(`ip:${ip}`) };
}
