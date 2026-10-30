import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { logAudit } from "../audit";
import { requireAdmin, requireAuth, requireMembership } from "../helpers";
import type { Bracket } from "../lib/payroll/tax";
import { sha256Hex } from "../lib/payroll/sha256";
import {
    alphalistPreflight,
    alphalistTotals,
    build2316,
    carryForward,
    renderAlphalist,
    type YearTotals,
} from "../lib/payroll/yearEnd";

/**
 * Year-end (P7): annualisation, 2316 and the alphalist.
 *
 * The year is summed from the REGISTER — every approved or paid run whose period was
 * paid in that year — never from a recomputation of individual periods. `annualise()`
 * is the same function the December run uses, so the certificate and the adjustment
 * cannot disagree (D4).
 */

const MANILA = "Asia/Manila";

function manilaYear(ms: number): number {
    return Number(
        new Intl.DateTimeFormat("en-CA", { timeZone: MANILA, year: "numeric" }).format(new Date(ms)),
    );
}

async function taxTable(ctx: QueryCtx | MutationCtx, year: number): Promise<{ brackets: Bracket[]; version: string }> {
    const rows = await ctx.db.query("statutoryTables").withIndex("by_kind_effective", (q) => q.eq("kind", "tax")).collect();
    if (rows.length === 0) throw new ConvexError("No tax table is seeded — seed the statutory tables first");
    // The table in force at the END of the year is the one that governs it.
    const endOfYear = Date.UTC(year, 11, 31, 23, 59) - 8 * 60 * 60 * 1000;
    const applicable = rows
        .filter((row) => row.effectiveFrom <= endOfYear)
        .sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    const chosen = applicable.at(-1) ?? rows[0];
    const payload = chosen.payload as { annualBrackets?: Bracket[] };
    if (!payload?.annualBrackets) throw new ConvexError("The tax table has no annual brackets");
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: MANILA, year: "numeric", month: "2-digit", day: "2-digit" })
        .format(new Date(chosen.effectiveFrom));
    return { brackets: payload.annualBrackets, version: `tax@${date}` };
}

export async function loadYearEnd(
    ctx: QueryCtx | MutationCtx,
    { orgId, year }: { orgId: Id<"organizations">; year: number },
) {
    const [periods, runs, table] = await Promise.all([
        ctx.db.query("payrollPeriods").withIndex("by_org_start", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("payrollRuns").withIndex("by_org_period", (q) => q.eq("orgId", orgId)).collect(),
        taxTable(ctx, year),
    ]);

    const periodById = new Map(periods.map((period) => [String(period._id), period]));
    const countedRuns = runs.filter((run) => {
        if (run.status !== "approved" && run.status !== "paid") return false;
        const period = periodById.get(String(run.periodId));
        return period ? manilaYear(period.payDate) === year : false;
    });
    const runIds = new Set(countedRuns.map((run) => String(run._id)));

    const lines = await ctx.db
        .query("payslipLines")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect();

    interface Accumulator {
        employeeId: string;
        gross: number; nonTaxable: number; withheld: number; thirteenth: number;
    }
    const byEmployee = new Map<string, Accumulator>();
    const ensure = (employeeId: string): Accumulator => {
        const existing = byEmployee.get(employeeId);
        if (existing) return existing;
        const created: Accumulator = { employeeId, gross: 0, nonTaxable: 0, withheld: 0, thirteenth: 0 };
        byEmployee.set(employeeId, created);
        return created;
    };

    for (const line of lines) {
        if (!runIds.has(String(line.runId))) continue;
        const amount = Math.round(line.amount * 100);
        const acc = ensure(String(line.payslipId)); // keyed by payslip; mapped to employee below
        if (line.kind === "earning") {
            acc.gross += amount;
            if (!line.taxable) acc.nonTaxable += amount;
        } else if (line.code === "TAX") {
            acc.withheld += amount;
        }
        if (line.code === "13M" || line.code === "13M_TAXABLE") acc.thirteenth += amount;
    }

    const payslips = await ctx.db.query("payslips").withIndex("by_org_employee", (q) => q.eq("orgId", orgId)).collect();
    const payslipById = new Map(payslips.map((slip) => [String(slip._id), slip]));

    // Re-key the per-payslip accumulators onto employees.
    const perEmployee = new Map<string, Accumulator>();
    for (const [payslipId, acc] of byEmployee) {
        const slip = payslipById.get(payslipId);
        if (!slip) continue;
        const key = String(slip.employeeId);
        const target = perEmployee.get(key) ?? { employeeId: key, gross: 0, nonTaxable: 0, withheld: 0, thirteenth: 0 };
        target.gross += acc.gross;
        target.nonTaxable += acc.nonTaxable;
        target.withheld += acc.withheld;
        target.thirteenth += acc.thirteenth;
        perEmployee.set(key, target);
    }

    const rows: YearTotals[] = [];
    for (const acc of perEmployee.values()) {
        const employee = await ctx.db.get(acc.employeeId as Id<"employees">);
        const ids = await ctx.db
            .query("employeeStatutoryIds")
            .withIndex("by_org_employee", (q) => q.eq("orgId", orgId).eq("employeeId", acc.employeeId as Id<"employees">))
            .unique();
        rows.push({
            employeeId: acc.employeeId,
            name: employee ? `${employee.lastName}, ${employee.firstName}` : acc.employeeId,
            tin: ids?.tin ?? "",
            grossCentavos: acc.gross,
            nonTaxableCentavos: acc.nonTaxable,
            withheldCentavos: acc.withheld,
            thirteenthMonthCentavos: acc.thirteenth,
        });
    }

    const certificates = build2316(rows, table.brackets);
    const totals = alphalistTotals(certificates);

    // Recorded remittances: the TAX the register booked for those runs — the same
    // figure 1601-C reports, so a divergence here means the pipeline itself is wrong.
    const remittedCentavos = rows.reduce((sum, row) => sum + row.withheldCentavos, 0);
    const preflight = alphalistPreflight({
        withheldCentavos: totals.withheldCentavos,
        remittedCentavos,
    });

    // Carry-forward: 13th month accrued but never released would be an unexplained
    // balance in January, so it is surfaced rather than assumed away.
    // The ledger index is (org, employee, year), so the year is filtered in memory —
    // one org's ledger is small, and adding an index for this alone is not worth it.
    const ledger = (
        await ctx.db
            .query("thirteenthMonthLedger")
            .withIndex("by_org_employee_year", (q) => q.eq("orgId", orgId))
            .collect()
    ).filter((row) => row.year === year);
    const accrued = ledger.reduce((sum, row) => sum + Math.round((row.accrued ?? 0) * 100), 0);
    const paid = ledger.reduce((sum, row) => sum + Math.round((row.paid ?? 0) * 100), 0);
    const carry = carryForward({ accruedCentavos: accrued, paidCentavos: paid, carriedCentavos: 0 });

    const organisation = await ctx.db.get(orgId);
    return {
        year,
        tableVersion: table.version,
        certificates,
        totals,
        preflight,
        carryForward: { accruedCentavos: accrued, paidCentavos: paid, ...carry },
        runCount: countedRuns.length,
        registeredName: organisation?.name ?? "",
        // P9 follow-up: the org carries its own TIN now (D19/A10 retired).
        tin: organisation?.tin ?? "",
    };
}

const previewArgs = { orgId: v.id("organizations"), year: v.number() };

/** Member-visible preview: the 2316 figures for every employee in the year. */
export const previewYearEnd = query({
    args: previewArgs,
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, args.orgId);
        return loadYearEnd(ctx, args);
    },
});

/**
 * Generate the alphalist artefact. Refuses when it does not reconcile — an exported
 * file that disagrees with the remittances is the §1.3 audit finding.
 */
export const generateAlphalist = mutation({
    args: previewArgs,
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, args.orgId);

        const yearEnd = await loadYearEnd(ctx, args);
        if (!yearEnd.preflight.ok) throw new ConvexError(yearEnd.preflight.message);

        // The alphalist is a year artefact; it hangs off the year's last run so it is
        // reachable from the register like every other filing document.
        const runs = await ctx.db
            .query("payrollRuns")
            .withIndex("by_org_period", (q) => q.eq("orgId", args.orgId))
            .collect();
        const periods = await ctx.db
            .query("payrollPeriods")
            .withIndex("by_org_start", (q) => q.eq("orgId", args.orgId))
            .collect();
        const periodById = new Map(periods.map((period) => [String(period._id), period]));
        const inYear = runs
            .filter((run) => {
                if (run.status !== "approved" && run.status !== "paid") return false;
                const period = periodById.get(String(run.periodId));
                return period ? manilaYear(period.payDate) === args.year : false;
            })
            .sort((a, b) => String(a._id).localeCompare(String(b._id)));
        const anchorRun = inYear.at(-1);
        if (!anchorRun) throw new ConvexError(`No approved run was paid in ${args.year}`);

        const content = renderAlphalist(
            {
                tin: yearEnd.tin,
                branchCode: "",
                registeredName: yearEnd.registeredName,
                year: args.year,
                tableVersion: yearEnd.tableVersion,
            },
            yearEnd.certificates,
        );
        const sha256 = await sha256Hex(content);
        const filename = `alphalist-${args.year}.csv`;

        const artefactId = await ctx.db.insert("payrollArtefacts", {
            orgId: args.orgId,
            runId: anchorRun._id,
            kind: "gov_schedule",
            layout: "alphalist",
            filename,
            content,
            sha256,
            rowCount: yearEnd.certificates.length,
            total: yearEnd.totals.withheldCentavos / 100,
            createdBy: userId,
            createdAt: Date.now(),
            tableVersion: yearEnd.tableVersion,
        });

        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: userId,
            action: "payroll.alphalist.generate",
            entityType: "payrollRuns",
            entityId: anchorRun._id,
        });

        return { artefactId, filename, sha256, rowCount: yearEnd.certificates.length, content };
    },
});

/**
 * Close the year. One row per org per year, and only when the alphalist reconciles —
 * closing a year whose figures do not add up is the error the close exists to prevent.
 */
export const closeYear = mutation({
    args: previewArgs,
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, args.orgId);

        const existing = await ctx.db
            .query("payrollYearEnds")
            .withIndex("by_org_year", (q) => q.eq("orgId", args.orgId).eq("year", args.year))
            .unique();
        if (existing) throw new ConvexError(`${args.year} is already closed`);

        const yearEnd = await loadYearEnd(ctx, args);
        if (!yearEnd.preflight.ok) throw new ConvexError(yearEnd.preflight.message);
        if (!yearEnd.carryForward.ok) {
            throw new ConvexError(
                `13th month has ${(yearEnd.carryForward.unexplainedCentavos / 100).toFixed(2)} accrued but neither paid nor carried — resolve it before closing the year`,
            );
        }
        if (yearEnd.certificates.length === 0) throw new ConvexError(`No payslips were paid in ${args.year}`);

        const content = renderAlphalist(
            {
                tin: yearEnd.tin,
                branchCode: "",
                registeredName: yearEnd.registeredName,
                year: args.year,
                tableVersion: yearEnd.tableVersion,
            },
            yearEnd.certificates,
        );
        const alphalistSha256 = await sha256Hex(content);

        const id = await ctx.db.insert("payrollYearEnds", {
            orgId: args.orgId,
            year: args.year,
            employeeCount: yearEnd.certificates.length,
            grossPesos: yearEnd.totals.grossCentavos / 100,
            nonTaxablePesos: yearEnd.totals.nonTaxableCentavos / 100,
            taxablePesos: yearEnd.totals.taxableCentavos / 100,
            taxDuePesos: yearEnd.totals.taxDueCentavos / 100,
            withheldPesos: yearEnd.totals.withheldCentavos / 100,
            trueUpPesos:
                yearEnd.certificates.reduce((sum, row) => sum + row.trueUpCentavos, 0) / 100,
            alphalistSha256,
            tableVersion: yearEnd.tableVersion,
            closedBy: userId,
            closedAt: Date.now(),
        });

        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: userId,
            action: "payroll.year.close",
            entityType: "organizations",
            entityId: args.orgId,
        });

        return { id, year: args.year };
    },
});

/** Years that already have a register, so the UI can offer them. */
export const listYears = query({
    args: { orgId: v.id("organizations") },
    handler: async (ctx, { orgId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const [periods, closed] = await Promise.all([
            ctx.db.query("payrollPeriods").withIndex("by_org_start", (q) => q.eq("orgId", orgId)).collect(),
            ctx.db.query("payrollYearEnds").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ]);
        const years = [...new Set(periods.map((period) => manilaYear(period.payDate)))].sort((a, b) => b - a);
        return years.map((year) => ({
            year,
            closed: closed.some((row) => row.year === year),
        }));
    },
});
