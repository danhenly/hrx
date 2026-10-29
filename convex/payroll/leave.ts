import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { logAudit } from "../audit";
import { requireAdmin, requireAuth, requireMembership } from "../helpers";
import { STANDARD_LEAVE_TYPES, leaveBalance } from "../lib/payroll/leave";

/**
 * Leave (P8.1/P8.2).
 *
 * The types are org data seeded with the standard PH set; the ledger is written by the
 * payroll run that accrued it. No mutation here edits an accrued balance — a correction
 * is an ADJUSTMENT row, the same discipline the register uses (D2).
 */

/** Seed (or refresh) the standard leave types. Idempotent by code. */
export const seedLeaveTypes = mutation({
    args: { orgId: v.id("organizations") },
    handler: async (ctx, { orgId }) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, orgId);

        const existing = await ctx.db
            .query("leaveTypes")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const byCode = new Map(existing.map((row) => [row.code, row]));

        let created = 0;
        let refreshed = 0;
        for (const spec of STANDARD_LEAVE_TYPES) {
            const row = byCode.get(spec.code);
            if (row) {
                // An org that edited its entitlement keeps it: only the statutory
                // definition is refreshed, never an org's own numbers.
                if (spec.statutory && (row.paid !== spec.paid || row.accrualBasis !== spec.accrualBasis)) {
                    await ctx.db.patch(row._id, {
                        paid: spec.paid,
                        accrualBasis: spec.accrualBasis,
                        updatedBy: userId,
                        updatedAt: Date.now(),
                    });
                    refreshed += 1;
                }
                continue;
            }
            await ctx.db.insert("leaveTypes", {
                orgId,
                code: spec.code,
                name: spec.name,
                paid: spec.paid,
                accrualBasis: spec.accrualBasis,
                daysPerYear: spec.daysPerYear,
                convertibleOnSeparation: spec.convertibleOnSeparation,
                minServiceMonths: spec.minServiceMonths,
                statutory: spec.statutory,
                updatedBy: userId,
                updatedAt: Date.now(),
            });
            created += 1;
        }

        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "payroll.leaveTypes.seed",
            entityType: "organizations",
            entityId: orgId,
        });

        return { created, refreshed };
    },
});

/** The org's leave types, for the settings UI and the payroll context. */
export const listTypes = query({
    args: { orgId: v.id("organizations") },
    handler: async (ctx, { orgId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const rows = await ctx.db
            .query("leaveTypes")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        return rows.sort((a, b) => a.code.localeCompare(b.code));
    },
});

/**
 * Balances for one employee (or the whole org). Balance = accrued − used ± adjusted,
 * summed from the ledger the runs wrote — never from an entitlement table.
 */
export const balances = query({
    args: {
        orgId: v.id("organizations"),
        employeeId: v.optional(v.id("employees")),
        year: v.optional(v.number()),
    },
    handler: async (ctx, { orgId, employeeId, year }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        const ledger = (await ctx.db
            .query("leaveLedger")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect()
        ).filter(
            (row) =>
                (employeeId ? row.employeeId === employeeId : true) && (year ? row.year === year : true),
        );

        const types = await ctx.db
            .query("leaveTypes")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const typeByCode = new Map(types.map((type) => [type.code, type]));

        const perEmployee = new Map<
            string,
            Map<string, { accrued: number; used: number; adjusted: number }>
        >();
        for (const row of ledger) {
            const key = String(row.employeeId);
            const forEmployee = perEmployee.get(key) ?? new Map();
            const forType = forEmployee.get(row.leaveCode) ?? { accrued: 0, used: 0, adjusted: 0 };
            forType.accrued += row.accruedDays;
            forType.used += row.usedDays;
            forType.adjusted += row.adjustedDays;
            forEmployee.set(row.leaveCode, forType);
            perEmployee.set(key, forEmployee);
        }

        const result = [];
        for (const [key, forEmployee] of perEmployee) {
            const employee = await ctx.db.get(key as Id<"employees">);
            const codes = [...forEmployee.entries()]
                .map(([code, totals]) => {
                    const type = typeByCode.get(code);
                    return {
                        code,
                        name: type?.name ?? code,
                        paid: type?.paid ?? true,
                        convertibleOnSeparation: type?.convertibleOnSeparation ?? false,
                        accruedDays: totals.accrued,
                        usedDays: totals.used,
                        adjustedDays: totals.adjusted,
                        balanceDays: leaveBalance({
                            accruedDays: totals.accrued,
                            usedDays: totals.used,
                            adjustedDays: totals.adjusted,
                        }),
                    };
                })
                .filter((entry) => entry.balanceDays !== 0 || entry.accruedDays !== 0)
                .sort((a, b) => a.code.localeCompare(b.code));
            result.push({
                employeeId: key,
                name: employee ? `${employee.lastName}, ${employee.firstName}` : key,
                types: codes,
            });
        }

        return result.sort((a, b) => a.name.localeCompare(b.name));
    },
});

/**
 * A manual adjustment to one balance (a carried-over grant, a correction). Adjustments
 * are additive and audited; nothing here overwrites accrued days.
 */
export const adjustBalance = mutation({
    args: {
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        leaveCode: v.string(),
        days: v.number(),
        reason: v.string(),
        periodId: v.id("payrollPeriods"),
    },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, args.orgId);
        if (args.days === 0) throw new ConvexError("An adjustment of zero days is not an adjustment");
        if (args.reason.trim().length < 3) throw new ConvexError("A reason is required");

        const type = await ctx.db
            .query("leaveTypes")
            .withIndex("by_org_code", (q) => q.eq("orgId", args.orgId).eq("code", args.leaveCode))
            .unique();
        if (!type) throw new ConvexError(`Unknown leave type ${args.leaveCode}`);

        const period = await ctx.db.get(args.periodId);
        if (!period || period.orgId !== args.orgId) throw new ConvexError("Period not found");

        const existing = await ctx.db
            .query("leaveLedger")
            .withIndex("by_org_employee_period", (q) =>
                q.eq("orgId", args.orgId)
                    .eq("employeeId", args.employeeId)
                    .eq("periodId", args.periodId),
            )
            .collect();
        const row = existing.find((entry) => entry.leaveCode === args.leaveCode);
        if (row) {
            await ctx.db.patch(row._id, {
                adjustedDays: Math.round((row.adjustedDays + args.days) * 10000) / 10000,
                updatedAt: Date.now(),
            });
        } else {
            await ctx.db.insert("leaveLedger", {
                orgId: args.orgId,
                employeeId: args.employeeId,
                leaveTypeId: type._id,
                leaveCode: args.leaveCode,
                periodId: args.periodId,
                year: new Date(period.endDate + 8 * 3_600_000).getUTCFullYear(),
                accruedDays: 0,
                usedDays: 0,
                adjustedDays: args.days,
                updatedAt: Date.now(),
            });
        }

        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: userId,
            action: "payroll.leave.adjust",
            entityType: "employees",
            entityId: args.employeeId,
        });

        return { ok: true };
    },
});
