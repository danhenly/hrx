import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { logAudit } from "../audit";
import { requireAdmin, requireAnyAdmin, requireAuth, requireMembership } from "../helpers";
import { dateKeyOf, msOfDateKey } from "../lib/payroll/calendar";

/**
 * Payroll periods (D1) — three dates, never "the month".
 *
 * The pilot's confirmed convention: cutoffs on the 10th and 25th, paid on the 15th
 * and 30th, with ONE deliberate override for the first period
 * (2026-11-10 → 2026-11-24, paid 2026-11-30) because the client takes over mid-month.
 */

/** Every period with its runs, newest first. */
export const list = query({
    args: { orgId: v.id("organizations") },
    handler: async (ctx, { orgId }) => {
        const userId = await requireAuth(ctx);
        await requireMembership(ctx, userId, orgId);
        const periods = await ctx.db
            .query("payrollPeriods")
            .withIndex("by_org_start", (q) => q.eq("orgId", orgId))
            .order("desc")
            .collect();
        return Promise.all(
            periods.map(async (period) => {
                const runs = await ctx.db
                    .query("payrollRuns")
                    .withIndex("by_org_period", (q) =>
                        q.eq("orgId", orgId).eq("periodId", period._id),
                    )
                    .collect();
                return {
                    ...period,
                    runs: runs.sort((a, b) => b.version - a.version),
                };
            }),
        );
    },
});

/** Refuse a period that overlaps, or repeats a pay date inside, an existing one. */
async function assertNoOverlap(
    ctx: MutationCtx,
    orgId: Id<"organizations">,
    range: { startDate: number; endDate: number },
) {
    const periods = await ctx.db
        .query("payrollPeriods")
        .withIndex("by_org_start", (q) => q.eq("orgId", orgId))
        .collect();
    for (const period of periods) {
        if (range.startDate <= period.endDate && period.startDate <= range.endDate) {
            throw new ConvexError(
                `That range overlaps the period ${dateKeyOf(period.startDate)} → ${dateKeyOf(period.endDate)}`,
            );
        }
    }
}

/** Create one period with explicit dates (the pilot's one-off override). */
export const createPeriod = mutation({
    args: {
        orgId: v.id("organizations"),
        startDate: v.string(),
        endDate: v.string(),
        payDate: v.string(),
    },
    handler: async (ctx, args) => {
        const userId = await requireAuth(ctx);
        await requireAdmin(ctx, userId, args.orgId);

        const startDate = msOfDateKey(args.startDate);
        const endDate = msOfDateKey(args.endDate);
        const payDate = msOfDateKey(args.payDate);
        if (endDate < startDate) {
            throw new ConvexError("The period end must not be before its start");
        }
        if (payDate < endDate) {
            throw new ConvexError("The pay date must not be before the period ends");
        }
        await assertNoOverlap(ctx, args.orgId, { startDate, endDate });

        const id = await ctx.db.insert("payrollPeriods", {
            orgId: args.orgId,
            periodType: "semi_monthly",
            startDate,
            endDate,
            payDate,
            status: "open",
        });

        await logAudit(ctx, {
            orgId: args.orgId,
            actorId: userId,
            action: "payroll.period.create",
            entityType: "payrollPeriods",
            entityId: id,
        });
        return id;
    },
});

/**
 * Generate periods following the org's cutoff convention, starting on `from`.
 *
 * INTERNAL (ops path): the register's "create period" button covers the one-off,
 * and this covers the routine roll-forward without a UI for every month.
 *
 *   npx convex run payroll/periods:generatePeriods \
 *     '{"orgId":"<id>","actorId":"<admin>","from":"2026-11-25","count":3}'
 */
export const generatePeriods = internalMutation({
    args: {
        orgId: v.id("organizations"),
        actorId: v.id("users"),
        from: v.string(),
        count: v.optional(v.number()),
    },
    handler: async (ctx, { orgId, actorId, from, count = 3 }) => {
        await requireAnyAdmin(ctx, actorId);
        await requireMembership(ctx, actorId, orgId);
        if (count < 1 || count > 24) {
            throw new ConvexError("Generate between 1 and 24 periods at a time");
        }

        const org = await ctx.db.get(orgId);
        const cutoffs = org?.payrollSettings?.cutoffDays ?? [10, 25];
        const payDays = org?.payrollSettings?.payDays ?? [15, 30];

        const created: { start: string; end: string; pay: string }[] = [];
        let cursor = msOfDateKey(from);

        for (let index = 0; index < count; index += 1) {
            const startKey = dateKeyOf(cursor);
            const [year, month] = startKey.split("-").map(Number);
            const startDay = Number(startKey.slice(8, 10));

            // Which cutoff closes this period: the first cutoff on/after the start,
            // else the second, else the first of next month.
            let endYear = year;
            let endMonth = month;
            let cutoffIndex: 0 | 1;
            if (startDay <= cutoffs[0]) {
                cutoffIndex = 0;
            } else if (startDay <= cutoffs[1]) {
                cutoffIndex = 1;
            } else {
                cutoffIndex = 0;
                endMonth = month === 12 ? 1 : month + 1;
                endYear = month === 12 ? year + 1 : year;
            }
            const endKey = `${endYear}-${String(endMonth).padStart(2, "0")}-${String(cutoffs[cutoffIndex]).padStart(2, "0")}`;

            // The pay date is the paired pay day, in the month the cutoff falls in.
            let payYear = endYear;
            let payMonth = endMonth;
            const payDay = payDays[cutoffIndex];
            if (payDay < cutoffs[cutoffIndex]) {
                // A pay day earlier in the month than its cutoff belongs to the next
                // month (e.g. cutoff 25 paid 15 would otherwise pay before the work).
                payMonth = payMonth === 12 ? 1 : payMonth + 1;
                payYear = payMonth === 1 ? payYear + 1 : payYear;
            }
            const payKey = `${payYear}-${String(payMonth).padStart(2, "0")}-${String(payDay).padStart(2, "0")}`;

            const startDate = msOfDateKey(startKey);
            const endDate = msOfDateKey(endKey);
            await assertNoOverlap(ctx, orgId, { startDate, endDate });
            await ctx.db.insert("payrollPeriods", {
                orgId,
                periodType: "semi_monthly",
                startDate,
                endDate,
                payDate: msOfDateKey(payKey),
                status: "open",
            });
            created.push({ start: startKey, end: endKey, pay: payKey });
            cursor = endDate + 24 * 3_600_000;
        }

        await logAudit(ctx, {
            orgId,
            actorId,
            action: "payroll.period.generate",
            entityType: "organizations",
            entityId: orgId,
        });

        return { created, count: created.length };
    },
});
