import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAuth, requireMembership } from "../helpers";
import { dateKeyOf } from "../lib/payroll/calendar";
import { resolvePayTerms } from "../lib/payroll/rates";
import type { Bracket } from "../lib/payroll/tax";
import type {
    PagibigTable,
    PhilhealthTable,
    SssTable,
} from "../lib/payroll/statutory";
import { computePayslip } from "../lib/payroll/engine";
import type {
    Adjustment,
    Allowance,
    DayRecord,
    DeminimisTable,
    HolidayRule,
} from "../lib/payroll/types";

/**
 * Dry-run preview (P1.5).
 *
 * Runs the engine for one employee and one period and PERSISTS NOTHING — no run,
 * no payslip, no lines. This is what makes the engine reviewable before any money
 * exists, and it is the acceptance surface for P1: the numbers a reviewer sees here
 * are the numbers a fixture asserts.
 *
 * Statuses read: `approved` AND `locked`. An approved-only filter silently drops
 * every locked day, and locking is the last step before a payroll run (the same trap
 * the Phase 1 CSV export had).
 */

/** The statutory table of one kind that is in force at an instant. */
async function tableInForce(
    ctx: QueryCtx,
    kind: "deminimis" | "holiday" | "sss" | "philhealth" | "pagibig" | "tax",
    at: number,
) {
    const rows = await ctx.db
        .query("statutoryTables")
        .withIndex("by_kind_effective", (q) => q.eq("kind", kind))
        .collect();
    const eligible = rows
        .filter(
            (row) =>
                row.effectiveFrom <= at &&
                (row.effectiveTo === undefined || at < row.effectiveTo),
        )
        .sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

/** Payroll periods for the org, newest first — drives the preview's period select. */
export const listPeriods = query({
    args: { orgId: v.id("organizations") },
    handler: async (ctx, { orgId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const rows = await ctx.db
            .query("payrollPeriods")
            .withIndex("by_org_start", (q) => q.eq("orgId", orgId))
            .order("desc")
            .collect();
        return rows;
    },
});

const previewArgs = {
    orgId: v.id("organizations"),
    employeeId: v.id("employees"),
    periodId: v.optional(v.id("payrollPeriods")),
};

/** The loading + compute path, shared by the public query and the ops entry point. */
async function buildPreview(
    ctx: QueryCtx,
    { orgId, employeeId, periodId }: {
        orgId: Id<"organizations">;
        employeeId: Id<"employees">;
        periodId?: Id<"payrollPeriods">;
    },
) {
        const employee = await ctx.db.get(employeeId);
        if (!employee || employee.orgId !== orgId) {
            throw new ConvexError("Employee not found in this organisation");
        }

        // Period: explicit, else the newest one (the preview's default).
        const period = periodId
            ? await ctx.db.get(periodId)
            : await ctx.db
                  .query("payrollPeriods")
                  .withIndex("by_org_start", (q) => q.eq("orgId", orgId))
                  .order("desc")
                  .first();
        if (!period || period.orgId !== orgId) {
            throw new ConvexError(
                "No payroll period for this organisation yet — periods are created with the run (P3). Seed a test dataset to preview against one.",
            );
        }

        // The position row in force at the period's end: the latest effective row
        // that had started by then (D15 — the register resolves pay terms per period).
        const history = await ctx.db
            .query("employeePositions")
            .withIndex("by_employee_effective", (q) => q.eq("employeeId", employeeId))
            .order("desc")
            .collect();
        const inForce = history.find(
            (row) => row.effectiveDate <= period.endDate,
        );
        if (!inForce) {
            throw new ConvexError(
                "No position row in force for this period — add pay terms on the employee's Position History",
            );
        }

        const org = await ctx.db.get(orgId);
        const resolved = resolvePayTerms({
            position: inForce,
            settings: org?.payrollSettings,
        });
        if (resolved.issues.length > 0) {
            // A preview over unresolved pay terms would be a number nobody can
            // defend; report instead of guessing (P0's backfill rule, applied here).
            return {
                status: "unresolved" as const,
                issues: resolved.issues,
                period,
            };
        }

        // Frozen day records (D6: intervals only).
        const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_org_employee_date", (q) =>
                q
                    .eq("orgId", orgId)
                    .eq("employeeId", employeeId)
                    .gte("date", period.startDate)
                    .lte("date", period.endDate),
            )
            .collect();
        const included = entries.filter(
            (entry) => entry.status === "approved" || entry.status === "locked",
        );
        const days: DayRecord[] = included
            .sort((a, b) => a.date - b.date)
            .map((entry) => ({
                entryId: entry._id,
                date: entry.date,
                totalMinutes: entry.totalMinutes,
                intervals: entry.intervals.map((interval) => ({
                    start: interval.start,
                    end: interval.end,
                })),
                status: entry.status,
            }));

        // Allowance units come from the catalogue; the position row stores only
        // code + amount, so the join happens here rather than in the engine.
        const catalogue = await ctx.db
            .query("allowanceTypes")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const unitByCode = new Map(catalogue.map((row) => [row.code, row.unit]));
        const allowances: Allowance[] = resolved.terms.allowances.map((allowance) => ({
            ...allowance,
            unit: unitByCode.get(allowance.code) ?? "monthly",
        }));

        const holidayRow = await tableInForce(ctx, "holiday", period.startDate);
        const holidays = holidayRow
            ? ((holidayRow.payload as { days?: HolidayRule[] }).days ?? [])
            : [];
        const deminimisRow = await tableInForce(ctx, "deminimis", period.endDate);
        const [sssRow, philhealthRow, pagibigRow, taxRow] = await Promise.all([
            tableInForce(ctx, "sss", period.endDate),
            tableInForce(ctx, "philhealth", period.endDate),
            tableInForce(ctx, "pagibig", period.endDate),
            tableInForce(ctx, "tax", period.endDate),
        ]);
        const missingTables = [
            !sssRow ? "sss" : null,
            !philhealthRow ? "philhealth" : null,
            !pagibigRow ? "pagibig" : null,
            !taxRow ? "tax" : null,
        ].filter((kind): kind is string => kind !== null);

        // Which half of the month this period is (D3's residue rule). A period that
        // starts on or before the 15th is the first cutoff, otherwise the second.
        const startDay = Number(dateKeyOf(period.startDate).slice(8, 10));
        const cutoffIndex: 0 | 1 = startDay <= 15 ? 0 : 1;

        const adjustmentRows = await ctx.db
            .query("adjustments")
            .withIndex("by_org_target", (q) =>
                q.eq("orgId", orgId).eq("targetPeriodId", period._id),
            )
            .collect();
        const adjustments: Adjustment[] = adjustmentRows
            .filter((row) => row.employeeId === employeeId)
            .map((row) => ({
                code: row.code,
                description: row.reason,
                amountCentavos: Math.round(row.amount * 100),
                reason: row.reason,
            }));

        const result = computePayslip({
            employee: {
                id: employeeId,
                name: `${employee.firstName} ${employee.lastName}`.trim(),
            },
            profile: { ...resolved.terms, allowances, positionRowId: inForce._id },
            days,
            holidayTable: holidays,
            tables: {
                deminimis: (deminimisRow?.payload as DeminimisTable) ?? undefined,
                sss: (sssRow?.payload as SssTable) ?? undefined,
                philhealth: (philhealthRow?.payload as PhilhealthTable) ?? undefined,
                pagibig: (pagibigRow?.payload as PagibigTable) ?? undefined,
                tax: (taxRow?.payload as { annualBrackets: Bracket[] }) ?? undefined,
            },
            adjustments,
            period: {
                startDate: period.startDate,
                endDate: period.endDate,
                payDate: period.payDate,
                isYearEnd: false,
                cutoffIndex,
            },
            employment: {
                start: employee.hireDate,
                end: undefined,
            },
        });

        return {
            status: "computed" as const,
            period,
            positionRow: inForce,
            cutoffIndex,
            /** Statutory tables that were absent — their lines are simply missing. */
            missingTables,
            terms: { ...resolved.terms, allowances },
            dayCount: days.length,
            /** Days in the period that were deliberately NOT priced, with why. */
            excluded: entries
                .filter(
                    (entry) =>
                        entry.status !== "approved" && entry.status !== "locked",
                )
                .map((entry) => ({ entryId: entry._id, status: entry.status })),
            result,
        };
}

/** Public preview (P1.5) — admin/hr, org-scoped, persists nothing. */
export const previewPayslip = query({
    args: previewArgs,
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, args.orgId);
        return buildPreview(ctx, args);
    },
});
