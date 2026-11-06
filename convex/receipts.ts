import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import { getTotalReceipts } from "./lib";
import { MAX_TOTAL_RECEIPTS } from "./limits";

/** Public, paginated list of every stored receipt (newest first). */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db.query("receipts").order("desc").paginate(paginationOpts);
    return {
      ...result,
      // Strip the user key so clients never see who uploaded what.
      page: result.page.map((r) => ({
        _id: r._id,
        _creationTime: r._creationTime,
        storeName: r.storeName,
        totalAmount: r.totalAmount,
        currency: r.currency,
        purchaseDate: r.purchaseDate,
      })),
    };
  },
});

/** Public, unpaginated list of every stored receipt for the XML export (newest first). */
export const exportAll = query({
  args: {},
  handler: async (ctx) => {
    // The database is capped, so one bounded read covers everything.
    const rows = await ctx.db.query("receipts").order("desc").take(MAX_TOTAL_RECEIPTS);
    return rows.map((r) => ({
      _id: r._id,
      _creationTime: r._creationTime,
      storeName: r.storeName,
      totalAmount: r.totalAmount,
      currency: r.currency,
      purchaseDate: r.purchaseDate,
    }));
  },
});

/** Public storage usage for the whole database. */
export const summary = query({
  args: {},
  handler: async (ctx) => ({
    totalReceipts: await getTotalReceipts(ctx),
    maxTotalReceipts: MAX_TOTAL_RECEIPTS,
  }),
});
