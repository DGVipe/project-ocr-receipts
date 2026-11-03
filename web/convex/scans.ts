import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServer, getTotalReceipts } from "./lib";
import {
  IP_SCANS_PER_WINDOW,
  MAX_CONCURRENT_SCANS_PER_USER,
  MAX_RECEIPTS_PER_USER,
  MAX_TOTAL_RECEIPTS,
  PENDING_SCAN_TIMEOUT_MS,
  USER_SCANS_PER_WINDOW,
  WINDOW_MS,
} from "./limits";

const identityArgs = {
  secret: v.string(),
  userKey: v.string(),
  ipKey: v.string(),
};

async function recentEvents(
  ctx: QueryCtx,
  index: "by_user_time" | "by_ip_time",
  key: string,
  since: number,
  limit: number,
) {
  const events = ctx.db.query("scanEvents");
  const ranged =
    index === "by_user_time"
      ? events.withIndex(index, (q) => q.eq("userKey", key).gte("createdAt", since))
      : events.withIndex(index, (q) => q.eq("ipKey", key).gte("createdAt", since));
  return await ranged.order("asc").take(limit + 1);
}

async function countUserReceipts(ctx: QueryCtx, userKey: string) {
  const rows = await ctx.db
    .query("receipts")
    .withIndex("by_user", (q) => q.eq("userKey", userKey))
    .take(MAX_RECEIPTS_PER_USER + 1);
  return rows.length;
}

async function computeQuota(ctx: QueryCtx, userKey: string, ipKey: string) {
  const now = Date.now();
  const since = now - WINDOW_MS;
  const userEvents = await recentEvents(ctx, "by_user_time", userKey, since, USER_SCANS_PER_WINDOW);
  const ipEvents = await recentEvents(ctx, "by_ip_time", ipKey, since, IP_SCANS_PER_WINDOW);

  const userRemaining = Math.max(0, USER_SCANS_PER_WINDOW - userEvents.length);
  const ipRemaining = Math.max(0, IP_SCANS_PER_WINDOW - ipEvents.length);
  const scansRemaining = Math.min(userRemaining, ipRemaining);

  // When the binding limit is exhausted, the oldest event in that window
  // determines when a slot frees up.
  let resetAt: number | null = null;
  if (scansRemaining === 0) {
    const limiting = userRemaining === 0 ? userEvents : ipEvents;
    const limit = userRemaining === 0 ? USER_SCANS_PER_WINDOW : IP_SCANS_PER_WINDOW;
    const oldest = limiting[limiting.length - limit];
    resetAt = oldest ? oldest.createdAt + WINDOW_MS : now + WINDOW_MS;
  }

  const inFlight = userEvents.filter(
    (e) => e.status === "pending" && e.createdAt > now - PENDING_SCAN_TIMEOUT_MS,
  ).length;

  return {
    scansRemaining,
    scansPerWindow: USER_SCANS_PER_WINDOW,
    windowMs: WINDOW_MS,
    resetAt,
    inFlight,
    userReceipts: await countUserReceipts(ctx, userKey),
    maxUserReceipts: MAX_RECEIPTS_PER_USER,
    totalReceipts: await getTotalReceipts(ctx),
    maxTotalReceipts: MAX_TOTAL_RECEIPTS,
  };
}

type Rejection = {
  ok: false;
  code: "rate_limited" | "busy" | "user_cap" | "global_cap";
  message: string;
  resetAt?: number | null;
};

/** Returns the reason a new scan cannot start, or null if it can. */
function checkLimits(quota: Awaited<ReturnType<typeof computeQuota>>): Rejection | null {
  if (quota.totalReceipts >= quota.maxTotalReceipts) {
    return {
      ok: false,
      code: "global_cap",
      message: "The receipt database is full. No new receipts can be stored.",
    };
  }
  if (quota.userReceipts >= quota.maxUserReceipts) {
    return {
      ok: false,
      code: "user_cap",
      message: `You have reached the limit of ${quota.maxUserReceipts} stored receipts.`,
    };
  }
  if (quota.inFlight >= MAX_CONCURRENT_SCANS_PER_USER) {
    return {
      ok: false,
      code: "busy",
      message: "You already have a scan in progress. Wait for it to finish.",
    };
  }
  if (quota.scansRemaining <= 0) {
    return {
      ok: false,
      code: "rate_limited",
      message: "Scan limit reached. Try again later.",
      resetAt: quota.resetAt,
    };
  }
  return null;
}

/** Usage numbers shown in the UI. Server-only because it takes identity keys. */
export const getQuota = query({
  args: identityArgs,
  handler: async (ctx, { secret, userKey, ipKey }) => {
    assertServer(secret);
    return await computeQuota(ctx, userKey, ipKey);
  },
});

/**
 * Reserves a scan slot before the image is sent to the OCR service.
 * Convex mutations are serializable, so two simultaneous requests from the
 * same user cannot both pass the checks.
 */
export const reserve = mutation({
  args: identityArgs,
  handler: async (ctx, { secret, userKey, ipKey }) => {
    assertServer(secret);
    const quota = await computeQuota(ctx, userKey, ipKey);
    const rejection = checkLimits(quota);
    if (rejection) return rejection;

    const scanId = await ctx.db.insert("scanEvents", {
      userKey,
      ipKey,
      status: "pending",
      createdAt: Date.now(),
    });
    return { ok: true as const, scanId };
  },
});

/** Stores the OCR result and closes the reservation. */
export const complete = mutation({
  args: {
    secret: v.string(),
    scanId: v.id("scanEvents"),
    userKey: v.string(),
    storeName: v.union(v.string(), v.null()),
    totalAmount: v.union(v.number(), v.null()),
    currency: v.union(v.string(), v.null()),
    purchaseDate: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { secret, scanId, userKey, ...data }) => {
    assertServer(secret);
    const event = await ctx.db.get(scanId);
    if (!event || event.userKey !== userKey || event.status !== "pending") {
      throw new Error("Invalid or already completed scan");
    }

    // Re-check the storage caps: other scans may have finished meanwhile.
    const totalReceipts = await getTotalReceipts(ctx);
    const userReceipts = await countUserReceipts(ctx, userKey);
    if (totalReceipts >= MAX_TOTAL_RECEIPTS || userReceipts >= MAX_RECEIPTS_PER_USER) {
      await ctx.db.patch(scanId, { status: "failed" });
      return {
        ok: false as const,
        message: "Storage limit reached. The receipt was not saved.",
      };
    }

    const receiptId = await ctx.db.insert("receipts", { userKey, ...data });

    const stats = await ctx.db
      .query("stats")
      .withIndex("by_name", (q) => q.eq("name", "global"))
      .unique();
    if (stats) {
      await ctx.db.patch(stats._id, { totalReceipts: stats.totalReceipts + 1 });
    } else {
      await ctx.db.insert("stats", { name: "global", totalReceipts: 1 });
    }

    await ctx.db.patch(scanId, { status: "done" });
    return { ok: true as const, receiptId };
  },
});

/** Closes a reservation whose OCR failed. The attempt still counts toward the rate limit. */
export const fail = mutation({
  args: { secret: v.string(), scanId: v.id("scanEvents"), userKey: v.string() },
  handler: async (ctx, { secret, scanId, userKey }) => {
    assertServer(secret);
    const event = await ctx.db.get(scanId);
    if (event && event.userKey === userKey && event.status === "pending") {
      await ctx.db.patch(scanId, { status: "failed" });
    }
  },
});

/** Cron: deletes scan events that are older than the rate-limit window. */
export const pruneOldEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - WINDOW_MS;
    const batch = await ctx.db
      .query("scanEvents")
      .withIndex("by_time", (q) => q.lt("createdAt", cutoff))
      .take(500);
    for (const event of batch) {
      await ctx.db.delete(event._id);
    }
    if (batch.length === 500) {
      await ctx.scheduler.runAfter(0, internal.scans.pruneOldEvents, {});
    }
  },
});
