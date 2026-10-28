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
 * All memberships for a user, one per org they belong to.
 * Never leaks other users' rows.
 */
export async function listUserMemberships(
    ctx: QueryCtx | MutationCtx,
    userId: Id<"users">
) {
    return ctx.db
        .query("members")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
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
 * For INTERNAL functions (`internalMutation`/`internalQuery`), which have no
 * session identity when invoked with `npx convex run`: verifies the supplied
 * actor holds `admin` in at least one org.
 *
 * Internal functions are not client-callable, so this is not a substitute for
 * `requireAdmin` — it is what lets a seed/backfill refuse an actor that is only
 * an `hr` member, and what gives the audit row a real person to name.
 */
export async function requireAnyAdmin(
    ctx: QueryCtx | MutationCtx,
    actorId: Id<"users">
) {
    const memberships = await listUserMemberships(ctx, actorId);
    if (!memberships.some((membership) => membership.role === "admin")) {
        throw new ConvexError("Admin role required");
    }
    return memberships;
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
