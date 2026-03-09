import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// role enum shared across members & invitations
export const roleValidator = v.union(v.literal("admin"), v.literal("hr"));

export default defineSchema({
    // Convex Auth tables: users, authAccounts, authSessions,
    // authRefreshTokens, authVerificationCodes, authRateLimits
    ...authTables,

    /**
     * Organizations — the top-level tenant.
     * Every piece of HR data will carry an orgId reference.
     */
    organizations: defineTable({
        name: v.string(),
        address: v.optional(v.string()),
        city: v.optional(v.string()),
        state: v.optional(v.string()),
        country: v.optional(v.string()),
        createdBy: v.id("users"),
    }),

    /**
     * Members — join table linking a user to an organization with a role.
     * This is the source-of-truth for tenant isolation checks.
     */
    members: defineTable({
        userId: v.id("users"),
        orgId: v.id("organizations"),
        role: roleValidator,
    })
        .index("by_user", ["userId"])
        .index("by_org", ["orgId"])
        .index("by_user_org", ["userId", "orgId"]),

    /**
     * Invitations — pending email invitations to join an org.
     * token is a cryptographically random URL-safe string.
     */
    invitations: defineTable({
        email: v.string(),
        orgId: v.id("organizations"),
        role: roleValidator,
        token: v.string(),
        invitedBy: v.id("users"),
        expiresAt: v.number(), // Unix ms
        acceptedAt: v.optional(v.number()),
    })
        .index("by_token", ["token"])
        .index("by_org", ["orgId"])
        .index("by_email", ["email"])
        .index("by_email_org", ["email", "orgId"]),
});
