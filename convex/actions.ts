/**
 * Convex actions that require secure, async password operations.
 * We use bcryptjs (pure JS, no native binaries) for all hashing/verification —
 * the same library used by the Password provider in auth.ts.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import bcrypt from "bcryptjs";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { roleValidator } from "./schema";

const SALT_ROUNDS = 12;

/**
 * Admin creates a new user with a pre-set password directly (no invitation email).
 * The admin shares the credentials with the new employee out-of-band.
 */
export const createDirectUser = action({
    args: {
        name: v.string(),
        email: v.string(),
        password: v.string(),
        role: roleValidator,
        orgId: v.id("organizations"),
    },
    returns: v.id("users"),
    handler: async (ctx: ActionCtx, args): Promise<Id<"users">> => {
        // Verify the caller is an authenticated admin
        const callerId = await getAuthUserId(ctx);
        if (!callerId) throw new ConvexError("Not authenticated");

        const membership = await ctx.runQuery(internal.users._getMembership, {
            userId: callerId,
            orgId: args.orgId,
        });
        if (!membership || membership.role !== "admin") {
            throw new ConvexError("Admin role required");
        }

        // Ensure email is not already taken
        const existing = await ctx.runQuery(internal.users._getUserByEmail, {
            email: args.email,
        });
        if (existing) throw new ConvexError("A user with this email already exists");

        // Hash password using the same algorithm as the Password provider in auth.ts
        const passwordHash = await bcrypt.hash(args.password, SALT_ROUNDS);

        // Persist user + auth account + membership
        return ctx.runMutation(internal.users._createDirectUserInternal, {
            name: args.name,
            email: args.email,
            passwordHash,
            role: args.role,
            orgId: args.orgId,
        });
    },
});
