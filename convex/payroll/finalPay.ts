import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { logAudit } from "../audit";
import { requireAuth, requireMembership } from "../helpers";
import { fromCentavos } from "../lib/payroll/rates";
import {
    computeFromContext,
    loadEmployeeContext,
    loadStatutoryTables,
} from "./context";

/**
 * Final pay (P5.3).
 *
 * Last salary (prorated to the last day), unused SIL conversion, the 13th month
 * accrued so far, less statutory contributions, tax and any outstanding loan — one
 * statement the admin can hand over.
 *
 * The statement is persisted once per employee per separation date, so two clicks
 * cannot pay a resigned employee twice. HRX has no leave ledger, so SIL is the
 * statutory 5 days per completed year and the statement says so.
 */

export const preview = query({
    args: { orgId: v.id("organizations"), employeeId: v.id("employees") },
    handler: async (ctx, { orgId, employeeId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        const history = await ctx.db
            .query("employeePositions")
            .withIndex("by_employee_effective", (q) => q.eq("employeeId", employeeId))
            .order("desc")
            .collect();
        // Only the LATEST row can carry a real separation date. Searching for "any row
        // with an endDate" returns the previous row that an append auto-closed, so every
        // employee with two positions would read as separated (P12 review).
        const latestRow = history[0] ?? null;
        const separationDate = latestRow?.endDate;
        if (separationDate === undefined) {
            return {
                status: "not-separated" as const,
                message:
                    "This employee has no end date on their position history — set the last day there first, and final pay will compute from it.",
            };
        }

        const periods = await ctx.db
            .query("payrollPeriods")
            .withIndex("by_org_start", (q) => q.eq("orgId", orgId))
            .collect();
        const period = periods.find(
            (row) => row.startDate <= separationDate && row.endDate >= separationDate,
        );
        if (!period) {
            return {
                status: "no-period" as const,
                message:
                    "No payroll period covers the separation date — create the period first so statutory contributions can be computed.",
            };
        }

        const tables = await loadStatutoryTables(ctx, period.endDate);
        const context = await loadEmployeeContext(ctx, { orgId, employeeId, period });
        if ("notEmployed" in context) {
            return { status: "not-separated" as const, message: "No position row in force." };
        }
        if ("unresolved" in context) {
            return { status: "unresolved" as const, issues: context.unresolved };
        }

        const result = computeFromContext({ context, period, tables });

        const existing = await ctx.db
            .query("finalPayStatements")
            .withIndex("by_org_employee", (q) =>
                q.eq("orgId", orgId).eq("employeeId", employeeId),
            )
            .collect();

        return {
            status: "computed" as const,
            period,
            separationDate,
            silDays: context.separation?.silDaysUnpaid ?? 0,
            yearsOfService: context.separation?.yearsOfService ?? 0,
            lines: result.lines.filter(
                (line) => line.kind === "earning" || line.kind === "deduction" || line.kind === "memo",
            ),
            totals: {
                gross: fromCentavos(result.gross),
                deductions: fromCentavos(result.totalDeductions),
                net: fromCentavos(result.net),
            },
            alreadyRecorded: existing.some(
                (row) => row.separationDate === separationDate,
            ),
            notes: result.notes ?? [],
            blocked: result.blocked ?? null,
        };
    },
});

export const record = mutation({
    args: {
        orgId: v.id("organizations"),
        employeeId: v.id("employees"),
        reason: v.string(),
    },
    handler: async (ctx, { orgId, employeeId, reason }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);

        const employee = await ctx.db.get(employeeId);
        if (!employee || employee.orgId !== orgId) {
            throw new ConvexError("Employee not found");
        }
        const history = await ctx.db
            .query("employeePositions")
            .withIndex("by_employee_effective", (q) => q.eq("employeeId", employeeId))
            .order("desc")
            .collect();
        // Latest row only — see the note on the preview query above.
        const separationDate = history[0]?.endDate;
        if (separationDate === undefined) {
            throw new ConvexError("The employee has no separation date on position history");
        }
        if (reason.trim().length < 3) {
            throw new ConvexError("A separation reason is required");
        }

        const existing = await ctx.db
            .query("finalPayStatements")
            .withIndex("by_org_employee", (q) =>
                q.eq("orgId", orgId).eq("employeeId", employeeId),
            )
            .collect();
        if (existing.some((row) => row.separationDate === separationDate)) {
            throw new ConvexError(
                "A final-pay statement already exists for this separation date",
            );
        }

        const periods = await ctx.db
            .query("payrollPeriods")
            .withIndex("by_org_start", (q) => q.eq("orgId", orgId))
            .collect();
        const period = periods.find(
            (row) => row.startDate <= separationDate && row.endDate >= separationDate,
        );
        if (!period) throw new ConvexError("No payroll period covers the separation date");

        const tables = await loadStatutoryTables(ctx, period.endDate);
        const context = await loadEmployeeContext(ctx, { orgId, employeeId, period });
        if ("notEmployed" in context || "unresolved" in context) {
            throw new ConvexError("The employee's pay terms are not resolvable");
        }
        const result = computeFromContext({ context, period, tables });
        if (result.blocked) {
            throw new ConvexError(
                `Cannot record a final-pay statement: ${result.blocked.reason}`,
            );
        }

        const statementId = await ctx.db.insert("finalPayStatements", {
            orgId,
            employeeId,
            separationDate,
            lastDay: separationDate,
            reason: reason.trim(),
            lines: result.lines,
            totals: {
                gross: fromCentavos(result.gross),
                deductions: fromCentavos(result.totalDeductions),
                net: fromCentavos(result.net),
            },
            createdBy: userId,
            createdAt: Date.now(),
        });

        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "payroll.finalPay.record",
            entityType: "employees",
            entityId: employeeId,
        });

        return { statementId, totals: { net: fromCentavos(result.net) } };
    },
});
