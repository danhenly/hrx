import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { logAudit } from "../audit";
import { requireAnyAdmin, requireMembership } from "../helpers";
import { allowanceTotalOf, resolvePayTerms } from "../lib/payroll/rates";

/**
 * Copies Phase 1 position rows onto the P0 pay-term fields (P0.2b).
 *
 * DRY RUN BY DEFAULT. Every row that cannot be resolved is REPORTED, never
 * guessed: a daily-paid employee whose row carries only an annual salary has no
 * defensible daily rate, and inventing one would silently mispay every premium
 * computed from it.
 *
 * IDEMPOTENT: a row that already has both `payType` and `basicRate` is skipped,
 * so a second run changes nothing and cannot overwrite a rate a human has since
 * edited.
 *
 *   npx convex run payroll/backfillPayTerms:backfillPayTerms \
 *     '{"orgId":"<id>","actorId":"<admin user id>"}'            # dry run
 *   npx convex run payroll/backfillPayTerms:backfillPayTerms \
 *     '{"orgId":"<id>","actorId":"<admin user id>","dryRun":false}'
 */
export const backfillPayTerms = internalMutation({
    args: {
        orgId: v.id("organizations"),
        actorId: v.id("users"),
        dryRun: v.optional(v.boolean()),
    },
    handler: async (ctx, { orgId, actorId, dryRun = true }) => {
        await requireAnyAdmin(ctx, actorId);
        await requireMembership(ctx, actorId, orgId);

        const org = await ctx.db.get(orgId);
        if (!org) throw new Error("Organisation not found");

        const positions = await ctx.db
            .query("employeePositions")
            .withIndex("by_org", (q) => q.eq("orgId", orgId))
            .collect();

        // The current row per employee: the open one, else the latest effective
        // date — the same rule employees.list uses, so the backfill and the table
        // never disagree about which row is "current".
        const current = new Map<string, Doc<"employeePositions">>();
        for (const row of positions) {
            const incumbent = current.get(row.employeeId);
            if (!incumbent) {
                current.set(row.employeeId, row);
                continue;
            }
            const rowOpen = row.endDate === undefined;
            const incumbentOpen = incumbent.endDate === undefined;
            if (rowOpen !== incumbentOpen) {
                if (rowOpen) current.set(row.employeeId, row);
                continue;
            }
            if (row.effectiveDate > incumbent.effectiveDate) {
                current.set(row.employeeId, row);
            }
        }

        const unresolved: {
            employeeId: string;
            jobTitle: string;
            reason: string;
        }[] = [];
        let alreadySet = 0;
        let updated = 0;

        for (const row of current.values()) {
            if (row.payType !== undefined && row.basicRate !== undefined) {
                alreadySet += 1;
                continue;
            }
            if (row.salary !== undefined && row.salary < 0) {
                unresolved.push({
                    employeeId: row.employeeId,
                    jobTitle: row.jobTitle,
                    reason: "salary on the position row is negative",
                });
                continue;
            }

            const resolved = resolvePayTerms({
                position: row,
                settings: org.payrollSettings,
            });
            if (resolved.issues.length > 0) {
                unresolved.push({
                    employeeId: row.employeeId,
                    jobTitle: row.jobTitle,
                    reason: resolved.issues.join("; "),
                });
                continue;
            }

            if (!dryRun) {
                await ctx.db.patch(row._id, {
                    payType: resolved.terms.payType,
                    basicRate: resolved.terms.basicRate,
                    dailyRateBasis: resolved.terms.dailyRateBasis,
                    workWeek: resolved.terms.workWeek,
                    statutoryBasis: resolved.terms.statutoryBasis,
                    allowanceTotal: allowanceTotalOf(resolved.terms.allowances) / 100,
                });
            }
            updated += 1;
        }

        if (!dryRun && updated > 0) {
            await logAudit(ctx, {
                orgId,
                actorId,
                action: "payroll.payTerms.backfill",
                entityType: "organizations",
                entityId: orgId,
            });
        }

        return {
            dryRun,
            scanned: current.size,
            alreadySet,
            updated,
            unresolved,
        };
    },
});
