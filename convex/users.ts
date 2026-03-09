import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireAdmin, requireAuth, requireMembership } from "./helpers";
import { roleValidator } from "./schema";

/**
 * Returns the current user's profile + their membership row.
 */
export const getMe = query({
    args: {},
    handler: async (ctx) => {
        const userId = await getAuthUserId(ctx);
        if (!userId) return null;
        const user = await ctx.db.get(userId);
        if (!user) return null;
        const membership = await ctx.db
            .query("members")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .first();
        return { ...user, membership };
    },
});

/**
 * List all members of an org (admin or hr can view).
 */
export const listMembers = query({
    args: { orgId: v.id("organizations") },
    handler: async (ctx, { orgId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        const memberships = await ctx.db
            .query("members")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();

        return Promise.all(
            memberships.map(async (m) => {
                const user = await ctx.db.get(m.userId);
                return { ...m, user };
            })
        );
    },
});

/**
 * Remove a member. Admin only. Cannot remove yourself.
 */
export const removeMember = mutation({
    args: { memberId: v.id("members") },
    handler: async (ctx, { memberId }) => {
        const userId = await requireAuth(ctx);
        const target = await ctx.db.get(memberId);
        if (!target) throw new ConvexError("Member not found");
        await requireAdmin(ctx, userId, target.orgId);
        if (target.userId === userId)
            throw new ConvexError("Cannot remove yourself");
        await ctx.db.delete(memberId);
    },
});

/**
 * Update a member's role. Admin only.
 */
export const updateMemberRole = mutation({
    args: { memberId: v.id("members"), role: roleValidator },
    handler: async (ctx, { memberId, role }) => {
        const userId = await requireAuth(ctx);
        const target = await ctx.db.get(memberId);
        if (!target) throw new ConvexError("Member not found");
        await requireAdmin(ctx, userId, target.orgId);
        await ctx.db.patch(memberId, { role });
    },
});

// ─── Internal helpers used by createDirectUser action ─────────────────────

export const _getUserByEmail = internalQuery({
    args: { email: v.string() },
    handler: async (ctx, { email }) => {
        return ctx.db
            .query("users")
            .withIndex("email", (q) => q.eq("email", email))
            .unique();
    },
});

export const _getMembership = internalQuery({
    args: { userId: v.id("users"), orgId: v.id("organizations") },
    handler: async (ctx, { userId, orgId }) => {
        return ctx.db
            .query("members")
            .withIndex("by_user_org", (q) =>
                q.eq("userId", userId).eq("orgId", orgId)
            )
            .unique();
    },
});

export const _createDirectUserInternal = internalMutation({
    args: {
        name: v.string(),
        email: v.string(),
        passwordHash: v.string(),
        role: roleValidator,
        orgId: v.id("organizations"),
    },
    handler: async (ctx, { name, email, passwordHash, role, orgId }) => {
        const newUserId = await ctx.db.insert("users", { name, email });

        // Insert into Convex Auth's authAccounts table so the user can sign in
        // with email + password through the Password provider.
        await ctx.db.insert("authAccounts", {
            userId: newUserId,
            provider: "password",
            providerAccountId: email,
            secret: passwordHash,
        });

        await ctx.db.insert("members", { userId: newUserId, orgId, role });
        return newUserId;
    },
});


