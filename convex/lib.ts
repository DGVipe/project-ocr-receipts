import type { QueryCtx } from "./_generated/server";

/**
 * Mutations that write data are only callable by the Next.js server, which
 * passes a shared secret. Set the same value in Convex
 * (`npx convex env set CONVEX_SERVER_SECRET ...`) and in the Next.js env.
 */
export function assertServer(secret: string) {
  const expected = process.env.CONVEX_SERVER_SECRET;
  if (!expected) {
    throw new Error("CONVEX_SERVER_SECRET is not configured on the Convex deployment");
  }
  if (secret !== expected) {
    throw new Error("Unauthorized");
  }
}

export async function getTotalReceipts(ctx: QueryCtx): Promise<number> {
  const stats = await ctx.db
    .query("stats")
    .withIndex("by_name", (q) => q.eq("name", "global"))
    .unique();
  return stats?.totalReceipts ?? 0;
}
