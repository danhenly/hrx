import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { requireAuth, requireMembership } from "../helpers";
import {
    computeFromContext,
    cutoffIndexOf,
    loadEmployeeContext,
    loadStatutoryTables,
} from "./context";

/**
 * Dry-run preview (P1.5).
 *
 * Runs the engine for one employee and one period and PERSISTS NOTHING — no run,
 * no payslip, no lines. The loading lives in payroll/context.ts, so this and a real
 * run compute from exactly the same inputs.
 */

/** Payroll periods for the org, newest first — drives the preview's period select. */
export const listPeriods = query({
    args: { orgId: v.id("organizations") },
    handler: async (ctx, { orgId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        return ctx.db
            .query("payrollPeriods")
            .withIndex("by_org_start", (q) => q.eq("orgId", orgId))
            .order("desc")
            .collect();
    },
});

export const previewPayslip = query({
    args: {
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        periodId: v.optional(v.id("payrollPeriods")),
    },
    handler: async (ctx, { orgId, employeeId, periodId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        const period = periodId
            ? await ctx.db.get(periodId)
            : await ctx.db
                  .query("payrollPeriods")
                  .withIndex("by_org_start", (q) => q.eq("orgId", orgId))
                  .order("desc")
                  .first();
        if (!period || period.orgId !== orgId) {
            throw new ConvexError(
                "No payroll period for this organisation yet — create one on Payroll → Periods.",
            );
        }

        const tables = await loadStatutoryTables(ctx, period.endDate);
        const context = await loadEmployeeContext(ctx, { orgId, employeeId, period });
        if ("notEmployed" in context) {
            // Not the same as "blocked": there is nothing to compute, so the preview
            // says why instead of showing an error that reads like a bug.
            return {
                status: "unresolved" as const,
                issues: [
                    "This employee has no position row in force for this period — not yet hired, or already separated",
                ],
                period,
            };
        }
        if ("unresolved" in context) {
            return { status: "unresolved" as const, issues: context.unresolved, period };
        }

        const result = computeFromContext({ context, period, tables });

        return {
            status: "computed" as const,
            period,
            positionRow: context.positionRow,
            cutoffIndex: cutoffIndexOf(period),
            missingTables: tables.missing,
            terms: { ...context.terms, allowances: context.allowances },
            dayCount: context.days.length,
            excluded: context.excluded,
            missingIds: context.missingIds,
            result,
        };
    },
});
