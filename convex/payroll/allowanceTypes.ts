import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { logAudit } from "../audit";
import { requireAdmin, requireAuth, requireMembership } from "../helpers";

/**
 * The allowance catalogue (§2.6). Codes are org data, seeded with the
 * Philippine-standard set and referenced from a position row's `allowances[]`
 * — which is why a code is never renamed in place: retire it and add the new one.
 */
export const list = query({
    args: { orgId: v.id("organizations"), includeInactive: v.optional(v.boolean()) },
    handler: async (ctx, { orgId, includeInactive = false }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const rows = await ctx.db
            .query("allowanceTypes")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        return rows
            .filter((row) => includeInactive || row.active)
            .sort((a, b) => a.code.localeCompare(b.code));
    },
});

/** Create or edit one allowance type. Admin only, audited. */
export const upsert = mutation({
    args: {
        orgId: v.id("organizations"),
        code: v.string(),
        description: v.string(),
        unit: v.union(
            v.literal("monthly"),
            v.literal("semi_monthly"),
            v.literal("annual"),
            v.literal("per_day"),
            v.literal("per_period"),
        ),
        taxable: v.boolean(),
        deMinimisKind: v.optional(v.string()),
        active: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, args.orgId);

        const code = args.code.trim().toUpperCase().replace(/\s+/g, "_");
        if (!/^[A-Z][A-Z0-9_]{1,23}$/.test(code)) {
            throw new ConvexError(
                "A code must be 2–24 characters: a letter, then letters, digits or underscores",
            );
        }
        const description = args.description.trim();
        if (description.length < 2) {
            throw new ConvexError("A description is required");
        }

        const existing = await ctx.db
            .query("allowanceTypes")
            .withIndex("by_org_code", (q) => q.eq("orgId", args.orgId).eq("code", code))
            .unique();

        const fields = {
            description,
            unit: args.unit,
            taxable: args.taxable,
            deMinimisKind: args.deMinimisKind?.trim() || undefined,
            active: args.active ?? true,
        };

        let id;
        if (existing) {
            await ctx.db.patch(existing._id, fields);
            id = existing._id;
        } else {
            id = await ctx.db.insert("allowanceTypes", { orgId: args.orgId, code, ...fields });
        }

        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: userId,
            action: existing ? "payroll.allowanceType.update" : "payroll.allowanceType.create",
            entityType: "allowanceTypes",
            entityId: id,
        });

        return { id, created: !existing };
    },
});
