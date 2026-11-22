import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { logAudit } from "../audit";
import { requireAdmin, requireAuth, requireMembership } from "../helpers";
import {
    applyLedgerDelta,
    mergeOpeningBalance,
    openingLedgerDelta,
    roundPesos,
    validateOpeningRow,
    type OpeningRowInput,
} from "../lib/payroll/openingBalances";

/**
 * Opening balances (P11).
 *
 * Import is an upsert per employee per year and is REFUSED row by row rather than in
 * bulk: one bad row must not silently drop the rest, and a skipped row is reported so
 * the operator can fix and re-import it. Because the operator WILL re-import corrected
 * files, the 13th-month ledger moves by the DIFFERENCE a row makes, never by its full
 * figure — importing the same CSV twice changes nothing.
 */

const rowValidator = v.object({
    email: v.optional(v.string()),
    employeeId: v.optional(v.string()),
    gross: v.number(),
    taxable: v.number(),
    taxWithheld: v.number(),
    thirteenthMonth: v.number(),
});

export const importBalances = mutation({
    args: {
        orgId: v.id("organizations"),
        year: v.number(),
        source: v.string(),
        rows: v.array(rowValidator),
    },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, args.orgId);
        if (!Number.isInteger(args.year) || args.year < 2000 || args.year > 2100) {
            throw new ConvexError("A four-digit payroll year is required");
        }
        if (args.source.trim().length < 3) throw new ConvexError("Name the source of these figures");

        const employees = await ctx.db
            .query("employees")
            .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
            .collect();
        const byEmail = new Map(
            employees
                .filter((employee) => employee.email)
                .map((employee) => [String(employee.email).trim().toLowerCase(), employee]),
        );
        const byId = new Map(employees.map((employee) => [String(employee._id), employee]));

        let imported = 0;
        const skipped: { row: number; reason: string }[] = [];
        const seen = new Set<string>();

        for (const [index, row] of args.rows.entries()) {
            const check = validateOpeningRow(row);
            if (!check.ok) {
                skipped.push({ row: index + 1, reason: check.errors.join("; ") });
                continue;
            }
            const employee = row.employeeId
                ? byId.get(row.employeeId)
                : byEmail.get(String(row.email ?? "").trim().toLowerCase());
            if (!employee) {
                skipped.push({
                    row: index + 1,
                    reason: `no employee matches ${row.employeeId ?? row.email ?? "(nothing)"}`,
                });
                continue;
            }
            const key = String(employee._id);
            if (seen.has(key)) {
                skipped.push({ row: index + 1, reason: "this employee appears twice in the file" });
                continue;
            }
            seen.add(key);

            const existing = await ctx.db
                .query("payrollOpeningBalances")
                .withIndex("by_org_employee_year", (q) =>
                    q.eq("orgId", args.orgId).eq("employeeId", employee._id).eq("year", args.year),
                )
                .unique();

            // The ledger moves by what this row CHANGES, so the previous contribution
            // has to be read before the upsert overwrites it.
            const prevThirteenth = existing?.thirteenthMonthPesos ?? 0;

            const values = {
                grossPesos: row.gross,
                taxablePesos: row.taxable,
                taxWithheldPesos: row.taxWithheld,
                thirteenthMonthPesos: row.thirteenthMonth,
                source: args.source.trim(),
                updatedAt: Date.now(),
            };

            if (existing) {
                await ctx.db.patch(existing._id, values);
            } else {
                await ctx.db.insert("payrollOpeningBalances", {
                    orgId: args.orgId,
                    employeeId: employee._id,
                    year: args.year,
                    ...values,
                    createdBy: userId,
                    createdAt: Date.now(),
                });
            }

            // The 13th month already paid must also stop the December run releasing it
            // again, and must consume the ₱90,000 ceiling it already used — but only
            // the part of that figure THIS import added, or a re-import would double-count
            // both the payout and the ceiling usage.
            const ledger = await ctx.db
                .query("thirteenthMonthLedger")
                .withIndex("by_org_employee_year", (q) =>
                    q.eq("orgId", args.orgId).eq("employeeId", employee._id).eq("year", args.year),
                )
                .unique();
            const delta = openingLedgerDelta({
                prevThirteenthPesos: prevThirteenth,
                nextThirteenthPesos: row.thirteenthMonth,
                exemptCeilingCentavos: await exemptCeilingCentavos(ctx),
            });
            const movesLedger = delta.paidDelta !== 0 || delta.exemptDelta !== 0;
            if (ledger) {
                // Nothing to move means the row already says this figure: leave the row
                // (and its updatedAt) untouched so a re-import is provably a no-op.
                if (movesLedger) {
                    await ctx.db.patch(ledger._id, {
                        ...applyLedgerDelta({
                            paid: ledger.paid,
                            exemptUsed: ledger.exemptUsed,
                            paidDelta: delta.paidDelta,
                            exemptDelta: delta.exemptDelta,
                        }),
                        updatedAt: Date.now(),
                    });
                }
            } else if (row.thirteenthMonth > 0) {
                await ctx.db.insert("thirteenthMonthLedger", {
                    orgId: args.orgId,
                    employeeId: employee._id,
                    year: args.year,
                    accrued: 0,
                    paid: roundPesos(row.thirteenthMonth),
                    exemptUsed: roundPesos(delta.nextExemptCentavos / 100),
                    updatedAt: Date.now(),
                });
            }

            imported += 1;
        }

        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: userId,
            action: "payroll.openingBalances.import",
            entityType: "organizations",
            entityId: args.orgId,
        });

        return { imported, skipped };
    },
});

/** The 13th-month exempt ceiling from the current tax table (₱90,000 by default). */
async function exemptCeilingCentavos(ctx: QueryCtx | MutationCtx): Promise<number> {
    const rows = await ctx.db
        .query("statutoryTables")
        .withIndex("by_kind_effective", (q) => q.eq("kind", "tax"))
        .collect();
    const latest = rows.sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];
    const payload = latest?.payload as { thirteenthMonthExemptCeiling?: number } | undefined;
    return Math.round((payload?.thirteenthMonthExemptCeiling ?? 90000) * 100);
}

/** Everything imported for a year, with the employee joined for display. */
export const listBalances = query({
    args: { orgId: v.id("organizations"), year: v.number() },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, args.orgId);
        const rows = await ctx.db
            .query("payrollOpeningBalances")
            .withIndex("by_org_year", (q) => q.eq("orgId", args.orgId).eq("year", args.year))
            .collect();

        const result = [];
        for (const row of rows) {
            const employee = await ctx.db.get(row.employeeId);
            result.push({
                ...row,
                name: employee ? `${employee.lastName}, ${employee.firstName}` : String(row.employeeId),
            });
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    },
});

/** Remove one employee's opening balance (a bad row before the first live run). */
export const deleteBalance = mutation({
    args: { orgId: v.id("organizations"), id: v.id("payrollOpeningBalances") },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, args.orgId);
        const row = await ctx.db.get(args.id);
        if (!row || row.orgId !== args.orgId) throw new ConvexError("Opening balance not found");
        await ctx.db.delete(row._id);

        // Reverse the deleted figure's contribution: a wrong row must not keep
        // suppressing the December payout or keep consuming ceiling it no longer stands
        // for. Only this import's share is subtracted, so the register's own accrual and
        // payout in the same ledger row survive.
        if (row.thirteenthMonthPesos > 0) {
            const ledger = await ctx.db
                .query("thirteenthMonthLedger")
                .withIndex("by_org_employee_year", (q) =>
                    q.eq("orgId", args.orgId).eq("employeeId", row.employeeId).eq("year", row.year),
                )
                .unique();
            if (ledger) {
                const delta = openingLedgerDelta({
                    prevThirteenthPesos: row.thirteenthMonthPesos,
                    nextThirteenthPesos: 0,
                    exemptCeilingCentavos: await exemptCeilingCentavos(ctx),
                });
                await ctx.db.patch(ledger._id, {
                    ...applyLedgerDelta({
                        paid: ledger.paid,
                        exemptUsed: ledger.exemptUsed,
                        paidDelta: delta.paidDelta,
                        exemptDelta: delta.exemptDelta,
                    }),
                    updatedAt: Date.now(),
                });
            }
        }

        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: userId,
            action: "payroll.openingBalances.delete",
            entityType: "employees",
            entityId: row.employeeId,
        });
        return { ok: true };
    },
});

/** The merge used by the year-end report, exported so the two cannot drift. */
export { mergeOpeningBalance };
export type { OpeningRowInput };
