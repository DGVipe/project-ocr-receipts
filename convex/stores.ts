import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/**
 * Public list of the stores the OCR can recognize. The browser fetches it to
 * match receipt text, and the scan route uses it to validate the store name.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const stores = await ctx.db.query("stores").collect();
    return stores.map(({ name, aliases }) => ({ name, aliases }));
  },
});

/** Adds a store, or replaces the aliases of an existing one. Run from the CLI/dashboard; the table starts empty. */
export const upsert = internalMutation({
  args: { name: v.string(), aliases: v.array(v.string()) },
  handler: async (ctx, { name, aliases }) => {
    const existing = await ctx.db
      .query("stores")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { aliases });
    else await ctx.db.insert("stores", { name, aliases });
  },
});
