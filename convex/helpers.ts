import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Returns the authenticated userId or throws a 401-equivalent error.
 */
export async function requireAuth(ctx: QueryCtx | MutationCtx) {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Not authenticated");
    return userId;
}

/**
 * Resolves the primary organisation for a user (first membership found).
 * Throws if the user has no org membership.
 */
export async function requireUserOrg(
    ctx: QueryCtx | MutationCtx,
    userId: Id<"users">
) {
    const membership = await ctx.db
        .query("members")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
    if (!membership) throw new ConvexError("User is not a member of any organisation");
    return membership;
}

/**
 * Verifies that `userId` is a member of `orgId` and returns the membership row.
 * Throws if not a member.
 */
export async function requireMembership(
    ctx: QueryCtx | MutationCtx,
    userId: Id<"users">,
    orgId: Id<"organizations">
) {
    const membership = await ctx.db
        .query("members")
        .withIndex("by_user_org", (q) =>
            q.eq("userId", userId).eq("orgId", orgId)
        )
        .unique();
    if (!membership) throw new ConvexError("Access denied");
    return membership;
}

/**
 * Verifies that `userId` is an **admin** of `orgId`.
 * Throws if not a member or not an admin.
 */
export async function requireAdmin(
    ctx: QueryCtx | MutationCtx,
    userId: Id<"users">,
    orgId: Id<"organizations">
) {
    const membership = await requireMembership(ctx, userId, orgId);
    if (membership.role !== "admin")
        throw new ConvexError("Admin role required");
    return membership;
}
