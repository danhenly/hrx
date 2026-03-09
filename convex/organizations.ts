import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireAuth, requireMembership, requireUserOrg } from "./helpers";

/**
 * Returns the organisation the current user belongs to.
 */
export const getMyOrg = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const membership = await requireUserOrg(ctx, userId);
    const org = await ctx.db.get(membership.orgId);
    return org;
  },
});

/**
 * Update organisation details. Admin only.
 */
export const updateOrg = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    country: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, ...fields }) => {
    const userId = await requireAuth(ctx);
    await requireAdmin(ctx, userId, orgId);
    await ctx.db.patch(orgId, fields);
  },
});
