import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logAudit } from "./audit";
import {
    listUserMemberships,
    requireAdmin,
    requireAuth,
    requireMembership,
} from "./helpers";

/**
 * Every org the caller belongs to — drives the org switcher and the
 * active-org context.
 */
export const listMyOrgs = query({
    args: {},
    handler: async (ctx) => {
        const userId = await requireAuth(ctx);
        const memberships = await listUserMemberships(ctx, userId);
        const rows = await Promise.all(
            memberships.map(async (m) => {
                const org = await ctx.db.get(m.orgId);
                return org
                    ? {
                        orgId: org._id,
                        name: org.name,
                        role: m.role,
                        membershipId: m._id,
                    }
                    : null; // org row deleted — skip rather than crash
            }),
        );
        return rows.filter((r) => r !== null);
    },
});

/**
 * Single org document by explicit id. Throws if the caller is not a member.
 */
export const getOrg = query({
    args: { orgId: v.id("organizations") },
    handler: async (ctx, { orgId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        return await ctx.db.get(orgId);
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

        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "org.update",
            entityType: "organizations",
            entityId: orgId,
        });
    },
});

/**
 * Company TIN (P7 filing header). Kept here rather than in payroll settings because it
 * identifies the EMPLOYER on every return, not a payroll policy.
 */
export const setTin = mutation({
    args: { orgId: v.id("organizations"), tin: v.string() },
    handler: async (ctx, { orgId, tin }) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, orgId);

        const value = tin.trim();
        // 9 digits, 3 digits, 5 digits — the BIR format; dashes optional on input.
        const digits = value.replace(/\D/g, "");
        if (value.length > 0 && digits.length !== 14) {
            throw new ConvexError("A TIN is 14 digits (000-000-000-00000)");
        }
        const formatted =
            digits.length === 14
                ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}-${digits.slice(9)}`
                : "";

        await ctx.db.patch(orgId, { tin: formatted });
        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "organization.tin.update",
            entityType: "organizations",
            entityId: orgId,
        });
        return { tin: formatted };
    },
});
