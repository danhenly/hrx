import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { logAudit } from "../audit";
import { requireAdmin, requireAuth, requireMembership } from "../helpers";
import { fromCentavos } from "../lib/payroll/rates";
import {
    computeFromContext,
    loadEmployeeContext,
    loadStatutoryTables,
} from "./context";

/**
 * The run (P3): compute → review → approve, and never edit.
 *
 * D2 is the whole design: once a run is `approved`, its payslips and lines are
 * frozen. There is no mutation in this file that patches a payslip or a line, and
 * none that deletes one. A correction is an adjustment against the NEXT period, or a
 * void plus a new version. The version that produced a bank credit must stay
 * readable forever.
 */

/** Chunk size for compute. A mutation is one transaction, so a run is resumable. */
const DEFAULT_CHUNK = 25;

// ─── Queries ───────────────────────────────────────────────────────────────

/** Runs for the org, newest first, with their period. */
export const list = query({
    args: { orgId: v.id("organizations"), periodId: v.optional(v.id("payrollPeriods")) },
    handler: async (ctx, { orgId, periodId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const runs = periodId
            ? await ctx.db
                  .query("payrollRuns")
                  .withIndex("by_org_period", (q) =>
                      q.eq("orgId", orgId).eq("periodId", periodId),
                  )
                  .collect()
            : await ctx.db.query("payrollRuns").collect().then((rows) =>
                  rows.filter((row) => row.orgId === orgId),
              );
        // Newest first; `?? 0` needs its own parentheses or the subtraction
        // binds to the nullish coalescing and the comparator returns nonsense.
        return runs.sort((a, b) => (b.computedAt ?? 0) - (a.computedAt ?? 0));
    },
});

/** One run with its payslips and employee names. */
export const get = query({
    args: { runId: v.id("payrollRuns") },
    handler: async (ctx, { runId }) => {
        const userId = await requireAuth(ctx);
        const run = await ctx.db.get(runId);
        if (!run) throw new ConvexError("Run not found");
        await requireMembership(ctx, userId, run.orgId);

        const [period, payslips] = await Promise.all([
            ctx.db.get(run.periodId),
            ctx.db
                .query("payslips")
                .withIndex("by_run", (q) => q.eq("runId", runId))
                .collect(),
        ]);

        const rows = await Promise.all(
            payslips.map(async (payslip) => {
                const employee = await ctx.db.get(payslip.employeeId);
                return {
                    ...payslip,
                    employeeName: employee
                        ? `${employee.firstName} ${employee.lastName}`.trim()
                        : "(deleted employee)",
                };
            }),
        );

        // D5: "13th month accrued to date", visible on the run page. It is a memo,
        // not money — summing the memo lines keeps the run and the payslip agreeing
        // without a second stored total that could drift.
        const lines = await ctx.db
            .query("payslipLines")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect();
        const thirteenthMonthAccrued = lines
            .filter((line) => line.kind === "memo" && line.code === "13M_ACCRUAL")
            .reduce((sum, line) => sum + line.amount, 0);
        const loanTotal = lines
            .filter((line) => line.kind === "deduction" && line.code.endsWith("_LOAN"))
            .reduce((sum, line) => sum + line.amount, 0);

        return {
            run,
            period,
            payslips: rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
            thirteenthMonthAccrued: Math.round(thirteenthMonthAccrued * 100) / 100,
            loanDeductions: Math.round(loanTotal * 100) / 100,
        };
    },
});

/** The lines of one payslip. Read-only by construction. */
export const getPayslip = query({
    args: { payslipId: v.id("payslips") },
    handler: async (ctx, { payslipId }) => {
        const userId = await requireAuth(ctx);
        const payslip = await ctx.db.get(payslipId);
        if (!payslip) throw new ConvexError("Payslip not found");
        await requireMembership(ctx, userId, payslip.orgId);
        const lines = await ctx.db
            .query("payslipLines")
            .withIndex("by_payslip", (q) => q.eq("payslipId", payslipId))
            .collect();
        return { payslip, lines };
    },
});

// ─── Mutations ─────────────────────────────────────────────────────────────

/**
 * Open a run for a period. Computing the same period again creates version + 1
 * (D1) — it never overwrites the earlier version.
 */
export async function createRunCore(
    ctx: MutationCtx,
    { orgId, periodId }: { orgId: Id<"organizations">; periodId: Id<"payrollPeriods"> },
) {
    {
    const period = await ctx.db.get(periodId);
    if (!period || period.orgId !== orgId) {
      throw new ConvexError("Payroll period not found in this organisation");
    }

    const existing = await ctx.db
      .query("payrollRuns")
      .withIndex("by_org_period", (q) =>
        q.eq("orgId", orgId).eq("periodId", periodId),
      )
      .collect();
    const nextVersion =
      existing.reduce((max, run) => Math.max(max, run.version), 0) + 1;

    const runId = await ctx.db.insert("payrollRuns", {
      orgId,
      periodId,
      version: nextVersion,
      status: "draft",
      totals: { gross: 0, deductions: 0, net: 0, employerCost: 0, employeeCount: 0 },
      blocked: [],
    });

    return { runId, version: nextVersion };
    }
}

export const createRun = mutation({
    args: { orgId: v.id("organizations"), periodId: v.id("payrollPeriods") },
    handler: async (ctx, { orgId, periodId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const result = await createRunCore(ctx, { orgId, periodId });
        await logAudit(ctx, {
            orgId,
            actorId: userId,
            action: "payroll.run.create",
            entityType: "payrollRuns",
            entityId: result.runId,
        });
        return result;
    },
});

/**
 * Compute one chunk of a run (P3.2). Idempotent and resumable: employees who
 * already have a payslip in this run are skipped, so a chunk failure blocks only
 * its own employees and calling again continues where it stopped.
 *
 * `hr` may compute and review; only `admin` approves (D12). An approved or paid run
 * is refused outright — the recompute path is a new version.
 */
export async function computeRunCore(
    ctx: MutationCtx,
    {
        orgId,
        runId,
        chunkSize,
    }: {
        orgId: Id<"organizations">;
        runId: Id<"payrollRuns">;
        chunkSize?: number;
    },
) {
    {
        const run = await ctx.db.get(runId);
        if (!run || run.orgId !== orgId) throw new ConvexError("Run not found");
        if (run.status === "approved" || run.status === "paid") {
            throw new ConvexError(
                "This run is frozen — open a new version to recompute it",
            );
        }
        if (run.status === "void") throw new ConvexError("This run was voided");

        const period = await ctx.db.get(run.periodId);
        if (!period) throw new ConvexError("The run's period no longer exists");

        const tables = await loadStatutoryTables(ctx, period.endDate);
        if (tables.missing.length > 0) {
            // A run computed without a statutory table produces gross pay with no
            // contributions, which is worse than refusing.
            throw new ConvexError(
                `No ${tables.missing.join(", ")} table is in force for ${new Date(period.endDate + 8 * 3_600_000).toISOString().slice(0, 10)} — enter the schedule in Settings → Payroll first`,
            );
        }

        const employees = await ctx.db
            .query("employees")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();
        const payslips = await ctx.db
            .query("payslips")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect();
        const paid = new Set(payslips.map((payslip) => payslip.employeeId));
        const blockedIds = new Set(run.blocked.map((row) => row.employeeId));

        const eligible = employees.filter(
            (employee) => employee.hireDate <= period.endDate,
        );
        const todo = eligible
            .filter(
                (employee) =>
                    !paid.has(employee._id) && !blockedIds.has(employee._id),
            )
            .slice(0, Math.max(1, Math.min(chunkSize ?? DEFAULT_CHUNK, 100)));

        const blocked = [...run.blocked];

        for (const employee of todo) {
            const context = await loadEmployeeContext(ctx, {
                orgId,
                employeeId: employee._id,
                period,
            });
            if ("notEmployed" in context) continue; // separated before the period
            if ("unresolved" in context) {
                blocked.push({
                    employeeId: employee._id,
                    reason: context.unresolved.join("; "),
                });
                continue;
            }
            if (context.missingIds.length > 0) {
                // D16: a payslip cannot exist without the numbers the remittance
                // files need. TIN is excluded — it has a documented fallback.
                blocked.push({
                    employeeId: employee._id,
                    reason: `Missing government ID(s): ${context.missingIds.join(", ")}`,
                });
                continue;
            }

            const result = computeFromContext({ context, period, tables });

            const payslipId = await ctx.db.insert("payslips", {
                orgId,
                runId,
                employeeId: employee._id,
                gross: fromCentavos(result.gross),
                totalDeductions: fromCentavos(result.totalDeductions),
                net: fromCentavos(result.net),
                employerCost: fromCentavos(result.employerCost),
                daysWorked: context.days.filter((day) => day.totalMinutes > 0).length,
                minutesWorked: Math.round((result.hoursWorked ?? 0) * 60),
            });

            for (const line of result.lines) {
                await ctx.db.insert("payslipLines", {
                    orgId,
                    payslipId,
                    runId,
                    kind: line.kind,
                    code: line.code,
                    description: line.description,
                    quantity: line.quantity,
                    rate: line.rate === undefined ? undefined : fromCentavos(line.rate),
                    amount: fromCentavos(line.amount),
                    taxable: line.taxable,
                    source: line.source,
                });
            }

            // D9: book the amortisation and move the balance. A run that skips this
            // leaves the loan looking untouched while the payslip says it was paid.
            for (const payment of result.loanPayments ?? []) {
                const loanId = payment.loanId as Id<"loanAccounts">;
                await ctx.db.insert("loanAmortizations", {
                    orgId,
                    loanId,
                    runId,
                    employeeId: employee._id,
                    amount: fromCentavos(payment.amountCentavos),
                    balanceAfter: fromCentavos(payment.balanceAfter),
                    createdAt: Date.now(),
                });
                const loan = await ctx.db.get(loanId);
                if (loan) {
                    await ctx.db.patch(loanId, {
                        balance: fromCentavos(payment.balanceAfter),
                        status: payment.balanceAfter <= 0 ? "closed" : loan.status,
                    });
                }
            }

            // D5: keep the accrual ledger current. The memo line on the payslip is the
            // evidence; this is what the December payout is computed from.
            const accrual = fromCentavos(result.thirteenthMonthAccrualCentavos ?? 0);
            const payout = fromCentavos(result.thirteenthMonthPayoutCentavos ?? 0);
            const exemptPayout = fromCentavos(
                result.lines
                    .filter((line) => line.kind === "earning" && line.code === "13M")
                    .reduce((sum, line) => sum + line.amount, 0),
            );
            if (accrual !== 0 || payout !== 0) {
                const ledgerYear = new Date(period.endDate + 8 * 3_600_000).getUTCFullYear();
                const ledger = await ctx.db
                    .query("thirteenthMonthLedger")
                    .withIndex("by_org_employee_year", (q) =>
                        q.eq("orgId", orgId)
                            .eq("employeeId", employee._id)
                            .eq("year", ledgerYear),
                    )
                    .unique();
                const round2 = (value: number) => Math.round(value * 100) / 100;
                if (ledger) {
                    await ctx.db.patch(ledger._id, {
                        accrued: round2(ledger.accrued + accrual),
                        paid: round2(ledger.paid + payout),
                        exemptUsed: round2(ledger.exemptUsed + exemptPayout),
                        updatedAt: Date.now(),
                    });
                } else {
                    await ctx.db.insert("thirteenthMonthLedger", {
                        orgId,
                        employeeId: employee._id,
                        year: ledgerYear,
                        accrued: round2(accrual),
                        paid: round2(payout),
                        exemptUsed: round2(exemptPayout),
                        updatedAt: Date.now(),
                    });
                }
            }

            // The snapshot that makes this payslip reproducible (§5).
            await ctx.db.insert("payrollInputs", {
                orgId,
                runId,
                employeeId: employee._id,
                days: context.days.map((day) => ({
                    entryId: day.entryId,
                    date: day.date,
                    totalMinutes: day.totalMinutes,
                    intervals: day.intervals,
                    status: day.status,
                })),
                terms: { ...context.terms, allowances: context.allowances },
                tableIds: tables.ids,
                computedAt: Date.now(),
            });
        }

        // Totals come from the payslips themselves, never from an accumulator that a
        // failed chunk could leave short.
        const allPayslips = await ctx.db
            .query("payslips")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .collect();
        const totals = allPayslips.reduce(
            (sum, payslip) => ({
                gross: sum.gross + payslip.gross,
                deductions: sum.deductions + payslip.totalDeductions,
                net: sum.net + payslip.net,
                employerCost: sum.employerCost + payslip.employerCost,
                employeeCount: sum.employeeCount + 1,
            }),
            { gross: 0, deductions: 0, net: 0, employerCost: 0, employeeCount: 0 },
        );

        const remaining = eligible.filter(
            (employee) =>
                !paid.has(employee._id) && !blocked.some((row) => row.employeeId === employee._id),
        ).length;
        const done = remaining === 0;

        await ctx.db.patch(runId, {
            totals: {
                gross: Math.round(totals.gross * 100) / 100,
                deductions: Math.round(totals.deductions * 100) / 100,
                net: Math.round(totals.net * 100) / 100,
                employerCost: Math.round(totals.employerCost * 100) / 100,
                employeeCount: totals.employeeCount,
            },
            blocked,
            status: done ? "computed" : run.status,
            computedAt: done ? Date.now() : run.computedAt,
        });

        return {
            processed: todo.length,
            remaining,
            done,
            blocked: blocked.length,
            employeeCount: totals.employeeCount,
        };
    }
}

export const computeRun = mutation({
    args: {
        orgId: v.id("organizations"),
        runId: v.id("payrollRuns"),
        chunkSize: v.optional(v.number()),
    },
    handler: async (ctx, { orgId, runId, chunkSize }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const result = await computeRunCore(ctx, { orgId, runId, chunkSize });
        if (result.done) {
            await logAudit(ctx, {
                orgId,
                actorId: userId,
                action: "payroll.run.compute",
                entityType: "payrollRuns",
                entityId: runId,
            });
        }
        return result;
    },
});

/** Mark a computed run reviewed — `hr` may review; only `admin` approves (D12). */
export const reviewRun = mutation({
    args: { runId: v.id("payrollRuns") },
    handler: async (ctx, { runId }) => {
        const userId = await requireAuth(ctx);
        const run = await ctx.db.get(runId);
        if (!run) throw new ConvexError("Run not found");
        await requireMembership(ctx, userId, run.orgId);
        if (run.status !== "computed") {
            throw new ConvexError(`A ${run.status} run cannot be reviewed`);
        }
        await ctx.db.patch(runId, { status: "reviewed", reviewedAt: Date.now() });
        await logAudit(ctx, {
            orgId: run.orgId,
            actorId: userId,
            action: "payroll.run.review",
            entityType: "payrollRuns",
            entityId: runId,
        });
    },
});

/**
 * Approve — the maker–checker gate (D12) and the moment the register freezes (D2).
 * Requires `admin`: an `hr` member who computes payroll must not also approve it.
 */
export async function approveRunCore(
    ctx: MutationCtx,
    { userId, runId }: { userId: Id<"users">; runId: Id<"payrollRuns"> },
) {
    {
        const run = await ctx.db.get(runId);
        if (!run) throw new ConvexError("Run not found");
        await requireAdmin(ctx, userId, run.orgId);
        if (run.status !== "computed" && run.status !== "reviewed") {
            throw new ConvexError(
                `A ${run.status} run cannot be approved — compute it first`,
            );
        }
        if (run.blocked.length > 0) {
            throw new ConvexError(
                `${run.blocked.length} employee(s) are blocked — resolve them or remove them from the run before approving`,
            );
        }
        await ctx.db.patch(runId, {
            status: "approved",
            approvedAt: Date.now(),
            approvedBy: userId,
        });
        await logAudit(ctx, {
            orgId: run.orgId,
            actorId: userId,
            action: "payroll.run.approve",
            entityType: "payrollRuns",
            entityId: runId,
        });
    }
}

export const approveRun = mutation({
    args: { runId: v.id("payrollRuns") },
    handler: async (ctx, { runId }) => {
        const userId = await requireAuth(ctx);
        await approveRunCore(ctx, { userId, runId });
    },
});

/** Void a run that has NOT been paid. Money that moved is never un-moved. */
export const voidRun = mutation({
    args: { runId: v.id("payrollRuns"), reason: v.string() },
    handler: async (ctx, { runId, reason }) => {
        const userId = await requireAuth(ctx);
        const run = await ctx.db.get(runId);
        if (!run) throw new ConvexError("Run not found");
        await requireAdmin(ctx, userId, run.orgId);
        const trimmed = reason.trim();
        if (trimmed.length < 3) throw new ConvexError("A reason is required to void a run");
        if (run.status === "paid") {
            throw new ConvexError(
                "This run has been paid — correct it with an adjustment against the next period",
            );
        }
        await ctx.db.patch(runId, { status: "void" });
        await logAudit(ctx, {
            orgId: run.orgId,
            actorId: userId,
            action: "payroll.run.void",
            entityType: "payrollRuns",
            entityId: runId,
        });
    },
});

// ─── D14: a day inside an approved or paid run cannot be unlocked ──────────

/**
 * Which of these time entries are inside an approved or paid payroll run.
 *
 * D14 says a PAID day cannot be reopened; this also covers an APPROVED run, because
 * D2 freezes the register at approval — letting the days move underneath it would
 * make the register unreproducible. The correction path is void + new version.
 */
export async function entriesInFrozenRuns(
    ctx: MutationCtx | QueryCtx,
    orgId: Id<"organizations">,
    entries: { _id: Id<"timeEntries">; date: number }[],
): Promise<Map<string, string>> {
    const frozen = new Map<string, string>();
    if (entries.length === 0) return frozen;

    const periods = await ctx.db
        .query("payrollPeriods")
        .withIndex("by_org_start", (q) => q.eq("orgId", orgId))
        .collect();

    for (const period of periods) {
        const inPeriod = entries.filter(
            (entry) => entry.date >= period.startDate && entry.date <= period.endDate,
        );
        if (inPeriod.length === 0) continue;

        const runs = await ctx.db
            .query("payrollRuns")
            .withIndex("by_org_period", (q) =>
                q.eq("orgId", orgId).eq("periodId", period._id),
            )
            .collect();
        const closed = runs.find(
            (run) => run.status === "approved" || run.status === "paid",
        );
        if (!closed) continue;
        for (const entry of inPeriod) {
            frozen.set(
                entry._id,
                `the ${closed.status} payroll run for ${new Date(period.startDate + 8 * 3_600_000).toISOString().slice(0, 10)} → ${new Date(period.endDate + 8 * 3_600_000).toISOString().slice(0, 10)}`,
            );
        }
    }
    return frozen;
}
