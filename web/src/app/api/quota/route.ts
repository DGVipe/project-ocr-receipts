import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getIdentity } from "@/lib/server/identity";
import { serverEnv } from "@/lib/server/env";

/** The caller's remaining scans and storage usage. */
export async function GET() {
  const { userKey, ipKey } = await getIdentity();
  const quota = await fetchQuery(api.scans.getQuota, {
    secret: serverEnv.convexServerSecret,
    userKey,
    ipKey,
  });
  return Response.json(quota, { headers: { "Cache-Control": "no-store" } });
}
