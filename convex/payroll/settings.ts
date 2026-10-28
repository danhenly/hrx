import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { logAudit } from "../audit";
import { requireAdmin, requireAuth, requireMembership } from "../helpers";
import { DEFAULT_PAYROLL_SETTINGS } from "../lib/payroll/rates";
import {
    dailyRateBasisValidator,
    statutoryBasisValidator,
    workWeekValidator,
} from "../schema";

/**
 * Org payroll conventions (P0.5b). Stored on `organizations.payrollSettings` so
 * one client changes a convention without touching 1,200 position rows.
 */
export const get = query({
    args: { orgId: v.id("organizations") },
    handler: async (ctx, { orgId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const org = await ctx.db.get(orgId);
        if (!org) throw new ConvexError("Organisation not found");
        return {
            settings: { ...DEFAULT_PAYROLL_SETTINGS, ...(org.payrollSettings ?? {}) },
            /** TRUE when the org has never saved settings — the page says so. */
            isDefault: org.payrollSettings === undefined,
        };
    },
});

function assertDays(days: number[], label: string) {
    if (days.length !== 2) {
        throw new ConvexError(`${label} needs exactly two days (a semi-monthly convention)`);
    }
    for (const day of days) {
        if (!Number.isInteger(day) || day < 1 || day > 31) {
            throw new ConvexError(`${label} must be whole days between 1 and 31`);
        }
    }
    if (days[0] >= days[1]) {
        throw new ConvexError(`${label} must be in ascending order`);
    }
}

/**
 * Save the org conventions. Admin only, audited.
 *
 * `isTestOrg` is NOT an argument and is carried through untouched: that flag is
 * the only thing standing between a demo dataset and `teardownPayrollDataset`,
 * so no UI path may set it.
 */
export const update = mutation({
    args: {
        orgId: v.id("organizations"),
        workWeek: workWeekValidator,
        cutoffDays: v.array(v.number()),
        payDays: v.array(v.number()),
        statutoryBasis: statutoryBasisValidator,
        dailyRateBasis: dailyRateBasisValidator,
    },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, args.orgId);

        const org = await ctx.db.get(args.orgId);
        if (!org) throw new ConvexError("Organisation not found");

        assertDays(args.cutoffDays, "Cutoff days");
        assertDays(args.payDays, "Pay days");

        await ctx.db.patch(args.orgId, {
            payrollSettings: {
                workWeek: args.workWeek,
                periodType: "semi_monthly",
                cutoffDays: args.cutoffDays,
                payDays: args.payDays,
                statutoryBasis: args.statutoryBasis,
                dailyRateBasis: args.dailyRateBasis,
                isTestOrg: org.payrollSettings?.isTestOrg ?? false,
            },
        });

        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: userId,
            action: "payroll.settings.update",
            entityType: "organizations",
            entityId: args.orgId,
        });
    },
});
